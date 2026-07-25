#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# seed_uat_users.sh
#
# Creates 3 UAT login accounts (sales / accounts / owner) in a Supabase project
# and inserts the matching salespersons rows.
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
#   bash scripts/seed_uat_users.sh
#
# Safe to re-run: uses `upsert` semantics — will skip users that already exist
# (Supabase returns 422 on duplicate email; we treat it as a no-op).
#
# Requirements: curl, jq  (both available on macOS/Linux by default)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL to your Supabase project URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"

ADMIN="${SUPABASE_URL}/auth/v1/admin/users"
DB="${SUPABASE_URL}/rest/v1"
AUTH_HEADER="Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
API_KEY_HEADER="apikey: ${SUPABASE_SERVICE_ROLE_KEY}"

# ── UAT test credentials ──────────────────────────────────────────────────────
# Change these before seeding production. For UAT only.
SALES_EMAIL="sales.uat@topaz-crm.test"
SALES_PASS="Topaz@UAT2A!"
SALES_NAME="Ravi Sharma (UAT)"
SALES_WA="+919800000001"

ACCOUNTS_EMAIL="accounts.uat@topaz-crm.test"
ACCOUNTS_PASS="Topaz@UAT2A!"
ACCOUNTS_NAME="Nisha Accounts (UAT)"
ACCOUNTS_WA="+919800000002"

OWNER_EMAIL="owner.uat@topaz-crm.test"
OWNER_PASS="Topaz@UAT2A!"
OWNER_NAME="Hemant Owner (UAT)"
OWNER_WA="+919800000003"

# ── Helpers ───────────────────────────────────────────────────────────────────

create_auth_user() {
  local email="$1" pass="$2"
  # Returns the user UUID, or empty string if the user already existed.
  local resp
  resp=$(curl -s -X POST "${ADMIN}" \
    -H "${AUTH_HEADER}" \
    -H "${API_KEY_HEADER}" \
    -H "Content-Type: application/json" \
    --data-raw "{
      \"email\": \"${email}\",
      \"password\": \"${pass}\",
      \"email_confirm\": true,
      \"user_metadata\": {}
    }")

  # Check for error
  local msg
  msg=$(echo "$resp" | jq -r '.msg // .message // empty' 2>/dev/null || true)
  if [[ -n "$msg" && "$msg" != "null" ]]; then
    # Duplicate email → fetch the existing user's id instead
    if echo "$msg" | grep -qi "already\|duplicate\|exists"; then
      local existing
      existing=$(curl -s -G "${ADMIN}" \
        -H "${AUTH_HEADER}" \
        -H "${API_KEY_HEADER}" \
        --data-urlencode "email=${email}")
      echo "$existing" | jq -r '.users[0].id // empty'
    else
      echo "  ⚠️  Auth user creation warning for ${email}: ${msg}" >&2
      echo ""
    fi
    return
  fi

  echo "$resp" | jq -r '.id // empty'
}

upsert_salesperson() {
  local auth_uid="$1" name="$2" whatsapp="$3" role="$4"
  curl -s -X POST "${DB}/salespersons" \
    -H "${AUTH_HEADER}" \
    -H "${API_KEY_HEADER}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    --data-raw "{
      \"auth_uid\": \"${auth_uid}\",
      \"name\": \"${name}\",
      \"whatsapp\": \"${whatsapp}\",
      \"role\": \"${role}\",
      \"active\": true,
      \"available\": true
    }" > /dev/null
}

echo ""
echo "══════════════════════════════════════════════════"
echo "  Topaz CRM — UAT User Seed"
echo "  Target: ${SUPABASE_URL}"
echo "══════════════════════════════════════════════════"
echo ""

# ── 1. Salesperson (role=salesperson) ─────────────────────────────────────────
echo "▶ Creating salesperson: ${SALES_EMAIL}"
SALES_UID=$(create_auth_user "$SALES_EMAIL" "$SALES_PASS")
if [[ -n "$SALES_UID" ]]; then
  upsert_salesperson "$SALES_UID" "$SALES_NAME" "$SALES_WA" "salesperson"
  echo "  ✓ auth.uid = ${SALES_UID}"
else
  echo "  ✗ Failed to create/find auth user. Check the Supabase URL and service role key."
fi

# ── 2. Accounts (role=accounts) ───────────────────────────────────────────────
echo ""
echo "▶ Creating accounts: ${ACCOUNTS_EMAIL}"
ACCOUNTS_UID=$(create_auth_user "$ACCOUNTS_EMAIL" "$ACCOUNTS_PASS")
if [[ -n "$ACCOUNTS_UID" ]]; then
  upsert_salesperson "$ACCOUNTS_UID" "$ACCOUNTS_NAME" "$ACCOUNTS_WA" "accounts"
  echo "  ✓ auth.uid = ${ACCOUNTS_UID}"
fi

# ── 3. Owner (role=owner) ──────────────────────────────────────────────────────
echo ""
echo "▶ Creating owner: ${OWNER_EMAIL}"
OWNER_UID=$(create_auth_user "$OWNER_EMAIL" "$OWNER_PASS")
if [[ -n "$OWNER_UID" ]]; then
  upsert_salesperson "$OWNER_UID" "$OWNER_NAME" "$OWNER_WA" "owner"
  echo "  ✓ auth.uid = ${OWNER_UID}"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  UAT logins ready:"
echo ""
echo "  SALES    ${SALES_EMAIL} / ${SALES_PASS}"
echo "  ACCOUNTS ${ACCOUNTS_EMAIL} / ${ACCOUNTS_PASS}"
echo "  OWNER    ${OWNER_EMAIL} / ${OWNER_PASS}"
echo ""
echo "  Next: run seed_demo.py to add products/quotes/orders."
echo "  DATABASE_URL=postgresql://... python apps/api/scripts/seed_demo.py"
echo "══════════════════════════════════════════════════"
echo ""
