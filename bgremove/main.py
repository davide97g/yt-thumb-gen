"""GrocerAI bgremove — local-only background-removal microservice for Thumb Studio.

POST /cutout  { "dataUrl": "data:image/png;base64,..." }  -> image/png (transparent)
GET  /health  -> { "ok": true }

Uses rembg (u2net) — free, runs fully offline after the first model download (~170 MB).
Not part of the Vercel/Render deploys; meant to run on the same machine as `apps/thumb`.
"""

from __future__ import annotations

import base64
import binascii

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from rembg import new_session, remove

app = FastAPI(title="GrocerAI bgremove", version="1.0.0")

# Thumb Studio runs on :5174; the web app on :5173. Allow both for convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://localhost:5173", "http://127.0.0.1:5174"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# Load the model once at import time so requests don't pay the cold-start cost.
_session = new_session("u2net")


class CutoutBody(BaseModel):
    dataUrl: str


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/cutout")
def cutout(body: CutoutBody) -> Response:
    # Accept either a full data URL ("data:...;base64,XXXX") or a bare base64 string.
    raw_b64 = body.dataUrl.split(",", 1)[-1]
    try:
        image_bytes = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="dataUrl is not valid base64")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    try:
        cut = remove(image_bytes, session=_session)
    except Exception as err:  # noqa: BLE001 — surface any decode/inference failure to the client
        raise HTTPException(status_code=422, detail=f"background removal failed: {err}")

    return Response(content=cut, media_type="image/png")
