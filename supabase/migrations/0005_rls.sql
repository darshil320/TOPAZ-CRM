-- Topaz CRM — 0005 · Row-Level Security (the primary data boundary, §19-B/H)
-- Depends on 0004 (helper functions). The Next.js client reads Supabase directly,
-- so THESE POLICIES ARE THE SECURITY BOUNDARY. The service role (FastAPI/Celery)
-- bypasses RLS by design. RLS is enabled on EVERY table — a table with RLS off is
-- wide open to the anon/authenticated API keys (security CRITICAL-4).
-- The release-blocking test suite (0006 + tests/) proves these policies.

alter table salespersons         enable row level security;
alter table consents             enable row level security;
alter table customers            enable row level security;
alter table face_embeddings      enable row level security;
alter table visits               enable row level security;
alter table customer_assignments enable row level security;
alter table coverage_requests    enable row level security;
alter table conversations        enable row level security;
alter table pipeline_stages      enable row level security;
alter table messages             enable row level security;
alter table followups            enable row level security;
alter table audit_log            enable row level security;

-- PostgreSQL privileges are checked before RLS policies. Grant only the base
-- operations each Supabase browser role is allowed to attempt; the policies
-- below remain the row-level security boundary.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on salespersons to authenticated;
grant select, insert, update on consents to authenticated;
grant select, insert, update on customers to authenticated;
grant select on face_embeddings to authenticated;
grant select on visits to authenticated;
grant select, insert, update on customer_assignments to authenticated;
grant select, insert, update on coverage_requests to authenticated;
grant select, insert, update on conversations to authenticated;
grant select, insert, update on pipeline_stages to authenticated;
grant select, insert, update on messages to authenticated;
grant select on followups to authenticated;
grant select, update on audit_log to authenticated;

grant insert on consents to anon;
grant select (id) on consents to anon;
grant select on customers to anon;

-- ─── salespersons ────────────────────────────────────────────────────────────
-- See your own row; owner sees all. Owner manages staff. (auth_uid linking on
-- first login is done by the backend via the service role.)
create policy sp_select_self_or_owner on salespersons for select to authenticated
    using (auth_uid = (select auth.uid()) or is_owner());
create policy sp_owner_manage on salespersons for all to authenticated
    using (is_owner()) with check (is_owner());

-- ─── consents ────────────────────────────────────────────────────────────────
-- Kiosk (anon) and staff may CREATE consent; only the owner may read/update
-- (withdrawal). Embeddings/consents are never browsable by salespersons.
create policy consent_anon_insert on consents for insert to anon          with check (true);
-- Allows anon INSERT ... RETURNING id for the consent kiosk. Column privileges
-- above limit anon reads to consents.id; consent choices/details remain hidden.
create policy consent_anon_return_inserted_id on consents for select to anon
    using (true);
create policy consent_auth_insert on consents for insert to authenticated with check (true);
-- Owner reads all; an assigned salesperson may read the consent of their OWN
-- customer (to show consent status in the UI) — database-review HIGH-4.
create policy consent_select on consents for select to authenticated
    using (is_owner() or exists (
        select 1 from customers c
        where c.consent_id = consents.id and is_assigned_to_customer(c.id)));
create policy consent_owner_update on consents for update to authenticated using (is_owner()) with check (is_owner());

-- ─── customers ───────────────────────────────────────────────────────────────
-- Assigned salespersons (primary or collaborator) + owner. Owner creates.
-- The owner-only AI toggles are additionally guarded by a trigger in 0004.
create policy cust_select on customers for select to authenticated
    using (is_owner() or is_assigned_to_customer(id));
create policy cust_owner_insert on customers for insert to authenticated
    with check (is_owner());
create policy cust_update on customers for update to authenticated
    using (is_owner() or is_assigned_to_customer(id))
    with check (is_owner() or is_assigned_to_customer(id));

-- ─── face_embeddings ─────────────────────────────────────────────────────────
-- RLS enabled, NO policies for anon/authenticated ⇒ zero access to biometric
-- data from the browser. Only the service role (recognition pipeline) touches it.

