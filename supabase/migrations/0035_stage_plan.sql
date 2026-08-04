-- Topaz CRM — 0035 · per-stage day budgets, skip, and reminder state
--
-- The client's ask: "configure how many days each stage should take, let me skip the
-- ones that don't apply, and remind me when one is due."
--
-- ─── WHAT ALREADY EXISTS, AND WHY IT IS NOT THIS ─────────────────────────────
--   * production_stage_defs (0024)         — the 11 stages, no notion of duration.
--   * order_item_assignments.due_date      — the item's ACTUAL deadline. The ceiling.
--   * order_item_route_legs.planned_days / due_at (0030)
--                                          — days per WORKSHOP SPAN, not per stage.
--
-- Legs stay AUTHORITATIVE for handover: they decide when goods move and who is late.
-- This table is REMINDER-ONLY — a foreman's internal schedule inside a leg. It must
-- never contradict a leg, which is why the API validates each stage's cumulative due
-- date against the leg that owns it before writing.
--
-- ─── WHY THE SUM RULE IS NOT A TRIGGER ───────────────────────────────────────
-- "The stage days must not add up past the item's due date" is a CROSS-ROW rule over a
-- plan that is written as one replace-all transaction. A row-level trigger cannot see
-- its not-yet-inserted siblings, so it would either fire spuriously mid-write or pass
-- an invalid total. Same reasoning 0030 records for the route-leg span rules: the
-- invariant lives in services/stage_plan.py, enforced at the one API chokepoint, and
-- the DB keeps only the constraints it can actually decide alone (per-row positivity,
-- skip consistency, one row per stage).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── The admin-level default ("configuration in admin") ──────────────────────
-- Nullable: a stage with no default is one the owner has not costed yet, which is
-- honest. Zero is not a duration, so the check floors at 1.
alter table production_stage_defs
    add column if not exists default_days int
        check (default_days is null or default_days > 0);

-- ─── The per-item plan ───────────────────────────────────────────────────────
create table if not exists order_item_stage_plan (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    stage_code    text not null references production_stage_defs(code),
    planned_days  int,
    -- SKIPPED: this stage does not happen for this item (a glass table has no
    -- upholstery). It consumes no days, gets no due date and never reminds.
    skipped       boolean not null default false,
    -- REMIND separately from SKIPPED: a stage can be real work that the owner does not
    -- want a WhatsApp about.
    remind        boolean not null default true,
    -- DERIVED and STORED, not computed on read: the hourly beat scan needs an indexable
    -- column, and recomputing eleven cumulative sums per item per tick would turn a
    -- one-index probe into a full scan.
    due_at        timestamptz,
    reminded_at   timestamptz,
    snoozed_until timestamptz,
    created_by    uuid references salespersons(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    -- A skipped stage with a day count or a due date is a contradiction the UI could
    -- produce by leaving a stale input value in the payload. Refuse it here.
    constraint stage_plan_skip_consistency check (
        not skipped or (planned_days is null and due_at is null)),
    constraint stage_plan_days_positive check (planned_days is null or planned_days > 0)
);

-- One plan row per stage per item. Also the conflict target the replace-all write and
-- the allocation seed both rely on.
create unique index if not exists order_item_stage_plan_uidx
    on order_item_stage_plan (order_item_id, stage_code);

-- THE reminder-scan index. Every predicate in tasks/stage_reminders.py's query is here,
-- so the hourly tick is an index probe over the handful of rows that can actually fire.
create index if not exists order_item_stage_plan_due_idx
    on order_item_stage_plan (due_at)
    where skipped = false and remind = true and reminded_at is null and due_at is not null;

drop trigger if exists order_item_stage_plan_set_updated_at on order_item_stage_plan;
create trigger order_item_stage_plan_set_updated_at
    before update on order_item_stage_plan
    for each row execute function set_updated_at();

-- ─── alerts: the new 'stage_due' signal ──────────────────────────────────────
-- `alerts.type` is a CHECK list (0010, widened by 0031), so a new signal has to be
-- declared here or tasks/stage_reminders.py's insert would fail the constraint on the
-- first overdue stage — a silent, hourly failure in a beat task nobody watches.
--
-- 'stage_due' — a planned stage passed its date with the work not marked done. Carries
-- the order's customer_id, so alerts_select's existing assigned-staff scoping keeps
-- working with no policy change.
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check
    check (type in ('intent_call', 'intent_visit', 'confusion', 'buying_signal',
                    'leg_overdue', 'transfer_pending', 'production_blocked',
                    'stage_due'));

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- SELECT is scoped exactly like oia_select (0024): owner/admin, workshop staff of the
-- workshop holding the item, or the salesperson assigned to its customer. A day budget
-- carries no money, but it does carry who is behind — same audience as the assignment.
--
-- NO WRITE GRANT AT ALL, deliberately. The plan's defining invariant (sum of days <=
-- the item's remaining budget) spans every row, so a browser INSERT of one row could
-- not be checked against it. api/stage_plan.py owns the atomic replace-all write on the
-- service-role connection — the same shape as production_events (0024).
alter table order_item_stage_plan enable row level security;
grant select on order_item_stage_plan to authenticated;

create policy oisp_select on order_item_stage_plan for select to authenticated
    using (is_owner() or is_role(array['admin'])
        or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                    where oi.id = order_item_stage_plan.order_item_id
                      and (is_assigned_to_customer(o.customer_id)
                           or is_workshop_manager_of(oi.workshop_id))));
