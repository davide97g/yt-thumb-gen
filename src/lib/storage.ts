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

import type { ThumbDoc } from "../state";
import { apiGet, apiSend } from "./api";
import { dehydrateDoc, hydrateDoc } from "./blobs";

const DB_NAME = "grocerai-thumb";
const VERSION = 1;
const META = "meta";
const CONFIGS = "configs"; // legacy store, kept so existing DBs open without an upgrade
const WORKING_KEY = "working";
const PROJECT_KEY = "project";

/** Lightweight archive-list row (no doc) — what the backend returns for a list. */
export type ConfigMeta = { id: string; name: string; updatedAt: number };
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
  const doc = await run<ThumbDoc | undefined>(META, "readonly", (s) => s.get(WORKING_KEY));
  return doc ?? null;
}

export function setWorking(doc: ThumbDoc): Promise<void> {
  return run<IDBValidKey>(META, "readwrite", (s) => s.put(doc, WORKING_KEY)).then(() => undefined);
}

export async function getProject(): Promise<Project | null> {
  return (await run<Project | undefined>(META, "readonly", (s) => s.get(PROJECT_KEY))) ?? null;
}

export function setProject(project: Project): Promise<void> {
  return run<IDBValidKey>(META, "readwrite", (s) => s.put(project, PROJECT_KEY)).then(() => undefined);
}

/** Clears the local working cache — used on logout so the next user starts clean. */
export async function clearWorking(): Promise<void> {
  await run(META, "readwrite", (s) => s.delete(WORKING_KEY));
  await run(META, "readwrite", (s) => s.delete(PROJECT_KEY));
}

// ── Backend projects (source of truth) ────────────────────────────────────────

export function listConfigs(): Promise<ConfigMeta[]> {
  return apiGet<ConfigMeta[]>("/projects");
}

/** Fetches one archived project and re-hydrates its images from R2. */
export async function loadConfig(id: string): Promise<SavedConfig> {
  const row = await apiGet<{ id: string; name: string; updatedAt: number; doc: ThumbDoc }>(`/projects/${id}`);
  return { id: row.id, name: row.name, updatedAt: row.updatedAt, doc: await hydrateDoc(row.doc) };
}

/** Upserts a project: pass an existing `id` to overwrite it, or omit it to archive a new
 *  one. Offloads inline images to R2 before sending. Returns the archive metadata. */
export async function saveConfig(name: string, doc: ThumbDoc, id?: string): Promise<ConfigMeta> {
  const payload = { name: name.trim() || "Senza nome", doc: await dehydrateDoc(doc) };
  return id ? apiSend<ConfigMeta>("PUT", `/projects/${id}`, payload) : apiSend<ConfigMeta>("POST", "/projects", payload);
}

/** Renames an archived project in place, leaving its doc untouched. */
export function renameConfig(id: string, name: string): Promise<ConfigMeta> {
  return apiSend<ConfigMeta>("PUT", `/projects/${id}`, { name: name.trim() || "Senza nome" });
}

export function deleteConfig(id: string): Promise<void> {
  return apiSend<{ ok: true }>("DELETE", `/projects/${id}`).then(() => undefined);
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
    throw new Error("File non valido");
  }
  return { name: parsed.name, doc: parsed.doc };
}
