# 14 — Multi-workshop routing, workshop staff hierarchy, inter-workshop transit

**Status: BUILT (2026-07-27) — code complete, gates green locally, NOT deployed.**
Migrations `0029`–`0031` are in the repo and apply clean on a temp cluster; they are
**not** on prod or UAT (head there is still 0020 per STATE.md). See §10 for exactly what
shipped and §11 for what is deliberately still open.

**Scope flag (CLAUDE.md, SOW §11):** none of this is in `topaz-sow-v1.md`, `topaz-prd-v2.md`
or `EXECUTION_PLAN §4` modules 08–13. It is **new scope on top of the already-unpapered
2B + job-cards work** (STATE.md 2026-07-26). The client instructed us to build it anyway
("go create everything, ignore the build blocker", 2026-07-27) — recorded, not silently
dropped. **A written Change Request must still cover it before invoicing.**

---

## 0. What the client asked for (verbatim intent → system terms)

| Client words | System term |
|---|---|
| "multiple workshop manager … in one workshop there should be submanager as well who handles the status update" | **workshop staff hierarchy**: N staff per workshop, `lead` vs `sub` capability split |
| "in workshop cards please mention the due date also time on which we have to deliver" | **`due_at timestamptz`** (IST-rendered) replacing date-only `due_date` on the card |
| "internal app for product delivery between workshops … polishing in one workshop within 5 days then to finishing up to another workshop within 4 days, all status handled" | **route legs**: an ordered plan of (workshop, stage span, planned days, due_at) per order item |
| "mediator app for sending the product with its data to another workshop, like for delivery guy who knows which product to transfer to which workshop" | **transit app**: `workshop_transfers` consignments + a money-blind `/transit` PWA for the `delivery` role |

---

## 1. What already exists (do not rebuild)

- `workshops` (0023) — one workshop, ONE `manager_salesperson_id`, `is_workshop_manager_of()`.
- `production_stage_defs` (0024) — 11 fixed stage codes, `sort` in tens, `photo_required`.
- `order_item_assignments` (0024) — **exactly one active workshop per item** (partial unique
  index `order_item_assignments_one_active`), `due_date date`, `sync_order_item_workshop()`
  trigger owning the `order_items.workshop_id` denorm.
- `production_events` (0024) — append-only, one `done` per (item, stage),
  `production_event_apply()` auto-advances `current_stage` by `sort` and flips order status.
- `media` (0025/0027) — polymorphic, `entity_type` CHECK, private bucket, thumbs.
- `job_card_pdf` (0027) — **carries no money by construction**; already the safe artefact
  to hand an outside vendor. Reuse it as the transit paperwork.
- `deliveries` / `delivery_items` (0026) — **customer** delivery (order → home), Phase 2C,
  not in SOW, and carrying two known defects (RLS `using (true)`, zero `grant`s). This
  module does **not** overload it: workshop→workshop movement is a different entity.
- `/workshop` PWA (queue + advance + block + stage photo) and `/delivery` (order deliveries).

### 1.1 Two prerequisites this plan depends on

1. **Module 09 (production state-machine API) is still `todo`.** Today
   [actions.ts](../../../apps/dashboard/src/app/workshop/actions.ts) advances stages by
   writing `production_events` **and** re-writing `current_stage` / `current_stage_at` /
   order status directly from the browser session — duplicating
   `production_event_apply()` and skipping every module-09 guard (stage order, actor-is-
   this-workshop, photo_required is checked client-side only). Routing adds three more
   guards (leg boundary, transit lock, leg completion side-effect). If they live in a
   server action next to the existing duplicate writes, they are bypassable and will
   drift. **Build module 09's `POST /api/production/items/{id}/advance|block|unblock`
   first and point the PWA at it.** ~2 days, already in the plan/SOW.
