-- Topaz CRM — 0044 · make the hot-path RLS policies cost O(1) function calls, not O(rows)
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THIS MIGRATION MUST NOT CHANGE WHO CAN SEE WHAT. It is a planner-shape change.
-- Every rewritten expression below is logically identical to the one it replaces;
-- the reasoning for each is spelled out because "it looked equivalent" is not good
-- enough on an authorization boundary. The RLS suites (tests/test_rls.py,
-- tests/test_rls_phase2a.py) are the check, and they are unchanged by design — if any
-- of them go red, this migration is wrong, not the test.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ─── The problem ─────────────────────────────────────────────────────────────
-- `is_owner()`, `is_role(...)` and `is_assigned_to_customer(...)` are STABLE
-- SECURITY DEFINER functions. Two consequences the original policies did not account
-- for:
--
--   1. A SECURITY DEFINER SQL function is NEVER inlined by the planner (nor is one
--      with a `SET search_path`), so each is an opaque call.
--   2. A STABLE function is not memoised across rows. Postgres only evaluates one
--      once per statement if it can hoist it into an InitPlan — and it does that for
--      a scalar SUBQUERY, not for a bare function call in a qualifier.
--
-- So `using (is_owner() or is_assigned_to_customer(customer_id))` executed
-- `is_owner()` — a `salespersons` lookup — once PER CANDIDATE ROW, and then
-- `is_assigned_to_customer()` per row too, which internally calls
-- `current_salesperson_id()` (another `salespersons` lookup) and probes
-- `customer_assignments`. Four nested calls and up to three index lookups per row of
-- every list the dashboard renders, most of it recomputing the same answer.
--
-- ─── The fix ─────────────────────────────────────────────────────────────────
--   * `is_owner()`            → `(select is_owner())`
--   * `is_role(array[...])`   → `(select is_role(array[...]))`
--     Wrapping an uncorrelated STABLE call in a scalar subquery is what lets the
--     planner hoist it to an InitPlan: evaluated ONCE per statement, then reused.
--     Identical result — both are the same function on the same (constant) input,
--     with no side effects and no dependence on the row.
--   * `is_assigned_to_customer(col)` → `col in (select my_assigned_customer_ids())`
--     The set of customers the caller is assigned to does not depend on the row
--     either, so as an uncorrelated subquery it becomes one InitPlan the executor
--     hashes and probes per row.
--
-- ─── Why the `in (...)` rewrite is equivalent ────────────────────────────────
-- `is_assigned_to_customer(X)` is, by its 0004 definition:
--     exists (select 1 from customer_assignments
--             where customer_id = X and salesperson_id = current_salesperson_id()
--               and active = true)
-- `X in (select my_assigned_customer_ids())` tests X for membership of exactly that
-- set — same table, same `active = true`, same `current_salesperson_id()`.
--
-- The one behavioural difference is NULL: `is_assigned_to_customer(NULL)` returns
-- FALSE, while `NULL in (non-empty set)` evaluates to NULL. RLS treats NULL as "does
-- not pass" exactly as it treats FALSE, so no row's visibility changes. None of the
-- rewritten expressions negate the test (there is no `not is_assigned_to_customer`
-- anywhere in this schema), which is the case where NULL-vs-FALSE would diverge.
-- Where the original guarded the NULL itself (`visits`, `alerts`:
-- `customer_id is not null and ...`) that guard is kept verbatim.
--
-- ─── Scope ───────────────────────────────────────────────────────────────────
-- Only the tables the dashboard SCANS: the customer/quote/order/payment read
-- surface. The workshop, routing, stage-plan, transfer and delivery policies are
-- deliberately untouched — they are read by primary key, so per-row cost is not the
-- bottleneck, and `deliveries`/`delivery_items` policies are being rewritten anyway
-- by the pending 0041/0042. `is_assigned_to_customer()` therefore STAYS, unchanged
-- and still used by those policies.
--
-- ALTER POLICY, not drop-and-create: it swaps the expression in place inside this
-- transaction, so there is never an instant where a table is readable without one.

-- ─── The caller's assigned-customer set, as a hoistable set-returning function ──
-- Deliberately parameterless: an uncorrelated call is the whole point — a function
-- taking the row's customer_id could not be hoisted and we would be back where we
-- started. SECURITY DEFINER + `set search_path` for the same reason 0004's helpers
-- are: it reads `customer_assignments` regardless of that table's own RLS, and must
-- not be resolvable to a shadowed relation.
create or replace function my_assigned_customer_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
    select customer_id from customer_assignments
    where salesperson_id = current_salesperson_id() and active = true
$$;

comment on function my_assigned_customer_ids() is
    'RLS helper: the customer ids the current user is primary or collaborator on. '
    'Parameterless so `col in (select my_assigned_customer_ids())` hoists to one '
    'InitPlan per statement instead of a function call per row (0044). Same set as '
    'is_assigned_to_customer() tests membership of.';

-- Stricter than 0004's helpers, which rely on the default PUBLIC EXECUTE: this is a
-- SECURITY DEFINER function that reads `customer_assignments` past its RLS, so only
-- the roles that actually evaluate these policies get it. `anon` is left out
-- deliberately and safely — every policy below is `to authenticated`, so anon never
-- evaluates one, and the function is scoped to the caller's own identity anyway
-- (no auth.uid() ⇒ empty set).
revoke all on function my_assigned_customer_ids() from public;
grant execute on function my_assigned_customer_ids() to authenticated, service_role;

-- ═══ 0005 · customers, visits, assignments, thread, pipeline, notes ═══════════

