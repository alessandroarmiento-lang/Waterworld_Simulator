# Waterworld Simulator 1.0

Offline sea-level globe simulator. **Public source**, **non-commercial**, with **mandatory on-screen credits**.

**Mac:** double-click `Waterworld Simulator 1.0.app` (opens Terminal + browser). Or double-click `deploy/start_waterworld.command`. Rebuild the app with `./deploy/build_mac_app.sh` if needed.

**Run / controls:** [`sea-level-sim/README.md`](sea-level-sim/README.md)

**License:** [LICENSE](LICENSE) — free for personal / educational / research use; **no commercial use**; credits must stay visible (see [`CREDITS.md`](CREDITS.md)).

This is **not** OSI “Open Source” (commercial use is forbidden).

**Third-party data (own licenses):**

- Elevation: [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) (NOAA NCEI), public domain
- Colour: NASA Blue Marble via [Visible Earth](https://visibleearth.nasa.gov/)
- Cities: [GeoNames](https://www.geonames.org/) (CC BY 4.0) — population estimates
- 3D: [three.js](https://threejs.org/) (MIT), vendored under `sea-level-sim/static/vendor/`

Dev sync notes (Mac ↔ Cloud / iPhone): [`SYNC.md`](SYNC.md).
