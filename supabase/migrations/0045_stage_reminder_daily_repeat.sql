-- Topaz CRM — 0045 · stage reminders repeat DAILY until the stage is cleared
--
-- The client's ask: "in stage duration set for particular days, every day it should send
-- the reminder to finish that stage until he's past that stage."
--
-- ─── WHAT 0035 SHIPPED, AND WHY IT IS NOT THIS ───────────────────────────────
-- 0035 made the reminder SINGLE-FIRE on purpose: `reminded_at` was claimed once
-- (`UPDATE … WHERE reminded_at IS NULL`) and the row never fired again. That traded a
-- possible lost reminder for a guarantee of no hourly nagging, which was the right
-- default when nobody had asked for repeats.
--
-- The ask reverses that trade: a stage that is past due but not finished SHOULD keep
-- asking, once a day, until the work is marked done. So `reminded_at` stops being a
-- permanent tombstone and becomes "when we last nagged" — the claim window widens from
-- "never reminded" to "not reminded since the start of today (IST)".
--
-- ─── WHY A COUNTER, NOT JUST A TIMESTAMP ─────────────────────────────────────
-- `reminder_count` is what makes the message able to say "Day 3 overdue" and what makes
-- an escalation rule (or a runaway loop) visible in one query. Without it, "how many
-- times have we nagged about this?" is unanswerable after the fact, because
-- `reminded_at` only ever holds the most recent value.
--
-- ─── WHY THE CAP IS IN SQL AND NOT ONLY IN PYTHON ────────────────────────────
-- A repeat reminder with no ceiling is how a shop floor learns to mute WhatsApp. The
-- partial index below encodes the ceiling so an exhausted row leaves the index
-- entirely — the scan never even considers it. The task reads the same constant, but the
-- index is what keeps the daily scan cheap once a few dozen items have gone stale.
-- ════════════════════════════════════════════════════════════════════════════

-- How many times this row has fired. NOT NULL default 0 so the daily scan's arithmetic
-- never has to cope with a NULL, and so existing 0035 rows backfill honestly: a row that
-- already fired once under the old single-fire rule gets 1, everything else 0.
alter table order_item_stage_plan
    add column if not exists reminder_count int not null default 0;

update order_item_stage_plan
   set reminder_count = 1
 where reminded_at is not null and reminder_count = 0;

-- ─── The scan index, rebuilt for the daily rule ──────────────────────────────
-- 0035's index carried `reminded_at is null`, which is exactly the predicate the daily
-- rule drops. Leaving it in place would mean the new scan (which must consider rows that
-- HAVE been reminded) falls back to a sequential scan on every tick. Replace it.
--
-- The cap (14) is duplicated from tasks/stage_reminders.py::_MAX_REMINDERS by necessity —
-- a partial index predicate must be immutable, so it cannot read a setting. If that
-- constant changes, this index has to be recreated in a new migration; the task's module
-- docstring says so.
drop index if exists order_item_stage_plan_due_idx;

create index if not exists order_item_stage_plan_due_idx
    on order_item_stage_plan (due_at)
    where skipped = false and remind = true and due_at is not null
      and reminder_count < 14;

comment on column order_item_stage_plan.reminder_count is
    'Times the stage-due reminder has fired. Capped by tasks/stage_reminders._MAX_REMINDERS '
    '(and by order_item_stage_plan_due_idx''s predicate, which must be kept in sync).';

comment on column order_item_stage_plan.reminded_at is
    'When the reminder LAST fired (0045). Under 0035 this was a one-shot tombstone; it is '
    'now the daily de-duplication key — a row re-fires once per IST day while its stage '
    'is unfinished.';
