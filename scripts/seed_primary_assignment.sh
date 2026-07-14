#!/usr/bin/env bash
# Bench-test helper: make salesperson TestSP the ACTIVE PRIMARY of customer Bench1.
# Replaces the Walk-in-Queue claim flow, which is blocked while phone-OTP login
# is misconfigured (Twilio 21910). Alert delivery (WA Cloud API) is independent
# of login, so this lets Flow 3 (salesperson alert) be tested end-to-end.
# Idempotent: re-running just re-asserts the active primary row.
# Run:  bash scripts/seed_primary_assignment.sh
set -euo pipefail

ENV_FILE="$(dirname "$0")/../apps/api/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

SB="https://hebnvwhuiqvbigluqfyz.supabase.co"
K="$SUPABASE_SERVICE_ROLE_KEY"
AUTH=(-H "apikey: $K" -H "Authorization: Bearer $K")

CUSTOMER=$(curl -sf -m 15 "$SB/rest/v1/customers?name=eq.Bench1&select=id" "${AUTH[@]}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
SP=$(curl -sf -m 15 "$SB/rest/v1/salespersons?name=eq.TestSP&select=id" "${AUTH[@]}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
OWNER=$(curl -sf -m 15 "$SB/rest/v1/salespersons?role=eq.owner&select=id" "${AUTH[@]}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")

[ -n "$CUSTOMER" ] || { echo "ERROR: customer Bench1 not found"; exit 1; }
[ -n "$SP" ] || { echo "ERROR: salesperson TestSP not found"; exit 1; }
echo "Bench1=$CUSTOMER  TestSP=$SP  owner=$OWNER"

# Upsert on (customer_id, salesperson_id): re-run just re-asserts active primary.
CODE=$(curl -s -m 20 -o /tmp/seed_out -w "%{http_code}" -X POST \
  "$SB/rest/v1/customer_assignments?on_conflict=customer_id,salesperson_id" \
  "${AUTH[@]}" -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d "{\"customer_id\":\"$CUSTOMER\",\"salesperson_id\":\"$SP\",\"role\":\"primary\",\"active\":true,\"added_by\":${OWNER:+\"$OWNER\"}}")
echo "assignment upsert: HTTP $CODE"
cat /tmp/seed_out; echo
case "$CODE" in 2*) echo "SEEDED — TestSP is primary of Bench1";; *) echo "FAILED"; exit 1;; esac