2. **`0026_deliveries.sql` RLS/grants must be fixed** in the same push, because this module
   ships a `delivery`-role app and that table becomes reachable. (STATE.md "Discoveries
   for later modules", 2C/REVIEW NEEDED.)

---

## 2. Design decisions

**D4, D6, D11 CONFIRMED by the client (Darshil, 2026-07-27)** — all three as recommended:
sub-manager = status updates only; handover auto-created on the leg's last stage `done`
with a lead-only manual override; no auto-shift of downstream due dates (alert + audited
owner/admin reflow). The rest are vendor calls, recorded here rather than left implicit.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | New `salespersons.role` value for sub-manager? | **No.** Keep role `workshop_manager`; put the fine-grained `lead`/`sub` in `workshop_staff.role`. | The role enum is read by `is_role()` in ~every policy and by `nav-config.tsx`. A new coarse role means auditing all of it for zero gain. Coarse role = which app you land in; `workshop_staff.role` = what you may do inside it. |
| D2 | Keep `workshops.manager_salesperson_id`? | **Yes, as a trigger-owned denorm** of the active `lead` row. | Same precedent as `order_items.workshop_id` (0024). Existing reads/RLS keep working; one writer, no drift. |
| D3 | Widen `is_workshop_manager_of()` to include sub-managers? | **Yes** (it becomes "is staff of"), and add a **new** `is_workshop_lead_of()` for lead-only writes. | Sub-managers must see the queue and the realtime stream (`pe_select`, `oia_select`). Keeping the old name avoids touching every call site; the comment gets rewritten. |
| D4 | Who may create/receive a transfer? | **Lead + owner/admin.** Sub-manager may advance/block stages only. | Matches the client's own words ("submanager … handles the status update"). Also mirrors the existing owner-only `ca_insert` philosophy: custody changes are not self-serve. |
| D5 | Model the multi-workshop journey by mutating `order_item_assignments`, or a new legs table? | **New `order_item_route_legs`** (the plan) + keep `order_item_assignments` as the record of **present custody** (the fact). Activating a leg inserts an assignment row. | `one_active` assignment is load-bearing for the denorm trigger, `oia_select`, the unallocated index and modules 11/13. Legs are additive; every shipped consumer keeps working with zero change. |
| D6 | Who decides a leg is finished? | **Stage-driven** — `done` on the leg's `stage_to` completes it — with a lead-only "hand over early / hand over late" manual override. | Directly encodes "polishing here, then finishing there". Manual-only would be one more thing the 45-year-old manager must remember. |
| D7 | Where does the leg-completion side-effect live? | **API layer, never the trigger.** | CLAUDE.md trigger scope fence (0024 header): `production_event_apply()` may only maintain denorm. Creating a consignment is business logic. |
| D8 | `order_items.workshop_id` during transit? | **Stays the ORIGIN** until `received`; a new `transit_transfer_id` denorm marks in-flight. | `pe_select` scopes a manager's Realtime stream off `workshop_id` — nulling it mid-transit blinds the origin manager and empties the board chip. |
| D9 | Item advanceable while in transit? | **No.** Advance API 409s when `transit_transfer_id is not null`. Block/unblock stays allowed (origin must be able to flag transit damage). | Physical custody is unknown mid-transit; a stage tap then means nothing. |
| D10 | Two-party handover, or one tap? | **Two-party**: courier marks `delivered`, destination lead marks `received`. Only `received` moves custody. | One tap makes "lost in transit" unattributable — the exact dispute this app exists to settle. Handover photo required at both ends. |
| D11 | Late leg → auto-shift downstream due dates? | **No auto-shift.** Slip raises an alert; owner/admin gets an explicit **Reflow route** action that recomputes remaining legs from now and audits it. | Due dates are commitments derived from the customer's delivery date. Silently moving them destroys the only signal that the order is late. |
| D12 | How does the courier see item data without seeing money? | **Through the API only** (service-role, money-blind projection) + the existing `job_card_pdf`. | `order_items` carries `unit_price`/`line_total`/`gst_rate` and `delivery` has (and must keep) no SELECT policy on it — same reasoning that forces module 13's money-blind view. |
| D13 | Rework/return-to-previous-workshop? | **Out of scope, same as rework generally** (STATE.md 2026-07-26 08: rework is not modelled; `production_events_one_done_per_stage` licenses that). A failed QC = `blocked` + note. If the client wants a physical send-back, that is a **new** transfer with `reason='rework'` and NO stage regression. | Reversing the no-rework decision means dropping that index and adding an `attempt` column — a much bigger change. |

---

## 3. Migrations

Head is `0028`. New files: **0029 / 0030 / 0031.** All additive; each is independently
revertible (drop the new tables + restore the two function bodies).

### 0029_workshop_staff.sql — the hierarchy

```
workshop_staff(
  id uuid pk,
  workshop_id     uuid not null references workshops(id),
  salesperson_id  uuid not null references salespersons(id),
  role            text not null check (role in ('lead','sub')),
  active          boolean not null default true,
  created_by      uuid references salespersons(id),
  created_at, updated_at, deactivated_at
)
```

- `unique index workshop_staff_one_active_lead on workshop_staff (workshop_id) where active and role = 'lead'`
  — one lead per workshop; sub-managers unbounded.
- `unique index workshop_staff_one_active_person on workshop_staff (workshop_id, salesperson_id) where active`
  — no duplicate membership. A person MAY be staff of several workshops (small showroom
  reality: one manager covering two sites).
- `index workshop_staff_person_idx on workshop_staff (salesperson_id) where active`
  — serves the "my workshops" read on every PWA page load.
- `set_updated_at` trigger.
- Backfill: `insert … select id, manager_salesperson_id, 'lead' from workshops where
  manager_salesperson_id is not null` — idempotent on the unique indexes.
- `sync_workshop_lead()` trigger (after ins/upd/del) recomputes
  `workshops.manager_salesperson_id` from the active lead row — pure denorm, D2.
- **Redefine** `is_workshop_manager_of(uuid)` → active `workshop_staff` row of ANY role
  (D3). Same signature, so `oia_select` / `pe_select` / the future module-13 view need no
  edit. Rewrite the comment; the old name now means "is staff of".
- **New** `is_workshop_lead_of(uuid)` → active row with `role='lead'`. Null-safe, both
  `stable security definer set search_path = public`, mirroring 0023.
- RLS: `select` open to authenticated (a name + a role carries no money);
  `insert`/`update` owner/admin only (D4). No delete grant — deactivate.

### 0030_route_legs.sql — the plan, plus due date **and time**

```
order_item_route_legs(
  id uuid pk,
  order_item_id  uuid not null references order_items(id) on delete cascade,
  seq            int  not null check (seq > 0),
  workshop_id    uuid not null references workshops(id),
  stage_from     text not null references production_stage_defs(code),
  stage_to       text not null references production_stage_defs(code),
  planned_days   int  check (planned_days > 0),
  due_at         timestamptz,
  status         text not null default 'pending'
                 check (status in ('pending','in_transit','active','completed','cancelled')),
  activated_at, completed_at timestamptz,
  created_by uuid references salespersons(id),
  created_at, updated_at
)
```

- `unique (order_item_id, seq)`; `unique index … (order_item_id) where status = 'active'`
  — at most one leg is where the work is happening, the DB backstop behind the
  receive transaction's `FOR UPDATE`.
- `index order_item_route_legs_workshop_idx on (workshop_id, status) where status in ('pending','in_transit','active')`
  — the PWA's "coming to me / at me" split.
- `index order_item_route_legs_due_idx on (due_at) where status = 'active' and due_at is not null`
  — module 12's overdue scan (mirrors `order_item_assignments_due_idx`).
- CHECK `stage_from`/`stage_to` ordering cannot be expressed against another table in a
  CHECK; enforce `sort(stage_from) <= sort(stage_to)` in a `before insert or update`
  trigger + in the API. Also validated: leg *n*'s `stage_from` is the stage after leg
  *n-1*'s `stage_to` (no gaps, no overlap) — API-side, since it is cross-row.
- `order_item_assignments` gains `route_leg_id uuid references order_item_route_legs(id)`
  (nullable — pre-route assignments keep working) **and `due_at timestamptz`**.
  `due_date` is kept and becomes a trigger-maintained denorm
  (`due_date := (due_at at time zone 'Asia/Kolkata')::date`) so `order_item_assignments_due_idx`
  and every shipped `due_date` read keep working. `at time zone` is STABLE, not IMMUTABLE
  → trigger, **not** a generated column.
- `order_items` gains `transit_transfer_id uuid` (FK added in 0031, which is where
  `workshop_transfers` is born) — trigger-owned denorm, D8/D9.
- **Route templates** (so nobody retypes "Polishing 5d → Finishing 4d" per item):
  `production_route_templates(id, name unique-active, active, created_at)` +
  `production_route_template_legs(template_id, seq, workshop_id, stage_from, stage_to, planned_days, unique(template_id, seq))`.
  Owner/admin write, all-staff read. Seeded EMPTY — same reasoning as `workshops`
  (0023): a placeholder route can drive a real item to a workshop that does not exist.
- RLS: select = owner/admin or `is_workshop_manager_of(workshop_id)` or
  `is_assigned_to_customer(...)` via the item's order (copy `oia_select` verbatim, plus
  the workshop clause). Writes service-role only, matching `order_item_assignments`.

