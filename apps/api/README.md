# apps/api — Backend (Phase 1A M2/M6A · Phase 1B M3/M4/M5)

**Planned.** FastAPI backend — the brain of the system.

- Stack: FastAPI · PostgreSQL + pgvector · Redis + Celery · Claude Haiku 4.5 · WhatsApp BSP.
- Routers: `visits` · `enquiries` · `leads` · `webhooks` (bsp/google) · `chatbot` · `alerts` · `consents` · `admin`.
- Migration 0001 = full PRD §8 schema with `showroom_id` everywhere from day one.
- Tools for Claude: `get_catalog_items` (live DB price/stock — never embeddings) + `notify_salesperson` (same call).
- 24h-window send chokepoint: every outbound WhatsApp message routes through one module (E1B-1).

**Reuses from prototype:** `notify/*` becomes the BSP send layer; `notify/messages.py` becomes approved templates.

See master plan epics E1A-1/3/4/6, E1B-1..8.
