"""Local offline sea-level rise globe simulator."""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
VENDOR = STATIC / "vendor"
JSM_CONTROLS = VENDOR / "jsm" / "controls"
JSM_RENDERERS = VENDOR / "jsm" / "renderers"
TEXTURES = STATIC / "textures"
THREE_VERSION = "0.160.0"
NASA_ELEV_MAX_M = 6400
REF_ELEV_M = 9000

ASSETS = {
    VENDOR / "three.module.js": f"https://unpkg.com/three@{THREE_VERSION}/build/three.module.js",
    JSM_CONTROLS / "OrbitControls.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/controls/OrbitControls.js",
    JSM_RENDERERS / "CSS2DRenderer.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/renderers/CSS2DRenderer.js",
    TEXTURES / "earth.jpg": "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/2_no_clouds_4k.jpg",
    TEXTURES / "earth-night.jpg": "https://unpkg.com/three-globe@2.45.2/example/img/earth-night.jpg",
}
GEBCO_SRC = TEXTURES / "gebco_elev_src.png"
ELEVATION = TEXTURES / "elevation.png"
GEBCO_URL = "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("sea-level-sim")


def _download(url: str, dst: Path) -> None:
    log.info("  → %s", dst.name)
    with httpx.Client(follow_redirects=True, timeout=180.0) as client:
        response = client.get(url)
        response.raise_for_status()
        dst.write_bytes(response.content)


def build_elevation_texture(src: Path, dst: Path) -> None:
    Image.MAX_IMAGE_PIXELS = None
    log.info("Building elevation.png (0–9000 m) from GEBCO…")
    image = Image.open(src).convert("L").resize((4096, 2048), Image.Resampling.BILINEAR)
    image = image.point(lambda gray: int(gray * NASA_ELEV_MAX_M / REF_ELEV_M))
    image.save(dst, optimize=True)


def ensure_assets() -> None:
    for path in (VENDOR, JSM_CONTROLS, JSM_RENDERERS, TEXTURES):
        path.mkdir(parents=True, exist_ok=True)
    missing = {dst: url for dst, url in ASSETS.items() if not dst.exists()}
    if missing:
        log.info("Downloading %d missing asset(s)…", len(missing))
        for dst, url in missing.items():
            _download(url, dst)
    if not ELEVATION.exists():
        if not GEBCO_SRC.exists():
            log.info("Downloading GEBCO elevation source…")
            _download(GEBCO_URL, GEBCO_SRC)
        build_elevation_texture(GEBCO_SRC, ELEVATION)
    log.info("Assets ready — running fully offline.")


ensure_assets()
app = FastAPI(title="Waterworld Simulator 1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


def main() -> None:
    print("\n  Waterworld Simulator 1.0 (offline)")
    print("  Apri: http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    main()
