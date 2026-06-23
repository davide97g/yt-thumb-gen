# bgremove

Local-only background-removal microservice for the thumbnail editor (the Vite app
in the project root). Strips the background off a webcam/uploaded photo so the
subject can be cut out and given a glowing silhouette border in the editor.

- `POST /cutout` — body `{ "dataUrl": "data:image/png;base64,…" }` → returns a transparent `image/png`
- `GET /health` — `{ "ok": true }`

Powered by [rembg](https://github.com/danielgatis/rembg) (u2net). Free, runs fully
offline after the first model download (~170 MB). Run it on the same machine as the editor.

## Run with Docker (recommended — isolates the heavy onnx/Python deps)

```bash
cd bgremove
docker build -t yt-thumb-bgremove .
docker run --rm -p 8000:8000 yt-thumb-bgremove
```

The model is baked into the image at build time, so the first request is instant.

## Run with a local venv (no Docker)

```bash
cd bgremove
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

First request downloads the u2net model to `~/.u2net/` (one-time).

## Connect the editor

The editor calls `VITE_BGREMOVE_URL` (default `http://localhost:8000`). Override in
a root `.env` only if you run the service elsewhere:

```
VITE_BGREMOVE_URL=http://localhost:8000
```

## Smoke test

```bash
curl http://localhost:8000/health
# {"ok":true}
```
