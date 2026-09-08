#!/usr/bin/env bash
# Land the current feature branch onto origin/main and push.
# Usage: ./deploy/land_on_main.sh [branch]
# Opt out: LAND_ON_MAIN=0 ./deploy/land_on_main.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"

if [[ "${LAND_ON_MAIN:-1}" == "0" ]]; then
  echo "LAND_ON_MAIN: skipped (LAND_ON_MAIN=0)"
  exit 0
fi

if [[ ! -d .git ]]; then
  echo "LAND_ON_MAIN: not a git repo"
  exit 0
fi

if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  echo "LAND_ON_MAIN: dirty tree — commit or stash first"
  exit 1
fi

src="${1:-}"
if [[ -z "$src" ]]; then
  src="$(git rev-parse --abbrev-ref HEAD)"
fi
if [[ "$src" == "HEAD" ]]; then
  echo "LAND_ON_MAIN: detached HEAD — pass a branch name"
  exit 1
fi

PUSH_HELPER=()
if command -v gh >/dev/null 2>&1; then
  PUSH_HELPER=(-c "credential.helper=" -c "credential.helper=!$(command -v gh) auth git-credential")
fi

if [[ "$src" == "main" ]]; then
  git fetch origin main --quiet || true
  if git "${PUSH_HELPER[@]}" push origin main; then
    echo "LAND_ON_MAIN: already on main — pushed"
  else
    echo "LAND_ON_MAIN: already on main — push failed or nothing to push"
  fi
  exit 0
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "LAND_ON_MAIN: no origin remote"
  exit 1
fi

git fetch origin --prune

if git rev-parse --verify "origin/${src}" >/dev/null 2>&1; then
  git branch -f "$src" "origin/${src}" 2>/dev/null || true
fi
if ! git rev-parse --verify "$src" >/dev/null 2>&1; then
  echo "LAND_ON_MAIN: unknown branch ${src}"
  exit 1
fi

here="$(git rev-parse --abbrev-ref HEAD)"
src_tip="$(git rev-parse "$src")"

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  git checkout -B main origin/main
else
  git checkout -B main
fi

if git merge-base --is-ancestor "$src_tip" HEAD; then
  echo "LAND_ON_MAIN: ${src} already contained in main"
else
  if ! git merge --no-ff "$src" -m "chore: land ${src} onto main (always-aligned)"; then
    echo "LAND_ON_MAIN: merge conflict — aborting"
    git merge --abort 2>/dev/null || true
    git checkout "$here" 2>/dev/null || true
    exit 1
  fi
fi

if ! git "${PUSH_HELPER[@]}" push origin main; then
  echo "LAND_ON_MAIN: push to main failed"
  git checkout "$here" 2>/dev/null || true
  exit 1
fi

git checkout "$here" 2>/dev/null || git checkout "$src" 2>/dev/null || true
echo "LAND_ON_MAIN: ${src} → origin/main OK"
exit 0
