# syntax=docker/dockerfile:1
#
# Hosted MCP endpoint. Built from the REPO ROOT, not from mcp/ — unlike the api, this
# service genuinely needs the document model (src/state.ts, src/presets.ts) and the shared
# validator (server/src/), so its build context has to span all three.
#
#   docker build -f mcp/Dockerfile .
#
# Dependencies install at /app, so imports from /app/mcp, /app/src and /app/server/src all
# resolve up into /app/node_modules.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY mcp/package.json mcp/bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY mcp ./mcp
COPY src ./src
COPY server/src ./server/src
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "mcp/src/http.ts"]
