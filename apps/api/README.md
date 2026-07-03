# apps/api — Topaz CRM Backend

FastAPI + Celery backend: recognition ingestion, kiosk enrollment, WhatsApp
messaging (alerts, AI drafts, cadence follow-ups), and the §19-E consent seam.

Stack: FastAPI · Supabase Postgres + pgvector · Redis + Celery (worker + beat) ·
WhatsApp Cloud API · Claude Haiku (AI drafts, optional).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/recognition` | `API-Key` (EDGE_API_KEY) | Edge camera event → Celery pipeline |
| POST | `/api/enrollment` | `API-Key` (EDGE_API_KEY) | Kiosk registration (consent + customer) |
| GET | `/api/enrollment/pending` | `API-Key` (EDGE_API_KEY) | Edge polls for a claimable consent token |
| GET/POST | `/api/whatsapp/webhook` | Meta signature (WA_APP_SECRET) | Inbound messages + delivery statuses |
| POST | `/api/whatsapp/send` | `API-Key` (DASHBOARD_API_KEY) | Dashboard server action → outbound send |
| GET | `/api/health` | none | Liveness |

## Run locally

```bash
cp .env.example .env   # fill DATABASE_URL, EDGE_API_KEY, DASHBOARD_API_KEY, …
source ../../.venv/bin/activate

# 1. API
uvicorn src.main:app --reload --port 8000

# 2. Worker (recognition, WhatsApp sends, AI drafts)
celery -A src.tasks.celery_app worker --loglevel=info --concurrency=2

# 3. Beat (cadence engine — send_due_followups every 30 min, hygiene at 01:00 IST)
celery -A src.tasks.celery_app beat --loglevel=info
```

Or everything at once: `docker compose -f ../../infra/docker-compose.yml up`
(services: redis, api, worker, beat).

## Celery tasks

- `recognition.process_recognition_event` — idempotency → quality gate → ANN →
  band (REPEAT/UNCERTAIN/NEW) → visit row → alert + AI draft (REPEAT) or
  consent-token enrollment (NEW/UNCERTAIN, §19-E).
- `whatsapp.send_salesperson_alert` / `whatsapp.send_customer_message` — Cloud
  API sends; customer sends update the `messages` row (sent/failed + wamid).
- `ai.draft_followup` / `ai.handle_inbound_reply` — pending-approval drafts
  (LLM if ANTHROPIC_API_KEY set, template fallback) + inbound logging.
- `followup.send_due_followups` (beat) — claims due `followups` rows
  (FOR UPDATE SKIP LOCKED), respects marketing consent + the 24h window
  (free-form inside, approved Meta template outside).
- `pipeline.close_stale_followups` (beat) — recovers stuck sends, cancels
  followups > FOLLOWUP_STALE_DAYS past due.

## Tests

```bash
pytest tests/test_templates.py tests/test_wa_window.py tests/test_wa_webhook.py  # unit, no DB
pytest tests/test_rls.py   # needs: supabase start && supabase db reset
```