alter policy cust_select on customers
    using ((select is_owner()) or id in (select my_assigned_customer_ids()));
-- An INSERT check runs once per inserted row, so this one is not a hot path; hoisted
-- anyway so every policy on a rewritten table reads the same way. A file where some
-- `is_owner()` calls are wrapped and others are not invites the next reader to assume
-- the difference is meaningful.
alter policy cust_owner_insert on customers
    with check ((select is_owner()));
alter policy cust_update on customers
    using ((select is_owner()) or id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or id in (select my_assigned_customer_ids()));

-- The `customer_id is not null` guard is load-bearing and kept: an anonymous visit
-- has no customer, and only the owner may see it.
alter policy visits_select on visits
    using ((select is_owner())
        or (customer_id is not null and customer_id in (select my_assigned_customer_ids())));

-- `salesperson_id = current_salesperson_id()` is a per-row COLUMN comparison, so the
-- function is the hoistable half — wrapped, the column left alone.
alter policy ca_select on customer_assignments
    using ((select is_owner())
        or salesperson_id = (select current_salesperson_id())
        or customer_id in (select my_assigned_customer_ids()));
alter policy ca_insert on customer_assignments
    with check ((select is_owner()));
alter policy ca_update on customer_assignments
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or salesperson_id = (select current_salesperson_id()));

alter policy consent_select on consents
    using ((select is_owner()) or exists (
        select 1 from customers c
        where c.consent_id = consents.id
          and c.id in (select my_assigned_customer_ids())));
alter policy consent_owner_update on consents
    using ((select is_owner())) with check ((select is_owner()));

alter policy conv_select on conversations
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy conv_insert on conversations
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy conv_update on conversations
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));

alter policy pipe_select on pipeline_stages
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy pipe_insert on pipeline_stages
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy pipe_update on pipeline_stages
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));

-- The single highest-frequency read in the system (0003's own words).
alter policy msg_select on messages
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy msg_insert on messages
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));
alter policy msg_update on messages
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));

alter policy fu_select on followups
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));

alter policy audit_owner_select on audit_log using ((select is_owner()));

-- ═══ 0010 · alerts ════════════════════════════════════════════════════════════

alter policy alerts_select on alerts
    using ((select is_owner())
        or (customer_id is not null and customer_id in (select my_assigned_customer_ids())));
alter policy alerts_update on alerts
    using ((select is_owner()) or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or customer_id in (select my_assigned_customer_ids()));

-- ═══ 0014 · quotations + items ════════════════════════════════════════════════

alter policy q_select on quotations
    using ((select is_owner()) or (select is_role(array['admin', 'accounts']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy q_insert on quotations
    with check ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy q_update on quotations
    using ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy q_delete on quotations
    using ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()));

-- Items still inherit the parent quotation's visibility; only the hoistable parts of
-- the inner predicate change. `q.id = quotation_id` stays the correlation.
alter policy qi_select on quotation_items
    using (exists (select 1 from quotations q where q.id = quotation_id
        and ((select is_owner()) or (select is_role(array['admin', 'accounts']))
             or q.customer_id in (select my_assigned_customer_ids()))));
alter policy qi_write on quotation_items
    using (exists (select 1 from quotations q where q.id = quotation_id
        and ((select is_owner()) or (select is_role(array['admin']))
             or q.customer_id in (select my_assigned_customer_ids()))))
    with check (exists (select 1 from quotations q where q.id = quotation_id
        and ((select is_owner()) or (select is_role(array['admin']))
             or q.customer_id in (select my_assigned_customer_ids()))));

-- ═══ 0015 · orders + items ════════════════════════════════════════════════════

alter policy o_select on orders
    using ((select is_owner()) or (select is_role(array['admin', 'accounts']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy o_insert on orders
    with check ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy o_update on orders
    using ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()))
    with check ((select is_owner()) or (select is_role(array['admin']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy o_delete on orders
    using ((select is_owner()) or (select is_role(array['admin'])));

alter policy oi_select on order_items
    using (exists (select 1 from orders o where o.id = order_id
        and ((select is_owner()) or (select is_role(array['admin', 'accounts']))
             or o.customer_id in (select my_assigned_customer_ids()))));
alter policy oi_write on order_items
    using (exists (select 1 from orders o where o.id = order_id
        and ((select is_owner()) or (select is_role(array['admin']))
             or o.customer_id in (select my_assigned_customer_ids()))))
    with check (exists (select 1 from orders o where o.id = order_id
        and ((select is_owner()) or (select is_role(array['admin']))
             or o.customer_id in (select my_assigned_customer_ids()))));

-- ═══ 0016 · payments + schedules ══════════════════════════════════════════════
-- These carry the `order_outstanding` view too: it is security_invoker, so it is
-- these policies that run when the dashboard reads a balance.

alter policy pay_select on payments
    using ((select is_owner()) or (select is_role(array['admin', 'accounts']))
        or customer_id in (select my_assigned_customer_ids()));
alter policy pay_insert on payments
    with check ((select is_owner()) or (select is_role(array['admin', 'accounts'])));

alter policy sched_select on payment_schedules
    using ((select is_owner()) or (select is_role(array['admin', 'accounts']))
        or exists (select 1 from orders o where o.id = order_id
                   and o.customer_id in (select my_assigned_customer_ids())));
alter policy sched_write on payment_schedules
    using ((select is_owner()) or (select is_role(array['admin', 'accounts'])))
    with check ((select is_owner()) or (select is_role(array['admin', 'accounts'])));
