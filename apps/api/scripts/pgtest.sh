#!/usr/bin/env bash
# Empirical temp-DB test harness (Docker-free).
#
# Spins an ephemeral local Postgres cluster that mimics the Supabase runtime just
# enough to run the RLS + repository tests: pgvector, the anon/authenticated/
# service_role roles, and an `auth` schema with auth.uid()/auth.role() reading the
# request.jwt.claims GUC (exactly how rls_support.as_role impersonates a user).
#
# It then applies EVERY migration in supabase/migrations in order and runs pytest
# with TEST_DATABASE_URL pointed at the cluster. The cluster is torn down on exit.
#
# Usage:
#   apps/api/scripts/pgtest.sh                      # run the full DB-backed suite
#   apps/api/scripts/pgtest.sh tests/test_rls.py    # pass args straight to pytest
#   PGTEST_KEEP=1 apps/api/scripts/pgtest.sh        # leave the cluster running for inspection
#
# Requires: a local Postgres 14+ install with pgvector on its sharedir
# (Homebrew: `brew install postgresql@14 pgvector`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
PORT="${PGTEST_PORT:-55432}"
DATADIR="$(mktemp -d "${TMPDIR:-/tmp}/topaz-pgtest.XXXXXX")"
PYTHON="${PGTEST_PYTHON:-$REPO_ROOT/.venv/bin/python}"

log() { printf '\033[36m[pgtest]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[pgtest] %s\033[0m\n' "$*" >&2; }

# --- locate the postgres toolchain (prefer postgresql@15 — Supabase prod parity —
#     with pgvector; fall back to @14 or a generic install) ---
for base in \
  /opt/homebrew/opt/postgresql@15/bin /usr/local/opt/postgresql@15/bin \
  /opt/homebrew/opt/postgresql@14/bin /usr/local/opt/postgresql@14/bin \
  /opt/homebrew/bin /usr/local/bin; do
  if [[ -x "$base/initdb" && -x "$base/pg_ctl" ]]; then PGBIN="$base"; break; fi
done
if [[ -z "${PGBIN:-}" ]]; then err "no initdb/pg_ctl found — install postgresql@15"; exit 1; fi
log "using postgres toolchain at $PGBIN"

cleanup() {
  if [[ "${PGTEST_KEEP:-0}" == "1" ]]; then
    log "PGTEST_KEEP=1 — cluster left running on port $PORT (datadir $DATADIR)"
    return
  fi
  "$PGBIN/pg_ctl" -D "$DATADIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATADIR"
}
trap cleanup EXIT

if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  err "port $PORT already in use — set PGTEST_PORT to a free port"; exit 1
fi

# --- init + start an isolated cluster (trust auth on loopback only) ---
log "initdb ($DATADIR)"
"$PGBIN/initdb" -D "$DATADIR" -U postgres --auth=trust --encoding=UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATADIR" -o "-p $PORT -c listen_addresses='127.0.0.1' -c unix_socket_directories='$DATADIR'" -w start >/dev/null
log "postgres up on 127.0.0.1:$PORT"

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=("$PGBIN/psql" -v ON_ERROR_STOP=1 -q)

# --- Supabase runtime shims the migrations assume (roles + auth.uid()) ---
log "bootstrapping Supabase-compatible roles + auth schema"
"${PSQL[@]}" <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname='anon')          then create role anon          nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role')  then create role service_role  nologin noinherit bypassrls; end if;
end $$;
grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
-- auth.uid()/auth.role() read the JWT claims GUC exactly like Supabase at runtime.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'role', '')::text
$$;
grant usage on schema auth to anon, authenticated, service_role;
SQL

# --- apply every migration in lexical order (each file auto-commits per statement:
#     ALTER TYPE ... ADD VALUE and other non-transactional DDL must not be wrapped) ---
shopt -s nullglob
for mig in "$MIGRATIONS_DIR"/*.sql; do
  log "migrate $(basename "$mig")"
  "${PSQL[@]}" -f "$mig" >/dev/null
done
log "all migrations applied"

# --- run the tests against the cluster ---
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres"
cd "$API_DIR"
log "pytest ${*:-tests/}"
set +e
"$PYTHON" -m pytest "${@:-tests/}" -q
rc=$?
set -e
exit $rc
