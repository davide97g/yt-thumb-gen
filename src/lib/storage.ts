// Persistence for the thumbnail editor.
//
// Split across two backends by concern:
//   • The live *working* canvas + its project identity stay in **IndexedDB** (store
//     "meta"): a fast, offline, per-browser cache. Docs here keep images as inline
//     base64 data URLs so the canvas can paint/export them directly.
//   • Named, reloadable **projects** live on the **backend** (Postgres + R2), scoped to
//     the logged-in user. On the way out, inline images are offloaded to R2 and replaced
//     by `blob:<id>` refs (see lib/blobs.ts); on the way in they're re-hydrated to data
//     URLs. So the DB row stays small and images survive a cache clear / move machines.
// Plus JSON file export/import (unchanged) so a project can leave the account entirely.

import { detachLayer, type FormatKey, type Layer, type LayerType, type ThumbDoc } from "../state";
import { apiGet, apiSend } from "./api";
import { assertWritable, dehydrateDoc, dehydrateLayer, hydrateDoc, hydrateLayer, setReadOnly as setBlobReadOnly } from "./blobs";

const DB_NAME = "grocerai-thumb";
const VERSION = 1;
const META = "meta";
const CONFIGS = "configs"; // legacy store, kept so existing DBs open without an upgrade
const WORKING_KEY = "working";
const PROJECT_KEY = "project";

// ── Session scope ─────────────────────────────────────────────────────────────
//
// Two kinds of visitor share one browser: the owner, signed in, and a guest who can edit
// freely but never writes to the backend. Both autosave a working canvas, and they must not
// be the same canvas — a guest's fiddling must not overwrite what the owner had open.
//
// The separation is a key prefix inside the existing `meta` store, deliberately not a second
// object store: adding one would mean bumping VERSION and writing an onupgradeneeded branch,
// and this needs neither.

export type Scope = "owner" | "guest";
let scope: Scope = "owner";

/** Sets the storage scope and, with it, whether remote writes are allowed at all. Called once
 *  by AuthGate when it resolves who the visitor is, before the editor mounts. */
export function setScope(next: Scope): void {
  scope = next;
  setBlobReadOnly(next === "guest");
}

const prefix = (s: Scope = scope) => (s === "guest" ? "guest:" : "");
const workingKey = () => prefix() + WORKING_KEY;
const projectKey = () => prefix() + PROJECT_KEY;

/** Lightweight archive-list row (no doc) — what the backend returns for a list. */
export type ConfigMeta = {
  id: string;
  name: string;
  updatedAt: number;
  campaignId: string | null;
  /** Whether a logged-out visitor can read this design. Off for everything by default;
   *  publishing is always a deliberate act, never a side effect of a save. */
  isPublic?: boolean;
  /** Read straight out of the stored doc, so the archive can label rows without fetching each one. */
  format?: FormatKey | null;
  /** Blob id of the preview thumbnail, or null for projects saved before previews existed
   *  (and for projects an agent created without ever opening the editor). */
  preview?: string | null;
};
/** A full project including its (hydrated) doc. */
export type SavedConfig = ConfigMeta & { doc: ThumbDoc };

/** Identity of the live working canvas. `id` is null until it's archived. */
export type Project = { name: string; id: string | null };

const EXPORT_VERSION = 1;
type ExportFile = { app: "grocerai-thumb"; version: number; name?: string; doc: ThumbDoc };

// ── IndexedDB (local working cache) ───────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(CONFIGS)) db.createObjectStore(CONFIGS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs a single request against one store and resolves with its result. */
async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function getWorking(): Promise<ThumbDoc | null> {
  const doc = await run<ThumbDoc | undefined>(META, "readonly", (s) => s.get(workingKey()));
  return doc ?? null;
}

export function setWorking(doc: ThumbDoc): Promise<void> {
  return run<IDBValidKey>(META, "readwrite", (s) => s.put(doc, workingKey())).then(() => undefined);
}

export async function getProject(): Promise<Project | null> {
  return (await run<Project | undefined>(META, "readonly", (s) => s.get(projectKey()))) ?? null;
}

export function setProject(project: Project): Promise<void> {
  return run<IDBValidKey>(META, "readwrite", (s) => s.put(project, projectKey())).then(() => undefined);
}

/** Clears one scope's local working cache. Defaults to the current one — that's the logout
 *  case, where the next user must not inherit the previous one's canvas. Passing "guest"
 *  explicitly is how a guest who then signs in drops their scratch canvas. */
export async function clearWorking(which: Scope = scope): Promise<void> {
  await run(META, "readwrite", (s) => s.delete(prefix(which) + WORKING_KEY));
  await run(META, "readwrite", (s) => s.delete(prefix(which) + PROJECT_KEY));
}

// ── Backend projects (source of truth) ────────────────────────────────────────

export function listConfigs(): Promise<ConfigMeta[]> {
  return apiGet<ConfigMeta[]>("/projects");
}

