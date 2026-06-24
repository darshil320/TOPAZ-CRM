# TOPAZ CRM — Production Execution Plan v2.2

**Version:** 2.2 · **Date:** 24 June 2026 · **Owner:** DMC Digital (Darshil)
**Audience:** implementing developer + AI coding agents (Opus for planning/review, Sonnet for execution, Haiku for workers).
**Companion docs:** `topaz-crm-sow-1.5L.md` (commercial scope), `CLAUDE.md` (standards), `apps/prototype/` (working prototype M1 core).

> **v2.3 changes:** added **§19 Pre-Build Hardening** — fixes from an independent 3-angle audit (architect + database-reviewer + security-reviewer). Verdict **GO-WITH-FIXES**: architecture is sound and needs no redesign; §19 lists the concurrency primitives, schema constraints/indexes, pgvector recall fix, DPDPA capture-before-consent flow, AI auto-message disclosure, RLS test suite, secrets hardening, and timeline re-baseline required to build it correctly. Apply §19 during the build.
> **v2.2 changes (expanded scope per Hemant's 24-Jun walkthrough):** a single customer can now be handled by **multiple salespersons** (one primary + collaborators) with a **leave/coverage handoff**; the WhatsApp follow-up is now a **conversational AI agent** that messages each pending customer *signed as their assigned salesperson*, governed by the **24-hour window** (templates re-open, free-form inside); **manual override** lets any assignee take the thread from the AI; both see the **shared conversation**; the owner gets a **per-customer AI on/off toggle**. New tables: `customer_assignments`, `coverage_requests`. New ADRs 13–17. Delivered as **one phase** for **₹1,50,000** (standard value ₹2,40,000; founding-partner/referral price).
> **v2.1 changes:** Dashboard is **Next.js (App Router) on Vercel**; data/realtime/auth/storage consolidated onto **Supabase** (managed Postgres + pgvector + Realtime + Auth + Storage). FastAPI is the backend for recognition + WhatsApp + Celery only. Redis + Celery, Meta Cloud API direct (no BSP), buffalo_l retained.

---

## 0. Scope

Fixed price **₹1,50,000 + 18% GST** (founding-partner/referral price; standard value **₹2,40,000**). **One phase, one delivery, full payment on delivery & acceptance.** One showroom (Bhatar), one entrance. Hardware is client-procured against our spec.

**IN:** face-recognition entry (new/repeat) → salesperson alert + **claim** → customer CRM + visit history → **multi-salesperson assignment (primary + collaborators) with leave/coverage handoff** → **conversational AI WhatsApp follow-up, signed as the assigned salesperson**, with **manual override + shared thread** and a **per-customer AI on/off toggle** → New/Talking/Won/Lost pipeline + owner dashboard → DPDPA consent.

**OUT (later, quoted separately):** a full **catalog Q&A bot** (AI answering arbitrary product/price questions from a product catalog — *distinct from* the follow-up agent, which converses about the customer's own deal), Instagram/Facebook/Google lead capture, order/payment/production/logistics, multi-camera/multi-showroom, advanced analytics.

> **Scope boundary — read once.** The AI in this build is a **conversational follow-up agent**: it proactively nudges and replies to *pending* customers about *their own enquiry* (the sofa they discussed, a revisit, quote status), signed as their salesperson, and hands off to a human on demand. It is **not** a product-catalog chatbot that fields any product/price question — that is a separate later module. (Same warning the v1 SOW carried, restated because the line matters.)

---

## 1. Architecture Decision Records

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| ADR-01 | Face model | **InsightFace buffalo_l (ArcFace, 512-d)** | Best accuracy in class for South Asian  faces; buffalo_l has the most deployment real-world data. Licensing risk accepted by client; will revisit for commercial scale. |
| ADR-02 | Primary database | **Supabase (managed PostgreSQL 16 + pgvector 0.7)** | Vector similarity search with HNSW index; managed backups/PITR; one platform gives DB + Auth + Realtime + Storage; pgvector is enabled with one click. |
| ADR-03 | Task queue | **Redis 7 + Celery 5 (Beat for scheduling)** | Proper durable task queue — WhatsApp sends, recognition events, follow-up cadence all need retry/deduplication guarantees. APScheduler is in-process and loses tasks on crash. |
| ADR-04 | Recognition/WhatsApp API | **FastAPI (Python 3.12)** | Async-native, Pydantic validation. Owns the recognition endpoint, WhatsApp webhook, and Celery tasks. Connects to Supabase Postgres directly. |
| ADR-05 | Dashboard | **Next.js 15 (App Router, RSC) on Vercel** | Modern React frontend; salesperson mobile dashboard + owner pipeline board. Reads Supabase directly via RLS; mutations via server actions / FastAPI. |
| ADR-06 | WhatsApp | **Meta Cloud API (direct, no BSP)** | Full control — no middleman markup, no webhook-behind-paywall, own rate-limit headroom. Requires Meta Business Verification + App Review (2–5 days; start Week 0). |
| ADR-07 | Hosting | **Vercel (Next.js) + cloud VM (FastAPI/Celery, DO/Hetzner) + Supabase (data)** | Frontend serverless on Vercel; backend on a small VM for the always-on edge/worker processes; Supabase managed for data. |
| ADR-08 | Embeddings search | **pgvector HNSW (cosine)** | Sub-ms ANN at any realistic showroom scale; eliminates separate vector DB ops overhead. |
| ADR-09 | DPDPA | **Consent-first hard gate** | No embedding written without `consent_id` FK. Three unbundled consents: `face_tracking`, `whatsapp_marketing`, `personal_data`. |
| ADR-10 | Live updates | **Supabase Realtime (Postgres changes subscription)** | Recognition events / new visits push to the salesperson dashboard in real-time via Supabase channels — no SSE/websocket plumbing to build. |
| ADR-11 | Auth | **Supabase Auth (phone OTP + RLS)** | Staff login via phone OTP; row-level security scopes a salesperson to their own customers; owner is admin role. Replaces hand-rolled JWT. |
| ADR-12 | Object storage | **Supabase Storage (signed URLs)** | Face crops stored in a private bucket; 1h signed URLs for WhatsApp media. One platform, RLS-aware. |
| ADR-13 | Customer↔salesperson | **Many-to-many via `customer_assignments` (role: primary \| collaborator)** | A customer can be worked by several staff. Exactly one active **primary** (partial unique index); others are **collaborators** who see the full thread. Replaces a single `assigned_salesperson_id`. |
| ADR-14 | Follow-up intelligence | **Conversational AI (Claude) drafting, governed by the WhatsApp 24h window** | Cold/pending customer → approved **template** re-opens the window; once they reply, the AI converses **free-form for 24h**. The LLM drafts from the customer's own visit history + deal state — not a general catalog bot. |
| ADR-15 | AI autonomy | **Human-in-the-loop at launch → graduated auto-send** | Launch: AI **drafts**, the assigned salesperson taps send (protects the brand from a wrong price/promise). Once tone is trusted, owner flips per-customer **auto-send** on. Guardrail: AI never states a price/date unless it comes from a structured field, never invents stock. |
| ADR-16 | Sender identity | **One showroom WhatsApp number; AI personalises content signed as the salesperson** | Meta Cloud API = one business number. "As Ramesh" = the message *reads* "— Ramesh, Topaz", not a send from Ramesh's personal phone. Per-salesperson numbers = 10× registration/cost → explicitly out. |
| ADR-17 | Handler arbitration | **One `handler_mode` per customer thread (`ai` \| `human`) + `handler_salesperson_id`** | Prevents AI and a human (or two humans) double-sending. Taking over sets `human` + locks to that salesperson; release/timeout returns to `ai` if the owner left AI enabled. |

---

## 2. System Architecture

```
┌──────────────────────┐
│  SHOWROOM (Bhatar)   │
│  ┌──────────┐  RTSP   │
│  │ 4MP IP   │────────┐│
│  │  Camera  │        ││
│  └──────────┘        ▼│
│        ┌──────────────────────────┐
│        │   Edge Worker (VM/Pi)    │
│        │  insightface buffalo_l   │
│        │  detect→embed→POST       │
│        └────────────┬─────────────┘
└─────────────────────┼────────────────────────────────────────────────────────┘
                      │ POST /api/recognition (API key)
                      ▼
   ┌──────────────────────────────────────┐        ┌───────────────────────────┐
   │   FastAPI Backend  (cloud VM)         │        │   Next.js 15  (Vercel)    │
   │   /api/recognition                    │        │   /dashboard (salesperson)│
   │   /api/whatsapp/webhook (Meta inbound)│        │   /owner     (pipeline)   │
   │   /api/customers, /pipeline (writes)  │        │   /consent   (kiosk)      │
   └───────┬──────────────────────┬────────┘        └─────────────┬─────────────┘
           │                      │                               │
           │            ┌─────────▼──────────┐                    │ supabase-js
           │            │     Redis 7         │                    │ (RLS reads +
           │            │  broker + cache     │                    │  Realtime sub)
           │            └─────────┬──────────┘                    │
           │            ┌─────────▼──────────┐                    │
           │            │  Celery Workers     │                    │
           │            │  recognition.*      │                    │
           │            │  whatsapp.*         │                    │
           │            │  followup.* · ai.*  │                    │
           │            │  pipeline.*         │                    │
           │            └─────────┬──────────┘                    │
           │ asyncpg              │ asyncpg                        │
           ▼                      ▼                                ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                         SUPABASE                                         │
   │  Postgres 16 + pgvector   │  Auth (phone OTP + RLS)  │  Realtime  │ Storage│
   │  customers · face_embeddings · consents · visits · salespersons ·        │
   │  customer_assignments · coverage_requests · conversations · messages ·   │
   │  followups · pipeline_stages · audit_log                                 │
   └────────────────────────────────────────────────────────────────────────┘
           │ HTTPS (Celery whatsapp.send)
           ▼
   ┌────────────────────────────┐
   │  Meta Cloud API            │
   │  graph.facebook.com/v20    │
   │  /messages · /webhook      │
   └────────────────────────────┘

Live updates: Celery/FastAPI write to Supabase → Realtime pushes Postgres changes
to the Next.js dashboard channel → salesperson sees the alert instantly (no polling).
AI follow-up: followup/ai Celery tasks call the Claude API to draft a contextual reply
(signed as the assigned salesperson), governed by the 24h window + per-thread handler_mode;
drafts either auto-send or queue for salesperson approval (ADR-14/15/17).
```

---

## 3. Tech Stack Summary

**Frontend (Next.js on Vercel)**

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, RSC) | 15 |
| Language | TypeScript | 5.x |
| UI | React + Tailwind CSS + shadcn/ui | 19 / 3.4 |
| Data / Auth / Realtime | @supabase/supabase-js + @supabase/ssr | 2.x |
| Forms / validation | react-hook-form + zod | — |
| Hosting | Vercel | — |

**Backend (FastAPI + Celery on a cloud VM)**

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | Python | 3.12 |
| API | FastAPI + Uvicorn | 0.115 / 0.32 |
| DB driver | SQLAlchemy 2.0 (async) + asyncpg | 2.0 |
| Migrations | Supabase CLI migrations (SQL) | — |
| Cache / Broker | Redis | 7 |
| Task queue | Celery + Celery Beat | 5.4 |
| Face recognition | InsightFace (buffalo_l) + ONNX Runtime | 0.7 / 1.18 |
| Image | OpenCV-Python | 4.10 |
| WhatsApp | Meta Cloud API (direct) | v20 |
| Validation | Pydantic v2 | 2.8 |
| HTTP client | httpx (async) | 0.27 |
| Config | pydantic-settings | 2.x |
| Testing | pytest + pytest-asyncio + factory-boy | — |
| Linting | Ruff | 0.6 |
| Container | Docker + docker-compose | — |

**Data platform**

| Layer | Technology |
|-------|-----------|
| Database | Supabase Postgres 16 + pgvector 0.7 (HNSW) |
| Auth | Supabase Auth (phone OTP + RLS) |
| Realtime | Supabase Realtime (Postgres changes) |
| Object storage | Supabase Storage (private bucket, signed URLs) |

---

## 4. Data Model (PostgreSQL + pgvector)

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Salespersons ────────────────────────────────────────────────────────
CREATE TABLE salespersons (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL,
    whatsapp     TEXT NOT NULL UNIQUE,          -- E.164: +919XXXXXXXXX
    role         TEXT NOT NULL DEFAULT 'salesperson', -- 'salesperson' | 'owner' (admin)
    active       BOOLEAN NOT NULL DEFAULT TRUE,       -- employed / has a login
    available    BOOLEAN NOT NULL DEFAULT TRUE,       -- present today (FALSE = on leave → triggers coverage)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Consents ─────────────────────────────────────────────────────────────
-- Three unbundled consents; no face_embedding row allowed without face_tracking=TRUE
CREATE TABLE consents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    face_tracking       BOOLEAN NOT NULL DEFAULT FALSE,
    personal_data       BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_marketing  BOOLEAN NOT NULL DEFAULT FALSE,
    method              TEXT NOT NULL,          -- 'kiosk', 'signage_implicit', 'verbal'
    given_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip                  TEXT,
    withdrawn_at        TIMESTAMPTZ
);

-- ─── Customers ────────────────────────────────────────────────────────────
CREATE TABLE customers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    consent_id          UUID NOT NULL REFERENCES consents(id),
    name                TEXT,                   -- NULL until salesperson fills in
    phone               TEXT,                   -- E.164 (optional at entry)
    wa_id               TEXT UNIQUE,            -- WhatsApp ID (phone without +)
    budget_range        TEXT,
    primary_interest    TEXT,
    -- AI follow-up control (per customer) ---------------------------------
    ai_followup_enabled BOOLEAN NOT NULL DEFAULT TRUE,  -- owner's per-customer master toggle
    ai_autosend         BOOLEAN NOT NULL DEFAULT FALSE, -- FALSE = AI drafts + human approves; TRUE = auto-send
    handler_mode        TEXT NOT NULL DEFAULT 'ai',     -- 'ai' | 'human' (who drives the WhatsApp thread now)
    handler_salesperson_id UUID REFERENCES salespersons(id), -- set when a human takes over; NULL when 'ai'
    handler_since       TIMESTAMPTZ,
    last_inbound_at     TIMESTAMPTZ,            -- drives the 24h free-form window
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Face Embeddings ──────────────────────────────────────────────────────
-- HARD GATE: can only insert if consents.face_tracking = TRUE (enforced in app layer + trigger)
CREATE TABLE face_embeddings (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    embedding      vector(512) NOT NULL,       -- ArcFace 512-d L2-normalised
    model_version  TEXT NOT NULL DEFAULT 'buffalo_l',
    quality_score  REAL,                        -- insightface det_score
    enrolled_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- HNSW index for fast cosine ANN (ef_construction=64, m=16 is production default)
CREATE INDEX face_embeddings_hnsw_idx
    ON face_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m=16, ef_construction=64);

-- ─── Visits ───────────────────────────────────────────────────────────────
CREATE TABLE visits (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id      UUID REFERENCES customers(id),  -- NULL = uncertain/anonymous
    salesperson_id   UUID REFERENCES salespersons(id),
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    match_score      REAL,
    match_band       TEXT NOT NULL,              -- 'NEW' | 'REPEAT' | 'UNCERTAIN'
    photo_key        TEXT,                       -- Supabase Storage object key (private bucket)
    raw_event_id     UUID UNIQUE NOT NULL        -- idempotency key from edge worker
);

-- ─── Customer ↔ Salesperson assignments (many-to-many) ─────────────────────
-- One customer can be worked by several staff: exactly one active 'primary',
-- plus zero-or-more 'collaborator's who see the full thread (leave/coverage handoff).
CREATE TYPE assignment_role AS ENUM ('primary', 'collaborator');
CREATE TABLE customer_assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    salesperson_id  UUID NOT NULL REFERENCES salespersons(id),
    role            assignment_role NOT NULL DEFAULT 'primary',
    added_by        UUID REFERENCES salespersons(id),   -- who looped this person in (NULL = system, e.g. first claim)
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, salesperson_id)
);
-- Enforce: at most ONE active primary per customer
CREATE UNIQUE INDEX one_active_primary_per_customer
    ON customer_assignments (customer_id)
    WHERE role = 'primary' AND active = TRUE;

