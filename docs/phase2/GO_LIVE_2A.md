# Phase 2A — go-live checklist (Sell)

Gate for flipping 2A on for Topaz. Owner (Darshil) runs this with Hemant present.
**Do not skip the BLOCKERS.**

## 0. Contract (must clear first)

- [x] **Signed Phase-2 SOW / Change Request covering Orders + Payments.** Every SOW on file excludes them (see `PLAN_2A_SELL.md §0`). This is a commercial blocker, not a technical one.

## 1. Security BLOCKERS (from the M07 security review — fix before real money)

The FastAPI write layer uses the service-role DB connection, so **RLS does not
protect writes — the API is the whole authorization boundary.**

- [x] **CRITICAL-1** — payments restricted to accounts/owner/admin in the API (fixed, `payments.py`).
- [x] **CRITICAL-2** — over-payment TOCTOU closed with `SELECT … FOR UPDATE` (fixed).
- [x] **HIGH-3** — caller identity now derived from a **verified Supabase JWT** (`deps.get_caller_uid` + `api/authz.resolve_caller`), not the request body. Dashboard server actions forward the access token (`lib/apiAuth.ts`). Requires `SUPABASE_JWT_SECRET` set (routes fail closed with 503 if unset). Proven by `test_authz_empirical`.
- [x] **HIGH-4** — orders/quotations/payments writes now re-check role + customer assignment server-side (`authz.assert_can_write_customer`): owner/admin any, salesperson only assigned, others 403.
- [ ] **LOW** — add basic rate limiting on public + dashboard-key routes (defense-in-depth). Still open.
- [x] Re-run the security-reviewer on the JWT change before go-live (verify audience/expiry handling, and that every write route carries the identity dep).

## 2. Manual / external gates (cannot be verified headless)

- [ ] `playwright install --with-deps chromium` on the API image; render one real quote PDF (bytes > 10KB).
- [ ] **WA-MEDIA-SPIKE:** send one real document + image to a phone via the live number; confirm the `statuses` webhook fires. Record result in STATE.md.
- [ ] Meta templates submitted + approved: `quote_sent`, `quote_approved_confirm`, `payment_due`. Until approved, `WA_MEDIA_ENABLED=false` and sends degrade to window-only (public approval link still works).
- [ ] Run the Playwright money-path E2E green against staging.

## 3. Environment

- [ ] **Staging Supabase project created** (still pending per STATE.md) — migrations land here first.
- [ ] Apply migrations **0011–0020** to staging; verify enum + `allocate_number` + views; run `pgtest.sh` parity.
- [ ] API env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, **`SUPABASE_JWT_SECRET`** (required — write routes 503 without it), `DOCUMENTS_BUCKET=documents`, `WA_MEDIA_ENABLED`, `DEFAULT_ADVANCE_PCT`, `SEND_RECEIPTS_TO_CUSTOMER`, `DASHBOARD_API_KEY`.
- [ ] Dashboard env: `TOPAZ_API_URL`, `NEXT_PUBLIC_API_URL`, `DASHBOARD_API_KEY`, `NEXT_PUBLIC_HOME_STATE=GJ`.
- [ ] Private `documents` Storage bucket created; access is signed-URL only.
- [ ] Beat schedule live (payment reminders 10:00 IST).

## 4. Prod push (only after staging verified + backup)

- [ ] **Backup / PITR checkpoint taken** (0019 pipeline data-migration is destructive on live stage values).
- [ ] Push 0011–0020 to prod in one batch; smoke-test a quote → order → payment.
- [ ] Confirm Phase-1 analytics still read the remapped pipeline vocabulary (won→order_confirmed).

## 5. Client inputs to confirm (fallbacks documented if unanswered)

- [ ] GST inclusive vs exclusive; HSN per family (re-confirm the goldens with Hemant).
- [ ] Quote terms text + validity days (now editable in admin).
- [ ] Schedule policy (50/40/10?) + receipts-to-customer toggle.
- [ ] Staff list + roles + phones (seed real users, not just Darshil/Hemant).
- [ ] Turnover < ₹5cr confirmed (no e-invoice/IRN in scope).

## 6. Acceptance

- [ ] UAT (`UAT_2A.md`) executed by Topaz staff, all boxes ticked.
- [ ] STATE.md modules 01–07 → `verified`.
- [ ] Milestone invoice raised.
