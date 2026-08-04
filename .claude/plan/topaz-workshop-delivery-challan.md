# Implementation Plan — Workshop Stage Budgets, Challan, Item Deliveries (7 client asks)

> **Multi-model status:** Codex backend analysis FAILED (`You've hit your usage limit …
> try again at Aug 16th, 2026`). Gemini/agy frontend analysis FAILED
> (`authentication required. Run 'agy' to log in` — this session is non-interactive).
> This plan is Claude-authored from direct source reading. Re-run
> `/multi-plan` after Aug 16 (or after `agy` login) if a second opinion is wanted.

### Task Type
- [x] Fullstack (migrations + FastAPI + Celery + Next.js dashboard + workshop PWA)

---

## Scope warning (read first — CLAUDE.md doc hierarchy)

Requirements **2, 5, 7** are new surface, not defects. Under SOW §11 they are a
**Change Request** (₹8,000/day T&M), not silent build. Requirements **1, 3, 4, 6**
are fixes/completions of already-shipped modules and are in scope.

Two items are **blocked on external input** and cannot ship end-to-end today:

| Blocker | Blocks | Lead time |
|---|---|---|
| Client has not uploaded the challan layout | REQ 5 visual layout (plumbing is unblocked) | client |
| New Meta template approval (`topaz_welcome_v2`, `topaz_item_ready`) | REQ 1 out-of-window path, REQ 6 send | 1–3 days Meta review |

Everything else is buildable now. Templates get submitted on day 1 so review runs
in parallel with the code.

---

## REQ 3 — BUG: sub-manager (Ekta) cannot mark a stage done  ← DO THIS FIRST

Blocks the client's daily operation, needs no migration, and its root cause also
breaks her photo upload (which four stages require).

### Root-cause ranking

