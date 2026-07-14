#!/usr/bin/env bash
# One-time bench-reset: wipe ALL test customer data from prod Supabase.
# Deletes: messages, followups, customer_assignments, visits, face_embeddings,
# customers, consents (in FK-safe order) + face-crop files in Storage.
# Keeps: salespersons, auth users, migrations, everything else.
# Run:  bash scripts/wipe_test_data.sh
set -euo pipefail

ENV_FILE="$(dirname "$0")/../apps/api/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing in apps/api/.env}"

SB="https://hebnvwhuiqvbigluqfyz.supabase.co"
K="$SUPABASE_SERVICE_ROLE_KEY"
AUTH=(-H "apikey: $K" -H "Authorization: Bearer $K")

echo "== 1/3 Deleting face-crop files from Storage =="
KEYS_JSON=$(curl -sf -m 20 "$SB/rest/v1/visits?select=photo_key&photo_key=not.is.null" "${AUTH[@]}" \
  | python3 -c "import sys,json; print(json.dumps({'prefixes':[v['photo_key'] for v in json.load(sys.stdin)]}))")
N_KEYS=$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])['prefixes']))" "$KEYS_JSON")
if [ "$N_KEYS" -gt 0 ]; then
  curl -sf -m 30 -X DELETE "$SB/storage/v1/object/face-crops" "${AUTH[@]}" \
    -H "Content-Type: application/json" -d "$KEYS_JSON" > /dev/null
  echo "deleted $N_KEYS storage objects"
else
  echo "no storage objects to delete"
fi

echo "== 2/3 Deleting DB rows (FK-safe order) =="
# table:filter-column (pipeline_stages has no id column — PK is customer_id)
for SPEC in messages:id followups:id customer_assignments:id visits:id \
            face_embeddings:id conversations:id coverage_requests:id \
            pipeline_stages:customer_id customers:id consents:id; do
  T="${SPEC%%:*}"; COL="${SPEC##*:}"
  CODE=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -X DELETE \
    "$SB/rest/v1/$T?$COL=not.is.null" "${AUTH[@]}")
  echo "$T: HTTP $CODE"
  case "$CODE" in 2*) ;; *) echo "ERROR deleting $T — stopping"; exit 1;; esac
done

echo "== 3/3 Verifying zero rows =="
FAIL=0
for T in messages followups customer_assignments visits face_embeddings \
         conversations coverage_requests pipeline_stages customers consents; do
  COUNT=$(curl -s -m 20 -I "$SB/rest/v1/$T?select=*" "${AUTH[@]}" -H "Prefer: count=exact" \
    | grep -i content-range | tr -d '\r' | awk -F/ '{print $2}')
  echo "$T: $COUNT rows"
  [ "$COUNT" = "0" ] || FAIL=1
done
[ "$FAIL" = "0" ] && echo "WIPE COMPLETE — system is clean" || { echo "WIPE INCOMPLETE — check above"; exit 1; }
