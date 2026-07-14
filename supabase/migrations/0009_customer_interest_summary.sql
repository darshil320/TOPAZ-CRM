-- Topaz CRM — 0009 · customer interest summary
-- A living free-text note of what the customer is looking for. Seeded at the
-- kiosk ("What are you looking for today?") and kept current by the owner or the
-- assigned salesperson on the dashboard — so a repeat arrival shows, at a glance,
-- what they wanted last time. Distinct from `conversations` (append-only per-visit
-- meeting notes) and from `primary_interest` (the short category tag).
-- Editable by owner + assigned salesperson via the existing cust_update policy;
-- NOT added to the owner-only guard trigger (it is operational sales info).
-- ════════════════════════════════════════════════════════════════════════════

alter table customers
    add column interest_summary text;

comment on column customers.interest_summary is
    'Living free-text summary of what the customer wants; seeded at kiosk, '
    'editable by owner + assigned salesperson. See conversations for per-visit notes.';
