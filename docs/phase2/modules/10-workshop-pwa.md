# 10 — Workshop PWA (My Queue)

THE adoption-critical module. Target user: 45-year-old manager, mid-range Android, maybe low literacy in English. Every decision optimizes taps-to-done.

## PWA shell
- `apps/dashboard`: manifest.json (name "Topaz Workshop", amber theme, icons — generate simple SVG-based set), next-pwa or hand-rolled service worker (shell cache only, network-first data; NO offline queue in v1).
- Route group `app/workshop/**`, middleware: role workshop_manager (others redirected). Phone-OTP login reused (manager_salesperson_id links workshop).

## Screens
1. `workshop/page.tsx` — My Queue: cards per assigned item — finished-photo-or-placeholder, item name + dimensions, order no, customer first name, current stage BIG (label_gu primary / label_en secondary), due date chip (red overdue), blocked banner.
2. Item card tap → `workshop/items/[id]/page.tsx` — stage stepper (done ✓ grey / current amber / future muted), two primary buttons:
   - **[✓ સ્ટેજ પૂર્ણ / Stage done]** → if photo_required or user opts: camera sheet (input capture=environment → compress → signed upload → media id) → confirm → server action advance → next stage renders. Total ≤ 3 taps with photo, 2 without.
   - **[અવરોધ / Blocked]** → note (voice-to-text hint via keyboard), submits block.
3. History accordion: past events w/ thumbs.
- Language toggle persisted localStorage. ALL strings in a `workshop/i18n.ts` dict (en+gu) — placeholders until client confirms Gujarati.

## Server actions
- `workshop/actions.ts`: advanceStage(itemId, mediaId?), blockItem(itemId, note), fetch queue — call FastAPI production endpoints with DASHBOARD_API_KEY + actor salesperson id (from Supabase session), AbortSignal 10s.

## Files to touch
- apps/dashboard: manifest, sw registration, app/workshop/**, components/CameraCapture.tsx, i18n dict, middleware role gate
- No API changes (module 09 endpoints)

## Gates
- tsc clean; Lighthouse PWA installable pass; manual: full stage walk on a real Android phone (USER field test with 2 real managers — feedback logged to STATE.md; one redesign loop budgeted in module 11 week).
