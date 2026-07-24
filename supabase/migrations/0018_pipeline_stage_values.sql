-- Topaz CRM — 0018 · pipeline_stage enum: add the Phase 2 granular stages
-- Postgres constraint: a value added to an enum CANNOT be used in the same
-- transaction that added it. Supabase wraps each migration file in one transaction,
-- so the ADD VALUEs live HERE alone; the data migration that USES them is a
-- SEPARATE file (0019). Do not merge these two files.
-- ════════════════════════════════════════════════════════════════════════════

alter type pipeline_stage add value if not exists 'inquiry';
alter type pipeline_stage add value if not exists 'contacted';
alter type pipeline_stage add value if not exists 'visit_scheduled';
alter type pipeline_stage add value if not exists 'walk_in';
alter type pipeline_stage add value if not exists 'design_discussion';
alter type pipeline_stage add value if not exists 'quotation_sent';
alter type pipeline_stage add value if not exists 'negotiation';
alter type pipeline_stage add value if not exists 'order_confirmed';

-- Legacy values 'new'/'talking'/'follow_up'/'won'/'lost' remain in the type
-- (Postgres cannot drop enum values). 0019 migrates existing rows off the first
-- four; 'lost' stays as-is. Application code is updated to the new vocabulary.
