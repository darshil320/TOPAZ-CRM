-- Topaz CRM — swap the production stage labels once the client confirms wording.
--
-- Stage LABELS ARE DATA, not code: nothing in the application reads label_gu except
-- as a display string, so confirming the Gujarati wording with Hemant is a 30-second
-- UPDATE in the Supabase SQL editor — never a migration, never a deploy.
-- (The same applies to photo_required: see the block at the bottom.)
--
-- The codes and their sort order ARE fixed (PRD) — do not change those here.
-- Run against staging first, then prod. Idempotent: re-running is harmless.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Gujarati labels. Replace the right-hand values with the client-confirmed text.
update production_stage_defs set label_gu = 'ડિઝાઇન મંજૂર'    where code = 'design_approved';
update production_stage_defs set label_gu = 'સામગ્રી ખરીદી'   where code = 'material_procurement';
update production_stage_defs set label_gu = 'કટિંગ'           where code = 'cutting';
update production_stage_defs set label_gu = 'ફ્રેમ કામ'        where code = 'frame_work';
update production_stage_defs set label_gu = 'એસેમ્બલી'         where code = 'assembly';
update production_stage_defs set label_gu = 'અપહોલ્સ્ટરી'       where code = 'upholstery';
update production_stage_defs set label_gu = 'પોલિશિંગ'         where code = 'polishing';
update production_stage_defs set label_gu = 'ફિનિશિંગ'         where code = 'finishing';
update production_stage_defs set label_gu = 'ગુણવત્તા તપાસ'    where code = 'quality_inspection';
update production_stage_defs set label_gu = 'પેકિંગ'           where code = 'packing';
update production_stage_defs set label_gu = 'ડિસ્પેચ'          where code = 'dispatch';

-- 2) English labels, if the client words a stage differently on the shop floor.
-- update production_stage_defs set label_en = '...' where code = '...';

-- 3) Photo policy. Retune after the pilot (module 13) with the SAME kind of UPDATE.
-- Current: frame_work, finishing, quality_inspection, dispatch require a photo
-- (rationale in 0024_production.sql). NOTE: module 12's `production_completed`
-- template carries an IMAGE header sourced from the `finishing` stage photo —
-- clearing photo_required on 'finishing' will degrade that message to text.
-- update production_stage_defs set photo_required = true  where code = 'upholstery';
-- update production_stage_defs set photo_required = false where code = 'dispatch';

-- Verify:
--   select sort, code, label_en, label_gu, photo_required, active
--     from production_stage_defs order by sort;
