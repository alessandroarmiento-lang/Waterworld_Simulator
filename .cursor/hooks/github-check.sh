#!/usr/bin/env bash
# Cursor hook wrapper: check GitHub before prompt / tool / session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-prompt}"
SLUG="$(basename "$ROOT" | tr ' ' '-')"

cat >/dev/null || true

STATUS="$("$ROOT/deploy/check_github_before_work.sh" 2>&1 || true)"
NOTE="$(printf '%s\n' "$STATUS" | grep '^GITHUB_CHECK:' | tail -n 1)"
NOTE="${NOTE:-GITHUB_CHECK: done}"

BRIEF=""
if [[ -x "$ROOT/deploy/report_peer_sync.sh" ]]; then
  BRIEF="$("$ROOT/deploy/report_peer_sync.sh" 2>/dev/null || true)"
fi
CHAT="$(printf '%s\n' "$BRIEF" | grep '^PEER_SYNC_CHAT:' | sed 's/^PEER_SYNC_CHAT: //' || true)"
CHAT="${CHAT:-main sync checked.}"

case "$MODE" in
  prompt)
    printf '{"continue":true,"user_message":""}\n'
    ;;
  tool)
    printf '{"permission":"allow","agent_message":%s}\n' \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$NOTE")"
    ;;
  session)
    CTX="${SLUG} GitHub gate: ${NOTE}

Bidirectional Mac ↔ Cloud briefing (bus = main):
${CHAT}

FIRST reply to Alessandro in Italian:
- If Mac: Mac acceso / sync main; list open Cloud PRs not on main.
- If Cloud/mobile: what is new on main (Mac work); which PRs still wait.
Do not wait to be asked."
    printf '{"additional_context":%s}\n' \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$CTX")"
    ;;
  *)
    printf '{"continue":true}\n'
    ;;
esac

exit 0
