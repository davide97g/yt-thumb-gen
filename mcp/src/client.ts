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
  /** A binary response (a rendered PNG), base64-encoded for an MCP image content block. */
  getBase64(path: string): Promise<{ base64: string; contentType: string }>;
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

    async getBase64(path) {
      if (!token) throw new ApiError(401, "No API token. Create one in Thumb Studio (key icon in the header) and use it as the bearer.");
      const res = await fetch(`${base}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        // Errors still come back as JSON, so the message survives even on a binary route.
        const payload = await res.json().catch(() => null);
        throw new ApiError(res.status, (payload as any)?.error ?? `HTTP ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const chunk = 0x8000; // btoa's argument limit is well under a 1280×720 PNG
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      return { base64: btoa(binary), contentType: res.headers.get("content-type") ?? "image/png" };
    },
    put: (p, b) => request("PUT", p, b),
    delete: (p) => request("DELETE", p),
  };
}
