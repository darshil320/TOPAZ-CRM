# 09 — Production state machine + events API

## API (api/production.py extend + repositories/production_repo.py new)
- `POST /api/production/items/{order_item_id}/advance` — body: optional note, optional media_id. Server: item must be allocated; determine current stage; insert event kind=done for current stage; trigger moves current_stage. Guards: stage order enforced (can't skip), photo_required stages need media_id (409 otherwise), actor must be assigned workshop's manager OR admin/owner (RLS + explicit check).
- `POST /api/production/items/{id}/block` + `/unblock` — note required on block. Blocked items excluded from advance until unblocked.
- `POST /api/production/items/{id}/override-stage` — admin only, reason required, audit loudly (kind done rows inserted for skipped stages with note 'admin override').
- `GET /api/production/my-queue` — workshop_manager scoped: assigned active items with current stage, due date, blocked flag. (Or Supabase read w/ RLS — choose API here: PWA calls server action → API keeps logic single-sourced.)

## Repo functions
- get_item_stage_state(session, item_id) — current stage + defs + blocked
- insert_event(...) with FOR UPDATE on order_item row (concurrent double-tap protection — same pattern as followup claim)
- queue_for_workshop(session, workshop_id)

## Notifications hooks (wired fully in module 12; stubs here)
- After event commit: enqueue `tasks/production_notify.notify_stage_event(event_id)` — module 12 implements; create module file now with logger-only body, register include.

## Tests (empirical — this is the module's core deliverable)
- Stage order guard (advance from cutting skipping frame_work → 409)
- photo_required enforcement
- Concurrent double-advance: two parallel advances → one event, second 409/no-op
- Trigger correctness: current_stage progression; order flips confirmed→in_production on first event; →ready when all items complete
- Blocked flow; admin override audit rows

## Files to touch
- api/production.py, repositories/production_repo.py, tasks/production_notify.py (stub), celery include
- tests/test_production_empirical.py (extend)

## Gates
- Full empirical suite green. Demo: allocate seeded order, walk all 11 stages via curl/scripts, watch order status flip.
