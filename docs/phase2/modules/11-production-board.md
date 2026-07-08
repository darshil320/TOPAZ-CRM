# 11 — Live production board + order production/photos tabs (+ PWA iteration)

## First: PWA field-feedback fixes
- Apply STATE.md notes from module 10 field test before new work. Budgeted: up to 2 days.

## Live board (`dashboard/production/page.tsx` — sales/owner/admin)
- Columns per production_stage_defs sort; cards = order items (thumb, item, order no, workshop chip, days-in-stage, blocked badge). Filters: workshop, overdue-only, order search.
- Realtime: subscribe production_events INSERT via Supabase Realtime channel (pattern: hooks/useVisitAlerts.ts) → refetch/move affected card. Enable realtime on table (publication) in a tiny migration if needed.
- Card click → item drawer: stage timeline + photos + assignment info + block history.

## Order detail additions (dashboard/orders/[id])
- Production tab: per-item progress bar (n/11), current stage, workshop, due date, blocked flags.
- Photos tab: MediaGallery grouped by kind; multi-select → "Share on WhatsApp" server action → sends selected images to customer via existing rails ONLY if 24h window open, else toast "window closed — customer must message first" (v1 rule; no image templates).

## WhatsApp image send
- tasks/whatsapp.py: `send_wa_image(to, storage_key, caption)` — media upload + type=image (mirror of document send).

## Files to touch
- dashboard/production/page.tsx + drawer, orders/[id] tabs, hooks/useProductionEvents.ts
- tasks/whatsapp.py (image), api route for share action (or reuse /api/whatsapp/send extended with media — decide: new `POST /api/whatsapp/send-media` dashboard-key endpoint)
- migration only if realtime publication needs enabling

## Gates
- tsc clean; manual: two browsers — PWA advances stage, board card moves live <2s. Demo 5 to Hemant per plan.
