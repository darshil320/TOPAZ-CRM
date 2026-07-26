-- Topaz CRM — 0025 · polymorphic media registry (Phase 2B)
-- One row per uploaded image. The bytes live in the PRIVATE Supabase Storage
-- 'media' bucket; this table records the key, lifecycle and provenance. Same trust
-- model as documents (0017): the key alone is inert, the bucket policy gates bytes.
--
-- ─── DPDPA ───────────────────────────────────────────────────────────────────
-- Face crops, visit photos and embeddings MUST NEVER enter the 'media' bucket —
-- they stay in 'face-crops' behind the face_tracking consent gate (0004). Do not
-- "consolidate the image buckets".
-- entity_type='customer' media is personal data: the API gates sign-upload on
-- active personal_data consent (api/media.py). Consent WITHDRAWAL does not yet
-- purge these Storage objects — tracked in CLAUDE.md "Known gaps". A DB cascade is
-- deliberately NOT added: SQL cannot delete Storage objects, and deleting the row
-- destroys the only record of the key, making the object permanently unpurgeable.
-- The correct shape is app-layer (list keys → storage.remove() → delete rows).
--
-- ─── NO storage.* DDL IN THIS FILE ───────────────────────────────────────────
-- scripts/pgtest.sh applies every migration to a bare PG15 cluster that shims only
-- `auth` + the three roles — a `create policy on storage.objects` here would break
-- the entire empirical harness. Bucket creation + object policies are an OPS step:
-- see supabase/storage/0025_media_policies.sql.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists media (
    id          uuid primary key default gen_random_uuid(),
    entity_type text not null check (entity_type in
                    ('customer', 'order', 'order_item', 'production_event', 'delivery')),
    entity_id   uuid not null,             -- NO FK: polymorphic, validated API-side
    kind        text not null check (kind in
                    ('reference', 'drawing', 'site', 'production', 'finished', 'delivery')),
    -- A 'site' photo is the inside of somebody's home — the most sensitive image
    -- this table can hold. Both protection boundaries (the media_select policy
    -- below and the bucket read policy, which can only see the FIRST PATH SEGMENT
    -- of the key) discriminate on entity_type, so a site photo filed against an
    -- order would sit outside both. Pin it to the customer entity, and the key
    -- layout `customer/{id}/…` then matches the protection boundary exactly.
    constraint media_site_is_customer_scoped check (
        kind <> 'site' or entity_type = 'customer'),
    storage_key text not null unique,      -- '{entity_type}/{entity_id}/{id}.{ext}'
    thumb_key   text,
    mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
    bytes       int check (bytes is null or bytes > 0),
    -- Lifecycle. sign-upload creates 'pending'; complete flips it to 'ready'.
    -- Without this a never-uploaded row is indistinguishable from a real one and the
    -- gallery renders a broken tile. 'failed' rows are GC targets (module 13).
    status      text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
    created_by  uuid references salespersons(id),
    created_at  timestamptz not null default now(),
    uploaded_at timestamptz
);

-- Gallery: an entity's media, newest first (11 Photos tab, 10 history accordion).
create index if not exists media_entity_idx
    on media (entity_type, entity_id, created_at desc);

-- GC of abandoned signed uploads (bytes that never arrived).
create index if not exists media_pending_idx
    on media (created_at) where status = 'pending';

-- ─── Deferred FK from 0024: production_events.media_id ───────────────────────
-- ON DELETE RESTRICT, NOT SET NULL: 'set null' would UPDATE production_events,
-- which forbid_production_event_mutation() blocks — the delete would fail with a
-- confusing immutability error. RESTRICT states the real rule: evidence attached to
-- a stage event cannot be deleted.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'production_events_media_id_fkey'
          and conrelid = 'production_events'::regclass   -- names are per-table, not global
    ) then
        alter table production_events
            add constraint production_events_media_id_fkey
            foreign key (media_id) references media(id) on delete restrict;
    end if;
end $$;

create index if not exists production_events_media_idx
    on production_events (media_id) where media_id is not null;

-- ─── RLS mirrors documents (0017): staff read the registry, service role writes.
-- No insert/update/delete grant — every write goes through api/media.py, which is
-- the authz boundary (the service-role connection bypasses RLS anyway).
-- Customer-entity media (site/reference photos of a customer's home) is personal
-- data: production and delivery roles have no business reason for it. Because
-- media_site_is_customer_scoped (above) pins every 'site' photo to the customer
-- entity, testing entity_type alone is sufficient AND is the only thing the bucket
-- read policy can also test — the two stay in lockstep by construction.
--
-- DELIBERATE: non-customer media is readable by every authenticated staff member,
-- not scoped per-assignment. Same call as documents_select (0017), which is broader
-- still (receipts and quotes carry money; these are photos of furniture). Module 13
-- may tighten if the pilot shows a reason.
alter table media enable row level security;
grant select on media to authenticated;

create policy media_select on media for select to authenticated
    using (entity_type <> 'customer'
        or not is_role(array['workshop_manager', 'delivery']));
