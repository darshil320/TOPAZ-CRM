# Topaz CRM — Staging Setup (UAT Unblock)

Two things needed to unblock M1 UAT:
1. **Dashboard** deployed to Vercel (pointed at UAT Supabase + API)
2. **Logins** — 3 auth users + `salespersons` rows seeded

Both are now scripted. Follow the steps in order.

---

## Prerequisites (gather these first)

| Item | Where to find |
|------|--------------|
| UAT Supabase URL | Supabase project → Settings → API → Project URL |
| UAT Supabase anon key | Supabase project → Settings → API → `anon public` |
| UAT Supabase service role key | Supabase project → Settings → API → `service_role` (secret) |
| Railway API URL | `https://api-production-c6189.up.railway.app` (already live) |
| `DASHBOARD_API_KEY` | Already in `.env.local`: `31ece4818f9aa0cd92f92488fb0e00d7ced2035a` |
| `SUPABASE_JWT_SECRET` | Supabase project → Settings → API → JWT Secret |

> [!IMPORTANT]
> If you don't have a separate UAT Supabase project yet, you can point staging at the **production** Supabase for now (UAT will read/write real data). Create a separate project at supabase.com/dashboard and apply migrations 0001-0020 to get a clean slate.

---

## Step 1 - Deploy to Vercel

### 1a. Import the repo

1. Go to vercel.com/new
2. Click **Import Git Repository** → select `darshil320/TOPAZ-CRM`
3. Vercel will auto-detect the `vercel.json` at the repo root (framework: Next.js)

### 1b. Set environment variables

In the Vercel project → **Settings → Environment Variables**, add these (for **Preview + Production**):

```
NEXT_PUBLIC_SUPABASE_URL      = https://<UAT-PROJECT>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...  (anon public key)
TOPAZ_API_URL                 = https://api-production-c6189.up.railway.app
DASHBOARD_API_KEY             = 31ece4818f9aa0cd92f92488fb0e00d7ced2035a
NEXT_PUBLIC_HOME_STATE        = GJ
```

> [!NOTE]
> `TOPAZ_API_URL` and `DASHBOARD_API_KEY` are server-only (no NEXT_PUBLIC_ prefix) — they stay secret.

### 1c. Deploy

Click **Deploy**. Vercel builds from `apps/dashboard/` (per `vercel.json`). First build ~3 min.

---

## Step 2 - Seed UAT auth users

```bash
cd /path/to/topaz-showroom-intelligence

SUPABASE_URL=https://<UAT-PROJECT>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
bash scripts/seed_uat_users.sh
```

This creates 3 login accounts with email confirmation pre-confirmed (no inbox needed):

| Role | Email | Password |
|------|-------|----------|
| salesperson | `sales.uat@topaz-crm.test` | `Topaz@UAT2A!` |
| accounts | `accounts.uat@topaz-crm.test` | `Topaz@UAT2A!` |
| owner | `owner.uat@topaz-crm.test` | `Topaz@UAT2A!` |

It also inserts the `salespersons` rows linked to each auth UID. Safe to re-run.

---

## Step 3 - Seed demo data (products / quotes / orders)

Apply Phase 2 migrations first if UAT Supabase is a fresh project:
- Paste each SQL file (0001-0020) into the Supabase SQL editor in order, OR
- Use `supabase db push` if supabase CLI is linked to the UAT project

Then seed:
```bash
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  python apps/api/scripts/seed_demo.py
```

Creates: 5 products, 10 customers, 6 quotations, 2 orders, payments.

---

## Step 4 - Verify

1. Open the staging Vercel URL → login page appears
2. Log in: `sales.uat@topaz-crm.test` / `Topaz@UAT2A!`
3. Land on `/dashboard` with Quotations, Orders, Board in nav
4. Check `/dashboard/quotes` — 6 quotes visible
5. Log out → owner login → check `/owner/admin`

Hand URL + credentials to Hemant, run `UAT_2A.md`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login redirect loop | Check `NEXT_PUBLIC_SUPABASE_URL` is set in Vercel env vars |
| Server actions 400 CSRF | Vercel domain not in `allowedOrigins` — already fixed in `next.config.ts` |
| Quotes/orders 503 | `SUPABASE_JWT_SECRET` not set on Railway API → add in Railway env vars |
| seed_uat_users.sh 401 | Service role key wrong — re-copy from Supabase Settings → API |
| seed_demo.py ImportError | `pip install psycopg2-binary` in local venv |
