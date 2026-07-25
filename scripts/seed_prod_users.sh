#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# seed_prod_users.sh — creates production staff logins in Supabase
#
# Usage:
#   SUPABASE_URL=https://hebnvwhuiqvbigluqfyz.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
#   bash scripts/seed_prod_users.sh
#
# Edit the USER DEFINITIONS section below before running.
# Re-running is safe — existing emails are skipped.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://hebnvwhuiqvbigluqfyz.supabase.co}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"

ADMIN="${SUPABASE_URL}/auth/v1/admin/users"
DB="${SUPABASE_URL}/rest/v1"
AUTH_H="Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
KEY_H="apikey: ${SUPABASE_SERVICE_ROLE_KEY}"

# ── USER DEFINITIONS — edit these ────────────────────────────────────────────
# Format: "email|password|name|whatsapp|role"
# Role must be one of: salesperson, owner, admin, accounts, workshop_manager, delivery
USERS=(
  "darshil@topaz-furniture.in|Change_Me_Now1!|Darshil (Owner)|+919999999999|owner"
  "hemant@topaz-furniture.in|Change_Me_Now1!|Hemant (Sales)|+919999999998|salesperson"
)
# ─────────────────────────────────────────────────────────────────────────────

create_user() {
  local email="$1" pass="$2" name="$3" wa="$4" role="$5"

  echo ""
  echo "▶ ${name} <${email}> [${role}]"

  # Create auth user (email_confirm=true skips OTP)
  local resp uid
  resp=$(curl -s -X POST "${ADMIN}" \
    -H "${AUTH_H}" -H "${KEY_H}" -H "Content-Type: application/json" \
    --data-raw "{\"email\":\"${email}\",\"password\":\"${pass}\",\"email_confirm\":true}")

  # Check for duplicate
  local errmsg
  errmsg=$(echo "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('msg','') or d.get('message',''))" 2>/dev/null || true)
  if echo "$errmsg" | grep -qi "already\|duplicate\|exists"; then
    echo "  — auth user already exists, fetching uid..."
    uid=$(curl -s -G "${ADMIN}" -H "${AUTH_H}" -H "${KEY_H}" \
      --data-urlencode "email=${email}" | \
      python3 -c "import json,sys; users=json.load(sys.stdin).get('users',[]); print(users[0]['id'] if users else '')" 2>/dev/null || true)
  elif [[ -n "$errmsg" && "$errmsg" != "None" && "$errmsg" != "" ]]; then
    echo "  ✗ Error: $errmsg"
    return
  else
    uid=$(echo "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  fi

  if [[ -z "$uid" ]]; then
    echo "  ✗ Could not get UID — check credentials"
    return
  fi
  echo "  auth.uid = ${uid}"

  # Upsert salespersons row
  curl -s -X POST "${DB}/salespersons" \
    -H "${AUTH_H}" -H "${KEY_H}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    --data-raw "{\"auth_uid\":\"${uid}\",\"name\":\"${name}\",\"whatsapp\":\"${wa}\",\"role\":\"${role}\",\"active\":true,\"available\":true}" \
    -o /dev/null

  echo "  ✓ salespersons row upserted"
}

echo "════════════════════════════════════════════════════════"
echo "  Topaz CRM — Production User Seed"
echo "  ${SUPABASE_URL}"
echo "════════════════════════════════════════════════════════"

for entry in "${USERS[@]}"; do
  IFS='|' read -r email pass name wa role <<< "$entry"
  create_user "$email" "$pass" "$name" "$wa" "$role"
done

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Done. Logins:"
for entry in "${USERS[@]}"; do
  IFS='|' read -r email pass name wa role <<< "$entry"
  echo "  [${role}] ${email}  /  ${pass}"
done
echo ""
echo "  ⚠ Change passwords immediately after first login."
echo "════════════════════════════════════════════════════════"
echo ""