**#1 — `salespersons.role` is not `'workshop_manager'` (highest likelihood).**
[authz.py:88-101](apps/api/src/api/authz.py#L88-L101) only performs the roster
lookup when `caller.role == "workshop_manager"`:

```python
if workshop_id and caller.role == "workshop_manager":
    staff_role = await workshop_staff_repo.staff_role_at(...)
return stage_flow.capabilities_for(role=caller.role, staff_role=staff_role)
```

If Ekta's row is `role='salesperson'`, `capabilities_for` returns `{allocate}`
([stage_flow.py:44-60](apps/api/src/services/stage_flow.py#L44-L60)) → `advance`
403s at `_assert_status_capability`. Her `workshop_staff` roster row is ignored
entirely. The same branch exists in
[media.py:80-86](apps/api/src/api/media.py#L80-L86), so her stage photo upload
403s too — she cannot complete `frame_work`, `finishing`, `quality_inspection`
or `dispatch` even if #1 is fixed only for `advance`.

This is a **real defect, not just bad data**: 0029 declares `workshop_staff` the
source of truth for what you may do at a workshop, then the API gates the lookup
on the coarse role.

**#2 — no active `workshop_staff` row** (or `workshops.active = false`).
`staff_role_at` → `None` → no `CAP_STATUS`. Symptom differs: her queue is also
empty and [workshop/page.tsx:70-79](apps/dashboard/src/app/workshop/page.tsx#L70-L79)
shows "No workshop assigned".

**#3 — `auth_uid` never linked.** `resolve_caller` 403 `"No active staff record"`
if she has not completed phone-OTP login. Symptom: every workshop call fails,
not only advance.

**#4 — 409s, not 403s** (item states, [production.py:186-205](apps/api/src/api/production.py#L186-L205)):
in transit → "receive it first"; `blocked = true`; `current_stage IS NULL`
(never allocated); stage outside the active leg's span; stage already done.

**#5 — photo_required with no `media_id`** → 409 (cascades from #1 if upload 403s).

### Diagnostic (run before changing code)

```sql
select s.id, s.name, s.role, s.active, s.auth_uid is not null as logged_in,
       ws.workshop_id, ws.role as staff_role, ws.active as staff_active, w.active as workshop_active
  from salespersons s
  left join workshop_staff ws on ws.salesperson_id = s.id and ws.active = true
  left join workshops w on w.id = ws.workshop_id
 where s.name ilike '%ekta%';

-- and for the item she is stuck on:
select oi.id, oi.current_stage, oi.blocked, oi.workshop_id, oi.production_done_at,
       l.status as leg_status, l.stage_from, l.stage_to, l.workshop_id as leg_workshop,
       t.id as transit_transfer_id
  from order_items oi
  left join order_item_route_legs l on l.order_item_id = oi.id and l.status = 'active'
  left join workshop_transfer_items ti on ti.order_item_id = oi.id
  left join workshop_transfers t on t.id = ti.transfer_id and t.status in ('created','picked_up','in_transit','delivered')
 where oi.id = '<item-uuid>';
```

### Fix

1. **Data:** `update salespersons set role='workshop_manager' where id = '<ekta>';`
   and ensure an active `workshop_staff` row (`role='sub'`) exists.
2. **Code (the durable fix)** — `capabilities_at_workshop` must consult the roster
   for **any** non-admin, non-courier role, because the roster IS the authority:

```python
# apps/api/src/api/authz.py
_NO_ROSTER_ROLES = {"owner", "admin", "delivery"}

async def capabilities_at_workshop(session, caller, workshop_id):
    staff_role = None
    if workshop_id and caller.role not in _NO_ROSTER_ROLES:
        staff_role = await workshop_staff_repo.staff_role_at(...)
    return stage_flow.capabilities_for(role=caller.role, staff_role=staff_role)
```

   `capabilities_for` must then union the coarse-role caps with the staff caps
   (a `salesperson` who is also a workshop `sub` gets `{allocate, status}`), and
   [media.py `_authorize_upload`](apps/api/src/api/media.py#L80) must switch from
   `caller.role == "workshop_manager"` to "has an active roster row at this
   entity's workshop" (`_is_staff_of` already exists — hoist the check above the
   role branch).
3. **UX** — [WorkshopQueueClient.tsx:504-509](apps/dashboard/src/app/workshop/WorkshopQueueClient.tsx#L504-L509)
   disables Done with no explanation. `GET /my-queue` already returns
   `capabilities` on the item-detail route; extend the queue payload with a
   per-workshop `capabilities` array and render the reason under a disabled
   button: *"Only a lead can do this" / "Photo required" / "In transit —
   receive first" / "Blocked: <note>"*. Never a dead button.

### Tests
- `test_stage_flow.py`: `capabilities_for(role='salesperson', staff_role='sub')` → contains `status`.
- `test_authz.py`: roster lookup runs for non-`workshop_manager` roles.
- `test_production_advance.py`: sub with roster row advances; sub without one 403s.

---

## REQ 1 — Salesperson phone number in the welcome message

### Two send paths, two different costs
[templates.py:36-46](apps/api/src/services/templates.py#L36-L46) —
`welcome_visit` → Meta `topaz_welcome`, NAMED params `customer_name`/`advisor_name`.

- **Inside the 24h window** (free-form, `render_followup`): a one-line body edit. Ships today.
- **Outside the window** (approved template): adding a 3rd parameter is a **template
  change requiring Meta re-review**. Editing the live approved template puts it back
  In-Review and sends fail meanwhile.

### Approach — new template, env-gated cutover (no send outage)

1. Submit **`topaz_welcome_v2`** in WhatsApp Manager: NAMED params
   `{{customer_name}}`, `{{advisor_name}}`, `{{advisor_phone}}`. Keep v1 live.
2. `FOLLOWUP_TEMPLATES` gains a `welcome_visit_v2` entry; selection at send time:

```python
# services/templates.py
WELCOME_KEY = "welcome_visit_v2" if get_settings().WELCOME_TEMPLATE_V2 else "welcome_visit"
```
   Flip `WELCOME_TEMPLATE_V2=true` on Railway once Meta shows APPROVED. Rollback = flip back.
3. Free-form body (both variants) gets the number immediately:
   `"Your advisor {advisor_name} ({advisor_phone}) will assist you personally."`
4. **Data source.** `advisor_name` comes from
   `followup_repo.get_followup_customer_context`. Add `advisor_whatsapp` to that
   query (join the active primary `customer_assignments` → `salespersons.whatsapp`,
   which is `not null unique` in [0002](supabase/migrations/0002_core_tables.sql#L13),
   so it is always present once claimed).
5. **Fallback is mandatory** — Meta rejects a send with an empty parameter. Add to
   `_DEFAULT_PARAM_VALUES`: `"advisor_phone": settings.SHOWROOM_CONTACT_NUMBER`
   (new env, validated at startup). Unclaimed customer → showroom number, never blank.
6. Display format: strip `+91`/render as `+91 63563 20206`-style in a pure helper
   `services/phone_fmt.py` (tested), so the template gets a human-readable number.

### Tests
`test_templates.py` — v2 returns 3 named params in body order; missing advisor
falls back to the showroom number; free-form body contains the number.

---

## REQ 2 — Per-stage day budgets + skip + popup reminders

### What exists
- `production_stage_defs` — 11 stages, `sort` in tens, `photo_required`, owner/admin-writable.
- `order_item_assignments.due_date` — the item's **actual** due date (the ceiling).
- `order_item_route_legs.planned_days` / `due_at` — per **leg** (workshop span), not per stage.

Per-stage budgets do not exist. Legs stay authoritative for handover; the stage
plan is **reminder-only** and must never contradict a leg.

### Migration 0035 — `production_stage_defs.default_days` + `order_item_stage_plan`

```sql
-- admin-level default (the "configuration in admin")
alter table production_stage_defs
  add column if not exists default_days int check (default_days is null or default_days > 0);

-- per-item plan, seeded from defaults at allocation, editable by owner/admin
create table if not exists order_item_stage_plan (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    stage_code    text not null references production_stage_defs(code),
    planned_days  int,
    skipped       boolean not null default false,   -- no due date, no reminder
    remind        boolean not null default true,
    due_at        timestamptz,                      -- derived, stored for the beat scan
    reminded_at   timestamptz,
    snoozed_until timestamptz,
    created_by    uuid references salespersons(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint stage_plan_skip_consistency check (
        (skipped and planned_days is null and due_at is null) or (not skipped)),
    constraint stage_plan_days_positive check (planned_days is null or planned_days > 0)
);
create unique index order_item_stage_plan_uidx on order_item_stage_plan (order_item_id, stage_code);
create index order_item_stage_plan_due_idx on order_item_stage_plan (due_at)
    where skipped = false and remind = true and reminded_at is null and due_at is not null;
create trigger order_item_stage_plan_set_updated_at
    before update on order_item_stage_plan for each row execute function set_updated_at();
```

RLS: `select` to authenticated scoped like `oia_select` (owner/admin/workshop
staff of the item's workshop/assigned salesperson); **no browser writes** — the
API owns the atomic replace-all write, mirroring `production_events`.

### Pure service `services/stage_plan.py` (validation lives here, unit-tested)

```python
def validate_plan(rows, *, start_date, due_date, leg_dues) -> list[str]:
    """Return human-readable errors; empty list = valid."""
    active = [r for r in rows if not r.skipped]
    if any(r.planned_days is None or r.planned_days <= 0 for r in active):
        errors.append("Every non-skipped stage needs at least 1 day")
    budget = (due_date - start_date).days
    total  = sum(r.planned_days for r in active)
    if total > budget:
        errors.append(f"Stage days total {total}, but only {budget} days remain "
                      f"until the due date — remove {total - budget} day(s)")
    # cumulative due dates must not overrun the leg that owns the stage
    for code, cum_due in cumulative_dues(rows, start_date):
        if leg_dues.get(code) and cum_due > leg_dues[code]:
            errors.append(f"'{code}' would finish after its workshop's leg due date")
    return errors

def cumulative_dues(rows, start_date):
    """Ordered by stage sort; skipped stages consume 0 days and get no due_at."""
```

The **sum ≤ actual due date** rule is enforced here (422 with the shortfall
spelled out), not in a trigger: a row-level trigger cannot see sibling rows of a
not-yet-committed plan — the same reasoning 0030 records for route-leg cross-row
rules.

### API — `api/stage_plan.py` (new router, service role)

```
GET   /api/production/items/{id}/stage-plan
        → {plan: [...], budget_days, used_days, remaining_days, due_date, stages}
PUT   /api/production/items/{id}/stage-plan     owner/admin (CAP_ALLOCATE)
        req {rows: [{stage_code, planned_days|null, skipped, remind}]}
        200 {plan, due_dates}  422 {detail: "<first validation error>"}
POST  /api/production/items/{id}/stage-plan/{stage_code}/snooze
        req {hours: int}   → sets snoozed_until, clears reminded_at
PATCH /api/admin/stage-defs/{code}    owner/admin → default_days
```

`PUT` is **replace-all in one transaction** (`DELETE` then `INSERT`), so the plan
is never half-written and the sum invariant holds at every commit.

### Seeding
`POST /api/production/allocate` — after the assignment insert, if a `due_date`
was supplied and `default_days` exist, seed the plan (best-effort, scaled down
proportionally if defaults overrun the budget; log when scaled). Never fail the
allocation because of a reminder plan.

### Reminder engine — `tasks/stage_reminders.py` (Celery beat, hourly)

Precedent: [tasks/transit_watchdog.py](apps/api/src/tasks/transit_watchdog.py).

```python
async def _run():
    rows = await stage_plan_repo.due_reminders(session)   # due_at <= now, remind, not skipped,
                                                          # reminded_at null or snoozed_until passed,
                                                          # stage not already done, item not done/blocked
    for r in rows:
        await alert_repo.create_alert(session, customer_id=r.customer_id,
                                      type_="stage_due", detail=...)
        await _send_template(lead_phone, transit_messages.TEMPLATE_PRODUCTION_ALERT,
                             production_alert_params(issue="Stage due", ...))
        await stage_plan_repo.mark_reminded(session, r.id)   # UPDATE … WHERE reminded_at IS NULL
```

`mark_reminded` uses `WHERE reminded_at IS NULL RETURNING id` — send only if a
row comes back. That is the single-fire guarantee; no duplicate WhatsApps on a
Celery retry. Reuses the already-approved `topaz_production_alert` template — **no
new Meta approval needed for this requirement.**

### UI

**Admin default (owner/admin):** new tab `StagePlanAdmin.tsx` in
[owner/admin/](apps/dashboard/src/app/owner/admin/) — the 11 stages in `sort`
order, each with a days number input, a *Skip* toggle and a *Remind* toggle.
Same table idiom as `RouteTemplateAdmin.tsx`.

**Per-item plan:** a *Stage schedule* step inside
[AssignModal.tsx](apps/dashboard/src/app/dashboard/production/allocate/AssignModal.tsx)
after the due date is picked, plus an *Edit schedule* entry on the production
board drawer. Sticky footer shows live `used / budget` and turns red on overrun
with the exact overshoot; Save is disabled while invalid, and the server
re-validates regardless (a Server Action is callable RPC).

**Popup on the phone:** `my-queue` returns per-item `stage_due_at` +
`stage_overdue`. `WorkshopQueueClient` renders:
- a **sticky top banner** counting overdue stages (never a blocking modal — it
  would trap someone mid-tap on a shop floor);
- a red/amber pill on the item card (`overdue` / `due today`);
- **Snooze 4h** on the card, calling the snooze endpoint.

Out-of-app delivery is the WhatsApp alert above. Web Push is explicitly **not**
in this plan — it needs a service worker, VAPID keys and iOS caveats; the
WhatsApp path reaches the same phone today.

### Tests
`test_stage_plan.py` (pure): sum ≤ budget, skipped stages consume 0 days,
cumulative due dates, leg-overrun detection. `test_stage_plan_api.py`: PUT
atomicity, 422 copy, non-admin 403. `test_stage_reminders.py`: single-fire.

---

## REQ 4 — Record which stage a photo was uploaded in

Today [media](supabase/migrations/0025_media.sql) has `entity_type/entity_id/kind`
but no stage. A photo attached to a `done` event is recoverable via
`production_events.media_id → stage_code`; a photo uploaded against
`entity_type='order_item'` **before** the tap has no stage at all.

### Migration 0036

```sql
alter table media add column if not exists stage_code text references production_stage_defs(code);
create index if not exists media_item_stage_idx on media (entity_id, stage_code)
    where entity_type = 'order_item';

-- backfill from the event stream (the only place the link exists today)
update media m set stage_code = e.stage_code
  from production_events e
 where e.media_id = m.id and m.stage_code is null;
```

### API
`POST /api/media/sign-upload` accepts an optional `stage_code`, but for
`entity_type='order_item'` + `kind='production'` the server **resolves it from the
item's `current_stage`** and ignores the client value — the phone's screen can be
stale, and the stage a photo belongs to is a server fact. `list_for_entity`
returns `stage_code` + the stage's `label_en`/`label_gu`.

### UI
Photo galleries group by stage with a header `Frame work · ફ્રેમ કામ`, and each
thumbnail carries stage label + timestamp + uploader name:
`WorkshopQueueClient` history accordion,
[ProductionBoardClient.tsx](apps/dashboard/src/app/dashboard/production/ProductionBoardClient.tsx)
drawer, and the order detail page.

### Tests
Upload against an item at `frame_work` stamps `stage_code='frame_work'`; a
client-supplied mismatched `stage_code` is ignored, not honoured.

---

## REQ 5 — Delivery challan PDF  ⚠ layout blocked on client upload

Build the plumbing now behind a swappable layout module; drop in the client's
format when it arrives. Precedent to copy exactly:
`services/receipt_html.py` + `services/pdf.py` + `tasks/receipts.py` +
`repositories/document_repo.py`.

**A challan belongs to a delivery, not an order** — it is the document that
travels with the goods, so a partial delivery gets its own challan. This makes
REQ 5 depend on REQ 7.

### Migration 0037

```sql
alter table documents drop constraint documents_kind_check;
alter table documents add constraint documents_kind_check
  check (kind in ('quotation_pdf','receipt_pdf','invoice_pdf','challan_pdf'));

alter table deliveries add column if not exists challan_no text unique;
```
`doc_series` needs no migration — `allocate_number('CHL', fy)` works on the
generic table ([0012](supabase/migrations/0012_doc_series.sql)).

### Code
- `services/challan_html.py` — **pure** `render_challan_html(challan: dict) -> str`.
  All layout in one module with a documented data contract, so the client's
  format is a rewrite of this file only.
- `tasks/challan.py` — `render_challan(delivery_id)`: allocate `CHL` number →
  gather data → render HTML → `render_html_to_pdf` (in `asyncio.to_thread`) →
  `upload_bytes(DOCUMENTS_BUCKET, f"challans/{challan_no}.pdf")` →
  `document_repo.insert_document(kind='challan_pdf', entity_type='delivery', …)`.
- `GET /api/documents/challan/{delivery_id}` → signed URL (mirror the receipt route).

### Data contract (what the layout gets)
challan_no, date · customer name/phone/GSTIN/delivery address · order_no ·
per item: description, HSN, qty, unit, (money optional — a challan may be
non-valuational; the client's format decides) · vehicle_no, eway_bill_no,
driver name · totals via [services/gst.py](apps/api/src/services/gst.py) ·
place of supply, signature blocks.

### UI
*Generate challan* on the delivery row + order detail; a spinner while the task
runs; *Download / Print* opens the signed URL. Re-generate bumps `version`; the
challan number is allocated **once** and reused.

### Tests
`test_challan_html.py` (pure, no browser): every line item present, totals
correct, HTML escaping of customer name. Rendering is manual-integration
(Playwright), as with receipts.

---

## REQ 6 — Item finishes all stages → notify the assigned salesperson

### Wiring
[production.py advance()](apps/api/src/api/production.py#L253) already computes
`done = next_stage is None`. Pass it through:
`_notify("stage_done", …, done=done)`.

[tasks/production_notify.py `_run_production`](apps/api/src/tasks/production_notify.py)
currently logs and returns for anything that is not `blocked`. Add an
`item_ready` branch.

### Migration 0038
```sql
alter table order_items add column if not exists ready_notified_at timestamptz;
```

### Single-fire guarantee
```python
row = await session.execute(text(
    "UPDATE order_items SET ready_notified_at = now()"
    " WHERE id = :id AND production_done_at IS NOT NULL AND ready_notified_at IS NULL"
    " RETURNING id"), {"id": item_id})
if row.first() is None:
    return {"sent": 0}          # already notified, or not actually done
```
Atomic claim before the send — a Celery retry after a partial failure cannot
double-message. Same shape as the followup claim in `tasks/followup.py`.

### Recipient
Active **primary** `customer_assignments` salesperson for the order's customer →
`salespersons.whatsapp`. Fallback: `alert_repo.get_owner_whatsapp()`. Also insert
an `alerts` row (`type='item_ready'`) so the dashboard shows it even if WhatsApp
is down — the alert is the record, the message is the nudge.

### Template (needs Meta approval — submit day 1)
`topaz_item_ready`, category **Utility** (transactional), NAMED params
`{{order_no}}`, `{{item_description}}`, `{{customer_name}}`, `{{balance_due}}`.
Money is fine here — the audience is sales, not the money-blind workshop.
Copy constants go in `services/transit_messages.py` beside the existing three.

### "Mark product as done" — deliberate scope call
Do **not** invent a parallel state machine. `orders.status` already has
`ready → delivered → installed → closed`
([order_status.py](apps/api/src/services/order_status.py)) and payments have
their own table. So:
- the alert's CTA deep-links to `/dashboard/orders/{id}` with the payment form open;
- "collect payment" = the existing `POST /api/payments` (which already renders a receipt);
- "mark done" = schedule + complete the delivery (REQ 7), which is what moves
  `ready → delivered`.

If the client insists on a separate per-item sales sign-off, add
`order_items.sales_closed_at` + a `POST /items/{id}/close` endpoint — flag it as
a change of the agreed status map before building.

### Tests
`test_production_notify.py`: notify fires once and only once; second call returns
`{"sent": 0}`; unassigned customer falls back to owner; a template send failure
does not roll back the claim (logged, alert row still written).

---

## REQ 7 — Specific order items as deliverables + scheduled delivery

### The actual gap
`deliveries` + `delivery_items` exist ([0026](supabase/migrations/0026_deliveries.sql))
with a write path ([0033](supabase/migrations/0033_deliveries_write_path.sql)), but
[scheduleDeliveryAction](apps/dashboard/src/app/dashboard/deliveries/actions.ts#L22)
inserts **only** the `deliveries` row — `delivery_items` is never written. Every
delivery is therefore order-level, and partial delivery is impossible.

### Migration 0039

```sql
alter table order_items add column if not exists delivered_at timestamptz;

-- one item may not sit on two OPEN deliveries. A plain unique index cannot express
-- this (the status lives on the parent), so denorm the parent status onto the child
-- and index it — the idiom this schema already uses (sync_order_item_workshop 0024,
-- sync_workshop_lead 0029).
alter table delivery_items add column if not exists delivery_status text;

create or replace function sync_delivery_item_status() ...   -- copies deliveries.status
create trigger delivery_items_sync_status  after insert on delivery_items ...
create trigger deliveries_sync_item_status after update of status on deliveries ...

create unique index if not exists delivery_items_one_open
    on delivery_items (order_item_id)
    where delivery_status in ('scheduled','in_transit');
```

Atomic scheduling from the browser (no multi-statement transaction on the
Supabase client) → **`SECURITY INVOKER` RPC**, so 0033's RLS still applies:

```sql
create or replace function schedule_delivery(
    p_order_id uuid, p_scheduled_date date, p_driver uuid,
    p_item_ids uuid[], p_vehicle_no text, p_eway_bill_no text, p_notes text
) returns uuid language plpgsql security invoker as $$
declare v_id uuid;
begin
    if array_length(p_item_ids, 1) is null then
        raise exception 'Select at least one item to deliver';
    end if;
    insert into deliveries (...) values (...) returning id into v_id;
    insert into delivery_items (delivery_id, order_item_id)
        select v_id, unnest(p_item_ids);
    return v_id;
end $$;
```
`delivery_items_one_open` surfaces as `unique_violation` → the action translates
it to *"One of these items is already on another delivery — refresh."*

### Order status propagation
0033's `SECURITY DEFINER` trigger flips `orders.status` on delivery completion.
Change it to stamp `order_items.delivered_at` for that delivery's items and move
the order to `delivered` **only when no item of the order is undelivered**:

```sql
if not exists (select 1 from order_items
                where order_id = v_order and delivered_at is null) then
    update orders set status = 'delivered' where id = v_order and status = 'ready';
end if;
```
Mirrors the `production_done_at` "all items complete" check in 0024.

### Eligibility rule
An item is deliverable when `production_done_at is not null`, `delivered_at is
null`, and it is not on an open delivery. Items still in production are shown
**greyed with the reason** ("in Polishing at Sanjay Workshop"), never hidden —
the manager needs to know why they cannot pick it.

### UI
- [DeliveriesManagementClient.tsx](apps/dashboard/src/app/dashboard/deliveries/DeliveriesManagementClient.tsx):
  after choosing an order, an **item checklist** (checkbox, description, qty,
  status pill, per-item photo thumb), *Select all eligible*, and a footer
  `n of m items · partial delivery` warning.
- [deliveries/page.tsx](apps/dashboard/src/app/dashboard/deliveries/page.tsx):
  widen the select to embed `delivery_items(order_item_id, order_items(description, qty))`
  and the order's full item list; extend `types.ts` with `DeliveryItemRow`.
- Delivery board rows list the items on each run, not just the order number.
- Driver PWA `/delivery`: a per-item tick-off checklist; *Mark delivered*
  requires all items ticked (or an explicit partial with a note).

### Tests
Two open deliveries for one item → `unique_violation`. Partial delivery leaves
`orders.status = 'ready'`; delivering the remainder moves it to `delivered`.
Empty item list → error, no `deliveries` row.

---

## Build order (dependencies are real)

| # | Epic | Depends on | Migration |
|---|---|---|---|
| 0 | Submit `topaz_welcome_v2` + `topaz_item_ready` to Meta | — | — |
| 1 | **REQ 3** sub-manager capability fix + UX reasons | — | none |
| 2 | **REQ 1** advisor phone (free-form now, template on approval) | 0 | none |
| 3 | **REQ 4** `media.stage_code` + grouped galleries | — | 0036 |
| 4 | **REQ 2** stage plan + reminders + admin/PWA UI | 1 | 0035 |
| 5 | **REQ 6** item-ready notification + alert + CTA | 0 | 0038 |
| 6 | **REQ 7** item-level deliveries | 5 | 0039 |
| 7 | **REQ 5** challan PDF plumbing (layout on client upload) | 6 | 0037 |

Migration numbers are assigned by build order, not by requirement number —
renumber if epics are reordered. Next free number today is **0035**.

---

## Key files

| File | Operation | Why |
|---|---|---|
| [apps/api/src/api/authz.py:88-101](apps/api/src/api/authz.py#L88-L101) | Modify | Roster lookup for all non-admin roles (REQ 3 root cause) |
| [apps/api/src/services/stage_flow.py:44](apps/api/src/services/stage_flow.py#L44) | Modify | Union coarse-role caps with staff caps |
| [apps/api/src/api/media.py:80-86](apps/api/src/api/media.py#L80-L86) | Modify | Roster-based upload authz + `stage_code` resolution |
| [apps/api/src/services/templates.py](apps/api/src/services/templates.py) | Modify | `welcome_visit_v2`, `advisor_phone`, showroom fallback |
| [apps/api/src/repositories/followup_repo.py](apps/api/src/repositories/followup_repo.py) | Modify | Return advisor whatsapp in the context |
| `apps/api/src/services/stage_plan.py` | Create | Pure budget/sum/due-date validation |
| `apps/api/src/api/stage_plan.py` | Create | GET/PUT/snooze routes |
| `apps/api/src/repositories/stage_plan_repo.py` | Create | Replace-all write, due-reminder scan |
| `apps/api/src/tasks/stage_reminders.py` | Create | Hourly beat, single-fire reminders |
| [apps/api/src/tasks/production_notify.py](apps/api/src/tasks/production_notify.py) | Modify | `item_ready` branch + atomic claim |
| [apps/api/src/api/production.py:253](apps/api/src/api/production.py#L253) | Modify | Pass `done` into `_notify`; seed stage plan on allocate |
| `apps/api/src/services/challan_html.py` | Create | Swappable challan layout |
| `apps/api/src/tasks/challan.py` | Create | Render → storage → documents row |
| [apps/dashboard/src/app/workshop/WorkshopQueueClient.tsx](apps/dashboard/src/app/workshop/WorkshopQueueClient.tsx) | Modify | Disabled-reason copy, overdue banner, snooze |
| `apps/dashboard/src/app/owner/admin/StagePlanAdmin.tsx` | Create | Default per-stage days |
| [apps/dashboard/src/app/dashboard/production/allocate/AssignModal.tsx](apps/dashboard/src/app/dashboard/production/allocate/AssignModal.tsx) | Modify | Per-item stage schedule step |
| [apps/dashboard/src/app/dashboard/deliveries/actions.ts](apps/dashboard/src/app/dashboard/deliveries/actions.ts) | Modify | Call `schedule_delivery` RPC with item ids |
| [apps/dashboard/src/app/dashboard/deliveries/DeliveriesManagementClient.tsx](apps/dashboard/src/app/dashboard/deliveries/DeliveriesManagementClient.tsx) | Modify | Item picker |
| `supabase/migrations/0035…0039` | Create | Schema above |

---

## Risks

| Risk | Mitigation |
|---|---|
| Meta rejects/slow-reviews the two new templates | Env-gated v2 cutover; v1 keeps sending; `topaz_production_alert` (already approved) covers REQ 2 reminders with no new submission |
| Widening `capabilities_at_workshop` grants caps somewhere unintended | Roster row + active workshop is a strictly narrower gate than a role string; add explicit tests for `accounts`/`delivery` getting nothing |
| Stage plan and route legs drift into contradiction | Legs stay authoritative for handover; the plan validates against leg `due_at` and is reminder-only |
| Reminder spam on a Celery retry | `UPDATE … WHERE reminded_at IS NULL RETURNING id` claim before send |
| Duplicate item-ready WhatsApp | `ready_notified_at` atomic claim (same pattern) |
| Challan built against a guessed layout, then reworked | Layout isolated in one pure module with a documented data contract; plumbing is layout-independent |
| Partial delivery leaves an order stuck in `ready` | Trigger only advances when zero items remain undelivered; board shows `n of m delivered` |
| An item scheduled onto two deliveries | `delivery_items_one_open` partial unique index + humanised `unique_violation` copy |
| REQ 2/5/7 are out of SOW scope | Raise the Change Request before build (SOW §11) |

---

## SESSION_ID (for /ccg:execute)
- CODEX_SESSION: *(unavailable — usage limit until 2026-08-16)*
- GEMINI_SESSION: `ccg-20260804183119-39689` *(auth failed, no output — do not resume)*
