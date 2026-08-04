# syntax=docker/dockerfile:1

# --- build stage -----------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Install deps first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the static site. git is absent here, so vite's build stamp
# falls back to commit "dev" (see vite.config.ts) — harmless.
COPY . .
RUN bun run build

# Precompressed twins for `gzip_static` (see nginx.conf). `-k` keeps the original, so a client
# that doesn't accept gzip still gets served. Only compressible types, only files worth it:
# woff2/png/jpg are already compressed and a .gz of them would be dead weight in the image.
RUN find dist -type f \
      \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.wasm' \
         -o -name '*.json' -o -name '*.svg' -o -name '*.webmanifest' -o -name '*.html' \) \
      -size +1k -exec gzip -9 -k {} +

# --- serve stage -----------------------------------------------------------
FROM nginx:1.27-alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
