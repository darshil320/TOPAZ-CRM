# 03 — Quote PDF + WhatsApp send + public approval

## PDF engine
- `apps/api/src/services/pdf.py`: `render_html_to_pdf(html) -> bytes` via Playwright chromium (add playwright to pyproject; chromium install documented in README + Dockerfile RUN). Fallback note: WeasyPrint if container size hurts.
- `apps/api/src/services/quote_html.py`: Jinja2 template (add jinja2 dep) → branded quote HTML: logo placeholder, DMC-styled header (Topaz brand colors amber), customer block, items table (desc/dimensions/material/qty/rate/HSN/GST/amount), totals block (taxable, CGST/SGST or IGST, grand total, amount-in-words helper), terms, validity, signature block. Template file `src/templates/quotation.html`.
- Celery task `src/tasks/pdf.py::render_quotation_pdf(quotation_id)`: load quote → render → upload Supabase Storage bucket `documents` key `quotes/{quote_no}-r{rev}.pdf` (httpx to storage API, service key from settings — add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` to api config/env.example) → documents row + quotations.pdf_key. Register module in celery include.

## WhatsApp document send
- `tasks/whatsapp.py`: add `send_wa_document(to, storage_bytes_or_url, filename, caption) -> wamid` — Meta media upload (`POST /{phone_id}/media` multipart) then message type=document. Reuse `_post_wa_payload` where possible.
- Template (outside 24h window): `quote_sent` utility template with document header — register in services/templates.py registry; actual Meta submission = USER action (STATE.md external deps).

## Send + approval flow
- `POST /api/quotations/{id}/send` (dashboard key): ensure pdf rendered (sync-wait or enqueue chain render→send), send WhatsApp (window-aware: free-form doc if window open, else template), status→sent, message row via message_repo (direction outbound, category utility), audit.
- Public endpoints (NO auth, token-gated):
  - `GET /api/public/quotes/{token}` — quote summary JSON (customer first name, items, totals, validity, pdf signed URL, status). 404 unknown/expired.
  - `POST /api/public/quotes/{token}/approve` and `/reject` — idempotent; sets status+approved_at+approved_ip (from X-Forwarded-For); audit row; enqueue confirmations: WhatsApp to customer ("thanks, confirmed") + internal alert to salesperson (reuse send_salesperson_alert pattern); pipeline_stages upsert → 'order_confirmed' on approve, 'negotiation' on reject.
  - Rate-limit note: token is uuid — brute force impractical; still 404 uniformly.
- Dashboard `/q/[token]/page.tsx` (public route group, no auth middleware — check middleware.ts matcher excludes /q): mobile-first summary card, PDF view link, Approve / Request Changes buttons → calls public API. Success screen.

## Files to touch
- apps/api/src/services/pdf.py, quote_html.py, src/templates/quotation.html, src/tasks/pdf.py (new)
- apps/api/src/tasks/whatsapp.py (add document send), src/tasks/celery_app.py (include pdf)
- apps/api/src/api/quotations.py (send + public routes; public router WITHOUT key dependency)
- apps/dashboard/src/app/q/[token]/** (new), src/middleware.ts (exclude /q)
- apps/api/src/services/templates.py (quote_sent, quote_approved_confirm entries)

## Gates
- Empirical: render golden quote → PDF bytes > 10KB; approve idempotency (double-POST one audit); token 404s.
- Manual demo: real quote → WhatsApp doc on user's phone → approve from phone → status + pipeline advance.
- USER actions this module: submit quote_sent/quote_approved_confirm/payment templates in Meta; approve PDF layout with Hemant (one revision loop).
