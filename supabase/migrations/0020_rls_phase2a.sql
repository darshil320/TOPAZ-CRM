-- Topaz CRM — 0020 · app_settings + Phase 2A RLS completion (module 06)
-- The quote/order/payment RLS policies already ship in 0014-0016. This migration
-- adds the app_settings key/value store (owner/admin-managed config: quote terms,
-- validity, schedule presets, receipt toggle) and asserts the role matrix is
-- complete — workshop_manager/delivery get NO access to money tables (default
-- deny: they appear in no policy's role list), which the RLS test suite proves.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists app_settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now()
);

create trigger app_settings_set_updated_at
    before update on app_settings for each row execute function set_updated_at();

-- ─── RLS: any staff may READ settings (the builder needs default terms/validity);
-- only owner/admin may WRITE (matrix, module 06).
alter table app_settings enable row level security;
grant select, insert, update, delete on app_settings to authenticated;

create policy app_settings_select on app_settings for select to authenticated
    using (true);
create policy app_settings_write on app_settings for all to authenticated
    using (is_owner() or is_role(array['admin']))
    with check (is_owner() or is_role(array['admin']));

-- Seed the defaults the app reads (idempotent). Values mirror config.py fallbacks;
-- an owner can edit them in the admin screen without a deploy.
insert into app_settings (key, value) values
    ('quote_terms', '"50% advance with order confirmation; balance before delivery. Delivery in 4-6 weeks. Prices inclusive of GST as shown."'::jsonb),
    ('quote_validity_days', '15'::jsonb),
    ('default_advance_pct', '50'::jsonb),
    ('send_receipts_to_customer', 'false'::jsonb),
    ('schedule_presets', '[{"label":"Advance","pct":50},{"label":"Before delivery","pct":40},{"label":"On installation","pct":10}]'::jsonb)
on conflict (key) do nothing;
