// Every Thumb Studio MCP tool, registered onto a server instance.
//
// Transport-agnostic on purpose: mcp/src/stdio.ts runs this locally over stdio with a token
// from the environment, and mcp/src/http.ts serves the same tools over Streamable HTTP with
// each request's own bearer. One implementation, so the two can never drift.
//
// This package lives in the repo and imports src/state.ts and src/presets.ts directly, so the
// agent gets the real layer factories and the real validator rather than a snapshot.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { validateDoc } from "../../server/src/validate";
import { adaptDocToFormat, adaptDocToFormats } from "../../src/lib/adapt";
import { TEMPLATE_LABELS, TEMPLATES, type TemplateKey } from "../../src/presets";
import {
  DEFAULT_FORMAT,
  FONT_LABELS,
  FORMATS,
  type FormatKey,
  type Layer,
  SIZE_LIMITS,
  type ThumbDoc,
  detachLayer,
  newLayerId,
  newBrandLayer,
  newDrawLayer,
  newEffectLayer,
  newEmojiFxLayer,
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
} from "../../src/state";
import { type Api, ApiError } from "./client";

type ProjectMeta = { id: string; name: string; updatedAt: number; campaignId?: string | null; warnings?: string[] };
type CampaignMeta = { id: string; name: string; updatedAt: number; designCount: number };
type StarredMeta = { id: string; name: string; kind: string; sourceProjectName: string | null; lastUsedAt: number };
type StarredItem = StarredMeta & { layer: Layer };

const formatKeys = Object.keys(FORMATS) as [FormatKey, ...FormatKey[]];
const templateKeys = Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]];

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string) => ({ ...text(message), isError: true });

/**
 * Schema for a `doc` argument.
 *
 * The inner `looseObject` is what makes the published JSON Schema say `type: "object"` — with a
 * bare `z.unknown()` the property carried no type at all, and clients that infer argument types
 * from the schema (Claude Code among them) sent the whole document as a JSON *string*, which then
 * failed preflight with "document must be an object". The `preprocess` keeps accepting a
 * stringified document from clients that stringify anyway.
 */
export const docInput = (description: string) =>
  z
    .preprocess(
      (v) => {
        if (typeof v !== "string") return v;
        try {
          return JSON.parse(v);
        } catch {
          return v; // rejected below — the message says what to send
        }
      },
      z.looseObject(
        {},
        {
          error:
            "must be a ThumbDoc object — { format, background, layers } — or a JSON string of one. " +
            "Call get_doc_schema for the contract.",
        }
      )
    )
    .describe(description);

/**
 * Extracts a project id from either a bare id or an editor link that carries one
 * (`https://thumb.example/?project=<id>`). Returns null when a link has no `project` param.
 *
 * The editor keeps `?project=<id>` in the address bar, so the URL a user copies out of their
 * browser *is* what they paste at an agent. Every project tool accepts that form, so no one has
 * to dig the id out of a query string by hand.
 */
export function projectIdFrom(ref: string): string | null {
  const raw = ref.trim();
  if (!raw) return null;
  if (!/[:/?]/.test(raw)) return raw; // already a bare id
  try {
    // Relative base: also accepts "/?project=<id>" and "?project=<id>".
    return new URL(raw, "https://thumb.invalid").searchParams.get("project")?.trim() || null;
  } catch {
    return null;
  }
}

/** The `id` argument of every project tool: an id, or an editor URL holding one. */
const projectRef = (what: string) =>
  z.string().min(1).describe(`${what} — a project id, or an editor URL containing ?project=<id>`);

const badRef = (ref: string) =>
  fail(
    `Could not read a project id from ${JSON.stringify(ref)}. Pass the id itself, or an editor ` +
      `URL of the form https://…/?project=<id>. Call list_projects to see the ids in the account.`
  );

/** Largest image an agent may hand over. The API accepts 25 MB, but a base64 argument that
 *  size is ~33 MB of JSON through the transport — refuse it here with a message that says so
 *  rather than letting it die somewhere less legible. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Turns the `data` argument of `upload_image` into bytes.
 *
 * Accepts a `data:` URL (whose own media type wins, since that's the one the encoder wrote)
 * or bare base64. Whitespace is stripped because base64 that has travelled through YAML,
 * a shell heredoc or a chat message is usually wrapped.
 */
