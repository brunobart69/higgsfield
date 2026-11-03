#!/usr/bin/env bash
# Build com o Supabase simulado, sobe o app e roda os testes E2E.
# Requer Playwright com Chromium (npx playwright install chromium) disponível para `require("playwright")`.
set -euo pipefail
cd "$(dirname "$0")/.."
export MOCK_PORT=54329
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${MOCK_PORT}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="mock-anon-key-for-e2e"
export NEXT_DIST_DIR=".next-e2e"
node e2e/mock-supabase.mjs > /dev/null &
MOCK=$!
trap 'kill $MOCK $APP 2>/dev/null || true' EXIT
npx next build > /dev/null
SUPABASE_SERVICE_ROLE_KEY="mock-service-role-key-not-real" npx next start -p 3100 > /dev/null &
APP=$!
for _ in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3100/login && break; sleep 1; done
node e2e/smoke.mjs
