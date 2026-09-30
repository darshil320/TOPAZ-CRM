-- Topaz CRM — 0050 · lead follow-up due-dates + in-app notifications
--
-- Replaces 0049's manual "follow-ups remaining" counter ENTIRELY, not
-- additively — two competing follow-up mechanisms on the same lead would be
-- confusing for no benefit. The client's actual ask (this session) was:
-- "set a number of days until the next follow-up, and after that day has
-- passed, show a notification" — date-granularity, not a decrementing tally.
--
-- ─── WHY A DUE-DATE COLUMN, NOT A NEW STATUS ──────────────────────────────────
-- A follow-up is a reminder a salesperson sets on a lead in ANY status — a
-- 'contacted' lead can have a follow-up due in 3 days at the same time; moving
-- a lead through the pipeline and reminding yourself to call it back are
-- different things. `followup_due_on` sits on `leads` for the same reason
-- `lost_reason` does (0046): a small lead-scoped fact, not a history table.
--
-- ─── WHY A NEW NOTIFICATION TABLE, NOT THE EXISTING `alerts` TABLE (0010) ─────
-- `alerts.customer_id` is NOT NULL — a lead-based notification has no
-- guaranteed customer (most leads are pre-conversion). `transit_watchdog.py`'s
-- own comment already establishes this codebase's precedent here: don't force
-- a notification into a table whose FK doesn't fit, make a new table instead.
--
-- ─── THE CLAIM, mirrors stage_plan_repo.claim_reminder's atomic-UPDATE shape ──
-- `followup_notified_at` is a plain null-check claim (not a daily-repeat claim
-- like stage reminders use) — a follow-up notification fires ONCE, ever, per
-- due date. Staying visible in the bell until manually cleared is what gives
-- it permanence; repeating it would just be noise on top of noise. The daily
-- beat task (tasks/lead_followup_notify.py) claims a row, creates a
-- lead_followup_notifications row, and never touches that lead's due date
-- again unless a human sets a new one.
--
-- ─── AUTO-CLEAR ON CONVERT/LOST ────────────────────────────────────────────────
-- A reminder on a lead that just became terminal is noise. api/leads.py's
-- change_status (for 'lost') and repositories/lead_repo.py's mark_converted
-- (for conversion) both null followup_due_on/followup_notified_at in the SAME
-- UPDATE that closes the lead — application-layer, not a DB trigger (this
-- codebase's own convention: terminal-state cleanup is explicit in route/repo
-- code, never a hidden side-effecting trigger a psql fix-up would also run).
-- The notification ROW itself is never deleted by this — it is history, and
-- is simply excluded from ever firing again (the scan excludes terminal
-- leads). Clearing it from the bell is still the user's own explicit action.
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the old counter system entirely (superseded, not additive).
alter table leads drop column if exists follow_ups_remaining;
alter table leads drop column if exists last_contacted_at;

alter table leads
    add column if not exists followup_due_on date,
    add column if not exists followup_notified_at timestamptz;

-- Scan index for the daily beat task (tasks/lead_followup_notify.py::due_followups).
create index if not exists leads_followup_due_idx
    on leads (followup_due_on)
    where followup_due_on is not null
      and followup_notified_at is null
      and status not in ('converted', 'lost');

-- ─── lead_followup_notifications ────────────────────────────────────────────
-- One row per (lead, due-date) firing. Never auto-expires — cleared only by an
-- explicit action (user ask: "should only go away if you clear it"). No delete
-- policy for `authenticated`, matching leads' own "no delete policy, mark
-- don't remove" precedent (0046).
--
-- salesperson_id is stored on the row itself, fixed at creation time, rather
-- than resolved via a join to leads.assigned_to/created_by at read time — a
-- later reassignment of the lead cannot retroactively change who a PAST
-- notification belonged to, which matters once a notification has already
-- been shown to someone.
create table if not exists lead_followup_notifications (
    id             uuid primary key default gen_random_uuid(),
    lead_id        uuid not null references leads(id) on delete cascade,
    salesperson_id uuid not null references salespersons(id) on delete cascade,
    due_on         date not null,
    created_at     timestamptz not null default now(),
    cleared_at     timestamptz
);

-- The panel/badge query: one salesperson's unread rows, newest first.
create index if not exists lead_followup_notifications_unread_idx
    on lead_followup_notifications (salesperson_id, created_at desc)
    where cleared_at is null;

-- Defensive dedupe alongside the primary claim (leads.followup_notified_at) —
-- belt-and-suspenders against a race that somehow re-armed the claim.
create unique index if not exists lead_followup_notifications_lead_recipient_uidx
    on lead_followup_notifications (lead_id, salesperson_id, due_on);

alter table lead_followup_notifications enable row level security;

-- "My leads only" (locked product decision): a salesperson sees/clears their
-- own notifications; the owner sees/clears all. (select ...) wrappers per 0044
-- so the helper hoists to an InitPlan rather than running once per row.
create policy lead_followup_notifications_select on lead_followup_notifications
    for select to authenticated
    using (
        (select is_owner())
        or salesperson_id = (select current_salesperson_id())
    );

-- UPDATE (clear / clear-all) only — no INSERT/DELETE policy for `authenticated`.
-- Only the service-role beat task creates rows; rows are cleared, never
-- hard-deleted.
create policy lead_followup_notifications_update on lead_followup_notifications
    for update to authenticated
    using (
        (select is_owner())
        or salesperson_id = (select current_salesperson_id())
    )
    with check (
        (select is_owner())
        or salesperson_id = (select current_salesperson_id())
    );
