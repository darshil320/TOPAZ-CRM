-- Topaz CRM — 0033 · deliveries write path
--
-- 0031 dropped 0026's `with check (true)` write policies and granted SELECT only,
-- on the plan that delivery writes would route through a service-role FastAPI
-- module the way the transfer app does. That module was never built, so since
-- 0031 the dashboard cannot schedule a delivery at all:
--
--     new row violates row-level security policy for table "deliveries"
--
-- and the driver PWA's "mark delivered" silently no-ops (its UPDATE matches no
-- policy, and the action never checked the error).
--
-- This migration takes the other route — scoped RLS writes from the browser,
-- exactly like `orders`/`quotations`/`payments` already do — rather than leaving
-- the feature dead until an API module exists. The scoping is the same
-- vocabulary used everywhere else: is_owner() / is_role() / assignment / the
-- driver themselves. Nothing here is `true`.
--
-- Order-status propagation and the audit row deliberately do NOT move to the
-- client: a driver has no UPDATE policy on `orders` and no INSERT grant on
-- `audit_log`, and widening either for a delivery would hand the delivery role
-- write access to the whole sales pipeline. A SECURITY DEFINER trigger performs
-- both, so the privilege lives in one auditable place.
-- ════════════════════════════════════════════════════════════════════════════

grant insert, update on deliveries     to authenticated;
grant insert         on delivery_items to authenticated;

-- ─── deliveries: INSERT ──────────────────────────────────────────────────────
-- Scheduling a delivery is a sales/back-office act: owner, admin, or a
-- salesperson assigned to the order's customer. A driver cannot invent a run
-- for themselves.
drop policy if exists deliveries_insert on deliveries;
create policy deliveries_insert on deliveries for insert to authenticated
    with check (is_owner() or is_role(array['admin'])
        or exists (select 1 from orders o
                    where o.id = order_id and is_assigned_to_customer(o.customer_id)));

-- ─── deliveries: UPDATE ──────────────────────────────────────────────────────
-- Same set, plus the assigned driver — completing the run is the driver's whole
-- job. WITH CHECK repeats the predicate so a row cannot be updated INTO a state
-- (a different order, a different driver) the caller could not have created.
drop policy if exists deliveries_update on deliveries;
create policy deliveries_update on deliveries for update to authenticated
    using (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or exists (select 1 from orders o
                    where o.id = deliveries.order_id and is_assigned_to_customer(o.customer_id)))
    with check (is_owner() or is_role(array['admin'])
        or driver_salesperson_id = current_salesperson_id()
        or exists (select 1 from orders o
                    where o.id = deliveries.order_id and is_assigned_to_customer(o.customer_id)));

-- ─── delivery_items: INSERT ──────────────────────────────────────────────────
-- Inherits the parent delivery's writability, mirroring delivery_items_select.
drop policy if exists delivery_items_insert on delivery_items;
create policy delivery_items_insert on delivery_items for insert to authenticated
    with check (exists (select 1 from deliveries d
        where d.id = delivery_id
          and (is_owner() or is_role(array['admin'])
               or d.driver_salesperson_id = current_salesperson_id()
               or exists (select 1 from orders o
                           where o.id = d.order_id and is_assigned_to_customer(o.customer_id)))));

-- ─── delivery completion ⇒ order status + audit ──────────────────────────────
-- Fires only on the scheduled → delivered edge. Terminal order states are left
-- alone: a cancelled or already-closed order must not be dragged backwards by a
-- late tap on a phone that was offline.
create or replace function on_delivery_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.status = 'delivered' and coalesce(old.status, '') <> 'delivered' then
        update orders
           set status = 'delivered', updated_at = now()
         where id = new.order_id
           and status not in ('delivered', 'installed', 'closed', 'cancelled');

        insert into audit_log (entity, entity_id, action, actor, payload)
        values ('orders', new.order_id, 'delivered',
                coalesce(current_salesperson_id()::text, 'system'),
                jsonb_build_object('delivery_id', new.id, 'notes', new.notes));
    end if;
    return new;
end;
$$;

comment on function on_delivery_completed() is
    'Propagates a completed delivery to orders.status and writes the audit row. '
    'SECURITY DEFINER because the delivery role has neither privilege directly.';

drop trigger if exists deliveries_completed on deliveries;
create trigger deliveries_completed
    after update of status on deliveries for each row
    execute function on_delivery_completed();
