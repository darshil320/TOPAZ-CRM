-- Topaz CRM — 'lead-audio' bucket policies — OPS-APPLIED
--
-- THIS FILE IS NOT A MIGRATION and must never be moved into supabase/migrations/.
-- scripts/pgtest.sh applies every migration to a bare PG15 cluster that shims only
-- the `auth` schema and the anon/authenticated/service_role roles — there is no
-- `storage` schema there, so storage DDL in a migration breaks the whole empirical
-- harness. Apply this by hand in the Supabase SQL editor, per environment, right
-- after creating the bucket. Mirrors supabase/storage/0025_media_policies.sql.
--
-- ─── Step 1 (dashboard, not SQL): create the bucket ──────────────────────────
--   Storage → New bucket → name: lead-audio → Public: OFF (private).
--   Verify with:
--       select id, public from storage.buckets where id = 'lead-audio';
--   Expected: public = false.
--
-- ─── Step 2: object read policy ──────────────────────────────────────────────
-- Key layout (set by services/lead_audio.py::build_key — the policy depends on it):
--     lead-audio/{lead_id}/{recording_id}.{ext}
--
-- SELECT only, no role carve-out (unlike media_objects_read's workshop/delivery
-- exclusion) — reads are open to every active salesperson here, matching the
-- lead_recordings_select row policy (0048): a lead's recordings are floor
-- knowledge, same as the lead's own fields. Uploads use service-role-signed
-- upload URLs, so the browser never needs INSERT on storage.objects. No
-- UPDATE/DELETE for authenticated either — GC is service-role only, and there is
-- no delete route (0048's header: a recording is evidence, never removed).
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists lead_audio_objects_read on storage.objects;

create policy lead_audio_objects_read on storage.objects for select to authenticated
    using (bucket_id = 'lead-audio');

-- ─── Verification ────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and policyname like 'lead_audio%';
-- Expected: exactly one row, cmd = SELECT.