/** Fetches one archived project and re-hydrates its images from R2. */
export async function loadConfig(id: string): Promise<SavedConfig> {
  const row = await apiGet<{ id: string; name: string; updatedAt: number; campaignId: string | null; doc: ThumbDoc }>(
    `/projects/${id}`
  );
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    campaignId: row.campaignId ?? null,
    doc: await hydrateDoc(row.doc),
  };
}

/** Upserts a project: pass an existing `id` to overwrite it, or omit it to archive a new
 *  one. Offloads inline images to R2 before sending. Returns the archive metadata. */
export async function saveConfig(
  name: string,
  doc: ThumbDoc,
  id?: string,
  campaignId?: string | null,
  preview?: string | null
): Promise<ConfigMeta> {
  assertWritable();
  // `campaignId` and `preview` are only sent when the caller passes them: on PUT the key's
  // absence means "leave it alone", which is what an ordinary save (or a rename, or a save
  // made with no canvas mounted) should do.
  const payload = {
    name: name.trim() || "Untitled",
    doc: await dehydrateDoc(doc),
    ...(campaignId === undefined ? {} : { campaignId }),
    ...(preview == null ? {} : { preview }),
  };
  return id ? apiSend<ConfigMeta>("PUT", `/projects/${id}`, payload) : apiSend<ConfigMeta>("POST", "/projects", payload);
}

/** Renames an archived project in place, leaving its doc untouched. */
export function renameConfig(id: string, name: string): Promise<ConfigMeta> {
  assertWritable();
  return apiSend<ConfigMeta>("PUT", `/projects/${id}`, { name: name.trim() || "Untitled" });
}

export function deleteConfig(id: string): Promise<void> {
  assertWritable();
  return apiSend<{ ok: true }>("DELETE", `/projects/${id}`).then(() => undefined);
}

/** Publishes a design to the public gallery, or takes it back down. Sent as its own key so
 *  the server's presence gate can tell "set to false" apart from "don't touch". */
export function setProjectPublic(id: string, isPublic: boolean): Promise<ConfigMeta> {
  assertWritable();
  return apiSend<ConfigMeta>("PUT", `/projects/${id}`, { isPublic });
}

// ── Public gallery (readable without an account) ──────────────────────────────
//
// What a guest sees. Backed by /api/public/*, which is GET-only and holds no notion of who is
// asking — a guest and a stranger with curl are the same caller, which is what keeps the
// public surface small enough to reason about.

/** A published design as a logged-out visitor sees it. No campaign id, no owner, no doc. */
export type PublicConfigMeta = {
  id: string;
  name: string;
  updatedAt: number;
  format?: FormatKey | null;
  preview?: string | null;
  /** Group heading in the gallery. Null for designs that aren't in a campaign. */
  campaignName?: string | null;
};

export function listPublicConfigs(): Promise<PublicConfigMeta[]> {
  return apiGet<PublicConfigMeta[]>("/public/projects");
}

/** Images come back through the publishing project's own route: a guest is entitled to the
 *  pictures inside a published design, not to the blob store. */
export const publicBlobUrl = (projectId: string, blobId: string) => `/api/public/projects/${projectId}/blobs/${blobId}`;

/** Fetches one published design. The `id` comes back so the caller can keep the shareable
 *  link, but a guest must *not* adopt it as `projectId` — that's what the editor treats as
 *  ownership, and a guest holds a local copy, not the project. */
export async function loadPublicConfig(id: string): Promise<SavedConfig> {
  const row = await apiGet<{ id: string; name: string; updatedAt: number; doc: ThumbDoc }>(`/public/projects/${id}`);
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    campaignId: null,
    doc: await hydrateDoc(row.doc, (blobId) => publicBlobUrl(id, blobId)),
  };
}

// ── Version history ───────────────────────────────────────────────────────────
//
// Undo is in-memory, 20 steps deep, and gone on reload — so before this, an edit that
// survived a refresh was permanent. The backend files the outgoing document on every save
// that changes it; these read that history back.

export type VersionMeta = {
  id: string;
  /** The project's name at the time — a rename doesn't rewrite the past. */
  name: string;
  createdAt: number;
  layerCount: number;
  format: FormatKey | null;
};

export function listVersions(projectId: string): Promise<VersionMeta[]> {
  return apiGet<VersionMeta[]>(`/projects/${projectId}/versions`);
}

/** Puts a past document back. The current one is filed first, server-side, so undoing a
 *  restore is just another restore. Returns the restored doc, hydrated for the canvas. */
export async function restoreVersion(projectId: string, versionId: string): Promise<{ doc: ThumbDoc; updatedAt: number }> {
  assertWritable();
  const row = await apiSend<{ doc: ThumbDoc; updatedAt: number }>("POST", `/projects/${projectId}/versions/${versionId}/restore`);
  return { doc: await hydrateDoc(row.doc), updatedAt: row.updatedAt };
}

// ── Campaigns (a folder of designs: one message across several platforms) ─────

export type CampaignMeta = { id: string; name: string; updatedAt: number; designCount: number };
export type CampaignDesign = { id: string; name: string; format: string; updatedAt: number; preview?: string | null };
export type Campaign = Omit<CampaignMeta, "designCount"> & { designs: CampaignDesign[] };

