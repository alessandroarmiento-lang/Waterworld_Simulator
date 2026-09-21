# Waterworld Simulator 1.0 (offline)

## Run

```bash
cd sea-level-sim
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Open http://127.0.0.1:8000

### iPhone Home Screen icon

Needs a URL reachable from the phone (Mac and iPhone on the same Wi‑Fi: start the server on the Mac, open `http://<Mac-IP>:8000` in Safari). Then Safari → Share → Add to Home Screen. A Cloud Agent URL will not last past the run.

## Controls

- Slider 0–9000 m (above +135 m is narrative / non-scientific)
- Presets: present, +70, +135, +2000, +5000, +8500, +9000
- Flag **Labels (names) on the 3D map**: hides text; red prisms stay
- Label filters: peaks / cities / points of interest (globe only; left list stays)
- Click a point on the globe: DEM elevation, nearby city, built-up or empty terrain
- Search a place and click to fly there

The globe uses an ETOPO 2022 DEM at 8192×4096, 16-bit PNG with elevations in metres (1 m steps, depths capped at -500 m). The browser does not decode it natively: `app.js` reads the bytes so CPU and GPU see the same value. Land and water colours are sharply distinct; flooded coastlines stay readable.

Source archives (ETOPO ~466 MB, Blue Marble ~30 MB) are not in git: `main.py` downloads them on first run only if the derived texture is missing.
