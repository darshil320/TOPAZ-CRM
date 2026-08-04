-- Topaz CRM — 0036 · which production stage a photo belongs to
--
-- The client's ask: "record which stage the photo was uploaded in." Today `media`
-- knows entity_type/entity_id/kind and nothing about the stage:
--
--   * a photo attached to a `done` event is recoverable the long way round
--     (production_events.media_id → production_events.stage_code), but only AFTER
--     the manager taps Done;
--   * a photo uploaded against entity_type='order_item' — which is exactly what the
--     PWA's CameraField does, BEFORE the tap (apps/dashboard .../usePhotoCapture) —
--     has no stage at all, and never gains one.
--
-- So the item's photo gallery is an undifferentiated pile: nobody can answer "show me
-- the frame work" without opening each image and guessing from the timestamps.
--
-- WHY A COLUMN AND NOT A JOIN: the link has to exist at UPLOAD time, before any event
-- row is written. There is nothing to join to yet. The API stamps it from the item's
-- SERVER-SIDE current_stage (api/media.py) — never from the client's value, because a
-- phone left open on a stale screen would file the photo under the wrong stage.
--
-- Nullable on purpose. A catalog photo, a customer site photo and a consignment
-- handover photo have no production stage, and inventing one would be a lie.
-- ════════════════════════════════════════════════════════════════════════════

alter table media
    add column if not exists stage_code text references production_stage_defs(code);

-- The gallery query this exists for: one item's photos, grouped by stage.
create index if not exists media_item_stage_idx
    on media (entity_id, stage_code)
    where entity_type = 'order_item';

-- ─── Backfill from the event stream ──────────────────────────────────────────
-- production_events is the ONLY place the photo→stage link exists today, so it is the
-- only honest source. Photos never attached to a `done` event stay NULL rather than
-- being guessed at from timestamps — a wrong stage label on a piece of evidence is
-- worse than an absent one.
update media m
   set stage_code = e.stage_code
  from production_events e
 where e.media_id = m.id
   and m.stage_code is null;
