"""Local offline sea-level rise globe simulator."""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
VENDOR = STATIC / "vendor"
JSM_CONTROLS = VENDOR / "jsm" / "controls"
JSM_RENDERERS = VENDOR / "jsm" / "renderers"
TEXTURES = STATIC / "textures"
THREE_VERSION = "0.160.0"

ASSETS = {
    VENDOR / "three.module.js": f"https://unpkg.com/three@{THREE_VERSION}/build/three.module.js",
    JSM_CONTROLS / "OrbitControls.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/controls/OrbitControls.js",
    JSM_RENDERERS / "CSS2DRenderer.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/renderers/CSS2DRenderer.js",
    TEXTURES / "heightmap.jpg": "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/elev_bump_4k.jpg",
    TEXTURES / "earth.jpg": "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/2_no_clouds_4k.jpg",
}

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("sea-level-sim")


def ensure_assets() -> None:
    for path in (VENDOR, JSM_CONTROLS, JSM_RENDERERS, TEXTURES):
        path.mkdir(parents=True, exist_ok=True)
    missing = {dst: url for dst, url in ASSETS.items() if not dst.exists()}
    if not missing:
        log.info("All assets already present — running fully offline.")
        return
    log.info("Downloading %d missing asset(s)…", len(missing))
    with httpx.Client(follow_redirects=True, timeout=120.0) as client:
        for dst, url in missing.items():
            log.info("  → %s", dst.name)
            response = client.get(url)
            response.raise_for_status()
            dst.write_bytes(response.content)
    log.info("Setup complete.")


ensure_assets()
app = FastAPI(title="Simulatore livello del mare")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


def main() -> None:
    print("\n  Simulatore livello del mare (offline)")
    print("  Apri: http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    main()
