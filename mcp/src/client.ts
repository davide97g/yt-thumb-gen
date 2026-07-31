// HTTP transport for the Thumb Studio API, authenticated with a personal API token.
//
// Deliberately separate from src/lib/api.ts: that one is browser-only (relative URLs +
// session cookie) and its ApiError throws away everything but `error`. Here the 422
// `details` array and the 200 `warnings` array are the whole point — they are what the
// agent reads to correct itself.
//
// The token is bound per client rather than read from the environment, because the remote
// HTTP transport serves many callers and has to use each request's own bearer.

export const DEFAULT_BASE = "https://thumb.davideghiotto.it";

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

export type Api = {
  baseUrl: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  /** Raw bytes, for the blob endpoint — it reads the body as-is and types it by content-type. */
  postBytes<T>(path: string, bytes: Uint8Array, contentType: string): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function makeApi(token: string | undefined, baseUrl: string = DEFAULT_BASE): Api {
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown, raw?: { bytes: Uint8Array; contentType: string }): Promise<T> {
    if (!token) {
      throw new ApiError(401, "No API token. Create one in Thumb Studio (key icon in the header) and use it as the bearer.");
    }
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(raw ? { "content-type": raw.contentType } : body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: raw ? (raw.bytes as unknown as BodyInit) : body === undefined ? undefined : JSON.stringify(body),
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

  return {
    baseUrl: base,
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    postBytes: (p, bytes, contentType) => request("POST", p, undefined, { bytes, contentType }),
    put: (p, b) => request("PUT", p, b),
    delete: (p) => request("DELETE", p),
  };
}
