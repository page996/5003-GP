#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 24 or newer is required."
  exit 1
fi
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "ERROR: Node.js 24 or newer is required. Current: $(node -v)"
  exit 1
fi

if [ ! -f node_modules/maplibre-gl/package.json ]; then
  echo "[1/4] Installing dependencies..."
  npm ci
fi

if [ ! -f data/generated/dataset.json ]; then
  echo "[2/4] Building dataset..."
  npm run data:build
fi

if [ ! -f data/visaatlas.sqlite ]; then
  echo "[3/4] Creating SQLite database..."
  npm run db:rebuild
fi

if [ ! -f dist/index.html ]; then
  echo "[4/4] Building production bundle..."
  npm run build
fi

PORT="${PORT:-3001}"
echo
echo "Visa Atlas is starting on http://127.0.0.1:${PORT}"
echo "Press Ctrl+C to stop."
echo
exec env PORT="$PORT" npm start
