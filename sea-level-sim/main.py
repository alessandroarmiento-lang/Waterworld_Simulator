"""Local offline sea-level rise globe simulator."""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Request
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
# Elevation map: 16-bit greyscale, metres = sample * ELEV_STEP_M - ELEV_OFFSET_M.
# One metre per step, and the browser decodes none of it — app.js reads the bytes itself.
# Depths below ELEV_FLOOR_M are flattened: this raises the sea, it does not survey the
# abyss, and abyssal detail alone tripled the file (40 MB against 13).
ELEV_OFFSET_M = 500
ELEV_STEP_M = 1
ELEV_FLOOR_M = -500
TEXTURE_SIZE = (8192, 4096)

ASSETS = {
    VENDOR / "three.module.js": f"https://unpkg.com/three@{THREE_VERSION}/build/three.module.js",
    JSM_CONTROLS / "OrbitControls.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/controls/OrbitControls.js",
    JSM_RENDERERS / "CSS2DRenderer.js": f"https://unpkg.com/three@{THREE_VERSION}/examples/jsm/renderers/CSS2DRenderer.js",
    TEXTURES / "earth-night.jpg": "https://unpkg.com/three-globe@2.45.2/example/img/earth-night.jpg",
}
ELEVATION = TEXTURES / "elevation.png"
COLOR = TEXTURES / "earth.jpg"
# Sources are reduced to the textures above and then never shipped: they are hundreds of
# megabytes and git-ignored. ETOPO is int16 metres, so altitudes survive with no rounding.
ETOPO_SRC = TEXTURES / "etopo_src.tif"
ETOPO_URL = (
    "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/"
    "60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif"
)
COLOR_SRC = TEXTURES / "bluemarble_src.jpg"
COLOR_URL = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/"
    "world.topo.bathy.200412.3x21600x10800.jpg"
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("sea-level-sim")


MIN_ASSET_BYTES = 4096


def _download(url: str, dst: Path) -> None:
    log.info("  → %s", dst.name)
    tmp = dst.with_suffix(dst.suffix + ".part")
    try:
        with httpx.Client(follow_redirects=True, timeout=180.0) as client:
            response = client.get(url)
            response.raise_for_status()
            body = response.content
        # A CDN error page is a few hundred bytes and would sit there looking like a
        # finished asset: every later run skips whatever already exists on disk.
        if len(body) < MIN_ASSET_BYTES:
            raise RuntimeError(f"{dst.name}: {len(body)} bytes, too small to be the asset")
        tmp.write_bytes(body)
        tmp.replace(dst)
    finally:
        tmp.unlink(missing_ok=True)


def build_elevation_texture(src: Path, dst: Path) -> None:
    import numpy as np

    Image.MAX_IMAGE_PIXELS = None
    log.info("Building elevation.png (16-bit, %d×%d) from ETOPO…", *TEXTURE_SIZE)
    with Image.open(src) as raw:
        metres = np.asarray(raw, dtype=np.float32)
    # Area average, not max: this is a height field, and a maximum would push every
    # coast outwards. Catalog altitudes are stamped back in by the client.
    reduced = Image.fromarray(metres).resize(TEXTURE_SIZE, Image.Resampling.BOX)
    samples = np.maximum(np.asarray(reduced, dtype=np.float32), ELEV_FLOOR_M)
    encoded = np.clip(
        np.rint((samples + ELEV_OFFSET_M) / ELEV_STEP_M), 0, 65535
    ).astype(np.uint16)
    image = Image.fromarray(encoded)
    # No icc_profile: this PNG carries altitudes, not colours. The source profile of the
    # old map made browsers colour-manage the greys and every altitude read ~30% too high.
    strip_color_profile(image)
    save_atomic(image, dst, optimize=True)


def build_color_texture(src: Path, dst: Path) -> None:
    Image.MAX_IMAGE_PIXELS = None
    log.info("Building earth.jpg (%d×%d) from Blue Marble…", *TEXTURE_SIZE)
    with Image.open(src) as raw:
        image = raw.convert("RGB").resize(TEXTURE_SIZE, Image.Resampling.LANCZOS)
    save_atomic(image, dst, quality=88, optimize=True)


def save_atomic(image: Image.Image, dst: Path, **options) -> None:
    tmp = dst.with_name(dst.name + ".part" + dst.suffix)
    try:
        image.save(tmp, **options)
        tmp.replace(dst)
    finally:
        tmp.unlink(missing_ok=True)


def strip_color_profile(image: Image.Image) -> None:
    for key in ("icc_profile", "gamma", "srgb", "chromaticity"):
        image.info.pop(key, None)


def ensure_assets() -> None:
    for path in (VENDOR, JSM_CONTROLS, JSM_RENDERERS, TEXTURES):
        path.mkdir(parents=True, exist_ok=True)
    missing = {dst: url for dst, url in ASSETS.items() if not dst.exists()}
    if missing:
        log.info("Downloading %d missing asset(s)…", len(missing))
        for dst, url in missing.items():
            _download(url, dst)
    for texture, source, url, build in (
        (ELEVATION, ETOPO_SRC, ETOPO_URL, build_elevation_texture),
        (COLOR, COLOR_SRC, COLOR_URL, build_color_texture),
    ):
        if texture.exists():
            continue
        if not source.exists():
            log.info("Downloading %s source (hundreds of MB, kept out of git)…", texture.name)
            _download(url, source)
        build(source, texture)
    log.info("Assets ready — running fully offline.")


try:
    ensure_assets()
except Exception as exc:  # noqa: BLE001 — assets already on disk are enough to serve the globe
    log.error("Asset setup failed: %s", exc)
    log.error("Serving what is already in static/; delete a partial file to fetch it again.")

app = FastAPI(title="Waterworld Simulator 1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def revalidate_local_assets(request: Request, call_next):
    """Always revalidate: an edited app.js or a rebuilt texture must never come from
    the browser's own cache. ETags keep the check to a 304 on a local server."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


def main() -> None:
    # 0.0.0.0 so an iPhone on the same Wi‑Fi can open the Mac LAN IP and Add to Home Screen.
    print("\n  Waterworld Simulator 1.0 (offline)")
    print("  Mac:     http://127.0.0.1:8000")
    print("  iPhone:  http://<Mac-LAN-IP>:8000  (same Wi‑Fi → Safari → Add to Home Screen)\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()
