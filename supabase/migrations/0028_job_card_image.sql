-- Topaz CRM — 0028 · job cards as IMAGES
--
-- A job card sent as a JPEG opens INLINE in WhatsApp: no PDF viewer, no download,
-- no taps. That is decisive for the audience this document exists for — a workshop
-- manager on a mid-range Android, which is the same constraint that shapes the
-- whole module 10 PWA. The PDF stays available for filing and printing; both render
-- from the SAME HTML template, so the two can never drift.
--
-- A multi-item card becomes several images (one tall JPEG of 15 rows is an
-- unreadable ribbon once WhatsApp recompresses it), so ONE render can file several
-- `documents` rows sharing a version — page order comes from the storage key
-- suffix. `latest_storage_keys()` reads them back as a set.
-- ════════════════════════════════════════════════════════════════════════════

alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check
    check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf',
                    'job_card_pdf', 'job_card_image'));

-- Reading back one render's pages is (entity, kind, version) ordered by key.
create index if not exists documents_entity_kind_version_idx
    on documents (entity_type, entity_id, kind, version desc);
