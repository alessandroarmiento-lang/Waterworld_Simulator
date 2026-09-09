#!/bin/bash
# Double-clickable / opened by Waterworld Simulator 1.0.app
# Runs in Terminal so macOS Desktop privacy allows reading .venv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM="$ROOT/sea-level-sim"
cd "$SIM"
if [[ ! -x .venv/bin/python ]]; then
  echo "Manca .venv. Esegui:"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  read -r -p "Invio per chiudere… " _
  exit 1
fi
echo "Waterworld Simulator 1.0"
echo "Apri: http://127.0.0.1:8000"
echo "Lascia aperta questa finestra mentre usi il simulatore."
echo
exec .venv/bin/python main.py
