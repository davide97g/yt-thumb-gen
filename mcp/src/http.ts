// Hosted MCP endpoint, served behind nginx at /api/mcp.
//
// This is what the "Aggiungi MCP" button in the editor hands out: a single URL plus a
// personal token, so connecting an agent needs no checkout, no runtime, no install.
//
// Stateless by design (`sessionIdGenerator: undefined`): every request carries its own
// bearer and nothing is kept between calls, so the service holds no per-user state, can be
// restarted freely, and never has to reconcile sessions with token revocation. The token is
// never validated here — it is forwarded to the API, which is the single authority on auth.

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { makeApi } from "./client";
import { registerTools } from "./tools";

// Server-to-server inside the compose network; the browser-facing origin is only used to
// build the ?project= links handed back to the agent.
const API_INTERNAL = process.env.THUMB_API_INTERNAL ?? "http://api:3000";
const PUBLIC_URL = (process.env.APP_URL ?? "http://localhost").replace(/\/+$/, "");

const app = new Hono();

app.get("/api/mcp/health", (c) => c.json({ ok: true }));

app.all("/api/mcp", async (c) => {
  const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) {
    // 401 + WWW-Authenticate is what MCP clients look for to prompt for credentials.
    return c.json({ error: "unauthorized", message: "missing bearer token" }, 401, {
      "WWW-Authenticate": 'Bearer realm="thumb-studio"',
    });
  }

  // A fresh server + transport per request: they are cheap, and it keeps one caller's
  // token from ever being visible to another's tool calls.
  const server = new McpServer({ name: "thumb-studio", version: "1.0.0" });
  registerTools(server, {
    ...makeApi(token, API_INTERNAL),
    baseUrl: PUBLIC_URL, // links must point at the domain the user browses, not api:3000
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  // Returned without an explicit close: the response body may still be streaming, and in
  // stateless mode the transport holds no session or timer to release — it becomes garbage
  // once the response completes. (Hono's `executionCtx` is Workers-only and throws on Bun,
  // so there is no waitUntil to defer a close onto either.)
  return transport.handleRequest(c.req.raw);
});

export default { port: Number(process.env.PORT ?? 3001), fetch: app.fetch, idleTimeout: 120 };