export function decodeImageInput(data: string, contentType?: string): { bytes: Uint8Array; contentType: string } | string {
  const trimmed = data.trim();
  const dataUrl = /^data:([^;,]+)?(;base64)?,/i.exec(trimmed);
  if (dataUrl && !dataUrl[2]) return "must be base64 — a `data:…;base64,…` URL or bare base64, not a URL-encoded one.";

  const payload = (dataUrl ? trimmed.slice(dataUrl[0].length) : trimmed).replace(/\s+/g, "");
  if (!payload) return "is empty.";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return "is not valid base64.";

  const type = dataUrl?.[1] || contentType || "image/png";
  if (!type.startsWith("image/")) return `has content type ${type}; only image/* can be used as a layer source.`;

  let bytes: Uint8Array;
  try {
    const binary = atob(payload);
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return "could not be decoded as base64.";
  }
  if (bytes.byteLength === 0) return "decoded to zero bytes.";
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return `is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit through this tool is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Downscale it first.`;
  }
  return { bytes, contentType: type };
}

/** Validates with the same code the server runs, so a malformed doc costs no round trip. */
function preflight(doc: unknown): string | null {
  const errors = validateDoc(doc);
  if (errors.length === 0) return null;
  return [
    "Document rejected by the ThumbDoc schema. Fix these and retry:",
    ...errors.slice(0, 30).map((e) => `  - ${e}`),
    "",
    "Call get_doc_schema for the full contract, or new_layer to start from valid defaults.",
  ].join("\n");
}

