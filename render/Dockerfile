# syntax=docker/dockerfile:1
#
# Headless renderer. Built from `./render` — unlike web and mcp it needs none of the app
# source: it drives the *served* bundle over HTTP, so the canvas code it renders is whatever
# `web` is serving, and can never be a stale copy.
#
# The base is Microsoft's Playwright image, which already carries a Chromium build and the
# system libraries it needs (fontconfig, the whole X/GTK set). Installing those by hand on a
# plain Bun image is a long list that breaks on every Debian bump. **The image tag and the
# playwright-core version in package.json must move together** — playwright refuses a browser
# build it doesn't recognise.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

# Bun, so this service runs the same runtime as the others. Copied from the official image
# rather than installed by script: the installer wants `unzip`, which this base doesn't carry,
# and adding apt packages to save one COPY is a poor trade.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ENV NODE_ENV=production
# Where the base image put the browsers it shipped with.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 3002
CMD ["bun", "run", "src/index.ts"]
