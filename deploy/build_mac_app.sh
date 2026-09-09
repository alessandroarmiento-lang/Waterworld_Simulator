#!/usr/bin/env bash
# Build "Waterworld Simulator 1.0.app" in the project root (double-click launcher).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Waterworld Simulator 1.0.app"
ICON_PNG="${1:-$ROOT/deploy/assets/waterworld-app-icon.png}"
ICON_ICNS="$ROOT/deploy/assets/AppIcon.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Waterworld Simulator 1.0</string>
  <key>CFBundleExecutable</key>
  <string>WaterworldSimulator</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>lang.alessandroarmiento.waterworld-simulator</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Waterworld Simulator 1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/WaterworldSimulator" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SIM="$ROOT/sea-level-sim"
PYTHON="$SIM/.venv/bin/python"
URL="http://127.0.0.1:8000"
LOG="$SIM/.launcher.log"

alert() {
  /usr/bin/osascript <<OSA >/dev/null 2>&1 || true
display alert "Waterworld Simulator 1.0" message "$1" as critical
OSA
}

notify() {
  /usr/bin/osascript <<OSA >/dev/null 2>&1 || true
display notification "$1" with title "Waterworld Simulator 1.0"
OSA
}

if [[ ! -d "$SIM" ]]; then
  alert "Cartella sea-level-sim non trovata. Lascia questa app nella cartella del progetto."
  exit 1
fi

if [[ ! -x "$PYTHON" ]]; then
  alert "Manca il virtualenv. In Terminale: cd sea-level-sim && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

already_up() {
  /usr/bin/curl -fsS --max-time 1 "$URL" >/dev/null 2>&1
}

if already_up; then
  open "$URL"
  notify "Gia in esecuzione — browser aperto."
  exit 0
fi

cd "$SIM"
nohup "$PYTHON" main.py >"$LOG" 2>&1 &
PID=$!

for _ in $(seq 1 60); do
  if already_up; then
    open "$URL"
    notify "Avviato (http://127.0.0.1:8000)."
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    alert "Avvio fallito. Dettagli in sea-level-sim/.launcher.log"
    exit 1
  fi
  sleep 0.5
done

alert "Timeout in avvio. Controlla sea-level-sim/.launcher.log"
exit 1
LAUNCH

chmod +x "$APP/Contents/MacOS/WaterworldSimulator"

if [[ ! -f "$ICON_ICNS" ]]; then
  if [[ ! -f "$ICON_PNG" ]]; then
    echo "Missing icon: $ICON_PNG" >&2
    exit 1
  fi
  python3 - "$ICON_PNG" "$TMP/AppIcon.iconset" <<'PY'
import sys
from pathlib import Path
from PIL import Image

src = Path(sys.argv[1])
iconset = Path(sys.argv[2])
iconset.mkdir(parents=True, exist_ok=True)
img = Image.open(src).convert("RGBA")
for px, name in [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]:
    img.resize((px, px), Image.Resampling.LANCZOS).save(iconset / name, "PNG")
PY
  /usr/bin/iconutil -c icns "$TMP/AppIcon.iconset" -o "$ICON_ICNS"
fi

cp "$ICON_ICNS" "$APP/Contents/Resources/AppIcon.icns"
/usr/bin/touch "$APP"
echo "Built: $APP"
