// Thin fetch wrapper for the backend API. The SPA is served same-origin (nginx proxies
// /api → the Bun service), so relative URLs + credentials:"include" carry the session cookie.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function parse(res: Response): Promise<any> {
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, body?.error || `HTTP ${res.status}`);
  return body;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(`/api${path}`, { credentials: "include" }).then(parse);
}

export function apiSend<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(parse);
}