### 0031_workshop_transfers.sql — the consignment + the mediator's state machine

```
workshop_transfers(
  id uuid pk,
  transfer_no       text not null unique,        -- services/numbering.py series
  from_workshop_id  uuid not null references workshops(id),
  to_workshop_id    uuid not null references workshops(id)
                    check (from_workshop_id <> to_workshop_id),
  reason            text not null default 'next_stage'
                    check (reason in ('next_stage','rework','capacity','other')),
  status            text not null default 'ready'
                    check (status in ('ready','picked_up','in_transit','delivered','received','cancelled')),
  courier_salesperson_id uuid references salespersons(id),   -- nullable: vendor's own tempo
  vehicle_no        text,
  expected_pickup_at timestamptz,
  due_at            timestamptz,                 -- when the DESTINATION must hold it
  picked_up_at, delivered_at, received_at, cancelled_at timestamptz,
  notes             text,
  created_by uuid references salespersons(id),
  created_at, updated_at
)

workshop_transfer_items(
  id, transfer_id fk on delete cascade, order_item_id fk, route_leg_id fk,
  qty numeric, created_at,
  unique (transfer_id, order_item_id)
)
-- one open transfer per item, across ALL transfers:
unique index workshop_transfer_items_one_open on workshop_transfer_items (order_item_id)
  where <transfer status not in ('received','cancelled')>   -- see note

workshop_transfer_events(
  id, transfer_id fk, kind check ('created','assigned','picked_up','in_transit',
  'delivered','received','cancelled','note'), note text, media_id uuid references media(id),
  actor uuid references salespersons(id), at timestamptz default now()
)   -- append-only via forbid_*_mutation(), same shape as production_events (0024:213)
```

