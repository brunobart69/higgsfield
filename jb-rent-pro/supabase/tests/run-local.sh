#!/usr/bin/env bash
# Executa as migrations + testes de banco em um PostgreSQL local descartável.
# Uso: npm run test:db   (requer psql e um servidor PostgreSQL 15+ acessível)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="jbrent_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
if [ -n "${PGTEST_SUPERUSER:-}" ]; then PREFIX=(sudo -u "$PGTEST_SUPERUSER"); else PREFIX=(); fi

"${PREFIX[@]}" createdb "$DB"
trap '"${PREFIX[@]}" dropdb --if-exists "$DB"' EXIT

"${PREFIX[@]}" "${PSQL[@]}" -d "$DB" -c "create extension if not exists pgcrypto;" -f "$DIR/supabase_stubs.sql"
for f in "$DIR"/../migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PREFIX[@]}" "${PSQL[@]}" -d "$DB" -f "$f"
done
for f in "$DIR"/*_test.sql; do
  echo "→ teste $(basename "$f")"
  "${PREFIX[@]}" "${PSQL[@]}" -d "$DB" -f "$f"
done
echo "✔ todos os testes de banco passaram"
