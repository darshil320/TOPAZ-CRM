-- Topaz CRM — 0051 · `telecaller` staff role
-- A telecaller works the whole enquiry list by phone: they may edit ANY lead's
-- fields (not just leads they captured), but may delete none — not even their own.
--
-- Additive: widens the role check only; existing rows stay valid.
--
-- leads_update (0047) is deliberately NOT widened. Every lead write goes through the
-- API (the dashboard only ever SELECTs `leads`), and the API is where the telecaller
-- rule lives — authz.assert_can_edit_lead / assert_can_delete_lead — behind a
-- LeadUpdate field whitelist that excludes created_by, status and the conversion
-- columns. A widened policy would add no app capability but would let a telecaller
-- PATCH any lead directly through PostgREST with their own JWT: re-point created_by
-- at a colleague (who can then delete it as "creator"), or set status/conversion
-- columns past the /status and /convert paths. Narrower RLS fails closed: through
-- PostgREST a telecaller can touch only leads they captured, like any salesperson.
-- ════════════════════════════════════════════════════════════════════════════

alter table salespersons drop constraint if exists salespersons_role_check;
alter table salespersons add constraint salespersons_role_check
    check (role in ('salesperson', 'owner', 'admin', 'accounts', 'workshop_manager',
                    'delivery', 'telecaller'));
