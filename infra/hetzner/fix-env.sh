#!/usr/bin/env bash
#
# Normalise a Railway Raw-Editor export into a file Docker Compose can read.
# Run on YOUR MAC from the repo root:
#
#     bash infra/hetzner/fix-env.sh api.env.out
#
# Railway's Raw Editor emits KEY="value" with double quotes. Compose's env_file
# parser does NOT strip them — it passes `"postgresql+asyncpg://...` through
# verbatim, leading quote included, and asyncpg then rejects the DSN. Every
# quoted secret breaks the same way (a WA_TOKEN with a stray quote 401s at Meta).
#
# Prints no values — only key names. These are production secrets.

set -euo pipefail

SRC="${1:-api.env.out}"

ok()   { printf '  \033[1;32m[OK]\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[1;31m[FAIL]\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m[WARN]\033[0m %s\n' "$1"; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

[[ -f "$SRC" ]] || { bad "$SRC not found"; exit 1; }

cp "$SRC" "$SRC.bak"
chmod 600 "$SRC.bak"

sec "Normalising $SRC"

python3 - "$SRC" <<'PY'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
out, seen = [], set()
stripped = dropped = 0

for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith('#'):
        out.append(raw)
        continue
    if '=' not in line:
        continue

    key, val = line.split('=', 1)
    key = key.strip()

    # Railway platform vars are meaningless off-platform. PORT in particular
    # would fight the Dockerfile's fixed 8000.
    if re.match(r'^(RAILWAY_|NIXPACKS_)', key) or key == 'PORT':
        dropped += 1
        continue

    val = val.strip()
    # Strip ONE matched pair of surrounding quotes. Inner quotes are left alone —
    # they may legitimately belong to the secret.
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        val = val[1:-1]
        stripped += 1

    # Railway template syntax cannot resolve outside Railway.
    if key == 'REDIS_URL' or '${{' in val:
        if key == 'REDIS_URL':
            val = 'redis://redis:6379/0'
        else:
            print(f"UNRESOLVED_TEMPLATE:{key}")

    if key in seen:
        print(f"DUPLICATE:{key}")
        continue
    seen.add(key)
    out.append(f"{key}={val}")

# config.py validates >= 10 digits at startup and refuses to boot without it.
if 'SHOWROOM_CONTACT_NUMBER' not in seen:
    out.append('SHOWROOM_CONTACT_NUMBER=+91 63563 20206')
    print("ADDED:SHOWROOM_CONTACT_NUMBER")
if 'REDIS_URL' not in seen:
    out.append('REDIS_URL=redis://redis:6379/0')
    print("ADDED:REDIS_URL")

path.write_text('\n'.join(out) + '\n')
print(f"STATS:{stripped} unquoted, {dropped} platform vars dropped")
PY

chmod 600 "$SRC"

sec "Checks"

grep -q '^DATABASE_URL=postgresql+asyncpg://' "$SRC" \
  && ok "DATABASE_URL uses the asyncpg prefix" \
  || bad "DATABASE_URL must start with postgresql+asyncpg:// — asyncpg will not start"

grep -q '^REDIS_URL=redis://redis:6379/0$' "$SRC" \
  && ok "REDIS_URL points at the compose service" \
  || bad "REDIS_URL is not redis://redis:6379/0"

# A quote surviving anywhere means the export had an odd shape worth eyeballing.
if grep -qE '^[A-Z_]+="' "$SRC"; then
  bad "still-quoted keys: $(grep -oE '^[A-Z_]+(?==")' "$SRC" | tr '\n' ' ')"
else
  ok "no leading quotes remain"
fi

# 6543 is the transaction pooler; asyncpg needs its statement cache off there.
if grep -q '^DATABASE_URL=.*:6543/' "$SRC"; then
  grep -q '^DB_DISABLE_PREPARED_STATEMENT_CACHE=true' "$SRC" \
    && ok "transaction pooler + prepared-statement cache disabled" \
    || bad "port 6543 pooler needs DB_DISABLE_PREPARED_STATEMENT_CACHE=true"
fi

for k in DATABASE_URL REDIS_URL EDGE_API_KEY DASHBOARD_API_KEY \
         WA_PHONE_NUMBER_ID WA_TOKEN WA_WEBHOOK_VERIFY_TOKEN WA_APP_SECRET \
         SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET \
         SUPABASE_SEND_SMS_HOOK_SECRET DASHBOARD_URL SHOWROOM_CONTACT_NUMBER; do
  grep -q "^$k=" "$SRC" || bad "MISSING: $k"
done

grep -q '^DASHBOARD_URL=https://' "$SRC" \
  && ok "DASHBOARD_URL is https" \
  || warn "DASHBOARD_URL is not https — links inside WhatsApp messages will be wrong"

printf '\n%s keys ready. Backup at %s\n\n' "$(grep -c '^[A-Z]' "$SRC")" "$SRC.bak"
