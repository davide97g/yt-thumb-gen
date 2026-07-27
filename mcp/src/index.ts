// Thumb Studio MCP server — lets an agent design and save real projects.
//
// Runs locally over stdio and talks to the deployed REST API with a personal API token.
// Because it lives in the repo it imports the document model directly from src/, so the
// agent gets the real layer factories (valid defaults for ~20 fields it would otherwise
// have to invent) and the real validator — no snapshot to keep in sync.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { validateDoc } from "../../server/src/validate";
import { adaptDocToFormat } from "../../src/lib/adapt";
import { TEMPLATE_LABELS, TEMPLATES, type TemplateKey } from "../../src/presets";
import {
  DEFAULT_FORMAT,
  FONT_LABELS,
  FORMATS,
  type FormatKey,
  SIZE_LIMITS,
  type ThumbDoc,
  newBrandLayer,
  newDrawLayer,
  newEffectLayer,
  newEmojiFxLayer,
  newEmojiLayer,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
} from "../../src/state";
import { ApiError, apiBase, apiDelete, apiGet, apiPost, apiPut } from "./client";

type ProjectMeta = { id: string; name: string; updatedAt: number; warnings?: string[] };

const formatKeys = Object.keys(FORMATS) as [FormatKey, ...FormatKey[]];
const templateKeys = Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]];

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string) => ({ ...text(message), isError: true });

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

const projectLink = (id: string) => `${apiBase}/?project=${id}`;

const server = new McpServer({ name: "thumb-studio", version: "1.0.0" });

// ── discovery ───────────────────────────────────────────────────────────────
server.registerTool(
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

server.registerTool(
  "get_doc_schema",
  {
    title: "Get the ThumbDoc JSON Schema",
    description: "The full published JSON Schema for a design document. Large — fetch it only when you need field-level detail.",
    inputSchema: {},
  },
  async () => {
    try {
      return text(await apiGet("/schema"));
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "list_templates",
  {
    title: "List starting templates",
    description: "Named starting points. Prefer starting from one of these over composing from scratch.",
    inputSchema: {},
  },
  async () => text(Object.keys(TEMPLATES).map((key) => ({ key, label: TEMPLATE_LABELS[key as TemplateKey] })))
);

server.registerTool(
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

server.registerTool(
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

// ── projects ────────────────────────────────────────────────────────────────
server.registerTool(
  "list_projects",
  { title: "List saved projects", description: "Every project in the account, newest first.", inputSchema: {} },
  async () => {
    try {
      return text(await apiGet<ProjectMeta[]>("/projects"));
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "get_project",
  {
    title: "Get a project",
    description: "Fetches one project including its full document, ready to modify and save back.",
    inputSchema: { id: z.string().describe("Project id from list_projects") },
  },
  async ({ id }) => {
    try {
      return text(await apiGet(`/projects/${id}`));
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "create_project",
  {
    title: "Create a project",
    description:
      "Saves a new design to the account. The document is validated locally first, so schema mistakes " +
      "come back immediately. Returns the id and a URL that opens it in the editor.",
    inputSchema: {
      name: z.string().min(1).describe("Project name shown in the editor"),
      doc: z.unknown().describe("A complete ThumbDoc: { format, background, layers }"),
    },
  },
  async ({ name, doc }) => {
    const problem = preflight(doc);
    if (problem) return fail(problem);
    try {
      const saved = await apiPost<ProjectMeta>("/projects", { name, doc: doc as ThumbDoc });
      return text({ ...saved, url: projectLink(saved.id) });
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "update_project",
  {
    title: "Update a project",
    description: "Renames a project, replaces its document, or both. Omit `doc` to rename only.",
    inputSchema: {
      id: z.string().describe("Project id"),
      name: z.string().min(1).optional().describe("New name"),
      doc: z.unknown().optional().describe("Replacement ThumbDoc"),
    },
  },
  async ({ id, name, doc }) => {
    if (name === undefined && doc === undefined) return fail("Pass `name`, `doc`, or both.");
    if (doc !== undefined) {
      const problem = preflight(doc);
      if (problem) return fail(problem);
    }
    try {
      const saved = await apiPut<ProjectMeta>(`/projects/${id}`, {
        ...(name === undefined ? {} : { name }),
        ...(doc === undefined ? {} : { doc }),
      });
      return text({ ...saved, url: projectLink(saved.id) });
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "delete_project",
  {
    title: "Delete a project",
    description: "Permanently deletes a project. Confirm with the user before calling this.",
    inputSchema: { id: z.string().describe("Project id") },
  },
  async ({ id }) => {
    try {
      await apiDelete(`/projects/${id}`);
      return text(`Deleted project ${id}.`);
    } catch (e) {
      return fail(e instanceof ApiError ? e.toText() : String(e));
    }
  }
);

server.registerTool(
  "project_url",
  {
    title: "Get the editor link for a project",
    description: "A URL that opens the project directly in the Thumb Studio editor.",
    inputSchema: { id: z.string().describe("Project id") },
  },
  async ({ id }) => text(projectLink(id))
);

await server.connect(new StdioServerTransport());