-- ─── visits ──────────────────────────────────────────────────────────────────
-- Read visits for your assigned customers; owner sees all (incl. anonymous).
-- Writes are service-role only (the recognition pipeline).
create policy visits_select on visits for select to authenticated
    using (is_owner() or (customer_id is not null and is_assigned_to_customer(customer_id)));

-- ─── customer_assignments ──────────────────────────────────────────────────
-- See your own assignments, co-assignees on your customers, or all (owner).
-- Claim/handoff INSERT/UPDATE: as yourself, or an existing assignee, or owner.
create policy ca_select on customer_assignments for select to authenticated
    using (is_owner()
        or salesperson_id = current_salesperson_id()
        or is_assigned_to_customer(customer_id));
-- Direct INSERT is owner-only. Salespersons claim via claim_customer() (SECURITY
-- DEFINER); collaborator-add + handoff go through the backend/service role (§19-A.2/G).
-- Closes the self-assign-to-any-customer hole (database-review CRITICAL-1).
create policy ca_insert on customer_assignments for insert to authenticated
    with check (is_owner());
-- A non-owner may only modify their OWN assignment row (e.g. step back); they cannot
-- demote the primary or edit a teammate's row (database-review HIGH-2). Handoff = backend.
create policy ca_update on customer_assignments for update to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id))
    with check (is_owner() or salesperson_id = current_salesperson_id());

-- ─── coverage_requests ───────────────────────────────────────────────────────
-- Raise for your own customers; any teammate may claim an open request.
create policy cov_select on coverage_requests for select to authenticated
    using (is_owner()
        or requested_by = current_salesperson_id()
        or claimed_by = current_salesperson_id()
        or is_assigned_to_customer(customer_id));
create policy cov_insert on coverage_requests for insert to authenticated
    with check (is_owner() or requested_by = current_salesperson_id());
-- Any teammate may claim an OPEN request (set claimed_by = self); involved parties and
-- the owner may update theirs. Closes the "update any coverage row" hole (CRITICAL-2).
create policy cov_update on coverage_requests for update to authenticated
    using (is_owner() or status = 'open'
        or requested_by = current_salesperson_id()
        or claimed_by = current_salesperson_id())
    with check (is_owner()
        or claimed_by = current_salesperson_id()
        or requested_by = current_salesperson_id());

-- ─── conversations (meeting notes) ────────────────────────────────────────────
create policy conv_select on conversations for select to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id));
create policy conv_insert on conversations for insert to authenticated
    with check (is_owner() or is_assigned_to_customer(customer_id));
create policy conv_update on conversations for update to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_assigned_to_customer(customer_id));

-- ─── pipeline_stages ─────────────────────────────────────────────────────────
create policy pipe_select on pipeline_stages for select to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id));
-- Split from FOR ALL so SELECT isn't double-evaluated (database-review HIGH-5).
create policy pipe_insert on pipeline_stages for insert to authenticated
    with check (is_owner() or is_assigned_to_customer(customer_id));
create policy pipe_update on pipeline_stages for update to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_assigned_to_customer(customer_id));

-- ─── messages (shared thread) ────────────────────────────────────────────────
-- Assignees + owner can read/write the thread. (AI + inbound writes come from
-- the service role; this covers human sends and AI-draft approvals.)
create policy msg_select on messages for select to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id));
create policy msg_insert on messages for insert to authenticated
    with check (is_owner() or is_assigned_to_customer(customer_id));
create policy msg_update on messages for update to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id))
    with check (is_owner() or is_assigned_to_customer(customer_id));

-- ─── followups ───────────────────────────────────────────────────────────────
-- Read-only to staff; the backend schedules/sends via the service role.
create policy fu_select on followups for select to authenticated
    using (is_owner() or is_assigned_to_customer(customer_id));

-- ─── audit_log (append-only) ─────────────────────────────────────────────────
-- Owner may read. Writes come only from SECURITY DEFINER triggers and the service
-- role; authenticated has no insert/update/delete policy ⇒ no tampering (CRITICAL-4 #6).
create policy audit_owner_select on audit_log for select to authenticated
    using (is_owner());
