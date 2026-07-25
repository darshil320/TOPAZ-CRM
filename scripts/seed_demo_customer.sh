#!/usr/bin/env bash
# Demo prep: turn the already-enrolled Bench1 (your face) into a realistic
# "returning customer with history" so the customer page tells a story during
# the Manoj demo — name, interest summary, pipeline stage, one meeting note.
# Safe to re-run (idempotent-ish: updates fields, adds one note if none exist).
# Run:  bash scripts/seed_demo_customer.sh
set -euo pipefail

ENV_FILE="$(dirname "$0")/../apps/api/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing}"

SB="https://hebnvwhuiqvbigluqfyz.supabase.co"
K="$SUPABASE_SERVICE_ROLE_KEY"
AUTH=(-H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json")
CID="05b883dc-d2ba-4087-9350-782988299ff6"   # Bench1 (has your enrolled face + primary salesperson)

DEMO_NAME="Rajesh Mehta"
SUMMARY="Looking for a 7-seater fabric recliner sofa for the living room, budget around Rs 1.5L. Prefers neutral tones (beige/grey). Comparing with two other showrooms — decision in ~2 weeks. Wife to visit next time."

echo "== 1/3 customer: name + interest summary + interest tag =="
curl -s -m 20 -X PATCH "$SB/rest/v1/customers?id=eq.$CID" "${AUTH[@]}" \
  -d "{\"name\":\"$DEMO_NAME\",\"primary_interest\":\"Living Room\",\"interest_summary\":\"$SUMMARY\",\"alerts_muted\":false}" \
  -w "  HTTP %{http_code}\n" -o /dev/null

echo "== 2/3 pipeline stage: talking =="
curl -s -m 20 -X POST "$SB/rest/v1/pipeline_stages?on_conflict=customer_id" "${AUTH[@]}" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"customer_id\":\"$CID\",\"stage\":\"talking\"}" \
  -w "  HTTP %{http_code}\n" -o /dev/null

echo "== 3/3 meeting note (only if none exist) =="
EXISTING=$(curl -s -m 15 -I "$SB/rest/v1/conversations?customer_id=eq.$CID&select=id" "${AUTH[@]}" -H "Prefer: count=exact" \
  | grep -i content-range | tr -d '\r' | awk -F/ '{print $2}')
if [ "${EXISTING:-0}" = "0" ]; then
  SP=$(curl -s -m 15 "$SB/rest/v1/customer_assignments?customer_id=eq.$CID&role=eq.primary&active=eq.true&select=salesperson_id" "${AUTH[@]}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['salesperson_id'] if d else '')")
  NOTE="First visit: showed the Milano and Sorrento recliner sets. Liked the Milano in beige, wants his wife's opinion before deciding. Asked about EMI options and delivery timeline."
  curl -s -m 20 -X POST "$SB/rest/v1/conversations" "${AUTH[@]}" \
    -d "{\"customer_id\":\"$CID\",\"salesperson_id\":${SP:+\"$SP\"},\"notes\":\"$NOTE\",\"budget\":\"1.5L\",\"products\":[\"Milano recliner\",\"Sorrento recliner\"],\"stage_at_time\":\"talking\"}" \
    -w "  HTTP %{http_code}\n" -o /dev/null
  echo "  note added"
else
  echo "  $EXISTING note(s) already exist — skipped"
fi

echo "DONE — Bench1 is now '$DEMO_NAME', a returning customer with history."