- **Note on `one_open`:** a partial index cannot read the parent's `status`. Two options —
  (a) denormalise `open boolean` onto `workshop_transfer_items`, trigger-maintained from
  the parent status, and index `where open`; or (b) rely on `order_items.transit_transfer_id`
  + `FOR UPDATE` in the API. Recommend **(a)** — a DB backstop, consistent with how every
  other one-active invariant in this schema is enforced.
- `index workshop_transfers_courier_idx on (courier_salesperson_id, status) where status in ('ready','picked_up','in_transit')`
  — the `/transit` app's entire home screen is this index.
- `index workshop_transfers_to_status_idx on (to_workshop_id, status)` — the destination's
  "Incoming" section.
- `sync_item_transit()` trigger on `workshop_transfer_items` + `workshop_transfers.status`
  → maintains `order_items.transit_transfer_id` (set while open, NULL on
  received/cancelled). Pure denorm, allowed.
- `media`: extend `media_entity_type_check` with `'workshop_transfer'`, and `media_kind`
  with `'transit'`; mirror in `services/media_entities.py::VALID_PAIRINGS` **and** in
  `supabase/storage/0025_media_policies.sql` (bucket policy discriminates on the first
  path segment — a new entity_type that the bucket policy does not know is an
  unreachable upload; that class of miss is exactly H2 in the 2026-07-26 review).
  `media_site_is_customer_scoped` is unaffected.
- RLS select: owner/admin, `is_workshop_manager_of(from_workshop_id)`,
  `is_workshop_manager_of(to_workshop_id)`, or
  `courier_salesperson_id = current_salesperson_id()`. **The destination must be able to
  read a transfer before receiving it** — that is the whole point of "Incoming".
  All writes service-role (API), matching `production_events`.
- `deliveries`/`delivery_items` (0026) get their missing `grant`s, real scoped policies and
  a `set_updated_at` trigger **in this migration** (§1.1.2).

