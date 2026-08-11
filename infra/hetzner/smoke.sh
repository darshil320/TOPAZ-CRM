#!/usr/bin/env bash
#
# Run ON THE VPS after `systemctl start topaz`.
#
#     bash /opt/topaz/infra/hetzner/smoke.sh
#
# Confirms the stack is actually serving — not merely that containers are "Up".
# A container can be Up while beat has no schedule and the DB is unreachable.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/topaz}"
COMPOSE="docker compose --env-file $APP_DIR/infra/hetzner/.env -f $APP_DIR/infra/hetzner/docker-compose.prod.yml"

pass=0; fail=0
# `|| true` is REQUIRED: ((x++)) returns x's PRE-increment value as exit status,
# so the first call (x=0) exits non-zero and an `ok ... || bad ...` chain reports
# a false failure alongside the pass.
ok()  { printf '  \033[1;32m[OK]\033[0m   %s\n' "$1"; ((pass++)) || true; }
bad() { printf '  \033[1;31m[FAIL]\033[0m %s\n' "$1"; ((fail++)) || true; }
sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

source "$APP_DIR/infra/hetzner/.env" 2>/dev/null || true

sec "Containers"
for svc in redis api worker beat caddy; do
  state=$($COMPOSE ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$svc" '$1==s{print $2}')
  [[ "$state" == "running" ]] && ok "$svc running" || bad "$svc is '${state:-absent}'"
done

sec "Redis"
$COMPOSE exec -T redis redis-cli ping 2>/dev/null | grep -q PONG \
  && ok "redis responds to PING" || bad "redis not responding"
# Confirms AOF is actually on — without it a reboot silently drops queued tasks.
$COMPOSE exec -T redis redis-cli config get appendonly 2>/dev/null | grep -q yes \
  && ok "AOF persistence enabled" || bad "AOF is OFF — queued tasks will not survive a reboot"

sec "API"
$COMPOSE exec -T api python -c \
  "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/api/health',timeout=10).status)" 2>/dev/null \
  | grep -q 200 && ok "/api/health 200 (in-container)" || bad "/api/health did not return 200"

if [[ -n "${API_DOMAIN:-}" ]]; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$API_DOMAIN/api/health" 2>/dev/null)
  [[ "$code" == "200" ]] && ok "https://$API_DOMAIN/api/health 200 (TLS working)" \
    || bad "public health check returned ${code:-no response} — check Caddy logs for the ACME result"
fi

sec "Database"
# Proves the app can actually reach Supabase with the configured DSN, rather
# than just that DATABASE_URL is a well-formed string.
$COMPOSE exec -T api python -c "
import asyncio, sys
from src.database import get_api_session
from sqlalchemy import text
async def main():
    async for s in get_api_session():
        await s.execute(text('select 1')); print('DBOK'); return
asyncio.run(main())
" 2>/dev/null | grep -q DBOK && ok "API reached Postgres" || bad "API could NOT reach Postgres — check DATABASE_URL"

sec "Celery"
$COMPOSE exec -T worker celery -A src.tasks.celery_app inspect ping -t 10 2>/dev/null \
  | grep -q pong && ok "worker responds to inspect ping" || bad "worker not answering — check its logs"

# The five schedules from celery_app.py. If beat is silent, no followup ever sends.
sched=$($COMPOSE logs beat 2>/dev/null | grep -cE 'send-due-followups|stage-reminders|payment-reminders|transit-watchdog|close-stale-followups')
(( sched > 0 )) && ok "beat loaded its schedule ($sched schedule lines)" \
  || bad "beat logged no schedule — followups will never fire"

$COMPOSE logs --since 5m 2>/dev/null | grep -qiE 'Traceback|CRITICAL' \
  && bad "tracebacks in the last 5 min of logs — inspect: $COMPOSE logs --since 5m" \
  || ok "no tracebacks in recent logs"

printf '\n\033[1m%d passed, %d failures\033[0m\n\n' "$pass" "$fail"
(( fail == 0 )) || exit 1
