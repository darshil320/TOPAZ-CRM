-- Topaz CRM — 0027 · job cards (spec sheets) + catalog/line photos
-- (Renumbered from 0026: 0026_deliveries.sql claimed that slot. Two files sharing
--  a number is risk R2 in the register — the thing that already forced one repo-wide
--  renumber. Content unchanged.)
--
-- A JOB CARD is the visual spec sheet the showroom already produces by hand: client
-- name, order/delivery date, salesperson, then one row per item with size, photo,
-- product and a free-text detail block (marble detail, molding, base detail…).
-- Two audiences, ONE document:
--   * the customer, alongside the priced quotation PDF (which keeps the money);
--   * the workshop, as the production job card.
--
-- ─── THE JOB CARD CARRIES NO MONEY, EVER ─────────────────────────────────────
-- Not a rendering option, not a variant flag: there is no priced job card to pick
-- the wrong one of. That is what makes the identical file safe to hand a workshop,
-- and it satisfies the module 13 money-blind requirement instead of fighting it.
-- If a future change adds a price column to this document, it is a defect.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── documents gains the new kind ────────────────────────────────────────────
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check
    check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf', 'job_card_pdf'));

-- ─── media gains two entity types ────────────────────────────────────────────
-- 'product'        — the CATALOG photo. Uploaded once, reused by every quote and
--                    order line that references the product. This is what stops
--                    staff re-uploading the same sofa on every single quotation.
-- 'quotation_item' — a per-line override, so a custom one-off piece (most of what
--                    this showroom sells) still gets its own photo.
-- order_item already exists (0025) and plays the same override role order-side.
alter table media drop constraint if exists media_entity_type_check;
alter table media add constraint media_entity_type_check
    check (entity_type in ('customer', 'order', 'order_item', 'production_event',
                           'delivery', 'product', 'quotation_item'));

-- media_site_is_customer_scoped (0025) is untouched and still binds: a 'site' photo
-- cannot be filed against a product or a quotation line either.

-- ─── products: which catalog photo is THE one ────────────────────────────────
-- Nullable. When null the renderer falls back to the newest ready 'reference' media
-- for the product, so a photo uploaded without ever setting a primary still shows.
-- ON DELETE SET NULL: losing the pointer must never block deleting a media row.
alter table products
    add column if not exists primary_media_id uuid references media(id) on delete set null;

-- ─── free-text spec block ────────────────────────────────────────────────────
-- The structured columns (dimensions/material/fabric/polish/customization) cannot
-- hold the hand-written detail block verbatim — the real documents carry headed,
-- multi-line prose ('Marble Detail :- … Molding :- …'). The renderer prints the
-- structured fields as labelled lines and then appends this, so nothing is lost
-- and the structured data stays queryable.
alter table quotation_items add column if not exists spec_notes text;
alter table order_items     add column if not exists spec_notes text;

-- Photo lookup for a job card: one query per entity type, newest ready first.
-- media_entity_idx (0025) already covers (entity_type, entity_id, created_at desc).