---

## 4. API (`apps/api`)

New router `api/routing.py` + `api/transfers.py`, new `repositories/route_repo.py` +
`transfer_repo.py`. All dashboard-key + verified-JWT, `authz.resolve_caller`, same shape
as `api/production.py`.

### Routes

```
POST /api/production/items/{item_id}/route
  body {legs:[{workshop_id, stage_from, stage_to, planned_days?, due_at?}], start_at?}
       | {template_id, start_at}
  Validates: contiguous non-overlapping stage spans covering stage_from(leg1)..stage_to(last);
             every workshop active; caller owner/admin/assigned-salesperson;
             order status in (confirmed, in_production); item not finished.
  Effect (ONE transaction): insert legs; compute missing due_at cumulatively from
             start_at + Σ planned_days at 18:00 IST; activate leg 1 →
             repo.allocate(...) (existing path, so the assignment/denorm invariants hold)
             + initialise current_stage = leg1.stage_from.
  409 item already routed (use PATCH), item in transit, concurrent route.
  422 gaps/overlaps in the stage cover, due_at in the past, stage_from after stage_to.

PATCH /api/production/items/{item_id}/route      owner/admin — edit unstarted legs, reflow (D11)
POST  /api/production/items/{item_id}/route/reflow  owner/admin — recompute remaining due_at from now, audited
GET   /api/production/items/{item_id}/route      money-blind projection of the leg timeline

POST /api/transfers                     lead(from)/owner/admin — create consignment from completed leg(s)
POST /api/transfers/{id}/assign         lead/owner/admin — courier + vehicle + expected_pickup_at
POST /api/transfers/{id}/pickup         courier or lead — requires handover media_id (D10)
POST /api/transfers/{id}/in-transit     courier
POST /api/transfers/{id}/deliver        courier — requires media_id
POST /api/transfers/{id}/receive        lead(to)/owner/admin — THE custody transaction, below
POST /api/transfers/{id}/cancel         lead(from)/owner/admin — reason required; leg returns to 'active' at origin
GET  /api/transfers/my                  courier-scoped queue, money-blind
GET  /api/transfers?workshop_id=&direction=in|out
```

### The two transactions that matter

