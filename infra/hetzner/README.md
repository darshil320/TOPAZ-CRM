# Hetzner deployment — Topaz backend

Replaces the Railway project `cooperative-wisdom` (api + worker + beat + Redis).
Everything runs as Docker Compose on one Hetzner CX22 behind Caddy.

Vercel keeps hosting `apps/dashboard`; Supabase keeps hosting Postgres. Only the
four backend services move.

## Cost

| Item | Monthly |
|---|---|
| Hetzner CX22 (2 vCPU / 4GB / 40GB NVMe) | €3.79 (~₹360) |
| Backups (optional, +20%) | €0.76 |
| **Total** | **~€4.55 (~₹430)** |

Fixed price. No usage metering, no egress billing surprises — the reason to move
off Railway, where 4 always-on services blow past the $5 Hobby credit.

## Sizing rationale

The API image ships **Playwright Chromium** for quote/receipt PDF rendering. A
render spikes ~1GB RAM. That single fact drives the plan:

- It rules out Fly.io's cheap 256MB machines — they OOM on the first PDF.
- Worker concurrency stays at **2**. Do not raise it on a 4GB box.
- `provision.sh` adds **2GB swap** so a spike degrades to a slow render instead
  of an OOM-kill that drops a Celery task mid-flight.

Steady-state RAM is roughly: Redis 100MB + api 400MB + worker 600MB + beat
150MB + Caddy 30MB ≈ 1.3GB, leaving headroom for render spikes.

## Files

| File | Role | Runs on |
|---|---|---|
| `docker-compose.prod.yml` | The five services, hardened for a public VPS | VPS |
| `Caddyfile` | TLS termination + reverse proxy to `api:8000` | VPS |
| `topaz.service` | systemd unit — starts the stack on boot | VPS |
| `provision.sh` | One-time VPS setup (Docker, firewall, swap, SSH, systemd) | VPS |
| `pull-railway-env.sh` | Export live Railway vars into a Hetzner-ready `.env` | **your Mac** |
| `preflight.sh` | Validate env + DNS + host **before** starting | VPS |
| `smoke.sh` | Prove the stack actually serves **after** starting | VPS |

## First deploy

1. **Create the server.** Hetzner Cloud → CX22, Ubuntu 24.04, Nuremberg or
   Falkenstein, add your SSH key. (Hetzner has no India region; Nuremberg adds
   ~120ms to Surat. Irrelevant for WhatsApp webhooks and dashboard calls, which
   are not latency-sensitive.)

2. **Point DNS.** `A` record for `api.yourdomain.com` → the VPS IPv4. Do this
   *before* step 4 or Caddy's Let's Encrypt challenge fails.

3. **Provision.**

   ```bash
   scp infra/hetzner/provision.sh root@<vps-ip>:/root/
   ssh root@<vps-ip> 'bash /root/provision.sh'
   ```

   The clone needs a GitHub **deploy key** for the private repo. If the clone
   fails, on the VPS run `ssh-keygen -t ed25519`, add
   `~/.ssh/id_ed25519.pub` under GitHub → repo → Settings → Deploy keys, then
   re-run `provision.sh` (it is idempotent).

4. **Build the environment file.** Two paths:

   **(a) Railway project still live** — on your Mac, in the repo root:

   ```bash
   brew install railway && railway login
   bash infra/hetzner/pull-railway-env.sh
   scp api.env.out root@<vps-ip>:/opt/topaz/apps/api/.env
   ssh root@<vps-ip> 'chmod 600 /opt/topaz/apps/api/.env'
   rm api.env.out              # holds live secrets — do not keep it
   ```

   Strips Railway-only vars (`RAILWAY_*`, `PORT`), rewrites `REDIS_URL`, warns on
   anything missing or placeholder.

   **(b) Railway suspended for non-payment** — the CLI cannot read a suspended
   project, so use the template:

   ```bash
   scp infra/hetzner/env.template root@<vps-ip>:/opt/topaz/apps/api/.env
   ssh root@<vps-ip> 'chmod 600 /opt/topaz/apps/api/.env && nano /opt/topaz/apps/api/.env'
   ```

   Fill every `<ANGLE_BRACKET>`. The Railway **dashboard** usually still shows
   Variables on a suspended project (billing stops compute, not dashboard reads) —
   check there first and copy across. Anything not recoverable there comes from
   source; `env.template` names the exact console page for each value.

   Only `WA_TOKEN` is genuinely unrecoverable (Meta displays it once). Reissuing
   it from the same System User is routine and needs no re-verification.

   If you regenerate `EDGE_API_KEY` or `DASHBOARD_API_KEY`, you must update the
   edge box and Vercel to match — otherwise those callers start returning 401.

