#!/usr/bin/env bash
#
# Run ON THE VPS after filling apps/api/.env, BEFORE `systemctl start topaz`.
#
#     bash /opt/topaz/infra/hetzner/preflight.sh
#
# Catches the failures that otherwise surface 10 minutes into a Chromium build,
# or worse, silently at 3am when beat first fires.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/topaz}"
ENV_FILE="$APP_DIR/apps/api/.env"
COMPOSE_ENV="$APP_DIR/infra/hetzner/.env"

pass=0; fail=0; warn=0
# `|| true` is REQUIRED, not decorative: ((x++)) evaluates to x's PRE-increment
# value, so the first call (x=0) exits non-zero. In `ok "..." || bad "..."` that
# made a passing check ALSO print a failure — the exact false alarm this file
# exists to prevent.
ok()   { printf '  \033[1;32m[OK]\033[0m   %s\n' "$1"; ((pass++)) || true; }
bad()  { printf '  \033[1;31m[FAIL]\033[0m %s\n' "$1"; ((fail++)) || true; }
warn() { printf '  \033[1;33m[WARN]\033[0m %s\n' "$1"; ((warn++)) || true; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "Files"
[[ -f "$ENV_FILE" ]] && ok "apps/api/.env exists" \
  || { bad "apps/api/.env MISSING — nothing will boot"; }
[[ -f "$COMPOSE_ENV" ]] && ok "infra/hetzner/.env exists" \
  || bad "infra/hetzner/.env MISSING — Caddy has no API_DOMAIN, TLS will not issue"

if [[ -f "$ENV_FILE" ]]; then
  perms=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')
  [[ "$perms" == "600" ]] && ok ".env is mode 600" \
    || warn ".env is mode $perms — should be 600 (holds WA_TOKEN + DB password)"
fi

sec "Required variables"
if [[ -f "$ENV_FILE" ]]; then
  # Read values by PARSING, not by sourcing. Compose's env_file takes the whole
  # line after '=' as the value, but bash `source` re-tokenises it — so an
  # unquoted value containing spaces (SHOWROOM_CONTACT_NUMBER=+91 63563 20206)
  # makes bash try to run "63563" as a command and leaves the var empty. That
  # made preflight fail a value the container reads perfectly well.
  envget() {
    sed -n "s/^$1=//p" "$ENV_FILE" | head -1
  }
  for _k in DATABASE_URL REDIS_URL EDGE_API_KEY DASHBOARD_API_KEY \
            WA_PHONE_NUMBER_ID WA_TOKEN WA_WEBHOOK_VERIFY_TOKEN WA_APP_SECRET \
            SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET \
            SUPABASE_SEND_SMS_HOOK_SECRET DASHBOARD_URL SHOWROOM_CONTACT_NUMBER \
            DB_DISABLE_PREPARED_STATEMENT_CACHE; do
    printf -v "$_k" '%s' "$(envget "$_k")"
  done

  for key in DATABASE_URL REDIS_URL EDGE_API_KEY DASHBOARD_API_KEY \
             WA_PHONE_NUMBER_ID WA_TOKEN WA_WEBHOOK_VERIFY_TOKEN WA_APP_SECRET \
             SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DASHBOARD_URL \
             SHOWROOM_CONTACT_NUMBER; do
    if [[ -n "${!key:-}" ]]; then ok "$key set"; else bad "$key MISSING"; fi
  done

  # These two are optional to Pydantic (default None) but fail CLOSED at runtime,
  # which makes them the worst kind of missing: the stack boots green and staff
  # discover it later.
  #   SUPABASE_JWT_SECRET unset        -> every money/write route returns 503
  #   SUPABASE_SEND_SMS_HOOK_SECRET    -> /api/auth/send-sms-hook 401s, no OTP login
  [[ -n "${SUPABASE_JWT_SECRET:-}" ]] && ok "SUPABASE_JWT_SECRET set" \
    || bad "SUPABASE_JWT_SECRET MISSING — identity-gated write routes will 503"
  [[ -n "${SUPABASE_SEND_SMS_HOOK_SECRET:-}" ]] && ok "SUPABASE_SEND_SMS_HOOK_SECRET set" \
    || bad "SUPABASE_SEND_SMS_HOOK_SECRET MISSING — WhatsApp OTP login will 401"

  sec "Value sanity"

  # asyncpg cannot parse a bare postgresql:// URL — the app dies at startup.
  [[ "${DATABASE_URL:-}" == postgresql+asyncpg://* ]] \
    && ok "DATABASE_URL uses the asyncpg driver prefix" \
    || bad "DATABASE_URL must start with postgresql+asyncpg:// (found: ${DATABASE_URL%%://*}://)"

  # The single most likely migration mistake: Railway's Redis URL carried over.
  if [[ "${REDIS_URL:-}" == "redis://redis:6379/0" ]]; then
    ok "REDIS_URL points at the compose service"
  else
    bad "REDIS_URL must be redis://redis:6379/0 on this box (found: ${REDIS_URL:-unset})"
  fi

  # Transaction pooler (6543) + asyncpg needs the prepared-statement cache off,
  # or every second query fails with DuplicatePreparedStatementError.
  if [[ "${DATABASE_URL:-}" == *:6543/* ]]; then
    [[ "${DB_DISABLE_PREPARED_STATEMENT_CACHE:-false}" == "true" ]] \
      && ok "transaction pooler + prepared-statement cache disabled" \
      || bad "DATABASE_URL uses the 6543 transaction pooler but DB_DISABLE_PREPARED_STATEMENT_CACHE is not true"
  else
    ok "DATABASE_URL uses the session pooler / direct connection"
  fi

  for key in EDGE_API_KEY DASHBOARD_API_KEY; do
    v="${!key:-}"
    (( ${#v} >= 32 )) && ok "$key is >= 32 chars" || bad "$key too short (${#v}) — must be >= 32"
  done

  # Meta rejects a template send with an empty parameter; config.py validates
  # >= 10 digits at startup and refuses to boot.
  digits=$(printf '%s' "${SHOWROOM_CONTACT_NUMBER:-}" | tr -cd '0-9' | wc -c)
  (( digits >= 10 )) && ok "SHOWROOM_CONTACT_NUMBER has $digits digits" \
    || bad "SHOWROOM_CONTACT_NUMBER needs >= 10 digits (found $digits) — startup validation will fail"

  [[ "${DASHBOARD_URL:-}" == https://* ]] && ok "DASHBOARD_URL is https" \
    || warn "DASHBOARD_URL is not https (${DASHBOARD_URL:-unset}) — links in WhatsApp messages will be wrong"

  # Catches both .env.example leftovers and unfilled <ANGLE_BRACKET> slots from
  # env.template. An unfilled placeholder is worse than a missing var: WA_TOKEN
  # set to the literal "<META_SYSTEM_USER_TOKEN>" boots fine and 401s at Meta.
  if leftovers=$(grep -nE '^[A-Z_]+=(<|change_me|xxxx|your_|password@|sk-ant-xxxx)' "$ENV_FILE" | cut -d: -f2- | cut -d= -f1 | tr '\n' ' '); [[ -n "${leftovers// }" ]]; then
    bad "unfilled placeholders: $leftovers"
  else
    ok "no unfilled placeholders"
  fi

  # PROJECT_REF is the one template token that hides inside a URL rather than
  # standing alone as the whole value, so the check above misses it.
  grep -qE '<PROJECT_REF>|<DB_PASSWORD>' "$ENV_FILE" \
    && bad "env.template tokens still present inside DATABASE_URL / SUPABASE_URL" \
    || ok "no template tokens inside URLs"
fi

sec "Compose config"
if [[ -f "$COMPOSE_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$COMPOSE_ENV"
  [[ -n "${API_DOMAIN:-}" ]] && ok "API_DOMAIN=$API_DOMAIN" || bad "API_DOMAIN not set"

  if [[ -n "${API_DOMAIN:-}" ]] && command -v dig >/dev/null 2>&1; then
    resolved=$(dig +short A "$API_DOMAIN" | tail -1)
    myip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    if [[ -z "$resolved" ]]; then
      bad "$API_DOMAIN does not resolve — Caddy cannot get a certificate"
    elif [[ "$resolved" == "$myip" ]]; then
      ok "$API_DOMAIN resolves to this box ($resolved)"
    else
      bad "$API_DOMAIN resolves to $resolved but this box is $myip — fix the A record first"
    fi
  fi
fi

# No -f here on purpose: compose then honours COMPOSE_FILE from .env, so this
# validates the SAME file set systemd will actually launch (base, or base +
# cpx12 overlay). Hardcoding -f would green-light a config that never runs.
cd "$APP_DIR/infra/hetzner" 2>/dev/null && {
  docker compose --env-file .env config >/dev/null 2>&1 \
    && ok "compose config parses (${COMPOSE_FILE:-docker-compose.prod.yml})" \
    || bad "compose config does not parse — check COMPOSE_FILE in infra/hetzner/.env"
}

# Confirm the overlay actually took effect, rather than trusting that naming the
# file was enough. This is the single setting that keeps a 2GB box alive.
if [[ "${COMPOSE_FILE:-}" == *cpx12* ]]; then
  docker compose --env-file .env config 2>/dev/null | grep -q -- '--concurrency=1' \
    && ok "worker concurrency is 1 (required on 2GB)" \
    || bad "cpx12 overlay named but worker concurrency is not 1 — overlay not applied"
fi

sec "Host"
mem=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
swap=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}')

# On a 2GB box the cpx12 overlay is REQUIRED, not optional: it drops worker
# concurrency to 1. Without it two concurrent Chromium renders exceed RAM+swap,
# the OOM killer takes the worker, and acks_late re-queues the same task — which
# OOMs again. That is a silent retry loop, not a visible crash.
if (( mem < 3000 )); then
  if [[ "${COMPOSE_FILE:-}" == *cpx12* ]]; then
    ok "RAM ${mem}MB with the cpx12 overlay active (worker concurrency 1)"
  else
    bad "RAM ${mem}MB but COMPOSE_FILE does not include docker-compose.cpx12.yml — set it in infra/hetzner/.env: COMPOSE_FILE=docker-compose.prod.yml:docker-compose.cpx12.yml"
  fi
  (( swap >= 3500 )) && ok "swap ${swap}MB" \
    || bad "swap ${swap}MB — a 2GB box needs 4GB (re-run provision.sh, or SWAP_GB=4)"
else
  ok "RAM ${mem}MB"
  (( swap >= 1500 )) && ok "swap ${swap}MB" \
    || warn "swap ${swap}MB — provision.sh should have made 2GB"
fi
disk=$(df -BG --output=avail "$APP_DIR" 2>/dev/null | tail -1 | tr -dc '0-9')
(( disk >= 10 )) && ok "disk ${disk}GB free" || warn "only ${disk}GB free — the image with Chromium is ~2GB"
command -v docker >/dev/null && ok "docker present" || bad "docker missing"

printf '\n\033[1m%d passed, %d warnings, %d failures\033[0m\n' "$pass" "$warn" "$fail"
if (( fail > 0 )); then
  printf '\033[1;31mDo not start the stack until the failures above are fixed.\033[0m\n\n'
  exit 1
fi
printf '\033[1;32mReady. Start with:  systemctl start topaz\033[0m\n\n'
