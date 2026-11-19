#!/usr/bin/env bash
# Mac only: clone owned GitHub repos that are not already a local checkout.
# Cloud sessions no-op. Existing folders are never moved or deleted.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

command -v gh >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

HOME_DIR="${HOME}"
STAMP_DIR="${HOME_DIR}/.cache"
STAMP="${STAMP_DIR}/clone-missing-repos.stamp"
mkdir -p "$STAMP_DIR"

now="$(date +%s)"
if [[ -f "$STAMP" ]]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  age=$((now - last))
  if [[ "$age" -ge 0 && "$age" -lt 21600 ]]; then
    exit 0
  fi
fi

owner="${CLONE_MISSING_OWNER:-alessandroarmiento-lang}"
list="$(gh repo list "$owner" --limit 200 --no-archived --json name,sshUrl 2>/dev/null || true)"
if [[ -z "$list" || "$list" == "[]" ]]; then
  exit 0
fi

python3 - "$HOME_DIR" "$owner" "$list" <<'PY'
import json, os, subprocess, sys
home, owner, raw = sys.argv[1], sys.argv[2], sys.argv[3]
repos = json.loads(raw)
remotes = set()
for dirpath, dirnames, _ in os.walk(home):
    rel = os.path.relpath(dirpath, home)
    depth = 0 if rel == "." else rel.count(os.sep) + 1
    if depth > 3:
        dirnames.clear()
        continue
    base = os.path.basename(dirpath)
    if base in {"Library", ".Trash", "node_modules", ".cache"} or base.startswith("."):
        if dirpath != home:
            dirnames.clear()
        continue
    if ".git" in dirnames:
        try:
            url = subprocess.check_output(
                ["git", "-C", dirpath, "remote", "get-url", "origin"],
                stderr=subprocess.DEVNULL, text=True,
            ).strip()
        except subprocess.CalledProcessError:
            url = ""
        if url:
            url = url.rstrip("/").lower()
            if url.endswith(".git"):
                url = url[:-4]
            remotes.add(url)
        dirnames.remove(".git")
cloned = []
for repo in repos:
    name = repo.get("name") or ""
    if not name:
        continue
    needle = f"/{owner}/{name}".lower()
    if any(url.endswith(needle) for url in remotes):
        continue
    dest = os.path.join(home, name)
    if os.path.exists(dest):
        print(f"CLONE_MISSING: skip {name} (path exists)")
        continue
    proc = subprocess.run(["gh", "repo", "clone", f"{owner}/{name}", dest])
    if proc.returncode == 0:
        cloned.append(name)
        print(f"CLONE_MISSING: cloned {name} -> {dest}")
    else:
        print(f"CLONE_MISSING: FAIL {name}")
if cloned:
    print("CLONE_MISSING: new on disk: " + " ".join(cloned))
PY

date +%s >"$STAMP"
exit 0
