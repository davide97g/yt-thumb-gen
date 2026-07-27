// HTTP transport for the Thumb Studio API, authenticated with a personal API token.
//
// Deliberately separate from src/lib/api.ts: that one is browser-only (relative URLs +
// session cookie) and its ApiError throws away everything but `error`. Here the 422
// `details` array and the 200 `warnings` array are the whole point — they are what the
// agent reads to correct itself.

const BASE = (process.env.THUMB_API_URL ?? "https://thumb.davideghiotto.it").replace(/\/+$/, "");
const TOKEN = process.env.THUMB_API_TOKEN;

export const apiBase = BASE;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = []
  ) {
    super(message);
  }

  /** What the agent sees. Keeps the per-layer error lines intact so it can fix and retry. */
  toText(): string {
    const head = `${this.message} (HTTP ${this.status})`;
    return this.details.length ? `${head}\n${this.details.map((d) => `  - ${d}`).join("\n")}` : head;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!TOKEN) {
    throw new ApiError(0, "THUMB_API_TOKEN is not set — mint one in Thumb Studio (Impostazioni → Token API).");
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = (payload as any)?.error ?? `HTTP ${res.status}`;
    const details = (payload as any)?.details;
    throw new ApiError(res.status, message, Array.isArray(details) ? details : []);
  }
  return payload as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
