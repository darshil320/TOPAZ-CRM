# 04 — Orders + pipeline kanban

## API (apps/api/src/api/orders.py + repositories/order_repo.py — new)
- `POST /api/orders/from-quote/{quotation_id}` — quote must be approved; copies header+items, allocates ORD number, advance_expected from % config or schedule policy (config knob `DEFAULT_ADVANCE_PCT=50`), status confirmed; pipeline upsert order_confirmed; audit.
- `POST /api/orders` — manual order (walk-in confirmed without quote): same body shape as quotation create; compute totals via gst.py.
- `PATCH /api/orders/{id}/status` — guarded transitions map: confirmed→cancelled; confirmed→in_production (2B trigger will also do this); in_production→ready; ready→delivered; delivered→installed; installed→closed. 409 on illegal. Reason required for cancelled. Audit each.
- `PATCH /api/orders/{id}` — expected_delivery_date, notes only.

## Dashboard
- `dashboard/orders/page.tsx` — list w/ status chips, outstanding column (order_outstanding view), filters (status, salesperson).
- `dashboard/orders/[id]/page.tsx` — tabs: Details (items full specs), Payments (module 05 fills), Timeline (audit_log rows for entity), Documents. Status action buttons per transition map. "Create order" button on approved quote detail (module 02 page) wires here.
- Pipeline kanban `dashboard/pipeline/page.tsx` — columns = 9 stages; cards = customers w/ stage age; drag→ server action updates pipeline_stages (Supabase direct update OK — RLS). Auto-moves already handled by quote/order events. Stage-age badge (days in stage, red > 7).

## Files to touch
- apps/api/src/api/orders.py, src/repositories/order_repo.py (new), src/main.py
- apps/dashboard/src/app/dashboard/orders/**, dashboard/pipeline/** (new)
- apps/api/tests/test_orders_empirical.py (conversion copies totals exactly; illegal transition 409; manual order totals)

## Gates
- Empirical green; tsc clean; demo: approved quote → order in one click; kanban drag persists.
