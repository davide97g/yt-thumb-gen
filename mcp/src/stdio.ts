// Local stdio entry point: runs on the developer's machine, talks to the deployed API.
//
// Configured through THUMB_API_URL / THUMB_API_TOKEN (see .mcp.json at the repo root).
// Most users should prefer the hosted endpoint at /api/mcp, which needs no checkout —
// this exists for working on the tools themselves.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BASE, makeApi } from "./client";
import { registerTools } from "./tools";

const server = new McpServer({ name: "thumb-studio", version: "1.0.0" });
registerTools(server, makeApi(process.env.THUMB_API_TOKEN, process.env.THUMB_API_URL ?? DEFAULT_BASE));

await server.connect(new StdioServerTransport());