/** Registers every tool onto `srv`, talking to Thumb Studio through `api`. */
export function registerTools(srv: McpServer, api: Api): void {
  const projectLink = (id: string) => `${api.baseUrl}/?project=${id}`;

  // ── discovery ─────────────────────────────────────────────────────────────
  srv.registerTool(
    "get_design_reference",
    {
      title: "Get design reference",
      description:
        "Canvas formats (with pixel dimensions), available font keys, and layer size limits. " +
        "Read this first — coordinates and sizes are meaningless without the canvas dimensions.",
      inputSchema: {},
    },
    async () =>
      text({
        defaultFormat: DEFAULT_FORMAT,
        formats: FORMATS,
        fonts: FONT_LABELS,
        sizeLimitsAdvisory: SIZE_LIMITS,
        note:
          "Layers are positioned in the authoring space of their format (x/y = top-left). " +
          "Array order is paint order: layers[0] is the backmost. Size limits are UI slider " +
          "bounds, not schema constraints.",
      })
  );

  srv.registerTool(
    "get_doc_schema",
    {
      title: "Get the ThumbDoc JSON Schema",
      description: "The full published JSON Schema for a design document. Large — fetch it only when you need field-level detail.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await api.get("/schema"));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "list_templates",
    {
      title: "List starting templates",
      description: "Named starting points. Prefer starting from one of these over composing from scratch.",
      inputSchema: {},
    },
    async () => text(Object.keys(TEMPLATES).map((key) => ({ key, label: TEMPLATE_LABELS[key as TemplateKey] })))
  );

  srv.registerTool(
    "get_template",
    {
      title: "Get a template document",
      description: "Returns a complete, valid ThumbDoc to edit and then save. Optionally rescaled to a target format.",
      inputSchema: {
        key: z.enum(templateKeys).describe("Template key from list_templates"),
        format: z.enum(formatKeys).optional().describe("Rescale layers to this format (templates are authored for youtube)"),
      },
    },
    async ({ key, format }) => {
      const doc = TEMPLATES[key]();
      return text(format && format !== doc.format ? adaptDocToFormat(doc, format) : doc);
    }
  );

  srv.registerTool(
    "new_layer",
    {
      title: "Create a layer with valid defaults",
      description:
        "Returns a fresh layer of the given kind with every required field populated and a unique id. " +
        "Use this instead of hand-writing layers — then override only the fields you care about.",
      inputSchema: {
        kind: z
          .enum(["text", "image", "brand-logo", "brand-wordmark", "emoji", "emojifx", "effect", "rect", "pill", "bar", "draw"])
          .describe("What to create. 'brand-*' are the built-in Claude marks and need no image upload."),
      },
    },
    async ({ kind }) => {
      switch (kind) {
        case "text":
          return text(newTextLayer());
        case "image":
          return text(newImageLayer());
        case "brand-logo":
          return text(newBrandLayer("logo"));
        case "brand-wordmark":
          return text(newBrandLayer("wordmark"));
        case "emoji":
          return text(newEmojiLayer());
        case "emojifx":
          return text(newEmojiFxLayer());
        case "effect":
          return text(newEffectLayer());
        case "rect":
        case "pill":
        case "bar":
          return text(newShapeLayer(kind));
        case "draw":
          return text(
            newDrawLayer([
              { x: 0, y: 40 },
              { x: 120, y: 0 },
            ])
          );
      }
    }
  );

  srv.registerTool(
    "upload_image",
    {
      title: "Upload an image",
      description:
        "Stores image bytes in the account and returns a `blob:<id>` reference to use as an image layer's " +
        "`src` or as `background.image`. Pass base64 — a `data:image/png;base64,…` URL or bare base64. " +
        "Without this, a design can only use the built-in brand marks, emoji and shapes.",
      inputSchema: {
        data: z.string().min(1).describe("The image as base64 (data: URL or bare). Max 8 MB decoded."),
        contentType: z
          .string()
          .optional()
          .describe("MIME type such as image/png. Ignored for a data: URL, which carries its own."),
      },
    },
    async ({ data, contentType }) => {
      const decoded = decodeImageInput(data, contentType);
      if (typeof decoded === "string") return fail(`\`data\` ${decoded}`);
      try {
        const { id } = await api.postBytes<{ id: string }>("/blobs", decoded.bytes, decoded.contentType);
        return text({
          ref: `blob:${id}`,
          bytes: decoded.bytes.byteLength,
          contentType: decoded.contentType,
          usage: "Put this in an image layer's `src` (new_layer kind:\"image\"), or in background.image. The editor turns it back into a picture on open.",
        });
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  // ── favourites (single layers the user saved out of a design) ───────────────
  //
  // The editor's starred collection is where a channel's actual visual language lives — the
  // logo lockup, the badge, the title treatment that gets reused every episode. An agent that
  // can't reach it has to reinvent them, badly, every time.
  srv.registerTool(
    "list_starred_elements",
    {
      title: "List saved elements",
      description:
        "The user's collection of favourite layers — logos, badges, title treatments they reuse. " +
        "Most recently used first. Prefer these over inventing a new element from scratch.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await api.get<StarredMeta[]>("/starred"));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "get_starred_element",
    {
      title: "Get a saved element",
      description:
        "One favourite, including its layer JSON — ready to drop into a document's `layers`. " +
        "Re-id it (or use add_starred_element, which does) before adding it to a document.",
      inputSchema: { id: z.string().min(1).describe("Element id from list_starred_elements") },
    },
    async ({ id }) => {
      try {
        return text(await api.get<StarredItem>(`/starred/${id}`));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "add_starred_element",
    {
      title: "Add a saved element to a project",
      description:
        "Appends a favourite to a project's document, on top of everything else, with a fresh id. " +
        "Optionally place it — coordinates are the layer's top-left in canvas space (see get_design_reference).",
      inputSchema: {
        element: z.string().min(1).describe("Element id from list_starred_elements"),
        project: projectRef("Project to add it to"),
        x: z.number().optional().describe("Left edge in canvas units; keeps the element's own x when omitted"),
        y: z.number().optional().describe("Top edge in canvas units; keeps the element's own y when omitted"),
      },
    },
    async ({ element, project, x, y }) => {
      const id = projectIdFrom(project);
      if (!id) return badRef(project);
      try {
        const [item, current] = await Promise.all([
          api.get<StarredItem>(`/starred/${element}`),
          api.get<{ name: string; doc: ThumbDoc }>(`/projects/${id}`),
        ]);
        // Detach + re-id: a favourite carries its old group link and id, and pasting either
        // into another document collides with whatever is already there.
        const layer: Layer = {
          ...detachLayer(item.layer),
          id: newLayerId(),
          ...(x === undefined ? {} : { x }),
          ...(y === undefined ? {} : { y }),
        };
        const doc: ThumbDoc = { ...current.doc, layers: [...current.doc.layers, layer] };

        const problem = preflight(doc);
        if (problem) return fail(problem);

        const saved = await api.put<ProjectMeta>(`/projects/${id}`, { doc });
        // Insertion is a use event — it's what ranks the collection for the user.
        await api.post(`/starred/${element}/use`).catch(() => {});
        return text({
          ...saved,
          added: { id: layer.id, name: layer.name, type: layer.type, x: layer.x, y: layer.y },
          url: projectLink(saved.id),
        });
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  // ── projects ────────────────────────────────────────────────────────────────
  srv.registerTool(
    "list_projects",
    { title: "List saved projects", description: "Every project in the account, newest first.", inputSchema: {} },
    async () => {
      try {
        return text(await api.get<ProjectMeta[]>("/projects"));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "get_project",
    {
      title: "Get a project",
      description:
        "Fetches one project including its full document, ready to modify and save back. Accepts a " +
        "project id or an editor URL (https://…/?project=<id>) — paste either.",
      inputSchema: { id: projectRef("Project from list_projects") },
    },
    async ({ id: ref }) => {
      const id = projectIdFrom(ref);
      if (!id) return badRef(ref);
      try {
        return text(await api.get(`/projects/${id}`));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Saves a new design to the account. The document is validated locally first, so schema mistakes " +
        "come back immediately. Returns the id and a URL that opens it in the editor.",
      inputSchema: {
        name: z.string().min(1).describe("Project name shown in the editor"),
        doc: docInput("A complete ThumbDoc: { format, background, layers }"),
      },
    },
    async ({ name, doc }) => {
      const problem = preflight(doc);
      if (problem) return fail(problem);
      try {
        const saved = await api.post<ProjectMeta>("/projects", { name, doc: doc as ThumbDoc });
        return text({ ...saved, url: projectLink(saved.id) });
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "update_project",
    {
      title: "Update a project",
      description: "Renames a project, replaces its document, or both. Omit `doc` to rename only.",
      inputSchema: {
        id: projectRef("Project to update"),
        name: z.string().min(1).optional().describe("New name"),
        doc: docInput("Replacement ThumbDoc").optional(),
      },
    },
    async ({ id: ref, name, doc }) => {
      const id = projectIdFrom(ref);
      if (!id) return badRef(ref);
      if (name === undefined && doc === undefined) return fail("Pass `name`, `doc`, or both.");
      if (doc !== undefined) {
        const problem = preflight(doc);
        if (problem) return fail(problem);
      }
      try {
        const saved = await api.put<ProjectMeta>(`/projects/${id}`, {
          ...(name === undefined ? {} : { name }),
          ...(doc === undefined ? {} : { doc }),
        });
        return text({ ...saved, url: projectLink(saved.id) });
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "delete_project",
    {
      title: "Delete a project",
      description: "Permanently deletes a project. Confirm with the user before calling this.",
      inputSchema: { id: projectRef("Project to delete") },
    },
    async ({ id: ref }) => {
      const id = projectIdFrom(ref);
      if (!id) return badRef(ref);
      try {
        await api.delete(`/projects/${id}`);
        return text(`Deleted project ${id}.`);
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  // ── campaigns ───────────────────────────────────────────────────────────────
  srv.registerTool(
    "list_campaigns",
    { title: "List campaigns", description: "Every campaign in the account with how many designs it holds.", inputSchema: {} },
    async () => {
      try {
        return text(await api.get<CampaignMeta[]>("/campaigns"));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "get_campaign",
    {
      title: "Get a campaign",
      description: "The campaign and the designs in it (name, format, id) — metadata only. Use get_project for a document.",
      inputSchema: { id: z.string().describe("Campaign id from list_campaigns") },
    },
    async ({ id }) => {
      try {
        return text(await api.get(`/campaigns/${id}`));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "create_campaign",
    {
      title: "Create an empty campaign",
      description: "Most of the time prefer generate_campaign_set, which creates the campaign and its designs together.",
      inputSchema: { name: z.string().min(1).describe("Campaign name") },
    },
    async ({ name }) => {
      try {
        return text(await api.post<CampaignMeta>("/campaigns", { name }));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "rename_campaign",
    { title: "Rename a campaign", description: "Renames a campaign. Its designs are untouched.", inputSchema: { id: z.string(), name: z.string().min(1) } },
    async ({ id, name }) => {
      try {
        return text(await api.put<CampaignMeta>(`/campaigns/${id}`, { name }));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "delete_campaign",
    {
      title: "Delete a campaign",
      description: "Deletes the campaign only — the designs in it survive and become ungrouped. Confirm with the user first.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        await api.delete(`/campaigns/${id}`);
        return text(`Deleted campaign ${id}. Its designs were kept and are now ungrouped.`);
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "set_project_campaign",
    {
      title: "File a design into a campaign",
      description: "Moves an existing project into a campaign, or pass null to pull it out.",
      inputSchema: {
        id: projectRef("Project to file"),
        campaignId: z.string().nullable().describe("Campaign id, or null to remove it from its campaign"),
      },
    },
    async ({ id: ref, campaignId }) => {
      const id = projectIdFrom(ref);
      if (!id) return badRef(ref);
      try {
        return text(await api.put<ProjectMeta>(`/projects/${id}`, { campaignId }));
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }
    }
  );

  srv.registerTool(
    "generate_campaign_set",
    {
      title: "Generate a multi-platform campaign",
      description:
        "The main campaign tool. Takes one design and ships it across several platforms: creates the campaign, " +
        "rescales the document into each requested format, and saves one project per format. " +
        "Each design is independent afterwards — editing one does not change the others.",
      inputSchema: {
        name: z.string().min(1).describe("Campaign name; also the base for each design's name"),
        doc: docInput("The master ThumbDoc. Its own `format` is the one it was composed for."),
        formats: z
          .array(z.enum(formatKeys))
          .min(1)
          .describe("Formats to produce, e.g. [\"youtube\",\"ig-reel\",\"linkedin\"]. Duplicates are ignored."),
      },
    },
    async ({ name, doc, formats }) => {
      const problem = preflight(doc);
      if (problem) return fail(problem);

      let campaign: CampaignMeta;
      try {
        campaign = await api.post<CampaignMeta>("/campaigns", { name });
      } catch (e) {
        return fail(e instanceof ApiError ? e.toText() : String(e));
      }

      // Saved one at a time so a single bad format reports precisely instead of failing the
      // whole set. The campaign is kept either way — partial output is still useful, and the
      // user can see what landed.
      const created: { format: FormatKey; id: string; url: string }[] = [];
      const failed: { format: FormatKey; error: string }[] = [];

      for (const { format, doc: variant } of adaptDocToFormats(doc as ThumbDoc, formats)) {
        try {
          const saved = await api.post<ProjectMeta>("/projects", {
            name: `${name} — ${FORMATS[format].label}`,
            doc: variant,
            campaignId: campaign.id,
          });
          created.push({ format, id: saved.id, url: projectLink(saved.id) });
        } catch (e) {
          failed.push({ format, error: e instanceof ApiError ? e.toText() : String(e) });
        }
      }

      return text({
        campaign: { id: campaign.id, name: campaign.name },
        created,
        ...(failed.length ? { failed } : {}),
        note: "Each design is now independent; edits to one do not propagate to the others.",
      });
    }
  );

  srv.registerTool(
    "project_url",
    {
      title: "Get the editor link for a project",
      description: "A URL that opens the project directly in the Thumb Studio editor.",
      inputSchema: { id: projectRef("Project to link") },
    },
    async ({ id: ref }) => {
      const id = projectIdFrom(ref);
      if (!id) return badRef(ref);
      return text(projectLink(id));
    }
  );
}
