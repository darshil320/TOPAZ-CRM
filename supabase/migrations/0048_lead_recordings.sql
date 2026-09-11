-- Topaz CRM — 0048 · lead call-note recordings (audio)
-- One row per uploaded audio file, attached to a lead. The bytes live in the
-- PRIVATE Supabase Storage 'lead-audio' bucket; this table records the key,
-- lifecycle and provenance — same trust model as `media` (0025).
--
-- ─── WHY THIS IS NOT `media` ──────────────────────────────────────────────────
-- `media.mime`'s CHECK excludes every audio type, and `media.entity_type`'s CHECK
-- excludes 'lead'. Widening either would drag this feature into `media`'s DPDPA
-- consent-gating branch (services/media_entities.CONSENT_GATED_ENTITY_TYPES),
-- which does not apply here: a lead has no consent record at all until it is
-- converted (0046 header). A parallel table is the smaller, more honest change.
--
-- ─── WHY `on delete cascade`, EVEN THOUGH LEADS ARE NEVER DELETED ─────────────
-- 0046 has no delete policy on `leads` by design ("no delete policy ever" — a lead
-- is marked lost, never removed). Cascade is therefore inert in practice, but it
-- is the semantically correct FK action if that policy is ever revisited — a
-- recording orphaned by a deleted lead has no meaning to preserve, unlike
-- `leads.linked_customer_id` (ON DELETE SET NULL), which points at a person who
-- can separately withdraw consent and must be forgotten while the lead survives.
--
-- ─── NO DELETE ROUTE EITHER ────────────────────────────────────────────────────
-- Mirrors 0046's own reasoning: a recording is evidence of what was actually said
-- on a call. Deleting one destroys that record. If the business later wants
-- "retract a mis-filed recording," that is a follow-up with its own justification.
--
-- ─── NO storage.* DDL IN THIS FILE ────────────────────────────────────────────
-- scripts/pgtest.sh applies every migration to a bare PG15 cluster that shims only
-- `auth` + the three roles — a `create policy on storage.objects` here would break
-- the empirical harness. Bucket creation + object policy are an OPS step: see
-- supabase/storage/0048_lead_audio_policies.sql.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists lead_recordings (
    id               uuid primary key default gen_random_uuid(),
    lead_id          uuid not null references leads(id) on delete cascade,

    -- '{lead_id}/{id}.{ext}' — set by services/lead_audio.py::build_key.
    storage_key      text not null unique,
    mime             text not null check (mime in
                         ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav')),
    bytes            int check (bytes is null or bytes > 0),
    -- Never computed server-side (no ffprobe/decode step exists in this API) —
    -- always NULL in this phase. Column exists for a future client that already
    -- knows the duration to report; no client in this feature populates it.
    duration_seconds int check (duration_seconds is null or duration_seconds > 0),
    -- Optional caption ("follow-up call, wants delivery by Diwali") — makes a list
    -- of many recordings scannable without playing each one. Same free-text
    -- philosophy as leads.comments/requirement (0046 header).
    note             text,

    status           text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
    created_by       uuid references salespersons(id),
    created_at       timestamptz not null default now(),
    uploaded_at      timestamptz
);

-- The one query this table serves: "this lead's recordings, newest first".
create index if not exists lead_recordings_lead_idx
    on lead_recordings (lead_id, created_at desc);
-- Mirrors media_pending_idx — future GC target for abandoned signed uploads.
create index if not exists lead_recordings_pending_idx
    on lead_recordings (created_at) where status = 'pending';

alter table lead_recordings enable row level security;
grant select on lead_recordings to authenticated;

-- Open read, matching leads_select (0046: "the person who picks up the phone is
-- rarely the one who took the original enquiry" — the same argument applies to
-- hearing a prior call). No insert/update/delete policy — every write goes
-- through the API's service-role connection (api/lead_recordings.py).
create policy lead_recordings_select on lead_recordings for select to authenticated
    using (true);