-- ─── Coverage requests (primary on leave → teammate covers) ────────────────
CREATE TYPE coverage_status AS ENUM ('open', 'claimed', 'closed');
CREATE TABLE coverage_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id),          -- the live revisit that triggered it
    requested_by    UUID NOT NULL REFERENCES salespersons(id),  -- absent primary
    claimed_by      UUID REFERENCES salespersons(id),    -- teammate who covered
    became_primary  BOOLEAN NOT NULL DEFAULT FALSE,      -- did the coverer take over as primary?
    status          coverage_status NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- ─── Conversations ────────────────────────────────────────────────────────
CREATE TABLE conversations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id      UUID NOT NULL REFERENCES customers(id),
    salesperson_id   UUID REFERENCES salespersons(id),
    visit_id         UUID REFERENCES visits(id),
    budget           TEXT,
    products         TEXT[],
    notes            TEXT,
    stage_at_time    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Pipeline Stages ──────────────────────────────────────────────────────
-- Hemant's states: New → Talking/Pending → Won (done) / Lost (not done)
CREATE TYPE pipeline_stage AS ENUM ('new', 'talking', 'follow_up', 'won', 'lost');
CREATE TABLE pipeline_stages (
    customer_id    UUID PRIMARY KEY REFERENCES customers(id),
    stage          pipeline_stage NOT NULL DEFAULT 'new',
    closing_notes  TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── WhatsApp Messages ────────────────────────────────────────────────────
CREATE TABLE messages (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id    UUID NOT NULL REFERENCES customers(id),
    wamid          TEXT UNIQUE,                  -- Meta message ID (dedupe key)
    direction      TEXT NOT NULL,                -- 'outbound' | 'inbound'
    category       TEXT,                         -- 'marketing' | 'utility' | 'service'
    template_name  TEXT,
    content        TEXT NOT NULL,
    -- Sender attribution (multi-salesperson + AI) -------------------------
    sender_type    TEXT NOT NULL DEFAULT 'customer', -- 'ai' | 'salesperson' | 'customer' | 'system'
    sender_salesperson_id  UUID REFERENCES salespersons(id), -- human who actually sent (NULL for ai/customer)
    sent_as_salesperson_id UUID REFERENCES salespersons(id), -- identity the AI signed as ("— Ramesh")
    ai_generated   BOOLEAN NOT NULL DEFAULT FALSE,
    draft_status   TEXT,                         -- AI drafts: 'pending_approval' | 'approved' | 'rejected'; NULL once sent
    approved_by    UUID REFERENCES salespersons(id), -- salesperson who approved an AI draft (human-in-loop)
    status         TEXT NOT NULL DEFAULT 'pending', -- pending/sent/delivered/read/failed
    sent_at        TIMESTAMPTZ,
    received_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Follow-up Queue ──────────────────────────────────────────────────────
CREATE TABLE followups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id     UUID NOT NULL REFERENCES customers(id),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    template_name   TEXT NOT NULL,
    template_vars   JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending/sent/skipped/cancelled
    celery_task_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX followups_due_idx ON followups(scheduled_at) WHERE status = 'pending';

-- ─── Audit Log ────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    entity       TEXT NOT NULL,
    entity_id    UUID,
    action       TEXT NOT NULL,
    actor        TEXT,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload      JSONB
);
```

### Cosine similarity query

```sql
-- Find top-5 nearest embeddings for an incoming 512-d vector $1
SELECT
    fe.customer_id,
    1 - (fe.embedding <=> $1::vector) AS similarity
FROM face_embeddings fe
JOIN customers c ON c.id = fe.customer_id
JOIN consents co ON co.id = c.consent_id
WHERE co.face_tracking = TRUE
ORDER BY fe.embedding <=> $1::vector
LIMIT 5;
```

Bands applied in application layer (not SQL): `similarity >= 0.45` → REPEAT, `< 0.30` → NEW, between → UNCERTAIN.

---

## 5. API Contracts

### 5.1 RecognitionEvent (Edge → API)

```python
class RecognitionEvent(BaseModel):
    raw_event_id: UUID        # idempotency key generated by edge worker
    embedding: list[float]    # 512 floats, L2-normalised
    quality_score: float      # insightface det_score; reject < 0.4
    captured_at: datetime
    camera_id: str            # "bhatar_entrance_01"
    photo_key: str | None     # uploaded to object storage before POST
```

### 5.2 FastAPI Backend Endpoints (recognition + WhatsApp only)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/recognition` | API key (edge) | New recognition event; triggers Celery task |
| POST | `/api/whatsapp/webhook` | HMAC-SHA256 | Meta inbound messages + status updates |
| GET | `/api/whatsapp/webhook` | Verify token | Meta webhook verification challenge |
| GET | `/api/health` | — | Liveness probe |

### 5.3 Next.js Routes (dashboard — reads Supabase via RLS, mutations via server actions)

| Route | Access | Purpose |
|-------|--------|---------|
| `/login` | public | Supabase phone-OTP login |
| `/consent` | public | DPDPA consent kiosk (writes consents) |
| `/dashboard` | salesperson | Assigned customer list + inline edit + live alerts (Realtime sub) |
| `/dashboard/customers/[id]` | salesperson | Customer detail: visit timeline + conversation + message log |
| `/owner` | admin | Pipeline board (New/Follow-up/Won/Lost) + daily metrics |
| `/owner/salespersons` | admin | Manage salesperson list + assignments |

Next.js **server actions** (mutations, run on the server with the user's Supabase session): `logConversation`, `updateCustomer`, `movePipelineStage`, `cancelFollowup`, `reassignSalesperson`. Reads go directly through `supabase-js` from RSC with RLS enforcing per-salesperson scope. The salesperson dashboard subscribes to a Supabase Realtime channel on `visits` + `messages` for instant alerts.

### 5.3 WhatsApp Templates (4 templates, submit to Meta Week 0)

```
TEMPLATE 1: salesperson_arrival_alert  [category: UTILITY]
Variables: {{1}} = customer type ("New customer" / "Repeat customer – Priya"),
           {{2}} = interest ("last wanted teak dining sets"),
           {{3}} = timestamp
Body: "🔔 {{1}} has arrived at the showroom – {{2}}. Time: {{3}}."
Note: Utility (transaction-tied to a live visit) → ₹0.115, FREE inside 24h window.

TEMPLATE 2: customer_thank_you  [category: MARKETING — requires opt-in]
Variables: {{1}} = customer name, {{2}} = products discussed, {{3}} = salesperson name
Body: "Hi {{1}}, thanks for visiting Topaz Furniture today! Great discussing {{2}} with you.
{{3}} will follow up shortly. Reply STOP to opt out."
Opt-out button: "STOP" (required for marketing)

TEMPLATE 3: followup_nudge  [category: MARKETING — requires opt-in]
Variables: {{1}} = customer name, {{2}} = interest, {{3}} = showroom name
Body: "Hi {{1}}, still thinking about {{2}}? We'd love to help you find the perfect piece.
Drop by or reply here to chat. Reply STOP to unsubscribe."
Opt-out button: "STOP" (required for marketing)

TEMPLATE 4: quote_ready  [category: UTILITY]
Variables: {{1}} = customer name, {{2}} = product, {{3}} = amount, {{4}} = salesperson
Body: "Hi {{1}}, your quote for {{2}} is ready: ₹{{3}}. Contact {{4}} to confirm.
Reply STOP to opt out."
```

### 5.4 BspAdapter → MetaCloudAdapter Protocol

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass(frozen=True)
class OutboundMessage:
    wa_id: str             # phone without +
    template_name: str
    language_code: str     # "en_IN"
    components: list[dict] # Meta template component format

class WhatsAppAdapter(ABC):
    @abstractmethod
    async def send_template(self, msg: OutboundMessage) -> str:
        """Returns wamid."""

    @abstractmethod
    async def upload_media(self, path: str, mime_type: str) -> str:
        """Returns media_id."""
```

---

## 6. Face Recognition Pipeline

### 6.1 Edge Worker (`apps/edge/src/`)

```
Camera (RTSP/USB)
  → OpenCV VideoCapture (threaded frame buffer)
  → FaceRecognizer.detect(frame)          [InsightFace buffalo_l]
  → quality_score filter (reject < 0.4)
  → L2-normalise embedding
  → upload crop to Object Storage (async)
  → POST /api/recognition {raw_event_id, embedding, quality_score, photo_key}
  → cooldown_tracker: suppress re-fire for same estimated face for 30s
```

The edge worker is **stateless** — it does not query pgvector. All matching happens in the API Celery task. This means the edge can be a Raspberry Pi 5, laptop, or cloud worker.

### 6.2 Celery Task: `tasks.recognition.process_event`

```python
@celery_app.task(bind=True, max_retries=3, acks_late=True)
def process_recognition_event(self, raw_event_id: str, embedding: list[float],
                               quality_score: float, photo_key: str | None,
                               camera_id: str, captured_at: str):
    # 1. Idempotency: check visits.raw_event_id — skip if already processed
    # 2. pgvector ANN query → top match + similarity score
    # 3. Band classification (REPEAT / UNCERTAIN / NEW)
    # 4. REPEAT: load customer + salesperson → fire alert task
    # 5. NEW: create anonymous customer + consent stub → fire alert task
    # 6. UNCERTAIN: fire alert to duty salesperson for manual confirm
    # 7. Write visit row; update pipeline_stages if first visit
    # 8. Schedule Day-1 thank-you if whatsapp_marketing consent = TRUE
```

### 6.3 Matching Bands (re-tune after AuraFace/buffalo_l pilot on real faces)

| Band | Cosine similarity | Action |
|------|-----------------|--------|
| REPEAT | ≥ 0.45 | Auto-identify → salesperson alert with name + last interest |
| UNCERTAIN | 0.30–0.45 | Alert duty salesperson with "possible match – please confirm" + photo |
| NEW | < 0.30 | Create anonymous customer, salesperson alerted "new visitor" |

---

## 7. Celery Task Catalogue

```
tasks/
├── recognition.py
│   └── process_recognition_event     # core match + route + claim/assignment + alert
├── whatsapp.py
│   ├── send_template_message         # Meta Cloud API POST with retry
│   ├── send_freeform_message         # free-form text inside the 24h window (AI or human)
│   ├── process_inbound_webhook       # save inbound; set last_inbound_at; route to handler
│   └── update_message_status         # delivered/read/failed status updates
├── ai.py
│   ├── draft_followup                # Claude: visit history + deal state → draft, signed as primary
│   └── handle_inbound_reply          # handler_mode='ai' & window open → draft → auto-send OR queue for approval
├── followup.py
│   ├── schedule_customer_followups   # after first contact; creates followups rows (cadence)
│   └── send_due_followups            # Celery Beat (30min): window CLOSED → re-engage template; else trigger ai.draft_followup
└── pipeline.py
    └── close_stale_followups         # Celery Beat: daily; auto-cancel followups for Won/Lost
```

### Celery Beat Schedule

```python
CELERYBEAT_SCHEDULE = {
    "send-due-followups": {
        "task": "tasks.followup.send_due_followups",
        "schedule": crontab(minute="*/30"),    # every 30 min
    },
    "close-stale-followups": {
        "task": "tasks.pipeline.close_stale_followups",
        "schedule": crontab(hour=1, minute=0), # 1am daily
    },
}
```

### Follow-up Cadence Engine

```
Proactive cadence (only while pipeline ∈ {new, talking, follow_up} AND customers.ai_followup_enabled = TRUE):
Day 0  →  customer_thank_you template (MARKETING — only if whatsapp_marketing=TRUE)
Day 2  →  followup_nudge template       (re-opens the 24h window)
Day 5  →  followup_nudge template       (different variable)
Day 10 →  followup_nudge (final)

Conversational layer (the v2.2 addition):
- WINDOW CLOSED (>24h since last_inbound_at): only an approved TEMPLATE may go out — the cadence above IS
  the re-engagement mechanism. Free-form AI text is not allowed by Meta here.
- CUSTOMER REPLIES → window opens 24h, last_inbound_at updated → ai.handle_inbound_reply fires:
    • handler_mode='human' → DO NOT auto-reply; flag the human handler + collaborators via Realtime; show in shared thread.
    • handler_mode='ai'    → ai.draft_followup builds context and drafts a reply signed as the PRIMARY salesperson:
        - customers.ai_autosend = FALSE → save message draft_status='pending_approval'; ping assignees to approve/edit/send.
        - customers.ai_autosend = TRUE  → send_freeform_message now; log sender_type='ai', sent_as_salesperson_id=primary.
- MANUAL OVERRIDE: any active assignee taps "Take over" → handler_mode='human', handler_salesperson_id=them; AI
  pauses on this thread. "Release" (or inactivity timeout) → back to 'ai' if the owner left ai_followup_enabled=TRUE.
- AI GUARDRAILS (ADR-15): never assert a price/delivery date unless it comes from a structured field; never invent
  stock; on anything it can't ground, it drafts "let me confirm and revert" and flags the human.
- STOP → consents.whatsapp_marketing = FALSE; cancel pending followups; mute AI for that customer.
- Won or Lost → cancel pending followups; mute AI.
```

---

## 8. WhatsApp Integration (Meta Cloud API Direct)

### Setup (Week 0 — start immediately, approval can take 2–5 days)

1. Create Meta App (Business type) at developers.facebook.com.
2. Add WhatsApp product → register the Topaz phone number.
3. Submit Meta Business Verification (company docs).
4. Submit all 4 templates for approval (approval: minutes to 48h).
5. Configure webhook: `https://topaz.dmc.digital/api/whatsapp/webhook`.
6. Subscribe to `messages` + `message_status_updates` fields.

### Sending (httpx async)

```python
async def send_template(self, msg: OutboundMessage) -> str:
    payload = {
        "messaging_product": "whatsapp",
        "to": msg.wa_id,
        "type": "template",
        "template": {
            "name": msg.template_name,
            "language": {"code": msg.language_code},
            "components": msg.components,
        },
    }
    r = await self._client.post(
        f"https://graph.facebook.com/v20.0/{self._phone_number_id}/messages",
        headers={"Authorization": f"Bearer {self._access_token}"},
        json=payload,
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()["messages"][0]["id"]   # wamid
```

### Inbound Webhook Handler

```python
async def handle_webhook(request: Request) -> Response:
    # 1. Verify X-Hub-Signature-256 HMAC-SHA256 over raw body
    # 2. Parse payload; extract messages[] and statuses[]
    # 3. For each message: dedupe on wamid (INSERT ... ON CONFLICT DO NOTHING)
    # 4. Dispatch: tasks.whatsapp.process_inbound_webhook.delay(message_dict)
    # 5. Return 200 immediately (Meta retries on non-200)
```

### 8.1 24-hour window + handler state machine (v2.2)

```
Every inbound customer message:
  1. dedupe (wamid) → save message (direction=inbound, sender_type=customer)
  2. customers.last_inbound_at = now()   → the 24h free-form window is now OPEN
  3. STOP?  → mute marketing + cancel followups + ack; done.
  4. route by customers.handler_mode:
       'human' → no auto-reply; Realtime-flag the human handler + collaborators; show in shared thread
       'ai'    → tasks.ai.handle_inbound_reply (draft → auto-send if ai_autosend else queue for approval)

Every outbound attempt chooses channel by the window:
  window OPEN  (now − last_inbound_at ≤ 24h) → free-form text allowed (AI reply or human typing)
  window CLOSED                              → approved TEMPLATE only (re-engagement cadence)

"Send as salesperson" = content personalisation, NOT a second number:
  outbound always from the single Topaz number; body signed "— {primary.name}, Topaz";
  the message row records sender_type, sender_salesperson_id (human) / sent_as_salesperson_id (AI).
```

---

## 9. File/Folder Structure

```
topaz-showroom-intelligence/
├── CLAUDE.md
├── docker-compose.yml                # backend: api + worker + beat + redis (+ edge)
├── .env.example
├── supabase/                         # Supabase project (DB schema + RLS, CLI-managed)
│   ├── config.toml
│   └── migrations/                   # SQL migrations (tables from §4 + RLS policies)
├── apps/
│   ├── prototype/                    # existing working demo — reuse M1 logic
│   ├── edge/                         # edge worker (camera → API)
│   │   ├── pyproject.toml
│   │   └── src/
│   │       ├── config.py
│   │       ├── capture.py            # OpenCV threaded frame buffer
│   │       ├── recognizer.py         # buffalo_l wrapper (ported from prototype)
│   │       └── publisher.py          # HTTP POST to /api/recognition + cooldown
│   ├── backend/                      # FastAPI: recognition + WhatsApp + Celery
│   │   ├── pyproject.toml
│   │   └── src/
│   │       ├── main.py               # FastAPI app factory
│   │       ├── config.py             # pydantic-settings
│   │       ├── database.py           # async SQLAlchemy engine → Supabase Postgres
│   │       ├── repositories/         # data access layer (repository pattern)
│   │       │   ├── embedding_repo.py # pgvector ANN queries live here
│   │       │   ├── customer_repo.py
│   │       │   ├── visit_repo.py
│   │       │   ├── message_repo.py
│   │       │   └── followup_repo.py
│   │       ├── api/
│   │       │   ├── recognition.py    # POST /api/recognition
│   │       │   ├── whatsapp.py       # Meta webhook (verify + inbound)
│   │       │   └── health.py
│   │       ├── tasks/
│   │       │   ├── celery_app.py     # Celery app factory + Beat schedule
│   │       │   ├── recognition.py
│   │       │   ├── whatsapp.py
│   │       │   ├── ai.py             # Claude draft_followup + handle_inbound_reply
│   │       │   ├── followup.py
│   │       │   └── pipeline.py
│   │       └── services/
│   │           ├── matching.py       # cosine bands (ported from prototype, pure logic)
│   │           ├── whatsapp_adapter.py  # MetaCloudAdapter + WhatsAppAdapter ABC
│   │           ├── assignment_service.py # claim, add collaborator, coverage handoff, set primary
│   │           ├── ai_followup.py    # Claude client + prompt/context builder + guardrails (ADR-15)
│   │           ├── handler_service.py   # handler_mode arbitration (take over / release)
│   │           ├── consent_service.py
│   │           ├── followup_engine.py
│   │           └── storage.py        # Supabase Storage signed-URL helper
│   └── web/                          # Next.js 15 dashboard (Vercel)
│       ├── package.json
│       ├── next.config.ts
│       ├── lib/
│       │   ├── supabase/             # browser + server clients (@supabase/ssr)
│       │   └── types.ts              # generated Supabase DB types
│       └── app/
│           ├── login/page.tsx        # phone-OTP login
│           ├── consent/page.tsx      # DPDPA consent kiosk
│           ├── dashboard/
│           │   ├── page.tsx          # my customers + Realtime alerts + "new customer — claim" + coverage requests
│           │   ├── customers/[id]/page.tsx  # shared WhatsApp thread, AI drafts to approve, take-over/release, assignees
│           │   └── actions.ts        # server actions (claimCustomer, takeOverThread, approveAiDraft, requestCoverage, addCollaborator, setPrimary, logConversation, updateCustomer…)
│           └── owner/
│               ├── page.tsx          # pipeline board + metrics
│               └── salespersons/page.tsx
└── docs/
    ├── EXECUTION_PLAN.md             # this file
    └── MONOREPO.md
```

---

## 10. Environment Variables

**Backend (`apps/backend/.env`)**

```bash
# Supabase Postgres (direct connection for FastAPI/Celery via asyncpg)
DATABASE_URL=postgresql+asyncpg://postgres:PASS@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server-side only; bypasses RLS for Celery writes
SUPABASE_STORAGE_BUCKET=topaz-captures

# Redis / Celery
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1

# WhatsApp (Meta Cloud API)
META_WHATSAPP_TOKEN=EAA...            # System User access token (long-lived)
META_PHONE_NUMBER_ID=12345678
META_WABA_ID=98765432
META_WEBHOOK_VERIFY_TOKEN=your_random_token
META_APP_SECRET=abc123                # HMAC webhook signature verification

# AI follow-up (Claude)
ANTHROPIC_API_KEY=sk-ant-...          # drafts conversational follow-ups (tasks/ai.py)
ANTHROPIC_MODEL=claude-sonnet-4-6     # draft model; cheap + fast for short WhatsApp replies

# App
EDGE_API_KEY=...                      # edge worker auth
CAMERA_ID=bhatar_entrance_01
SHOWROOM_NAME=Topaz Furniture Bhatar
MATCH_THRESHOLD=0.45
NEW_THRESHOLD=0.30
```

**Frontend (`apps/web/.env.local`)**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # public; RLS enforces access
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server actions only (never shipped to client)
NEXT_PUBLIC_BACKEND_URL=https://api.topaz.dmc.digital
```

---

## 11. Docker Compose (development)

Postgres is **Supabase** (managed) — not in compose. Locally, run `supabase start` (Supabase CLI) for a local Postgres+Auth+Storage stack, or point `DATABASE_URL` at a cloud Supabase project. Compose runs only the backend processes:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build: apps/backend
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
    env_file: apps/backend/.env
    depends_on: [redis]
    ports:
      - "8000:8000"
    volumes:
      - ./apps/backend:/app

  worker:
    build: apps/backend
    command: celery -A src.tasks.celery_app worker --loglevel=info -c 4
    env_file: apps/backend/.env
    depends_on: [redis]

  beat:
    build: apps/backend
    command: celery -A src.tasks.celery_app beat --loglevel=info
    env_file: apps/backend/.env
    depends_on: [redis]

  edge:
    build: apps/edge
    command: python -m src
    env_file: apps/backend/.env
    devices:
      - /dev/video0:/dev/video0     # USB webcam (swap for RTSP in prod)
```

The Next.js app (`apps/web`) runs on Vercel; locally `npm run dev`. Supabase schema is managed by `supabase db push` from `supabase/migrations/`.

---

## 12. Build Sequence (single-phase delivery)

Delivered as **one phase, one handover** — no commercial phasing; **payment in full on delivery & acceptance**.
The weeks below are the **logical build order and dependency chain**, not billing milestones. Under the
AI-assisted 24/7 sprint (**Opus 4.8 plan/review → Sonnet 4.6 execute → Haiku 4.5 workers**) the calendar
compresses materially — the ordering is what matters, not the literal week count.

### Week 0 — Setup + Meta submission (parallel tracks, start immediately)

**Track A — Infrastructure**

- [ ] Create Supabase project; enable `vector` extension; apply §4 schema via `supabase/migrations/` (`supabase db push`)
- [ ] Write RLS policies: salesperson sees only assigned customers; owner = admin; service-role for backend
- [ ] Provision backend VM (DO Droplet 4 vCPU / 8GB ~$48/mo) for FastAPI + Celery + Redis + edge
- [ ] `apps/backend/` scaffold: FastAPI app factory, async SQLAlchemy → Supabase Postgres
- [ ] `apps/web/` scaffold: Next.js 15 + Tailwind + shadcn/ui + Supabase clients; deploy to Vercel
- [ ] Generate Supabase TS types into `apps/web/lib/types.ts`
- [ ] CI: GitHub Actions → backend `ruff + pytest` (pure logic, no ML) · web `tsc + eslint + next build`

**Track B — Meta / WhatsApp (start day 1 — approval takes days)**

- [ ] Create Meta App (Business), add WhatsApp product, register Topaz phone number
- [ ] Submit Business Verification documents
- [ ] Draft + submit all 4 templates for approval
- [ ] Configure webhook URL + subscribe to fields

**Track C — Prototype migration**

- [ ] Port `apps/prototype/src/faces/matching.py` (pure cosine logic) → `apps/backend/src/services/matching.py`
- [ ] Port `FaceRecognizer` → `apps/edge/src/recognizer.py` (buffalo_l stays)

---

### Week 1 — Recognition pipeline + consent

- [ ] `embedding_repo.py`: `find_nearest_n(embedding, n=5)` using pgvector HNSW query
- [ ] `tasks/recognition.py`: `process_recognition_event` (idempotency, band classify, write visit)
- [ ] `POST /api/recognition` endpoint with API key auth
- [ ] Consent service: write consent record, enforce face_tracking gate (DB trigger + app check)
- [ ] Kiosk consent UI: Next.js `/consent` page → writes `consents` via Supabase
- [ ] Edge worker: `apps/edge/` publishes recognition events to API
- [ ] Unit tests: matching bands, embedding repo (mocked DB), idempotency

---

### Week 2 — Salesperson alerts + CRM

- [ ] `tasks/whatsapp.py`: `send_template_message` via MetaCloudAdapter
- [ ] MetaCloudAdapter implementation (httpx async, retry on 5xx / 429 with backoff)
- [ ] Salesperson "arrived" alert: REPEAT + NEW branches with correct template vars
- [ ] UNCERTAIN branch: duty salesperson alert + photo attachment
- [ ] Server actions: `logConversation`, `updateCustomer` (Next.js, write to Supabase)
- [ ] Mobile dashboard: Next.js `/dashboard` — assigned customer list + inline edit (shadcn/ui)
- [ ] Supabase Realtime: dashboard subscribes to `visits` channel → salesperson sees alert instantly in browser

---

### Week 3 — WhatsApp inbound + conversational AI follow-up

- [ ] Inbound webhook: HMAC verify, dedupe on wamid, save to messages, set `customers.last_inbound_at`
- [ ] `tasks/whatsapp.py`: `process_inbound_webhook` + `send_freeform_message` (in-window text)
- [ ] STOP handler: set `consents.whatsapp_marketing = FALSE`, cancel pending followups, mute AI
- [ ] Follow-up engine: `schedule_customer_followups` creates followups rows (Day 0/2/5/10)
- [ ] `send_due_followups` Celery Beat: window CLOSED → re-engagement template; else trigger AI draft
- [ ] **`tasks/ai.py` + `ai_followup.py`**: Claude client, context builder (visit history + deal state), guardrails (ADR-15)
- [ ] **`handle_inbound_reply`**: handler_mode routing; `ai_autosend` → send vs queue `draft_status='pending_approval'`
- [ ] **Shared thread UI** `/dashboard/customers/[id]`: full history, approve/edit/send AI drafts
- [ ] **Take over / release** (`handler_service.py` + server actions): flips `handler_mode`, pauses AI on that thread
- [ ] Message status updates webhook (delivered/read/failed → update messages.status)

---

### Week 4 — Pipeline + Owner dashboard

- [ ] Server action `movePipelineStage`: move to won/lost, add closing_notes
- [ ] `close_stale_followups` Beat task: cancel all pending followups for Won/Lost customers
- [ ] Owner dashboard: Next.js `/owner` — pipeline board (New/Follow-up/Won/Lost columns), daily activity
- [ ] Metrics: visits today, new vs repeat, conversion rate (Won / total), follow-up response rate
- [ ] Customer detail page: `/dashboard/customers/[id]` — full visit timeline + conversation + message log

---

### Week 5 — Supabase Storage + photo flow

- [ ] Supabase Storage private bucket `topaz-captures`; `storage.py` signed-URL helper (service role)
- [ ] Edge worker uploads crop before posting recognition event
- [ ] REPEAT alert: photo not attached (salesperson knows who it is)
- [ ] NEW/UNCERTAIN alert: attach 1h signed URL to WhatsApp notification
- [ ] Periodic cleanup: delete crops older than 90 days (DPDPA retention)

---

### Week 6 — Auth + multi-salesperson assignment + coverage handoff

- [ ] Supabase Auth: phone-OTP login at Next.js `/login`; session via `@supabase/ssr`
- [ ] RLS-based roles: `owner` (admin) vs `salesperson`; RLS scopes a salesperson to customers where they are in `customer_assignments` (primary OR collaborator)
- [ ] **Claim flow**: NEW visit → broadcast alert to all `available` salespersons → first to tap "I'll take it" wins (atomic insert into `customer_assignments` as primary; loser sees "already claimed")
- [ ] **Returning customer** → notify only the active primary; if primary `available=FALSE` → open `coverage_requests` + notify the primary to hand off
- [ ] **Coverage handoff** (`assignment_service.py`): teammate accepts → added as collaborator → optional "Make me primary" (demotes old primary to collaborator; respects the one-primary index)
- [ ] **Shared visibility**: collaborators see the full thread + history; owner sees everyone
- [ ] **Per-customer AI toggle** (`ai_followup_enabled`) + **auto-send toggle** (`ai_autosend`) on the customer page (owner)
- [ ] Owner: manage salesperson list + availability (`/owner/salespersons`), view all customers

---

### Week 7 — Hardening + performance + DPDPA

- [ ] Load test: `locust` — recognition pipeline throughput at 10 rps sustained
- [ ] pgvector `HNSW` index tuned: `SET hnsw.ef_search = 40` for quality/speed balance
- [ ] DPDPA checklist: withdrawal flow (server action → cascade delete + storage purge), deletion within 72h on request, audit_log verified complete
- [ ] Error boundaries: dead-letter queue for failed Celery tasks, alert to owner WhatsApp on repeated failures
- [ ] Rate limiting: `slowapi` on API endpoints; 429 handling on Meta API calls
- [ ] Observability: structured logging (structlog), Sentry for error tracking, basic Prometheus metrics endpoint

---

### Week 8 — Go-live at Bhatar + training

- [ ] Hardware on-site: camera mount, edge device, network run
- [ ] RTSP URL in edge worker config (one-line change from webcam index)
- [ ] On-site consent signage printed + displayed
- [ ] Staff training: 2-hour session — consent kiosk, mobile dashboard, how to log meetings, pipeline moves
- [ ] Soft go-live: 2-day shadow mode (alerts fire but staff verify manually)
- [ ] Hard go-live: full automated flow
- [ ] **45-day support window begins**

---

## 13. Edge Cases & Error Handling

| Scenario | Handling |
|----------|---------|
| Camera offline | Edge worker reconnects with exponential backoff; alert sent to owner after 5min |
| No face detected | Discard frame silently; no event |
| Quality score < 0.4 | Reject embedding; log as low-quality visit (no customer match attempted) |
| pgvector returns empty | Treat as NEW (gallery is empty or all consents withdrawn) |
| UNCERTAIN band | Alert duty salesperson with photo link; await manual confirm before creating customer record |
| Meta API 429 | Celery retry with exponential backoff (30s, 5min, 30min); task moves to dead-letter after 3 attempts |
| Meta API template rejected | Celery marks message as `failed`; logs alert to owner; does not retry |
| STOP message received | Synchronously cancel all pending followups; set consent flag; acknowledge with "You've been unsubscribed" (free-form, if window open) |
| Inbound message, window closed | Save message; flag salesperson via Supabase Realtime; do not auto-reply |
| Duplicate wamid | `ON CONFLICT DO NOTHING`; return 200 immediately |
| Database connection lost | SQLAlchemy pool reconnects; Celery tasks retry |
| Customer requests data deletion | Admin UI: delete all rows with customer_id cascade; log to audit_log |

---

## 14. Deployment (Vercel + DO VM + Supabase)

```
Production topology:
  - Vercel: Next.js dashboard (apps/web)
    — Hobby free for one showroom; Pro ~$20/mo if needed
  - DO Droplet: 4 vCPU / 8GB RAM — FastAPI + Celery worker + Beat + edge worker
    (~$48/month)  [edge worker can run on-site Pi instead]
  - Supabase: Postgres 16 + pgvector + Auth + Realtime + Storage
    — Free tier covers one showroom; Pro $25/mo (8GB DB, daily backups, no pausing)
  - Redis via Upstash (serverless) or on the Droplet — ~$0–10/month
  - Total infra: ~$70–95/month (₹6,000–8,000/month)

Frontend deploy: git push → Vercel auto-build & deploy (preview per PR, prod on main).
Backend deploy: git push → GitHub Actions → SSH to Droplet + `docker compose up -d --build`.
SSL: Vercel manages frontend TLS; Caddy/Nginx + Let's Encrypt for the FastAPI API subdomain.
Schema: `supabase db push` from `supabase/migrations/` (versioned SQL).
Backups: Supabase Pro daily backups + PITR; weekly `pg_dump` to a separate bucket as belt-and-braces.
```

---

## 15. Monitoring & Observability

| Tool | Purpose |
|------|---------|
| structlog | Structured JSON logs (every request, every Celery task) |
| Sentry (free tier) | Exception tracking + task failure alerts |
| Prometheus + Grafana Cloud (free tier) | `recognition_events_total`, `whatsapp_sent_total`, `task_duration_seconds`, `db_pool_size` |
| Celery Flower | Celery task monitoring UI (`/flower`) — internal only |
| Uptime check | UptimeRobot (free) → ping `/api/health` every 5min |

---

## 16. Security Checklist

- [ ] API key for edge worker (rotatable per device); separate from staff auth
- [ ] Staff auth via Supabase Auth (phone OTP); short-lived JWT issued by Supabase
- [ ] **RLS on every table** — salesperson scoped to assigned customers; service-role key server-side only
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never shipped to the browser (server actions / backend only)
- [ ] All secrets in env vars / Vercel + DO secret stores — never in source
- [ ] Meta webhook HMAC-SHA256 verified on every inbound
- [ ] Supabase Storage: private bucket, signed URLs only (1h expiry); no public objects
- [ ] Face embeddings encrypted at rest (Supabase Postgres encryption at rest)
- [ ] SQL: SQLAlchemy parameterised queries only; no raw string interpolation
- [ ] Input validation: Pydantic (backend) + zod (Next.js server actions)
- [ ] Rate limiting: slowapi on FastAPI public endpoints; Vercel/Supabase platform limits on frontend
- [ ] CORS: explicit allowed origins only (Vercel domain + API subdomain)
- [ ] HTTPS enforced; HSTS header set

---

## 17. DPDPA 2023 Compliance Checklist

- [ ] Three unbundled consents collected before any face stored (face_tracking, personal_data, whatsapp_marketing)
- [ ] Consent is free, specific, informed, unconditional
- [ ] Signage at entrance: "This showroom uses face recognition. Tap here to opt in / out."
- [ ] Withdrawal flow live: owner/staff action → cascade delete (customer + embeddings + crops) within 72h
- [ ] Data minimisation: only store embeddings + minimal metadata; raw frames deleted after crop extraction
- [ ] Captures auto-deleted after 90 days
- [ ] Audit log is append-only; all deletions logged
- [ ] DMC builds compliance system; Topaz (Hemant Grover) is the Data Fiduciary and operates opt-in
- [ ] Full obligations: ~May 2027; building compliant now

---

## 18. Cost Model

### Build value vs price

Priced at **₹1,50,000 + GST** (founding-partner/referral price). Standard build value **₹2,40,000** — the gap
is a deliberate discount against Hemant's commitment to introduce DMC to other showroom owners. Value split:

| Component | Value (₹) |
|-----------|----------:|
| Face recognition + edge worker | 60,000 |
| Multi-salesperson CRM + assignment + coverage handoff + visit history | 50,000 |
| Conversational AI WhatsApp follow-up engine (Claude + 24h window + override) | 70,000 |
| Owner dashboard + pipeline + shared thread + reports | 30,000 |
| WhatsApp Business setup + DPDPA consent + compliance | 20,000 |
| Deployment + training + post-go-live support | 10,000 |
| **Total value** | **2,40,000** |

### Running cost (client opex, from go-live)

| Item | Monthly (₹) |
|------|------------|
| DO Droplet (FastAPI + Celery + Redis + edge) | ≈ 4,000 |
| Supabase Pro (DB + Auth + Realtime + Storage) | ≈ 2,100 ($25) |
| Vercel (Hobby free; Pro if needed) | 0–1,700 |
| Claude API (AI follow-up drafts — short replies, low volume) | ≈ 500–1,500 |
| WhatsApp Marketing templates (~100 sends/month) | ≈ 1,100 (₹1.09 × 100 × 1.18 GST) |
| WhatsApp Utility (salesperson alerts, 500/mo) | ≈ 70 (≈FREE inside 24h window; tiny overflow) |
| Sentry + monitoring (free tiers) | 0 |
| **Total monthly** | **≈ ₹8,000–10,500/month** |

> Free-tier path (one showroom, low volume): Supabase Free + Vercel Hobby + Droplet ≈ ₹4,000 + WhatsApp ≈ ₹1,200 → **~₹5,200/month**. Recommend Pro tiers once live for backups + no DB pausing.

---

## 19. Pre-Build Hardening — Audit Findings (apply during the build)

> Independent audit (architect + database-reviewer + security-reviewer) on v2.2. **Verdict: GO-WITH-FIXES** — architecture sound, no redesign required; the items below are what make it *correct and compliant*. **‡ = cross-confirmed by ≥2 reviewers** (high confidence).

### A. Concurrency primitives — wrong here = a real customer gets a wrong/double message

1. **Claim "first tap wins" ‡** — one statement, never read-then-insert:
   ```sql
   INSERT INTO customer_assignments (customer_id, salesperson_id, role, active)
   VALUES ($1, $2, 'primary', TRUE)
   ON CONFLICT (customer_id) WHERE role = 'primary' AND active = TRUE
   DO NOTHING RETURNING id;
   -- no row returned = lost the race → UI shows "already claimed". Drive the lock from THIS, not Realtime order.
   ```
2. **Coverage handoff (demote→promote) ‡** — one transaction, demote first, then upsert-promote:
   ```sql
   BEGIN;
   UPDATE customer_assignments SET role='collaborator'
     WHERE customer_id=$1 AND role='primary' AND active=TRUE;
   INSERT INTO customer_assignments (customer_id, salesperson_id, role, added_by, active)
     VALUES ($1, $2, 'primary', $3, TRUE)
     ON CONFLICT (customer_id, salesperson_id) DO UPDATE SET role='primary', active=TRUE;
   COMMIT;  -- never promote-then-demote (the one-primary index rejects it)
   ```
   Rule for ADR-13: **returning from leave does NOT auto-reclaim primary** (must be requested).
3. **AI-vs-human double-send ‡** — re-check at SEND time, not draft time: `SELECT ... FOR UPDATE` the customers row inside `send_freeform_message`, re-read `handler_mode` + `ai_autosend`, abort if `handler_mode='human'` or `ai_autosend=FALSE`. Take-over also `FOR UPDATE`s the same row.
4. **Follow-up Beat dedupe** — claim each due row atomically: `UPDATE followups SET status='sending' WHERE id=$1 AND status='pending' RETURNING ...`; re-check the 24h window immediately before send.

### B. Realtime + RLS — the claim alert won't arrive otherwise ‡

- A NEW-visit alert has **no `customer_assignments` row yet**, so an RLS-filtered Postgres-changes subscription delivers it to **nobody**. Use a Realtime **Broadcast** channel for "new customer — claim", OR a dedicated `alerts` table with policy "all `available` salespersons may read unclaimed alerts." **Prove end-to-end in Week 1, not Week 6.**
- RLS scoping uses the cached-uid + security-definer pattern (per-row `auth.uid()` is a perf trap):
  ```sql
  CREATE FUNCTION is_assigned_to_customer(p UUID) RETURNS BOOLEAN
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT EXISTS (SELECT 1 FROM customer_assignments
      WHERE customer_id=p AND salesperson_id=(SELECT auth.uid()) AND active=TRUE); $$;
  -- use is_assigned_to_customer(customer_id) in policies on messages / visits / conversations.
  ```
- **`salespersons.id` MUST equal `auth.uid()`** (or add `auth_uid UUID UNIQUE` and key RLS on it) ‡ — otherwise every policy silently returns empty.

### C. Schema fixes (into the migration, Week 0) — database-reviewer

- **Indexes** (hottest first): `messages(customer_id, created_at DESC)`, `customer_assignments(salesperson_id)`, partial `customer_assignments(customer_id) WHERE active`, `visits(customer_id, occurred_at DESC)`, `face_embeddings(customer_id)`, `messages(draft_status) WHERE draft_status='pending_approval'`, + every remaining FK (18+ total).
- **CHECK/enums**: `handler_mode IN ('ai','human')`, `sender_type`, `direction`, `draft_status`, `visits.match_band`; consistency CHECK `(handler_mode='ai' AND handler_salesperson_id IS NULL) OR (handler_mode='human' AND handler_salesperson_id IS NOT NULL)`.
- `gen_random_uuid()` instead of `uuid_generate_v4()` (drop uuid-ossp). `updated_at` BEFORE-UPDATE triggers on customers/conversations/followups/pipeline_stages/messages (add `messages.updated_at`).
- **Migration order**: all enums first; `visits` before `coverage_requests`; numbered files 001 extensions → 016 rls.

### D. pgvector recall — database-reviewer

- Enforce consent at **write time** (trigger), then **drop the consent join from the ANN query** — the join is a post-filter that defeats the HNSW index and silently degrades recall. Correct query: `SELECT customer_id, 1-(embedding <=> $1) AS similarity FROM face_embeddings ORDER BY embedding <=> $1 LIMIT 5;`. Set `hnsw.ef_search` via `SET LOCAL` in the query fn (not deferred to Week 7).
- **Cosine bands 0.45/0.30 are synthetic-tuned ‡** — budget **one real-camera tuning day** (~20 volunteers, build same/different ROC, set thresholds from real data; keep env-driven).

### E. DPDPA / consent — fix BEFORE real faces ‡

- **Capture-before-consent is the #1 legal gap.** Inference + crop upload currently happen for every walk-in before consent exists. Fix: edge runs inference **in-memory**, persists **nothing** (no embedding row, no Storage crop) unless a kiosk consent token exists for that session; zero the embedding after the window. Never write an embedding against a FALSE-consent stub (fixes §6.2 step 5).
- Remove `signage_implicit` and `verbal` from `consents.method`. Walk-ins who never consent → retain **zero** (anonymous footfall count only).
- **Consent withdrawal must purge Storage**, not just DB: fetch `visits.photo_key`s → `storage.remove()` → delete customer (cascade) → `audit_log` each step. Add the withdrawal cascade trigger on `consents` (DB cascade does NOT touch Storage).

### F. AI safety & WhatsApp policy — before go-live ‡

- **Disclose automation**: append e.g. *"(sent on behalf of {name} by Topaz's digital assistant)"* to every `ai_generated` message, enforced structurally in the send functions (Meta Business Policy + IT Act §66D personation risk). Not owner-optional.
- **Launch draft-only** (`ai_autosend=FALSE` everywhere) — removes the most dangerous race; graduate later. Add a **global `ai_enabled` kill switch** + a per-day Claude cost ceiling (fallback to draft-only on breach).
- **Prompt injection**: wrap customer text in a delimited `<customer_message>` block, instruct the model to treat it as untrusted, log every draft + prompt to `audit_log`. Consent copy must state messages may be sent by an automated system on the salesperson's behalf.

### G. Secrets & infra — before real data / go-live — security-reviewer

- **Remove `SUPABASE_SERVICE_ROLE_KEY` from the Next.js env entirely ‡** — route elevated writes through FastAPI; CI grep fails the build if the key appears in `apps/web/.env*` or any `NEXT_PUBLIC_`.
- **Redis**: `requirepass` + remove the `6379:6379` port mapping (internal network only) + firewall. **Celery**: don't pass the raw 512-d embedding as a task arg (plaintext in Redis) — stash in Redis w/ 60s TTL, pass the key; msgpack/encrypted serializer; disable RDB or encrypt the volume.
- **Webhook**: 32-byte random `META_WEBHOOK_VERIFY_TOKEN`; startup assert on `META_APP_SECRET` length; Redis-set dedupe of `(wamid,status)` (replay defense). **Edge**: API key in OS keyring (not plaintext `.env`), per-camera key + revoke, validate `camera_id` matches key, VLAN-isolate. **Flower**: basic-auth + firewall 5555. **Logs**: redact `embedding/photo_key/phone/wa_id` at the structlog processor (free-tier logs store in US → cross-border concern for biometrics).

### H. RLS test suite — release-blocking, Week 1 (not Week 7) ‡

pytest against `supabase start`, 3 personas (owner / assigned SP / unrelated SP): assigned-only SELECT; SP cannot INSERT consents or face_embeddings; SP cannot UPDATE owner-only toggles; SP reads only its own salespersons row; anon can INSERT consent only; audit_log append-only. A leaked-row test failure **blocks release**.

### I. Repo & build reconciliation — Week 0 — architect

- Plan says `apps/backend`/`apps/web`; the **existing repo has `apps/api`/`apps/dashboard`/`packages/shared`**. Pick one, update the other, and **keep `packages/shared`** for the Edge↔API `RecognitionEvent` contract.
- `MetaCloudAdapter` + webhook is **net-new** (prototype WhatsApp is Twilio/AiSensy BSP) — scope as fresh Week 2-3 work; **keep the BSP adapters as the Meta-verification fallback.**

### J. Timeline re-baseline ‡

The long pole is **Meta Business Verification (1–3 weeks, can be rejected)** + hardware on-site + one tuning week — none compress with AI coding. Commit Hemant to **"software handover in 10–15 days; live recognition gated on Meta verification + hardware + tuning."** Submit Meta verification **Day 0**, BSP fallback ready.

---

*TOPAZ-EXEC-PLAN-v2.3 · DMC Digital · 24 June 2026 · audit-hardened (GO-WITH-FIXES) · Next.js + Supabase · FastAPI + Celery + Meta Cloud API · Claude AI follow-up · multi-salesperson · buffalo_l*
