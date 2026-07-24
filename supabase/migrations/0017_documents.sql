-- Topaz CRM — 0017 · documents registry (Phase 2A)
-- One row per generated PDF (quotation/receipt/invoice). The bytes live in the
-- private Supabase Storage 'documents' bucket; this table records the key + version.
-- Rows are written by the backend (service role) after a render task; the browser
-- only reads them to build signed-URL links.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    kind        text not null check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf')),
    entity_type text not null,               -- 'quotation' | 'order' | 'payment'
    entity_id   uuid not null,
    storage_key text not null,
    version     int not null default 1,
    created_at  timestamptz not null default now()
);

create index if not exists documents_entity_idx on documents (entity_type, entity_id);

-- ─── RLS: staff may read the registry (storage bytes stay behind private-bucket
-- signed URLs — the key alone is inert). Writes are service-role only (no grant).
alter table documents enable row level security;
grant select on documents to authenticated;

create policy documents_select on documents for select to authenticated
    using (true);
