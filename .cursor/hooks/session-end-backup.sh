#!/usr/bin/env bash
# Cursor hook: sessionEnd / stop → GitHub backup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="$(cat || true)"

SHOULD_RUN=yes
if command -v python3 >/dev/null 2>&1 && [[ -n "$INPUT" ]]; then
  SHOULD_RUN="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    d = json.loads(raw)
except Exception:
    print("yes"); raise SystemExit(0)
if "reason" in d:
    print("yes"); raise SystemExit(0)
status = (d.get("status") or "completed").lower()
print("yes" if status == "completed" else "no")
' 2>/dev/null || echo yes)"
fi

if [[ "$SHOULD_RUN" != "yes" ]]; then
  echo '{}'
  exit 0
fi

if [[ -x "$ROOT/deploy/backup_session.sh" ]]; then
  "$ROOT/deploy/backup_session.sh" || true
fi
if [[ -x "$ROOT/deploy/auto_sync_peer.sh" ]]; then
  "$ROOT/deploy/auto_sync_peer.sh" || true
fi
echo '{}'
exit 0
