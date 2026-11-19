-- Topaz CRM — 0055 · the front desk manages the stock catalog
--
-- The front desk creates and edits products, sets stock, uploads catalog photos and
-- prints QR stickers (api/products.py, api/media.py — roles.PRODUCT_MANAGE). Two of
-- those writes are direct browser updates under RLS — the cover photo
-- (products.primary_media_id) and the active toggle — so products_insert/products_update
-- gain front_desk alongside owner-level and admin. Nothing else changes: other staff
-- still cannot write products, stock has no browser write path (0053), and admin still
-- cannot deactivate (refuse_admin_removal, 0052).
-- ════════════════════════════════════════════════════════════════════════════

alter policy products_insert on products
    with check ((select is_owner()) or (select is_role(array['admin', 'front_desk'])));
alter policy products_update on products
    using ((select is_owner()) or (select is_role(array['admin', 'front_desk'])))
    with check ((select is_owner()) or (select is_role(array['admin', 'front_desk'])));
