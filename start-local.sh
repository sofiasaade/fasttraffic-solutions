#!/bin/bash
# Start Fast Traffic OS locally (no Manus): local TiDB database + app + a public tunnel link.
# Usage:  ./start-local.sh
set -e
export PATH="$HOME/.local/node/bin:$HOME/.tiup/bin:$HOME/.local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Starting local TiDB database (if not already running)…"
if ! nc -z 127.0.0.1 4000 2>/dev/null; then
  # --monitor=false is REQUIRED (the Prometheus add-on isn't installed and its failure kills the cluster)
  nohup tiup playground --tag fts --db 1 --kv 1 --pd 1 --tiflash 0 --monitor=false \
    > "$ROOT/.tidb.log" 2>&1 &
  disown
  echo "    waiting for the database…"
  for i in $(seq 1 60); do nc -z 127.0.0.1 4000 2>/dev/null && break; sleep 2; done
fi
nc -z 127.0.0.1 4000 2>/dev/null && echo "    database up (127.0.0.1:4000)" || { echo "    database failed — see .tidb.log"; exit 1; }

echo "==> Ensuring tables exist…"
npx drizzle-kit push --force >/dev/null 2>&1 || true

echo "==> Starting a public tunnel link…"
nohup cloudflared tunnel --url http://localhost:3000 --http-host-header localhost:3000 --no-autoupdate \
  > "$ROOT/.tunnel.log" 2>&1 &
disown
PUBLIC=""
for i in $(seq 1 25); do
  PUBLIC=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$ROOT/.tunnel.log" 2>/dev/null | head -1)
  [ -n "$PUBLIC" ] && break; sleep 1
done

echo ""
echo "======================================================================"
echo "  LOCAL:   http://localhost:3000/api/dev-login"
[ -n "$PUBLIC" ] && echo "  PUBLIC:  $PUBLIC/api/dev-login   (share carefully — no password)"
echo ""
echo "  Open either link to log in as coordinator. Keep this window open."
echo "  Press Ctrl+C to stop the app (database + tunnel keep running)."
echo "======================================================================"
echo ""
pnpm dev
