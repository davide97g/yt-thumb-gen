// Persistence for the thumbnail editor.
//
// Configs embed images as base64 dataURLs, so a single doc can be several MB —
// well past the ~5MB localStorage cap. Everything therefore lives in IndexedDB:
//   • store "meta"    — the working canvas, autosaved under key "working"
//   • store "configs" — named saves the user can reload later (keyPath "id")
// Plus JSON file export/import so configs survive a cache clear and move between
// machines.

import type { ThumbDoc } from "../state";

const DB_NAME = "grocerai-thumb";
const VERSION = 1;
const META = "meta";
const CONFIGS = "configs";
const WORKING_KEY = "working";

export type SavedConfig = { id: string; name: string; updatedAt: number; doc: ThumbDoc };

const EXPORT_VERSION = 1;
type ExportFile = { app: "grocerai-thumb"; version: number; name?: string; doc: ThumbDoc };

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

export async function listConfigs(): Promise<SavedConfig[]> {
  const all = await run<SavedConfig[]>(CONFIGS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Saves a config under a fresh id and returns it. */
export function saveConfig(name: string, doc: ThumbDoc): Promise<SavedConfig> {
  const config: SavedConfig = { id: crypto.randomUUID(), name: name.trim() || "Senza nome", updatedAt: Date.now(), doc };
  return run<IDBValidKey>(CONFIGS, "readwrite", (s) => s.put(config)).then(() => config);
}

export function deleteConfig(id: string): Promise<void> {
  return run<undefined>(CONFIGS, "readwrite", (s) => s.delete(id)).then(() => undefined);
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
