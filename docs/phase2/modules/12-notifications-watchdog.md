# 12 — Notifications + delay watchdog

## Implement tasks/production_notify.py (stub from 09)
`notify_stage_event(event_id)`:
- Internal (free-form, staff numbers — P1 alert pattern): blocked → assigned salesperson + owner immediately; done on quality_inspection + dispatch → salesperson.
- Customer (window-aware, capped): stage mapping — first stage done → `production_started` template; finishing done → `production_completed` (image header w/ finished photo if exists); dispatch/packing done → `ready_for_dispatch`. CAP: max 1 customer production message per day per order (check messages table last utility for customer today; skip + log if exceeded). Respect withdrawn consent; utility category bypasses marketing consent (module 05 pattern).
- Registry entries in services/templates.py; Meta submission status per STATE.md.

## Delay watchdog (beat, daily 08:30 IST — add to celery beat_schedule)
`tasks/production_watchdog.py::flag_delays`:
- Items where current_stage_at < now()-INTERVAL config `STAGE_STALE_DAYS=4` and not blocked → internal alert list.
- Items past assignment due_date and not complete → list.
- Compose ONE owner digest WhatsApp (free-form to owner number): counts + top 5 items ("3 items no update 4+ days: ORD-2627-0012 sofa @ Workshop B — polishing 6d"). Also nudge each workshop manager with their own stale items (1 msg/manager).
- Config knobs in config.py.

## Owner daily digest (extend)
- Same watchdog task appends: orders confirmed today, payments received today (sum), quotes awaiting approval count. One message, not four.

## Files to touch
- tasks/production_notify.py (implement), tasks/production_watchdog.py (new, include+beat), services/templates.py, config.py
- tests: unit for cap logic + stage→template mapping (pure fn extracted `services/production_messaging.py` for testability); empirical light

## Gates
- Unit green; manual: walk stages on seeded order → correct messages queued (inspect messages table), cap enforced on second same-day event; watchdog dry-run prints expected digest.
