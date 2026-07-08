# 08 — Workshops, allocation, media foundation (migrations 0014–0016)

database-reviewer agent on migrations.

## Migrations
**0014_workshops.sql**
- `workshops(id, name text not null, type check ('own','vendor') default 'own', manager_name text, manager_phone text, manager_salesperson_id uuid fk salespersons nullable, address text, active bool default true, created_at)`
- Seed from client list if available (STATE.md open question) else empty.

**0015_production.sql**
- `production_stage_defs(code text pk, sort int unique not null, label_en text not null, label_gu text, photo_required bool default false, active bool default true)` — seed 11: design_approved, material_procurement, cutting, frame_work, assembly, upholstery, polishing, finishing, quality_inspection, packing, dispatch (labels_gu placeholder until client confirms — STATE.md).
- `ALTER TABLE order_items ADD current_stage text references production_stage_defs(code), ADD current_stage_at timestamptz, ADD workshop_id uuid references workshops(id)` (workshop denormalized from latest assignment).
- `order_item_assignments(id, order_item_id fk not null, workshop_id fk not null, due_date date, assigned_by fk salespersons, active bool default true, created_at)` — one active per item (partial unique index).
- `production_events(id, order_item_id fk not null, stage_code fk stage_defs, kind check ('started','done','blocked','unblocked'), note text, media_id uuid, actor fk salespersons, at timestamptz default now())` — append-only (RLS: no update/delete).
- Trigger on production_events insert: kind done → set order_items.current_stage to NEXT stage by sort (done on last stage → current_stage='dispatch' complete flag); first done on an order's any item → order status in_production; all items past final stage → order status ready. Keep trigger simple; complex logic in API layer + trigger only maintains denorm.
  DECISION: current_stage = stage currently IN (next after last done). Store also `completed_stage` implicit via events.

**0016_media.sql**
- `media(id, entity_type text check ('customer','order','order_item','production_event','delivery'), entity_id uuid not null, kind text check ('reference','drawing','site','production','finished','delivery'), storage_key text not null, thumb_key text, mime text, bytes int, created_by fk salespersons, created_at)` + index (entity_type, entity_id).
- Storage bucket `media` (private). RLS: visible where parent visible (pragmatic: role-based — staff all roles read; write any authenticated staff).

## API
- `api/workshops.py`: CRUD (admin), list.
- `api/media.py`: `POST /api/media/sign-upload` (entity refs + mime → returns storage signed upload URL + media row id), `POST /api/media/{id}/complete` (bytes, enqueue thumbnail). Celery `tasks/media.py::make_thumb` (pillow, 400px, thumb_key).
- Allocation: `POST /api/production/allocate` — order_item_id, workshop_id, due_date; deactivates prior assignment; sets order_items.workshop_id; audit.

## Dashboard
- `dashboard/production/allocate/page.tsx`: unallocated confirmed-order items queue (cards: item, order, customer, expected delivery), assign modal (workshop + due date), per-workshop open-count hint.
- `owner/admin` gains Workshops CRUD tab.
- Shared `MediaGallery` + `MediaUpload` components (compression via browser-image-compression dep).

## Files to touch
- migrations 0014-0016; api/workshops.py, media.py, production.py (allocate only), tasks/media.py (+include); dashboard production/allocate, admin workshops, components/Media*
- tests: test_production_empirical.py part 1 (allocation uniqueness, media row lifecycle)

## Gates
- Empirical green; migrations clean on temp DB; upload→thumb flow works locally (manual).
- USER this module: workshop list + Gujarati stage names from Hemant; submit 2B Meta templates (production_started, production_completed image-header, ready_for_dispatch).