**Leg completion** (inside module 09's `advance`, after the event commits — D7):

```
if completed stage_code == active_leg.stage_to and a next leg exists:
    leg.status = 'completed', completed_at = now()
    next_leg.status = 'in_transit'
    create workshop_transfers(status='ready', from=leg.workshop, to=next_leg.workshop,
                              due_at=next_leg.due_at) + transfer_items row
    enqueue notify (module 12): destination lead + courier pool
else if no next leg:
    nothing new — existing behaviour
```

**Receive** (`POST /api/transfers/{id}/receive`) — one transaction, `SELECT … FOR UPDATE`
on the transfer and each item:

```
transfer.status = 'received', received_at = now()        (409 if not in delivered/in_transit)
for each item: leg(seq+1).status = 'active', activated_at = now()
               repo.allocate(item, to_workshop, due_at=next_leg.due_at)   -- deactivates prior
                 → sync_order_item_workshop() flips order_items.workshop_id
               sync_item_transit() clears order_items.transit_transfer_id  → item advanceable again
insert workshop_transfer_events(kind='received', media_id=?)
```

`current_stage` is **not** touched on receive: `production_event_apply()` already moved it
to the next stage by `sort` when the origin's last stage completed. The item sits at
"finishing, not started" while in transit — honest, and it is exactly what D9's advance
lock protects.

### Guards added to module 09's `advance`

1. Caller must be active `workshop_staff` of `order_items.workshop_id` (any role) — or owner/admin.
2. `order_items.transit_transfer_id is null` → else **409 "item is in transit"** (D9).
3. `stage_code` must lie within the active leg's `[stage_from, stage_to]` by `sort` → else
   409. This is what stops workshop A from ticking off workshop B's stages.

---

## 5. Dashboard / apps

### 5.1 `/owner/admin` → Workshops tab (extend `WorkshopAdmin.tsx`)

Per-workshop **Staff** panel: current lead + sub-managers, add (salesperson picker filtered
to active staff, role lead|sub), deactivate, promote sub → lead (deactivates the old lead
in one action — the one-active-lead index makes a two-step sequence fail). Plus a
**Route templates** tab (name + legs table with workshop / stage span / days).

### 5.2 `/workshop` PWA (`page.tsx`, `WorkshopQueueClient.tsx`)

- **Read fix, required:** `page.tsx:45` filters workshops by
  `manager_salesperson_id = sp.id` — a sub-manager matches nothing and sees an empty
  queue. Switch to `workshop_staff` (my active rows → `.in("id", ids)`).
- Card gains: **due date + time** (`due_at`, rendered IST, e.g. `Thu 30 Jul · 6:00 PM`)
  with a live countdown chip — amber < 24h, red overdue, and the existing card border
  logic extended (overdue is as loud as blocked, `bg-red-950/20`).
- Card gains a leg badge: `Leg 2/3 · પોલિશિંગ→ફિનિશિંગ` (label_gu primary, per module 10's
  language rule) and the destination hint `→ Sharma Furniture`.
- **"Ready to hand over"** button, **lead only**, enabled when the leg's `stage_to` is done
  → creates the transfer (or shows the auto-created one).
- New **"આવી રહ્યું છે / Incoming"** section above the queue: transfers with
  `to_workshop_id = mine` and status in (ready, picked_up, in_transit, delivered) —
  each with a **Receive** button (lead only) that demands a handover photo.
- In-transit items render read-only with an "in transit" banner, advance disabled (D9),
  block still available.
- Sub-manager: identical screen minus hand-over / receive (D4). Capability comes from the
  server, not a client flag.

### 5.3 `/transit` — the mediator app (new route group, role `delivery`)

Money-blind by construction: every read goes through `GET /api/transfers/my` (D12).
- **Home = today's runs**, grouped by pickup workshop, sorted by `expected_pickup_at`.
- Run card: from-workshop (name, address, lead name + tap-to-call phone) →
  to-workshop (same), `due_at`, item count, and per item: **photo thumb, description,
  qty, dimensions, material, order_no, customer first name** — and **no money, ever**.
- One tap opens the existing **job card PDF** as the paperwork that travels with the goods
  (0027 — already money-clean, already sendable to an outside vendor).
- Four buttons, one per state edge: **Picked up** (camera required) → **In transit** →
  **Delivered** (camera required) → then it leaves the courier's list and waits for the
  destination lead's Receive.
- Same PWA discipline as module 10: ≤3 taps per action, Gujarati primary, strings in an
  `i18n.ts` dict, no offline queue in v1.

### 5.4 `/dashboard/production` board (module 11, when built)

- A **Transit** lane between stage columns, cards showing from→to and `due_at`.
- Filters: `overdue only`, `in transit only`, workshop.
- Card drawer: full leg timeline (workshop, span, planned vs actual, due_at vs completed_at)
  + transfer handover photos.

---

## 6. Notifications (module 12 hooks — stub now, wire there)

| Trigger | To | Channel |
|---|---|---|
| transfer created | destination lead, courier pool | WhatsApp (new template `transfer_assigned`) |
| picked up / delivered | origin lead, destination lead | WhatsApp |
| received | origin lead, order's salesperson | WhatsApp + `alerts` row |
| leg `due_at` passed, not completed | owner + order's salesperson | `alerts` row + WhatsApp `leg_overdue` |
| `expected_pickup_at` passed, still `ready` | owner + origin lead | `alerts` row |

**External dependency, long lead time:** `transfer_assigned` and `leg_overdue` are new Meta
templates. 2A templates took days to clear review and two are still *In review*
(STATE.md). Submit at the START of this module; in-window text sends work meanwhile.
Every send routes through the existing 24h-window chokepoint — no new send path.

---

## 7. Tests (the module's real deliverable)

Empirical, on `apps/api/scripts/pgtest.sh`:
1. One active lead per workshop; promote is atomic; a person may be staff of two workshops.
2. `is_workshop_manager_of()` now true for a sub; `is_workshop_lead_of()` false for a sub.
3. Route validation: gap in the stage cover → 422; overlap → 422; `stage_from` after
   `stage_to` → 422; inactive workshop → 409.
4. `due_at` → `due_date` denorm is correct across the IST/UTC date boundary
   (a 30 Jul 00:30 IST `due_at` must NOT store `due_date = 2026-07-29`).
5. Leg completion auto-creates exactly one transfer; a second `done` on the same stage
   still 409s on `production_events_one_done_per_stage` and creates no second transfer.
6. Advance on an in-transit item → 409. Block on an in-transit item → 200.
7. Workshop A cannot advance a stage belonging to leg 2 → 409.
8. Receive: activates the next leg, inserts the assignment, deactivates the prior one,
   `order_items.workshop_id` flips, `transit_transfer_id` clears — all in one commit.
9. Concurrent double-receive → one wins, other 409 (`FOR UPDATE` + `one_active` leg index).
10. Cancel a transfer → leg returns `active` at the origin, `transit_transfer_id` clears.
11. RLS: sub-manager can read the queue but the receive endpoint 403s; a courier reads
    only their own transfers; `delivery` role still cannot SELECT `order_items`
    (money-blind, the load-bearing assertion — extend `test_rls_phase2a.py`).
12. Reflow recomputes only `pending` legs and writes an audit row.

Pure: route validator (contiguity/cover), due_at cumulative computation, IST formatting,
capability resolution (lead vs sub vs owner) — all in `services/`, no DB, `pytest` green
with no ML/network deps installed (CLAUDE.md import-light rule).

---

## 8. Build order (each step ends green + committed)

| Step | Work | Days |
|---|---|---|
| 0 | **Prereq** — module 09 advance/block API; repoint `/workshop` server actions at it; delete the duplicated denorm writes in `actions.ts` | 2 |
| 1 | 0029 + staff API + admin Staff panel + `/workshop` read fix (sub-managers can see their queue) | 1.5 |
| 2 | 0030 + route/template API + validator (pure, TDD) + allocate page becomes a route builder | 2.5 |
| 3 | `due_at` end-to-end: denorm trigger, API, workshop card countdown, board chip | 1 |
| 4 | 0031 + transfer state machine + the receive transaction + module-09 guards | 2.5 |
| 5 | `/transit` mediator PWA + `/workshop` Incoming section | 2 |
| 6 | Module 12 hooks + templates submitted; overdue watchdog | 1 |
| 7 | Hardening: `code-reviewer` + `security-reviewer` + `database-reviewer` on the whole surface; 0026 RLS fix; field test with two real managers + one courier | 1.5 |

**≈14 working days** (≈12 excluding the module-09 prereq that is already in scope) at the
SOW §11 T&M rate of ₹8,000/day → **≈₹96,000–₹1,12,000**, to be papered in the Change
Request alongside the job-card scope.

## 9. Gates

- Full `pgtest.sh` suite green; `tsc --noEmit` clean.
- Migrations apply clean on a temp DB **and** on UAT before prod.
- Demo, on real hardware: route an order item Polishing(A, 5d) → Finishing(B, 4d); A's
  sub-manager advances to polishing-done; transfer appears on the courier's phone; courier
  picks up (photo) → delivers (photo); B's lead receives; the item is now B's with its own
  due_at; the board shows the whole journey; the order flips `ready` only after B's
  dispatch. No screen in the courier's or either manager's app ever shows a price.
- `security-reviewer` must specifically confirm the money-blind boundary for the
  `delivery` role and the destination-before-receive read widening.

## 10. What actually shipped (2026-07-27)

### Migrations (repo head is now `0031`)

| File | Contents |
|---|---|
| `0029_workshop_staff.sql` | `workshop_staff` (lead/sub) + one-active-lead and one-active-membership indexes; backfill from `workshops.manager_salesperson_id`; `sync_workshop_lead()` makes that column a denorm; **`is_workshop_manager_of()` widened to "is staff of"** (same name/signature, so `oia_select`/`pe_select` needed no edit) + new `is_workshop_lead_of()` |
| `0030_route_legs.sql` | `order_item_route_legs` (seq, stage span, planned_days, `due_at`, status) + one-active-leg index + span-direction trigger; `order_item_assignments.due_at` + `route_leg_id`; `sync_assignment_due_date()` derives `due_date` in **Asia/Kolkata**; `order_items.transit_transfer_id`; `production_route_templates` + `_legs`; realtime publication |
| `0031_workshop_transfers.sql` | `workshop_transfers` / `_items` (with the `open` denorm + one-open-per-item index) / `_events` (append-only); the FK + `sync_transfer_denorm()` that owns `transit_transfer_id`; media `workshop_transfer`/`transit`; alert types `leg_overdue`/`transfer_pending`/`production_blocked`; realtime; **and the `0026_deliveries` RLS/grants/updated_at fix** |

### API (`apps/api`)

- **Pure core:** `services/stage_flow.py` (stage order + the lead/sub capability rule),
  `services/route_plan.py` (cover validation, cumulative deadlines, reflow),
  `services/transit_messages.py` (bilingual copy). 44 pure tests.
- **I/O:** `services/handover.py` (`open_handover` / `receive_transfer` / `cancel_transfer`),
  `repositories/workshop_staff_repo.py`, `route_repo.py`, `transfer_repo.py`,
  `production_repo.py` extended with the module-09 stage machine.
- **Routers:** module 09 endpoints on `/api/production` (`my-queue`, `items/{id}`,
  `advance`, `block`, `unblock`, `override-stage`), new `/api/routing` (6 routes) and
  `/api/transfers` (10 routes), staff routes on `/api/workshops`.
- **Tasks:** `tasks/production_notify.py`, `tasks/transit_watchdog.py` (09:00 IST beat).
- **Fixed while passing through:** `api/media.py` gated workshop uploads on
  `workshops.manager_salesperson_id`, so a **sub-manager could not have uploaded a
  photo — and four stages are `photo_required`, meaning they could not have completed a
  stage at all.** Now roster-based. A courier is also allowed exactly one upload path
  (`workshop_transfer`/`transit`) where the role was previously refused outright.

### Dashboard (`apps/dashboard`)

- `/workshop` — **read moved from Supabase to `GET /api/production/my-queue`.** The old
  query filtered `manager_salesperson_id = me`, which a sub-manager never matches, and
  selected `order_items` directly (a table their role has no policy on). Card now shows
  the deadline **with a time** + live countdown, the leg badge and the next workshop,
  goes read-only in transit, and offers a lead-only hand-over.
- `/workshop` **Incoming** section — receive an arriving consignment, photo required.
- `/transit` — **the mediator app** (`delivery` role): today's runs, both sites with
  address + tap-to-call, every item with size/material/order/customer and **no price**,
  four state buttons with photos at pickup and delivery.
- `/owner/admin` — **Workshop Staff** panel (appoint/promote/remove) and **Route
  Templates** builder.
- `/dashboard/production/allocate` — **Plan route** modal beside Allocate (saved
  template in one tap, or leg-by-leg).
- `/dashboard/production` board — deadline chip, leg badge, in-transit badge.
- Shared: `lib/apiFetch.ts`, `lib/production/{types,format,reads}.ts`,
  `components/production/{usePhotoCapture,CameraField}`.
- `lib/supabase/types.ts` extended with all seven new tables.

### Gate results

- `apps/api/scripts/pgtest.sh` — **307 passed** (23 of them the new
  `test_workshop_routing_empirical.py`).
- Pure suite with no DB/ML deps — **192 passed, 82 skipped**.
- `tsc --noEmit` on the dashboard — **clean**.

## 11. Deliberately still open

- **Not deployed.** Prod/UAT migration head is `0020`; `0021`–`0031` must be pushed, and
  the storage bucket policy needs no change (verified: its rule is a denylist on
  `customer`, so `workshop_transfer/…` keys are already readable by the roles that need
  them).
- **Meta templates `transfer_assigned` and `leg_overdue` are not submitted.** Until they
  clear review, transit notifications only reach a handset that has messaged the business
  number in the last 24 hours. In-window text works today.
- **No code-reviewer / security-reviewer pass on this surface yet** — the same gate that
  module 08 never formally closed. Worth running specifically at the money-blind boundary
  for the `delivery` role and at the destination-before-receive read widening.
- **Rework is still not modelled** (D13): a physical send-back is a new transfer with
  `reason='rework'`, and no stage regresses.
- **`coverage_requests` and consent-withdrawal purge** are untouched by this module and
  remain as CLAUDE.md lists them.
