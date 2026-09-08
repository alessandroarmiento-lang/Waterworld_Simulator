#!/usr/bin/env bash
# Mandatory GitHub check before Mac / Cloud Agent work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SLUG="$(basename "$ROOT" | tr ' ' '-')"
STAMP_DIR="${TMPDIR:-/tmp}/${SLUG}-github-check"
mkdir -p "$STAMP_DIR"
STAMP="${STAMP_DIR}/last-check.stamp"
MAX_AGE_SEC="${GITHUB_CHECK_MAX_AGE:-45}"

now="$(date +%s)"
if [[ -f "$STAMP" ]]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  age=$((now - last))
  if [[ "$age" -ge 0 && "$age" -lt "$MAX_AGE_SEC" ]]; then
    echo "GITHUB_CHECK: ok (cached ${age}s ago)"
    exit 0
  fi
fi

out="no origin"
if [[ -x "$ROOT/deploy/auto_sync_peer.sh" ]] && git remote get-url origin >/dev/null 2>&1; then
  out="$("$ROOT/deploy/auto_sync_peer.sh" 2>&1 || true)"
  echo "$out" | tail -n 5
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
local_tip="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
behind=0
ahead=0
if git rev-parse --verify "origin/${branch}" >/dev/null 2>&1; then
  behind="$(git rev-list --count "HEAD..origin/${branch}" 2>/dev/null || echo 0)"
  ahead="$(git rev-list --count "origin/${branch}..HEAD" 2>/dev/null || echo 0)"
fi

date +%s >"$STAMP"

if echo "$out" | grep -q 'PULLED '; then
  echo "GITHUB_CHECK: pulled updates on ${branch} @ ${local_tip}"
elif echo "$out" | grep -q 'dirty tree'; then
  echo "GITHUB_CHECK: WARN behind on GitHub but local tree dirty — commit/stash before pull (${branch})"
elif [[ "$behind" -gt 0 ]]; then
  echo "GITHUB_CHECK: WARN still behind origin/${branch} by ${behind}"
elif [[ "$ahead" -gt 0 ]]; then
  echo "GITHUB_CHECK: local ahead by ${ahead} (push attempted) ${branch} @ ${local_tip}"
else
  echo "GITHUB_CHECK: aligned with origin/${branch} @ ${local_tip}"
fi

exit 0
