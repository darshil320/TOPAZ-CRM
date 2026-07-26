-- Topaz CRM — 'media' bucket policies (Phase 2B, module 08) — OPS-APPLIED
--
-- THIS FILE IS NOT A MIGRATION and must never be moved into supabase/migrations/.
-- scripts/pgtest.sh applies every migration to a bare PG15 cluster that shims only
-- the `auth` schema and the anon/authenticated/service_role roles — there is no
-- `storage` schema there, so storage DDL in a migration breaks the whole empirical
-- harness. Apply this by hand in the Supabase SQL editor, per environment, right
-- after creating the bucket.
--
-- ─── Step 1 (dashboard, not SQL): create the bucket ──────────────────────────
--   Storage → New bucket → name: media → Public: OFF (private, like `documents`
--   and `face-crops`). Verify with:
--       select id, public from storage.buckets where id = 'media';
--   Expected: public = false. A public bucket is a DPDPA incident.
--
-- ─── Step 2: object read policy ──────────────────────────────────────────────
-- Key layout (set by services/media_keys.py — the policy depends on it):
--     media/{entity_type}/{entity_id}/{media_id}.{ext}
--     media/{entity_type}/{entity_id}/{media_id}_thumb.jpg
--
-- SELECT only. Uploads use service-role-signed upload URLs, so the browser never
-- needs INSERT on storage.objects — that is the entire point of
-- POST /api/media/sign-upload. No UPDATE/DELETE for authenticated: GC is
-- service-role. This mirrors the `media_select` row policy (migration 0025) so the
-- metadata and the bytes can never disagree about who may see customer media.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists media_objects_read on storage.objects;

create policy media_objects_read on storage.objects for select to authenticated
    using (
        bucket_id = 'media'
        and ((storage.foldername(name))[1] <> 'customer'
             or not public.is_role(array['workshop_manager', 'delivery']))
    );

-- ─── Verification ────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and policyname like 'media%';
-- Expected: exactly one row, cmd = SELECT.
