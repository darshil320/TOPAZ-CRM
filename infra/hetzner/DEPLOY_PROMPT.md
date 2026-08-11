# Deploy prompt — paste into a fresh Claude Code session

Two prompts below. Use **Prompt A** on your Mac (steps 1 and 5), **Prompt B** on
the VPS over SSH (steps 4, 6, 7). Steps 2, 3 and 8 are console/dashboard work in
Hetzner, your DNS provider, Meta and Vercel — no agent can do those for you.

Each prompt is self-contained: it restates the repo facts a fresh session has no
way to know, so you can paste it without any of this conversation's history.

---

## Prompt A — on your Mac, repo root

```
You are helping deploy the Topaz backend from Railway (now suspended) to a
Hetzner CX22 VPS. Work in /Users/darshillashkari/Downloads/topaz-showroom-intelligence.

CONTEXT YOU NEED:
- The deploy tooling already exists in infra/hetzner/ — do NOT rewrite it.
  fix-env.sh, preflight.sh, smoke.sh, provision.sh, docker-compose.prod.yml,
  Caddyfile, topaz.service, env.template, README.md
- api.env.out in the repo root is a Railway Raw-Editor export. Railway exports
  values wrapped in double quotes; Docker Compose env_file does NOT strip them,
  so an unfixed file yields a DSN starting with a literal quote character and
  asyncpg refuses it.
- Backend = 4 services: FastAPI api, Celery worker, Celery beat, Redis.
  Postgres is external (Supabase) and is NOT being migrated.
- The API image installs Playwright Chromium for quote/receipt PDFs (~1GB RAM
  per render) — this is why the box is 4GB and worker concurrency is pinned at 2.

THESE ARE PRODUCTION SECRETS. Never print a value to stdout, never paste one
into a summary, never write one into a file outside apps/api/.env. Key NAMES
are fine to print; values are not.

TASK 1 — normalise the env file:
  bash infra/hetzner/fix-env.sh api.env.out
It strips quotes, drops RAILWAY_*/PORT/NIXPACKS_*, rewrites REDIS_URL to
redis://redis:6379/0, adds SHOWROOM_CONTACT_NUMBER if absent, and reports
missing keys. Report which keys it flagged as MISSING.

For each MISSING key, tell me the exact console page to get it from — read
infra/hetzner/env.template, which documents the source for every variable.
Flag SUPABASE_JWT_SECRET and SUPABASE_SEND_SMS_HOOK_SECRET especially: both are
optional to Pydantic but fail CLOSED at runtime (write routes 503, OTP login
401s), so a missing one boots green and only breaks when staff use the app.

Do not proceed past a MISSING key. Stop and ask me.

TASK 2 — once I confirm the env file is complete, give me the exact scp and
chmod commands to copy it to the VPS as /opt/topaz/apps/api/.env (mode 600),
plus the rm command to delete both api.env.out and api.env.out.bak from my Mac
afterwards. Ask me for the VPS IP rather than guessing it.
```

---

## Prompt B — on the VPS, over SSH as root

```
You are provisioning a fresh Hetzner CX22 (Ubuntu 24.04) to run the Topaz
backend. The repo is at /opt/topaz (clone it if absent — it is a PRIVATE GitHub
repo, darshil320/TOPAZ-CRM, so a deploy key may be needed).

CONTEXT:
- All deploy tooling exists in /opt/topaz/infra/hetzner/ — use it, do not
  rewrite it or invent new scripts.
- Services: FastAPI api, Celery worker, Celery beat, Redis, Caddy. Postgres is
  external (Supabase). The api image carries Playwright Chromium, so the first
  build takes 5-10 minutes and pulls ~2GB.
- /opt/topaz/apps/api/.env holds live production secrets. Never cat it, never
  print its values, never echo a value into a log. Key names only.

RUN IN THIS ORDER, and STOP at the first failure — do not continue past a red
check, and do not "fix" anything by editing the scripts:

1. bash /opt/topaz/infra/hetzner/provision.sh
   Installs Docker, 2GB swap, ufw (22/80/443 only), fail2ban, SSH hardening,
   and the systemd unit. Idempotent — safe to re-run.
   If the git clone fails, generate a key with
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519, print the PUBLIC key only,
   and tell me to add it as a GitHub deploy key. Then re-run.

2. Ask me for my API domain, then write it:
   echo 'API_DOMAIN=<domain>' > /opt/topaz/infra/hetzner/.env
   Before continuing, verify DNS resolves to THIS box:
   dig +short A <domain>   vs   curl -s https://api.ipify.org
   If they differ, STOP — Caddy's Let's Encrypt challenge will fail and the
   certificate attempt counts against rate limits.

3. bash /opt/topaz/infra/hetzner/preflight.sh
   Must be fully green. It checks env completeness, the postgresql+asyncpg://
   prefix, REDIS_URL, unfilled placeholders, DNS, RAM/swap/disk.
   If it fails on a missing or malformed variable, tell me exactly which key
   and which console page it comes from (see infra/hetzner/env.template).
   Do NOT edit preflight.sh to make it pass.

4. systemctl start topaz
   First build is 5-10 min. If it appears stuck, check:
   journalctl -u topaz -f

5. bash /opt/topaz/infra/hetzner/smoke.sh
   Verifies 5 containers running, Redis AOF enabled, /api/health 200 over
   public TLS, a real Postgres round-trip, a Celery worker ping, and that beat
   loaded its 5 schedules (send-due-followups */5, stage-reminders hourly,
   transit-watchdog 09:00 IST, payment-reminders 10:00 IST,
   close-stale-followups 01:00 IST).

If any smoke check fails, diagnose from container logs and tell me the root
cause and the fix. Do not mark the deploy successful with a failing check —
report honestly what passed and what did not.

When everything is green, remind me of the three remaining manual steps:
  a. Meta webhook callback -> https://<domain>/api/whatsapp/webhook
     (verify token unchanged), then confirm the hub.challenge echo returns cp1
  b. Vercel env TOPAZ_API_URL -> https://<domain>, then redeploy the dashboard
  c. Edge box API_URL -> https://<domain>, then restart it
```

---

## What no agent can do for you

| Step | Why it is yours |
|---|---|
| 2 · Create the CX22 | Hetzner console, your account and payment method |
| 3 · DNS A record | Your DNS provider's console |
| 8a · Meta webhook | developers.facebook.com, your login |
| 8b · Vercel env | Vercel dashboard, your login |
| 8c · Edge box | Physical machine in the showroom |

## Order

1. You: create CX22, add the DNS A record (do this **first** — propagation lags)
2. Prompt A on your Mac — fix and ship the env file
3. Prompt B on the VPS — provision, preflight, start, smoke
4. You: repoint Meta, Vercel, edge box
5. Verify: WhatsApp round-trip, dashboard loads without 503s
6. Delete the Railway project

## Why the prompts are written this way

They tell the agent to **stop at the first failure** and forbid editing the
check scripts to make them pass. Preflight and smoke exist to catch a
half-configured deploy; an agent that "helpfully" relaxes a failing assertion
converts a loud, fixable error into a silent production break — which is exactly
the failure mode the fail-closed Supabase secrets already create on their own.