5. **Set the domain and preflight.**

   ```bash
   ssh root@<vps-ip>
   echo 'API_DOMAIN=api.yourdomain.com' > /opt/topaz/infra/hetzner/.env
   bash /opt/topaz/infra/hetzner/preflight.sh
   ```

   Preflight must be green before you continue. It catches the wrong
   `REDIS_URL`, a `postgresql://` DSN that asyncpg cannot parse, a DNS record
   pointing at the wrong box, and the two fail-closed Supabase secrets whose
   absence lets the stack boot green and break only when staff try to use it.

6. **Start.**

   ```bash
   systemctl start topaz          # first build ~5-10 min (Chromium download)
   bash /opt/topaz/infra/hetzner/smoke.sh
   ```

   Smoke checks all five containers, Redis AOF, `/api/health` over public TLS,
   a real Postgres round-trip, a Celery worker ping, and that beat actually
   loaded its five schedules: `send-due-followups` (*/5), `stage-reminders`
   (hourly), `transit-watchdog` (09:00 IST), `payment-reminders` (10:00 IST),
   `close-stale-followups` (01:00 IST).

## Cutover from Railway

Order matters — do not skip step 1.

1. **Stop Railway's beat service first.** While both run, every scheduled
   followup fires twice and real customers get duplicate WhatsApp messages.
   Scale Railway `beat` to 0 replicas before starting the new stack.

   Note: while Railway beat is down, **no followups are being sent at all** —
   welcome messages, stage reminders and payment reminders are all paused. That
   is the intended trade (a gap beats duplicates), but it makes the cutover
   time-sensitive: finish it the same day. Railway `api` should stay **up** until
   step 3, so the Meta webhook keeps being answered while you migrate.
2. Bring up the Hetzner stack; confirm `/api/health` over HTTPS.
3. Repoint the **Meta webhook** callback URL to
   `https://api.yourdomain.com/api/whatsapp/webhook` and re-verify the GET
   challenge. Verify token is unchanged.
4. Update **Vercel** env `TOPAZ_API_URL` → the new domain, redeploy the dashboard.
5. Update the **edge box** `API_URL` (see `docs/DEPLOYMENT.md`).
6. Watch logs for one full day, then delete the Railway project.

## Operations

```bash
# Deploy new code
cd /opt/topaz && git pull && systemctl reload topaz   # rebuild + recreate

# Logs
docker compose -f /opt/topaz/infra/hetzner/docker-compose.prod.yml logs -f api

# Restart one service
docker compose -f /opt/topaz/infra/hetzner/docker-compose.prod.yml restart worker

# Reclaim disk after several deploys (old images add up on a 40GB disk)
docker image prune -af
```

## What this setup does NOT do

Be deliberate about these before go-live — they were managed for you on Railway:

- **No off-box backups.** Postgres still lives on Supabase (backed up there), so
  the only local state is the Redis queue. Enable Hetzner's +20% snapshot backup
  if you want the box itself recoverable.
- **No zero-downtime deploy.** `systemctl reload topaz` recreates containers;
  expect a few seconds of 502. Acceptable for a single showroom; revisit if not.
- **No alerting.** Nothing pages you if the box dies. Add an uptime check
  (Better Stack / UptimeRobot free tier) against `/api/health`.
- **No log aggregation.** Logs are local and rotated at 10MB × 3 per service.
