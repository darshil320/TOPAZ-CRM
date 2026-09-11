-- Topaz CRM — 0049 · follow-up counter, layered on the existing lead status
--
-- Two columns, not a new table: this is per-lead scalar state (a count and a
-- timestamp), not a history of events. `leads.lost_reason` (0046) is the
-- precedent for "a small lead-scoped fact lives as a column" — a
-- `lead_follow_ups` history table is not what was asked for here (tracking and
-- display, not an automated reminder engine — see below).
--
-- Default 0, not the budgeted number: a brand-new 'new'-status lead has not had a
-- first contact attempt scheduled yet. The counter becomes meaningful (and
-- auto-resets to DEFAULT_FOLLOW_UPS = 3, services/lead_status.py) only once a
-- lead moves 'new' -> 'contacted' — that is a one-time, one-directional edge, so
-- the reset fires at most once per lead's lifetime.
--
-- `last_contacted_at` is NULL until the first `POST /leads/{id}/follow-up` call —
-- distinguishable from "contacted today", which matters for the hero copy on the
-- dashboard (3/3 remaining with a NULL last_contacted_at reads differently from
-- 3/3 with a recent timestamp, e.g. after a manual reset).
--
-- ─── THIS IS A MANUAL COUNTER, NOT A SCHEDULED REMINDER SYSTEM ────────────────
-- Nothing reads these columns on a cron. A salesperson logs a follow-up by
-- tapping "Log follow-up" on the lead's detail page (api/leads.py::log_follow_up);
-- that is the only writer besides the new->contacted auto-reset. No WhatsApp
-- nudge, no Celery beat entry — do not assume one exists when reading this later.
-- ════════════════════════════════════════════════════════════════════════════

alter table leads
    add column if not exists follow_ups_remaining int not null default 0
        check (follow_ups_remaining >= 0),
    add column if not exists last_contacted_at timestamptz;

-- No new index: both columns ride the existing per-lead fetch (get_lead/list_leads),
-- never filtered/sorted on independently in this feature. Add one only if a future
-- "leads with 0 follow-ups remaining" filter view is requested.
--
-- No RLS change: both columns are covered by the existing leads_select/leads_update
-- policies (table-level, not column-level), and writes go through the API's
-- service-role connection regardless (0047's own note: RLS does not run there at all).
