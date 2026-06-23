# yt-thumb-gen

YouTube thumbnail generator. Vite/React editor (root) + a local Python
background-removal sidecar ([`bgremove/`](bgremove/README.md)). Both are local
tools — nothing is deployed.

## Editor

```bash
bun install        # or: npm install
bun run dev        # vite on :5174
bun run build
bun run check      # tsc --noEmit
```

## Background removal (optional)

The "remove background" action calls a local [rembg](https://github.com/danielgatis/rembg)
service. Without it, the editor works but that one feature errors. See
[`bgremove/README.md`](bgremove/README.md) — quickest is Docker:

```bash
cd bgremove && docker build -t yt-thumb-bgremove . && docker run --rm -p 8000:8000 yt-thumb-bgremove
```

Override the URL with `VITE_BGREMOVE_URL` in a root `.env` if it runs elsewhere
(default `http://localhost:8000`).
