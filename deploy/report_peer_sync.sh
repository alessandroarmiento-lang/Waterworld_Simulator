#!/usr/bin/env bash
# Bidirectional Mac ↔ Cloud (mobile) status via origin/main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"

HOST_KIND="cloud"
if [[ "$(uname -s)" == "Darwin" ]]; then
  HOST_KIND="mac"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "PEER_SYNC: nessun remote origin (repo non ancora su GitHub)."
  echo "PEER_SYNC_CHAT: Questo progetto non ha ancora origin. Va messo su GitHub prima di lavorare da mobile."
  exit 0
fi

git fetch origin --prune --quiet 2>/dev/null || {
  echo "PEER_SYNC: fetch fallito (rete?)."
  echo "PEER_SYNC_CHAT: Sync GitHub non riuscito."
  exit 0
}

if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  echo "PEER_SYNC: manca origin/main."
  echo "PEER_SYNC_CHAT: origin/main assente."
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
remote_short="$(git rev-parse --short origin/main)"
head_tip="$(git rev-parse HEAD)"
remote_main="$(git rev-parse origin/main)"
behind_main="$(git rev-list --count "${head_tip}..${remote_main}" 2>/dev/null || echo 0)"
ahead_main="$(git rev-list --count "${remote_main}..${head_tip}" 2>/dev/null || echo 0)"

echo "PEER_SYNC: host=${HOST_KIND} branch=${branch} origin/main@${remote_short}"

if [[ "$behind_main" -gt 0 ]]; then
  echo "PEER_SYNC: questo checkout indietro di ${behind_main} commit rispetto a origin/main."
elif [[ "$ahead_main" -gt 0 && "$branch" == "main" ]]; then
  echo "PEER_SYNC: main locale avanti di ${ahead_main} commit (push verso GitHub)."
elif [[ "$ahead_main" -gt 0 ]]; then
  echo "PEER_SYNC: feature avanti di ${ahead_main} commit rispetto a main."
else
  echo "PEER_SYNC: allineato con origin/main."
fi

pr_count=0
pr_lines=""
if command -v gh >/dev/null 2>&1; then
  while IFS=$'\t' read -r num title state head; do
    [[ -z "${num:-}" ]] && continue
    pr_count=$((pr_count + 1))
    line="#${num} [${state}] ${title} — ${head}"
    echo "PEER_SYNC_PR: ${line}"
    pr_lines="${pr_lines}"$'\n'"  - ${line}"
  done < <(
    gh pr list --base main --state open --limit 20 \
      --json number,title,isDraft,headRefName \
      --jq '.[] | [.number, .title, (if .isDraft then "draft" else "open" end), .headRefName] | @tsv' \
      2>/dev/null || true
  )
fi

if [[ "$pr_count" -eq 0 ]]; then
  echo "PEER_SYNC: nessuna PR aperta."
  echo "PEER_SYNC_TOAST: Mac↔Cloud: main OK"
else
  echo "PEER_SYNC: ${pr_count} PR in coda — non su main finché non le sbarcano."
  echo "PEER_SYNC_TOAST: ${pr_count} PR Cloud in attesa di land su main"
fi

chat_mac="Di' ad Alessandro in italiano: Mac acceso; sync main; elenca PR in coda; land su main = allineamento col telefono."
chat_cloud="Di' ad Alessandro in italiano: sessione Cloud/mobile; novità su main (lavoro Mac); PR ancora aperte; per allineare il Mac serve land su main."
chat_line="$chat_cloud"
[[ "$HOST_KIND" == "mac" ]] && chat_line="$chat_mac"

echo "PEER_SYNC_CHAT: === Sync Mac ↔ Cloud (bus = main) ==="
echo "PEER_SYNC_CHAT: - Host: ${HOST_KIND} | branch: ${branch} | origin/main@${remote_short}"
if [[ "$behind_main" -gt 0 ]]; then
  echo "PEER_SYNC_CHAT: - GitHub→qui: indietro ${behind_main} commit."
elif [[ "$ahead_main" -gt 0 && "$branch" == "main" ]]; then
  echo "PEER_SYNC_CHAT: - Qui→GitHub: avanti ${ahead_main} commit."
else
  echo "PEER_SYNC_CHAT: - Allineato con origin/main."
fi
if [[ "$pr_count" -gt 0 ]]; then
  echo "PEER_SYNC_CHAT: - Coda Cloud/mobile:"
  printf '%s\n' "$pr_lines" | sed 's/^/PEER_SYNC_CHAT: /'
else
  echo "PEER_SYNC_CHAT: - Nessuna PR in coda."
fi
echo "PEER_SYNC_CHAT: ${chat_line}"

exit 0
