# Monorepo Map → Master Implementation Plan

How each part of this repo maps to the phases in `topaz-master-implementation-plan.md`.

**Status source of truth:** `docs/DEPLOYMENT.md`. The table below was written during
planning and is kept only as the phase-mapping reference — do not read its Status
column as current; it was last accurate pre-build.

| Folder | Phase | Stack | Status (see docs/DEPLOYMENT.md for current) |
|---|---|---|---|
| `apps/prototype` | Pre-sales (deal-closer) | Python · InsightFace · OpenCV · pluggable WhatsApp notifier · stdlib web view | Built |
| `apps/edge` | 1A · M1 | Python · InsightFace/ArcFace (CPU by default) · USB webcam or RTSP CCTV via OpenCV | Built — code complete, no autostart service yet (Track E of DEPLOYMENT.md) |
| `apps/api` | 1A · M2, M6A · 1B · M3, M4, M5 | FastAPI · PostgreSQL+pgvector · Redis+Celery · Claude · Meta Cloud API direct (not BSP — see CLAUDE.md note) | Built — deployed on Railway, secrets being finalized |
| `apps/dashboard` | 1A · M6A · 1B · M6B | Next.js · Supabase realtime · server-side RBAC | Built — deployed on Vercel |
| `packages/shared` | all | Shared types / API contracts (enrollment, recognition, auth linking) | Built |
| `infra` | all | Docker Compose (local dev only — no Jetson/on-prem provisioning scripts exist yet) | Partial |

## Prototype → Phase 1A reuse

The prototype is **not throwaway**. Its core carries into `apps/edge` / `apps/api`:

- `src/faces/matching.py` — pure cosine-match + NEW/REPEAT/UNCERTAIN banding → reused verbatim in the edge classifier (master plan E1A-2).
- `src/faces/recognizer.py` — InsightFace/ArcFace wrapper → ported to the Jetson edge pipeline.
- `src/notify/*` — the pluggable Notifier (console/Twilio/AiSensy) → becomes the BSP send layer (master plan E1A-4, hardened into the 24h-window chokepoint in E1B-1).
- `src/notify/messages.py` — owner-alert copy → becomes approved WhatsApp templates.
- `src/web.py` — the live visit-log view → seed of the M6A dashboard (master plan E1A-6).

## What the prototype deliberately omits (and where it lands in the real build)

| Omitted in prototype | Real build location |
|---|---|
| DPDPA consent-first hard gate | 1A · E1A-1 (consent service + tablet flow) |
| Jetson edge device (runs on laptop CPU instead) | 1A · E1A-2 |
| Persistent DB (uses JSON/JSONL files) | 1A · E1A-3 (Postgres/pgvector) |
| CRM data entry UI | 1A · E1A-5 |
| AI WhatsApp chatbot, lead capture, full dashboard | 1B |
| Encryption at rest, audit log, RBAC | 1A · cross-cutting §6 |

Keeping these out is intentional: the prototype proves the *wow* (recognition → alert) in days, with near-zero client dependency. The omissions are exactly the production-hardening the ₹7.5L pays for.
