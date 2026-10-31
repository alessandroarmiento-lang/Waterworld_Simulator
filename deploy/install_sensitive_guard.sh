#!/usr/bin/env bash
# Install deploy/block_sensitive_files.sh as this repo's pre-commit hook.
# Safe to re-run. Does not change git config. Chains an existing hook.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
GUARD="$(cd "$(dirname "$0")" && pwd)/block_sensitive_files.sh"
HOOK="$ROOT/.git/hooks/pre-commit"

[[ -f "$GUARD" ]] || { echo "GUARD: missing $GUARD"; exit 1; }
chmod +x "$GUARD"
mkdir -p "$ROOT/.git/hooks"

if [[ -f "$HOOK" ]] && grep -q 'block_sensitive_files.sh' "$HOOK"; then
  echo "GUARD: already installed in $ROOT"
  exit 0
fi

if [[ ! -f "$HOOK" ]]; then
  cat > "$HOOK" <<EOF
#!/usr/bin/env bash
set -euo pipefail
"$GUARD"
EOF
  chmod +x "$HOOK"
  echo "GUARD: installed in $ROOT"
  exit 0
fi

python3 - "$HOOK" "$GUARD" <<'PY'
import sys
path, guard = sys.argv[1], sys.argv[2]
text = open(path).read()
call = f'\n"{guard}"\n'
if text.startswith("#!"):
    nl = text.find("\n")
    text = text[: nl + 1] + call + text[nl + 1 :]
else:
    text = "#!/usr/bin/env bash\n" + call + text
open(path, "w").write(text)
PY
chmod +x "$HOOK"
echo "GUARD: chained in $ROOT"
