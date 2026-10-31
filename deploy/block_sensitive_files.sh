#!/usr/bin/env bash
# Block a commit that stages sensitive paths or sensitive values.
# Prints file paths only, never the matched text.
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root"

files="$(git diff --cached --name-only --diff-filter=ACMR)"
[[ -z "$files" ]] && exit 0

# Codice fiscale shape, and an Italian IBAN (country + check + ABI/CAB/account).
CF='[A-Z]{6}[0-9]{2}[A-EHLMPR-T][0-9]{2}[A-Z][0-9]{3}[A-Z]'
IBAN='IT[0-9]{2}[A-Z][0-9]{10}[0-9A-Z]{12}'

fail=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  base="${f##*/}"
  low="$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')"

  case "$base" in
    .env.example|*.example) continue ;;
  esac

  blocked=0
  case "$base" in
    .env|.env.local) blocked=1 ;;
  esac
  case "$low" in
    *.enc) ;;
    private/*|*/private/*|*.private.md|*dati-personali-compilato*|*.kdbx|*.sparsebundle|*.key|*codice-fiscale*|*codice_fiscale*)
      blocked=1 ;;
    *.pem)
      case "$low" in
        *public*) ;;
        *) blocked=1 ;;
      esac
      ;;
  esac
  if [[ "$blocked" -eq 1 ]]; then
    echo "BLOCK sensitive path: $f"
    fail=1
    continue
  fi

  [[ "$f" == "deploy/block_sensitive_files.sh" ]] && continue
  [[ -f "$f" ]] || continue
  size="$(wc -c < "$f" | tr -d ' ')"
  [[ "${size:-0}" -gt 1000000 ]] && continue
  grep -Iq . "$f" || continue
  if grep -qE "$CF" "$f" || grep -qE "$IBAN" "$f"; then
    echo "BLOCK sensitive value pattern in: $f"
    fail=1
  fi
done <<< "$files"

exit "$fail"
