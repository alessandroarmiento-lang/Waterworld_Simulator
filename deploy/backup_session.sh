#!/usr/bin/env bash
# End-of-session backup: commit dirty tree if needed, push, land on main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"
SLUG="$(basename "$ROOT" | tr ' ' '-')"

LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="${LOG_DIR}/${SLUG}-session-backup.log"
if [[ ! -w "$LOG_DIR" ]]; then
  LOG="/tmp/${SLUG}-session-backup.log"
fi
LOCKDIR="${TMPDIR:-/tmp}/${SLUG}-session-backup.lockdir"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "$(ts)  $*" | tee -a "$LOG" >&2; }

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [[ -d "$LOCKDIR" ]]; then
    age=$(( $(date +%s) - $(stat -f %m "$LOCKDIR" 2>/dev/null || echo 0) ))
    if [[ "$age" -gt 600 ]]; then
      rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR"
      mkdir "$LOCKDIR"
    else
      log "SKIP: backup already running"
      exit 0
    fi
  fi
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

if [[ ! -d .git ]]; then
  log "SKIP: not a git repository"
  exit 0
fi

dirty=0
ahead=0
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  dirty=1
fi
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  if [[ -n "$(git log --oneline '@{u}..HEAD' 2>/dev/null)" ]]; then
    ahead=1
  fi
elif [[ -n "$(git rev-parse -q --verify HEAD 2>/dev/null)" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    ahead=1
  fi
fi

if [[ "$dirty" -eq 0 && "$ahead" -eq 0 ]]; then
  log "SKIP: clean working tree and nothing to push"
  exit 0
fi

log "START: dirty=$dirty ahead=$ahead"

if [[ "$dirty" -eq 1 ]]; then
  git add -A
  if git diff --cached --name-only | grep -E '(^|/)\.env$|(^|/)\.env\.local$' >/dev/null 2>&1; then
    git reset HEAD -- .env .env.local 2>/dev/null || true
    log "WARN: refused to stage .env / .env.local"
  fi
  if [[ -n "$(git diff --cached --name-only)" ]]; then
    if ! git config user.email >/dev/null 2>&1; then
      export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Alessandro Armiento}"
      export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-alessandroarmiento-lang@users.noreply.github.com}"
      export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
      export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
    fi
    # A refused commit used to pass in silence, and the push right after carried
    # nothing: the session looked backed up while the work was still only local.
    if ! git commit -m "Session backup $(date '+%Y-%m-%d %H:%M')" >>"$LOG" 2>&1; then
      log "ERROR: commit refused — nothing was backed up (see $LOG)"
      exit 1
    fi
  fi
fi

if git remote get-url origin >/dev/null 2>&1; then
  log "PUSH: origin"
  export GIT_TERMINAL_PROMPT=0
  PUSH_HELPER=()
  if command -v gh >/dev/null 2>&1; then
    PUSH_HELPER=(-c "credential.helper=" -c "credential.helper=!$(command -v gh) auth git-credential")
  fi
  if ! git "${PUSH_HELPER[@]}" push origin HEAD >>"$LOG" 2>&1; then
    log "ERROR: git push failed — run: gh auth login"
    exit 1
  else
    log "PUSH: ok"
    if [[ -x "$ROOT/deploy/land_on_main.sh" ]]; then
      br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
      if [[ "$br" != "main" && "$br" != "HEAD" ]]; then
        log "LAND: ${br} → main"
        if "$ROOT/deploy/land_on_main.sh" "$br" >>"$LOG" 2>&1; then
          log "LAND: ok"
        else
          log "WARN: land_on_main failed (conflicts?)"
        fi
      fi
    fi
  fi
else
  log "WARN: no origin remote — skipped push"
fi

log "DONE"
exit 0
