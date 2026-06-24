# RLS security tests — runbook

These tests prove the database security boundary (§19-H of the execution plan). They
run against a **local Supabase** stack and impersonate each role the way Supabase does
in production. A failing test = a real customer-data leak. Treat as release-blocking.

## One-time setup
You already have Docker. Install the Supabase CLI:

```bash
brew install supabase/tap/supabase          # macOS
supabase --version
```

## Run
From the repo root (`topaz-showroom-intelligence/`):

```bash
supabase init                # first time only — creates supabase/config.toml
supabase start               # boots local Postgres + Auth + Studio in Docker
supabase db reset            # applies migrations 0001–0005 to the local DB (clean)

python -m venv .venv && source .venv/bin/activate
pip install -r apps/api/tests/requirements-dev.txt

pytest apps/api/tests/test_rls.py -v
```

All tests should pass. Any failure prints which isolation boundary broke.

## See the data by hand
- **Supabase Studio:** http://127.0.0.1:54323 → Table editor / SQL editor.
- **Connection string:** `supabase status` prints the DB URL (default
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
- Override the DB the tests hit with `TEST_DATABASE_URL=... pytest ...`.

## Tear down
```bash
supabase stop                # stops the containers (data kept)
supabase stop --no-backup    # stops and wipes local data
```
