#!/usr/bin/env bash
# Fetch origin, ff-pull if clean, push local commits, land feature branches on main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"
SLUG="$(basename "$ROOT" | tr ' ' '-')"

LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="${LOG_DIR}/${SLUG}-auto-sync.log"
if [[ ! -w "$LOG_DIR" ]]; then
  LOG="/tmp/${SLUG}-auto-sync.log"
fi

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "$(ts)  $*" | tee -a "$LOG" >&2; }

notify_mac() {
  local title="$1"
  local body="$2"
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  /usr/bin/osascript >/dev/null 2>&1 <<OSA || true
tell application "System Events"
  display notification "${body//\"/\\\"}" with title "${title//\"/\\\"}"
end tell
OSA
}

if [[ ! -d .git ]]; then
  log "SKIP: not a git repo"
  exit 0
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  log "SKIP: no origin"
  exit 0
fi

if ! git fetch origin --prune --quiet 2>>"$LOG"; then
  log "WARN: fetch failed"
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  log "SKIP: detached HEAD"
  exit 0
fi

if ! git rev-parse --verify "origin/${branch}" >/dev/null 2>&1; then
  log "SKIP: no origin/${branch}"
  exit 0
fi

local_tip="$(git rev-parse HEAD)"
remote_tip="$(git rev-parse "origin/${branch}")"
behind="$(git rev-list --count "${local_tip}..${remote_tip}" 2>/dev/null || echo 0)"
ahead="$(git rev-list --count "${remote_tip}..${local_tip}" 2>/dev/null || echo 0)"

dirty=0
if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  dirty=1
fi

if [[ "$behind" -gt 0 ]]; then
  if [[ "$dirty" -eq 1 ]]; then
    log "BEHIND ${branch} by ${behind} but dirty tree — cannot auto-pull"
  elif git pull --ff-only origin "$branch" >>"$LOG" 2>&1; then
    log "PULLED ${branch} (${behind} commits)"
    notify_mac "${SLUG} — sincronizzato" \
      "${branch}: aggiornato da GitHub (${behind} commit)."
  else
    log "WARN: ff-only pull failed on ${branch}"
  fi
fi

if [[ "$ahead" -gt 0 ]]; then
  PUSH_HELPER=()
  if command -v gh >/dev/null 2>&1; then
    PUSH_HELPER=(-c "credential.helper=" -c "credential.helper=!$(command -v gh) auth git-credential")
  fi
  if git "${PUSH_HELPER[@]}" push origin "$branch" >>"$LOG" 2>&1; then
    log "PUSHED ${branch} (${ahead} commits)"
    if [[ "$branch" != "main" && -x "$ROOT/deploy/land_on_main.sh" ]]; then
      if "$ROOT/deploy/land_on_main.sh" "$branch" >>"$LOG" 2>&1; then
        log "LANDED ${branch} → main"
      else
        log "WARN: land_on_main failed for ${branch}"
      fi
    fi
  else
    log "WARN: push failed on ${branch}"
  fi
fi

# Mac: land open Cloud Agent branches (cursor/*) onto main
if [[ "$(uname -s)" == "Darwin" && -x "$ROOT/deploy/land_on_main.sh" ]] \
  && command -v gh >/dev/null 2>&1; then
  while IFS= read -r head; do
    [[ -z "$head" || "$head" == "$branch" ]] && continue
    if "$ROOT/deploy/land_on_main.sh" "$head" >>"$LOG" 2>&1; then
      log "LANDED peer branch ${head} → main"
    else
      log "SKIP land ${head} (conflict or already landed)"
    fi
  done < <(
    gh pr list --base main --state open --limit 20 \
      --json headRefName \
      --jq '.[] | .headRefName | select(startswith("cursor/"))' \
      2>/dev/null || true
  )
fi

if [[ "$behind" -eq 0 && "$ahead" -eq 0 ]]; then
  log "OK ${branch} aligned"
fi

exit 0
