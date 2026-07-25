#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# apply_phase2_migrations.sh
# Applies migrations 0011-0020 to the production Supabase project.
# Uses the Supabase Management API (POST /rest/v1/rpc or the pg connection).
#
# Usage:
#   SUPABASE_URL=https://hebnvwhuiqvbigluqfyz.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
#   DATABASE_URL=postgresql://postgres:<pass>@db.hebnvwhuiqvbigluqfyz.supabase.co:5432/postgres \
#   bash scripts/apply_phase2_migrations.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../supabase/migrations"

: "${DATABASE_URL:?Set DATABASE_URL to the Supabase direct Postgres URL}"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Topaz CRM — Phase 2 Production Migrations (0011-0020)"
echo "══════════════════════════════════════════════════════════"
echo ""

MIGRATIONS=(
  "0011_roles.sql"
  "0012_doc_series.sql"
  "0013_products.sql"
  "0014_quotations.sql"
  "0015_orders.sql"
  "0016_payments.sql"
  "0017_documents.sql"
  "0018_pipeline_stage_values.sql"
  "0019_pipeline_migrate.sql"
  "0020_rls_phase2a.sql"
)

# Strip asyncpg dialect if present
DB_URL="${DATABASE_URL/postgresql+asyncpg:\/\//postgresql://}"

for migration in "${MIGRATIONS[@]}"; do
  filepath="${MIGRATIONS_DIR}/${migration}"
  if [[ ! -f "$filepath" ]]; then
    echo "  ✗ MISSING: ${migration}"
    exit 1
  fi
  echo "▶ Applying ${migration}..."
  psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${filepath}" 2>&1 | tail -5
  echo "  ✓ ${migration} done"
  echo ""
done

echo "══════════════════════════════════════════════════════════"
echo "  All 10 migrations applied. Verifying key tables..."
echo "══════════════════════════════════════════════════════════"

psql "${DB_URL}" -c "
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('products','quotations','orders','payments','payment_schedules','documents')
ORDER BY tablename;
"

echo ""
echo "  Done. Prod DB is now at migration 0020."
echo ""