export function listCampaigns(): Promise<CampaignMeta[]> {
  return apiGet<CampaignMeta[]>("/campaigns");
}

export function loadCampaign(id: string): Promise<Campaign> {
  return apiGet<Campaign>(`/campaigns/${id}`);
}

export function createCampaign(name: string): Promise<CampaignMeta> {
  assertWritable();
  return apiSend<CampaignMeta>("POST", "/campaigns", { name });
}

export function renameCampaign(id: string, name: string): Promise<CampaignMeta> {
  assertWritable();
  return apiSend<CampaignMeta>("PUT", `/campaigns/${id}`, { name });
}

/** Deletes the campaign only — its designs survive, ungrouped. */
export function deleteCampaign(id: string): Promise<void> {
  assertWritable();
  return apiSend<{ ok: true }>("DELETE", `/campaigns/${id}`).then(() => undefined);
}

/** Files a project into a campaign, or pass null to pull it back out. */
export function setProjectCampaign(id: string, campaignId: string | null): Promise<ConfigMeta> {
  assertWritable();
  return apiSend<ConfigMeta>("PUT", `/projects/${id}`, { campaignId });
}

// ── Personal API tokens (for the MCP server / scripts) ────────────────────────
//
// Cookie-authenticated on purpose: a token can reach the rest of the API but must never be
// able to mint another one, so this section only works from a logged-in browser.

export type ApiToken = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
/** Only ever returned once, at creation. The server keeps just a hash. */
export type NewApiToken = ApiToken & { token: string };

export function listTokens(): Promise<ApiToken[]> {
  return apiGet<ApiToken[]>("/tokens");
}

export function createToken(name: string): Promise<NewApiToken> {
  assertWritable();
  return apiSend<NewApiToken>("POST", "/tokens", { name });
}

export function deleteToken(id: string): Promise<void> {
  assertWritable();
  return apiSend<{ ok: true }>("DELETE", `/tokens/${id}`).then(() => undefined);
}

// ── Starred elements (per-user collection of single layers) ───────────────────
//
// Any layer can be starred out of a project into a global, searchable collection and
// re-inserted into any other project later. Stored dehydrated (images → R2 refs) like
// project docs; hydrated back to data URLs on load so the canvas can paint it.

/** Collection-list row (no layer payload). `kind` mirrors layer.type for filtering. */
export type StarredMeta = {
  id: string; name: string; kind: LayerType; updatedAt: number; lastUsedAt: number;
  sourceProjectId: string | null; sourceProjectName: string | null;
};
export type StarredItem = StarredMeta & { layer: Layer };

// Re-exported from the document model, where it now lives — the MCP server needs it and
// can't import this module (browser fetch). Importers here are unaffected.
export { detachLayer };

export function listStarred(): Promise<StarredMeta[]> {
  return apiGet<StarredMeta[]>("/starred");
}

/** Stars a layer: detaches it from its doc, offloads images to R2, saves it. */
export async function starLayer(layer: Layer, name?: string, sourceProject?: Project): Promise<StarredMeta> {
  assertWritable();
  const clean = await dehydrateLayer(detachLayer(layer));
  const payload = {
    name: (name ?? layer.name).trim() || "Untitled", kind: layer.type, layer: clean,
    sourceProjectId: sourceProject?.id ?? null, sourceProjectName: sourceProject?.name ?? null,
  };
  return apiSend<StarredMeta>("POST", "/starred", payload);
}

/** Fetches one starred element and re-hydrates its images from R2. */
export async function loadStarred(id: string): Promise<StarredItem> {
  const row = await apiGet<StarredItem>(`/starred/${id}`);
  return { ...row, layer: await hydrateLayer(row.layer) };
}

export function renameStarred(id: string, name: string): Promise<StarredMeta> {
  assertWritable();
  return apiSend<StarredMeta>("PUT", `/starred/${id}`, { name: name.trim() || "Untitled" });
}

export function deleteStarred(id: string): Promise<void> {
  assertWritable();
  return apiSend<{ ok: true }>("DELETE", `/starred/${id}`).then(() => undefined);
}

/** Records an insertion so favourites can be ranked by actual use. */
export function useStarred(id: string): Promise<void> {
  assertWritable();
  return apiSend<{ ok: true }>("POST", `/starred/${id}/use`).then(() => undefined);
}

// ── JSON file export / import ─────────────────────────────────────────────────

/** Downloads the doc as a .json file with embedded images. */
export function exportConfigFile(doc: ThumbDoc, name = "grocerai-thumb"): void {
  const payload: ExportFile = { app: "grocerai-thumb", version: EXPORT_VERSION, name, doc };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, "-") || "config"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parses a previously exported file and returns its doc. Throws on malformed input. */
export async function importConfigFile(file: File): Promise<{ name?: string; doc: ThumbDoc }> {
  const parsed = JSON.parse(await file.text()) as Partial<ExportFile>;
  if (!parsed || parsed.app !== "grocerai-thumb" || !parsed.doc || !Array.isArray(parsed.doc.layers) || !parsed.doc.background) {
    throw new Error("Invalid file");
  }
  return { name: parsed.name, doc: parsed.doc };
}
