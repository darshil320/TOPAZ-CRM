#!/usr/bin/env bash
#
# Export the live Railway env into a Hetzner-ready apps/api/.env.
# Run on YOUR MAC (not the VPS) from the repo root:
#
#     bash infra/hetzner/pull-railway-env.sh
#
# Produces ./api.env.out — copy it to the VPS, then delete the local file.
# Nothing is printed to stdout: these are production secrets and this script's
# output would otherwise land in your shell history and terminal scrollback.

set -euo pipefail

OUT="api.env.out"
SERVICE="${SERVICE:-api}"

log()  { printf '\033[1;32m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

cat <<'NOTE'
NOTE: this script needs a LIVE Railway project. If the project is suspended for
non-payment, the API returns nothing and this will fail. In that case skip this
script entirely and use infra/hetzner/env.template instead — the Railway
dashboard usually still shows Variables on a suspended project (billing stops
compute, not dashboard reads), so you can copy the values across by hand.

NOTE

command -v railway >/dev/null 2>&1 \
  || fail "railway CLI not found. Install: brew install railway  (then: railway login)"

railway whoami >/dev/null 2>&1 \
  || fail "not logged in. Run: railway login"

log "Linking to the Railway project"
# `railway link` is interactive — pick project 'cooperative-wisdom', the
# production environment, and service 'api' when prompted.
if [[ ! -f .railway/config.json && ! -f railway.json ]]; then
  railway link || fail "link failed"
fi

log "Fetching variables from service '$SERVICE'"
# --kv gives KEY=value lines. --service avoids the interactive service prompt.
RAW="$(railway variables --service "$SERVICE" --kv 2>/dev/null)" \
  || fail "could not read variables (project suspended for non-payment? then use env.template). Try: railway variables --service $SERVICE --kv"

[[ -n "$RAW" ]] || fail "Railway returned no variables — project suspended, or wrong service/environment. Fall back to infra/hetzner/env.template"

log "Rewriting for Hetzner"
{
  echo "# Exported from Railway service '$SERVICE' by infra/hetzner/pull-railway-env.sh"
  echo "# REDIS_URL is rewritten to the compose service name; Railway's"
  echo "# \${{Redis.REDIS_URL}} template does not resolve outside Railway."
  echo

  # Drop Railway-injected platform vars (RAILWAY_*, PORT) — they are meaningless
  # on the VPS and PORT in particular would fight the Dockerfile's fixed 8000.
  # Rewrite REDIS_URL to the internal compose hostname.
  printf '%s\n' "$RAW" \
    | grep -v -E '^(RAILWAY_|PORT=|NIXPACKS_)' \
    | sed -E 's|^REDIS_URL=.*|REDIS_URL=redis://redis:6379/0|'
} > "$OUT"

# 600 before anyone can read it: this file holds WA_TOKEN and the DB password.
chmod 600 "$OUT"

# --- validation -------------------------------------------------------------
REQUIRED=(DATABASE_URL REDIS_URL EDGE_API_KEY DASHBOARD_API_KEY
          WA_PHONE_NUMBER_ID WA_TOKEN WA_WEBHOOK_VERIFY_TOKEN WA_APP_SECRET
          SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DASHBOARD_URL
          # Optional in config.py but fail closed at runtime: no JWT secret means
          # write routes 503, no hook secret means OTP login 401s.
          SUPABASE_JWT_SECRET SUPABASE_SEND_SMS_HOOK_SECRET)

missing=()
for key in "${REQUIRED[@]}"; do
  grep -q "^${key}=" "$OUT" || missing+=("$key")
done

# A placeholder that silently rode along from .env.example is worse than a
# missing var: the app boots and fails later, in production, on a real customer.
if grep -qE '^[A-Z_]+=(change_me|xxxx|password|your_|sk-ant-xxxx)' "$OUT"; then
  warn "placeholder values still present:"
  grep -nE '^[A-Z_]+=(change_me|xxxx|password|your_|sk-ant-xxxx)' "$OUT" | cut -d= -f1
fi

if (( ${#missing[@]} )); then
  warn "missing required vars: ${missing[*]}"
  warn "add them by hand to $OUT before copying to the VPS"
fi

if ! grep -q '^DATABASE_URL=postgresql+asyncpg://' "$OUT"; then
  warn "DATABASE_URL is not using the postgresql+asyncpg:// prefix — asyncpg requires it"
fi

COUNT=$(grep -c '^[A-Z]' "$OUT" || true)
log "Wrote $OUT ($COUNT variables, mode 600)"

cat <<NEXT

Next:
  1. Review it:   less $OUT
  2. Copy to VPS: scp $OUT root@<vps-ip>:/opt/topaz/apps/api/.env
  3. Lock it down: ssh root@<vps-ip> 'chmod 600 /opt/topaz/apps/api/.env'
  4. DELETE the local copy — it holds live secrets:
       rm $OUT

NEXT
