-- Topaz CRM — 0007 · unclaimed walk-in queue (salesperson self-claim discovery)
--
-- claim_customer() (0004) lets any active salesperson claim a customer as
-- primary via an atomic "first tap wins" race, but the customers/visits SELECT
-- policies (0005) only ever exposed rows the caller was ALREADY assigned to
-- (or the owner, who sees everything). That left claim_customer() with no
-- queue to claim from: a brand-new NEW/UNCERTAIN walk-in was invisible to
-- every non-owner salesperson until the owner manually inserted the
-- assignment row by hand.
--
-- This adds a second PERMISSIVE select policy per table (Postgres OR's
-- multiple permissive policies for the same command together), so any
-- active salesperson can additionally see customers/visits that have no
-- active primary assignment yet. It does not touch or weaken the existing
-- cust_select / visits_select policies.
--
-- The "does this customer already have a primary" check MUST run as a
-- SECURITY DEFINER function, not inline SQL in the policy: inline SQL runs
-- as the calling role, so a plain `not exists (select ... from
-- customer_assignments ...)` is itself filtered by customer_assignments'
-- own RLS (ca_select) — which hides other salespeople's assignment rows —
-- and would make every already-claimed customer look "unclaimed" to anyone
-- not on that assignment. Caught by apps/api/tests/test_rls.py before this
-- ever reached prod: test_unrelated_sp_is_blind_to_customer failed with sp2
-- suddenly able to see sp1's assigned CUST1.

create or replace function customer_has_active_primary(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from customer_assignments ca
        where ca.customer_id = p_customer_id
          and ca.role = 'primary'
          and ca.active = true
    );
$$;

create policy cust_select_unclaimed on customers for select to authenticated
    using (
        current_salesperson_id() is not null
        and not customer_has_active_primary(customers.id)
    );

create policy visits_select_unclaimed on visits for select to authenticated
    using (
        visits.customer_id is not null
        and current_salesperson_id() is not null
        and not customer_has_active_primary(visits.customer_id)
    );
