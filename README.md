# Waterworld Simulator 1.0

Offline **3D sea-level globe**: raise the oceans (0–9000 m), explore coasts, peaks, and cities on an ETOPO-based planet. **Public source**, **non-commercial**, **mandatory on-screen credits**.

## Get it

| Who | How |
| --- | --- |
| **macOS (quick)** | Download the app from [Latest release](https://github.com/alessandroarmiento-lang/Waterworld_Simulator/releases/latest), unzip, double-click `Waterworld Simulator 1.0.app` (opens Terminal + browser). Or double-click `deploy/start_waterworld.command` from a clone. |
| **From source** | See [Run](#run) below. First launch may download DEM / Blue Marble textures if missing (~hundreds of MB). |
| **Rebuild Mac app** | `./deploy/build_mac_app.sh` |

**Controls & details:** [`sea-level-sim/README.md`](sea-level-sim/README.md)

**License:** [ANCA 1.0](https://github.com/alessandroarmiento-lang/ANCA) ([LICENSE](LICENSE)) — free for personal / educational / research use; **no commercial use**; credits must stay visible (see [`CREDITS.md`](CREDITS.md)).

**Language:** UI Italian / English (IT · EN in the panel). Public clones default to **English**. A gitignored `sea-level-sim/static/owner-prefs.json` (`defaultLang: "it"`) keeps Italian on the author’s machine — see `owner-prefs.example.json`.

This is **not** OSI “Open Source” (commercial use is forbidden).

## Run

```bash
cd sea-level-sim
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Open http://127.0.0.1:8000

## What you can do

- Slider 0–9000 m (above +135 m is narrative / non-scientific scenario)
- Presets: present, +70, +135, +2000, +5000, +8500, +9000
- Toggle map labels; filter peaks / cities / POIs
- Click the globe for DEM elevation and nearby city context
- Search a place and fly there

## Data credits (own licenses)

- Elevation: [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) (NOAA NCEI), public domain
- Colour: NASA Blue Marble via [Visible Earth](https://visibleearth.nasa.gov/)
- Cities: [GeoNames](https://www.geonames.org/) (CC BY 4.0) — population estimates
- 3D: [three.js](https://threejs.org/) (MIT), vendored under `sea-level-sim/static/vendor/`

Dev sync notes (Mac ↔ Cloud / iPhone): [`SYNC.md`](SYNC.md).
