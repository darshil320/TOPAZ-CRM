-- Topaz CRM — 0022 · one order per quotation (DB-level backstop)
-- create_from_quote is now idempotent in the repo, but that check can't cover a
-- concurrent double-submit (two requests both pass the "no existing order" read
-- before either inserts). A partial unique index makes the invariant absolute:
-- at most one order per quotation_id. Manual orders (quotation_id NULL) are
-- unaffected — NULLs are excluded from the index.
--
-- NOTE: any pre-existing duplicate orders for a single quote must be removed
-- before this migration, or index creation fails with a uniqueness violation.
-- ════════════════════════════════════════════════════════════════════════════
create unique index if not exists orders_quotation_id_uniq
    on orders (quotation_id)
    where quotation_id is not null;
