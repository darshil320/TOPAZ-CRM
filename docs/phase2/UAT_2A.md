# Phase 2A UAT — scripted acceptance (Sell)

Run on staging with demo data seeded (`python apps/api/scripts/seed_demo.py`).
Tick each box. Report failures with the screen + what you saw vs expected.

## Setup

- [ ] Staging stack up: Supabase (0011–0020 applied), API, worker+beat, dashboard.
- [ ] Seed run: 5 products, 10 customers, 6 quotes, 2 orders, payments visible.
- [ ] Logins ready: one **sales**, one **accounts**, one **owner**.

## Salesperson — quote lifecycle

- [ ] `/dashboard/quotes` lists quotes with number, customer, total, status.
- [ ] New quote: pick a customer, add 2 items (one from catalog, one free-text), set a discount → the live total matches the printed grand total after save.
- [ ] Save draft → lands on the quote detail with the server-computed totals.
- [ ] Edit the draft → change qty → totals update; send is only offered on drafts.
- [ ] Send to customer → status → **Sent**; a WhatsApp/message row appears.
- [ ] Revise a sent quote → a new draft revision (Rev 2) with a fresh number; the old one is unchanged.
- [ ] Draft delete works; a sent quote cannot be deleted or edited (buttons gone / server refuses).

## Customer — public approval (phone)

- [ ] Open the `/q/<token>` link on a phone → mobile summary card, items, totals.
- [ ] Approve → success screen; re-tapping does nothing bad (idempotent).
- [ ] Salesperson gets an internal alert; pipeline shows the customer at **Order Confirmed**.

## Salesperson/owner — order + pipeline

- [ ] Approved quote detail shows **Create order** → one click → order confirmed, totals copied exactly, advance = 50%.
- [ ] Order status buttons follow the allowed path (confirmed → in production → ready → delivered → installed → closed); illegal jumps are refused; cancelling asks for a reason.
- [ ] Pipeline board: drag a customer between stages → persists on refresh; stale (>7d) badge shows.

## Accounts — payments

- [ ] `/dashboard/payments`: collected-today + aging buckets (0-7/8-30/30+) + open balances.
- [ ] Record an advance on an order → outstanding drops; receipt document row created.
- [ ] Recording more than the outstanding is refused (409) unless owner/admin overrides.
- [ ] A **salesperson** cannot record a payment (403) — read-only on money.
- [ ] A refund can only be recorded by owner/admin.
- [ ] A recorded payment cannot be edited or deleted anywhere (immutable).

## Owner — admin

- [ ] `/owner/admin`: add a product → appears in the quote builder catalog.
- [ ] Edit quote terms + validity → a new quote prefills them.
- [ ] Template registry lists 2A templates with Meta status.

## Running the E2E (optional, engineering)

```
cd apps/dashboard && npx playwright install chromium
BASE_URL=http://localhost:3000 E2E_SALES_EMAIL=... E2E_SALES_PASSWORD=... npm run test:e2e
```
