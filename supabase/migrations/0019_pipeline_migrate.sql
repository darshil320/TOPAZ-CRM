-- Topaz CRM — 0019 · migrate existing pipeline_stages rows to the new vocabulary
-- Runs AFTER 0018 (separate transaction — the new enum values must be committed
-- before they can be used here). Mapping (spec):
--   new       -> inquiry
--   talking   -> design_discussion
--   follow_up -> negotiation
--   won       -> order_confirmed
--   lost      -> (unchanged)
-- Destructive on live data — apply to staging first, prod only after a verified
-- backup/PITR (see EXECUTION_PLAN §0.2 / §8). Application code (dashboard analytics,
-- StageSelect, owner board, generated types) is updated in the same change.
-- ════════════════════════════════════════════════════════════════════════════

update pipeline_stages set stage = 'inquiry'           where stage = 'new';
update pipeline_stages set stage = 'design_discussion' where stage = 'talking';
update pipeline_stages set stage = 'negotiation'       where stage = 'follow_up';
update pipeline_stages set stage = 'order_confirmed'   where stage = 'won';

-- New rows default to the first real stage of the funnel.
alter table pipeline_stages alter column stage set default 'inquiry';
