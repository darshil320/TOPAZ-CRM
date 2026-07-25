# Topaz Showroom Intelligence — End-to-End Product Documentation

**Version:** 1.0 · **Updated:** July 2026  
> **Status:** Production (deployed on Railway + Vercel + Supabase)

---

## Table of Contents

1. [What This Product Is](#1-what-this-product-is)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Data Model](#4-data-model)
5. [System Layers & Internal Logic](#5-system-layers--internal-logic)
6. [Web App — Next.js Dashboard](#6-web-app--nextjs-dashboard)
7. [Key Business Flows (End-to-End)](#7-key-business-flows-end-to-end)
8. [API Contract Reference](#8-api-contract-reference)
9. [WhatsApp Templates](#9-whatsapp-templates)
10. [Environment Variables](#10-environment-variables)
11. [Compliance & Legal Constraints](#11-compliance--legal-constraints)
12. [Known Gaps & Open Items](#12-known-gaps--open-items)

---

## 1. What This Product Is

Topaz Showroom Intelligence is a **Sales Conversion Engine** built for Topaz Furniture (Surat/Bhatar). It turns anonymous showroom traffic into tracked relationships by:

1. **Recognising customers at the entrance** via face recognition — with full DPDPA consent.
2. **Alerting the right salesperson** instantly on WhatsApp when a customer (new or returning) enters.
3. **Assigning customers** to one primary salesperson + optional collaborators, with coverage handoff when the primary is on leave.
4. **Following up automatically** via a conversational AI assistant (Claude), which drafts WhatsApp messages signed as the assigned salesperson — governed by Meta's 24-hour messaging window.
5. **Surfacing the full pipeline** on a real-time dashboard (Next.js on Vercel) so the owner sees New → Talking → Won/Lost at a glance.

**What this product is NOT:**

- A general catalog chatbot for arbitrary product/price queries (planned as a separate later module)
- A multi-showroom or multi-camera system (single entrance, Bhatar only)
- Instagram/Facebook/Google lead capture (later phase)

---

## 2. High-Level Architecture

```
┌─────────────────── SHOWROOM (Bhatar) ───────────────────┐
│                                                           │
│  ┌─────────────────┐                                      │
│  │  4MP IP Camera  │  RTSP stream                         │
│  │  (USB fallback) │──────────────┐                       │
│  └─────────────────┘              ▼                       │
│                       ┌──────────────────────────┐         │
│                       │  Edge Worker (VM/Pi/Mac)  │         │
│                       │  InsightFace buffalo_l    │         │
│                       │  detect → embed → POST    │         │
│                       └─────────────┬────────────┘         │
└─────────────────────────────────────────────────────────-─┘
                                      │ POST /api/recognition (API key auth)
                                      ▼
   ┌──────────────────────────────────────┐    ┌────────────────────────────────┐
   │   FastAPI Backend  (Railway)          │    │   Next.js 15 (Vercel)           │
   │                                       │    │                                 │
   │   POST /api/recognition               │    │   /dashboard  (salesperson)     │
   │   POST /api/whatsapp/webhook          │    │   /owner      (pipeline)        │
   │   GET  /api/whatsapp/webhook          │    │   /consent    (DPDPA kiosk)    │
   │   POST /api/whatsapp/send             │    │   /login      (phone OTP)       │
   │   POST /api/enrollment                │    │                                 │
   │   GET  /api/health                    │    └──────────────┬─────────────────┘
   └──────────────┬────────────────────────┘                   │ supabase-js
                  │            │                               │ RLS-scoped reads
                  │  ┌─────────▼──────────┐                   │ + Realtime sub
                  │  │      Redis 7        │                   │
                  │  │  broker + result    │                   │
                  │  └─────────┬──────────┘                   │
                  │  ┌─────────▼──────────┐                   │
                  │  │   Celery Workers    │                   │
                  │  │   + Celery Beat     │                   │
                  │  │  recognition.*      │                   │
                  │  │  whatsapp.*         │                   │
                  │  │  ai.*              │                   │
                  │  │  followup.*         │                   │
                  │  │  pipeline.*         │                   │
                  │  └─────────┬──────────┘                   │
                  │ asyncpg    │ asyncpg                       │
                  ▼            ▼                               ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                         SUPABASE                                   │
   │                                                                    │
   │  Postgres 16 + pgvector 0.7 (HNSW cosine ANN)                     │
   │  Auth (phone OTP + Row Level Security)                             │
   │  Realtime (Postgres changes → WebSocket push)                      │
   │  Storage (private bucket: face crops, signed URLs)                 │
   │                                                                    │
   │  Tables: customers · face_embeddings · consents · visits ·         │
   │  salespersons · customer_assignments · coverage_requests ·         │
   │  conversations · messages · followups · pipeline_stages ·          │
   │  audit_log                                                         │
   └──────────────────────────────────────────────────────────────────┘
                  │  HTTPS (Celery whatsapp.send)
                  ▼
   ┌──────────────────────────────┐
   │  Meta Cloud API              │
   │  graph.facebook.com/v20      │
   │  /messages · /webhook        │
   └──────────────────────────────┘
```

**Live Update Loop:**  
Celery/FastAPI write events to Supabase → Supabase Realtime pushes Postgres changes via WebSocket → Next.js dashboard receives alert → salesperson sees "Customer arrived" instantly, without polling.

---

## 3. Technology Stack

### Backend (FastAPI + Celery — Railway)

| Layer | Technology | Version |
|---|---|---|
| Language | Python | 3.12 |
| API framework | FastAPI + Uvicorn | 0.115 / 0.32 |
| DB driver | SQLAlchemy 2.0 (async) + asyncpg | 2.0 |
| Migrations | Supabase CLI (SQL) | — |
| Task queue | Celery 5 + Celery Beat | 5.4 |
| Cache / Broker | Redis | 7 |
| Face recognition | InsightFace (buffalo_l) + ONNX Runtime | 0.7 / 1.18 |
| Image | OpenCV-Python | 4.10 |
| WhatsApp | Meta Cloud API (direct, v20) | — |
| AI follow-up | Anthropic Claude API | claude-haiku-4-5 |
| Validation | Pydantic v2 | 2.8 |
| HTTP client | httpx (async) | 0.27 |
| Config | pydantic-settings | 2.x |
| Testing | pytest + pytest-asyncio | — |
| Linting | Ruff | 0.6 |
| Container | Docker + docker-compose | — |

### Frontend (Next.js — Vercel)

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router (RSC) | 15 |
| Language | TypeScript | 5.x |
| UI | React + Tailwind CSS + shadcn/ui | 19 / 3.4 |
| Auth & Data | @supabase/supabase-js + @supabase/ssr | 2.x |
| Forms | react-hook-form + zod | — |
| Hosting | Vercel | — |

### Data Platform (Supabase)

| Layer | Technology |
|---|---|
| Database | Supabase Postgres 16 + pgvector 0.7 |
| Auth | Supabase Auth (phone OTP + RLS) |
| Realtime | Supabase Realtime (Postgres changes subscription) |
| Object storage | Supabase Storage (private bucket, 1h signed URLs) |

---

## 4. Data Model

### Entity Relationships

```
consents ──→ customers ──→ face_embeddings
                │
                ├──→ customer_assignments ──→ salespersons
                │
                ├──→ visits ──→ coverage_requests
                │
                ├──→ conversations
                │
                ├──→ messages
                │
                ├──→ followups
                │
                └──→ pipeline_stages
```

### Key Tables

#### `consents`

Three unbundled DPDPA consents. A face embedding row **cannot** exist without `face_tracking = TRUE`.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `face_tracking` | BOOLEAN | Gate for biometric data |
| `personal_data` | BOOLEAN | Gate for CRM data |
| `whatsapp_marketing` | BOOLEAN | Gate for marketing messages |
| `method` | TEXT | `'kiosk'` \| `'signage_implicit'` \| `'verbal'` |
| `withdrawn_at` | TIMESTAMPTZ | When consent was revoked |

#### `customers`

Central entity. Contains AI follow-up controls per customer.

| Column | Type | Description |
|---|---|---|
| `consent_id` | UUID FK | Must reference a valid consent |
| `wa_id` | TEXT UNIQUE | WhatsApp ID (phone without `+`) |
| `ai_followup_enabled` | BOOLEAN | Owner's master AI toggle per customer |
| `ai_autosend` | BOOLEAN | `FALSE` = drafts await approval; `TRUE` = auto-send |
| `handler_mode` | TEXT | `'ai'` \| `'human'` — who drives the WhatsApp thread |
| `handler_salesperson_id` | UUID FK | Set when a human takes over |
| `last_inbound_at` | TIMESTAMPTZ | Drives the 24h free-form window |

#### `face_embeddings`

ArcFace 512-dimensional vectors with HNSW cosine index.

```sql
CREATE INDEX face_embeddings_hnsw_idx
    ON face_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m=16, ef_construction=64);
```

#### `visits`

Every detected entrance event (NEW / REPEAT / UNCERTAIN).

| Column | Type | Description |
|---|---|---|
| `match_band` | TEXT | `'NEW'` \| `'REPEAT'` \| `'UNCERTAIN'` |
| `match_score` | REAL | Cosine similarity (0–1) |
| `raw_event_id` | UUID UNIQUE | Idempotency key from edge worker |
| `photo_key` | TEXT | Supabase Storage object key |

#### `customer_assignments`

Many-to-many: one customer, multiple salespeople (one primary + N collaborators).

```sql
-- Enforces: exactly ONE active primary per customer (partial unique index)
CREATE UNIQUE INDEX one_active_primary_per_customer
    ON customer_assignments (customer_id)
    WHERE role = 'primary' AND active = TRUE;
```

#### `messages`

Full audit trail of every WhatsApp message: inbound, outbound (human), and AI-drafted.

| Column | Type | Description |
|---|---|---|
| `sender_type` | TEXT | `'ai'` \| `'salesperson'` \| `'customer'` \| `'system'` |
| `sent_as_salesperson_id` | UUID FK | Identity the AI signed as ("— Ramesh") |
| `draft_status` | TEXT | `'pending_approval'` \| `'approved'` \| `'rejected'` (AI drafts only) |
| `ai_generated` | BOOLEAN | Flags AI-authored content |

### pgvector Similarity Query

```sql
-- Find top-5 nearest face embeddings for an incoming 512-d vector $1
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

**Matching bands (applied in application layer, not SQL):**

| Band | Cosine Similarity | Action |
|---|---|---|
| REPEAT | ≥ 0.45 | Auto-identify → alert primary salesperson with name + last interest |
| UNCERTAIN | 0.30 – 0.45 | Alert duty salesperson with "possible match – please confirm" + photo |
| NEW | < 0.30 | Create anonymous customer, alert all available salespersons to claim |

---

## 5. System Layers & Internal Logic

### 5.1 Edge Worker — Camera to API

**Location:** `apps/edge/src/`

The edge worker is intentionally **stateless** — it captures frames, runs face detection, and posts events to the API. All matching logic lives in the API's Celery task.

```
Camera (RTSP/USB)
  → OpenCV VideoCapture (threaded frame buffer — avoids blocking I/O)
  → FaceRecognizer.detect(frame)        [InsightFace buffalo_l]
  → quality_score filter: reject < 0.4  [low-quality/blurry frames discarded]
  → L2-normalise embedding              [unit-sphere normalisation for cosine ANN]
  → upload face crop to Supabase Storage (async, before POST)
  → POST /api/recognition {
        raw_event_id,   ← UUID generated here, used for idempotency
        embedding,      ← 512 floats
        quality_score,
        photo_key,      ← storage object key
        camera_id,
        captured_at
    }
  → cooldown_tracker: suppress re-fire for same estimated face for 30s
```

**Key Design Choices:**

- Stateless: can run on a Raspberry Pi 5, laptop, or VM.
- Cooldown tracker prevents duplicate events for the same person lingering at the entrance.
- Photo upload happens *before* the POST so the key is valid when the Celery task fires.

### 5.2 FastAPI Backend

**Location:** `apps/api/src/`

The FastAPI app is a **thin dispatch layer** — it validates, authenticates, and hands off to Celery. No business logic lives in routes.

```
apps/api/src/
├── main.py              ← FastAPI app factory; mounts all routers
├── config.py            ← pydantic-settings; validated at startup; fails fast on missing secrets
├── database.py          ← async SQLAlchemy engine → Supabase Postgres (asyncpg)
├── api/
│   ├── auth.py          ← POST /api/auth/link-salesperson (first-login Supabase UID linking)
│   ├── enrollment.py    ← POST /api/enrollment (kiosk customer + consent + embedding registration)
│   ├── recognition.py   ← POST /api/recognition (edge events → Celery queue)
│   └── whatsapp.py      ← GET + POST /api/whatsapp/webhook; POST /api/whatsapp/send
├── repositories/        ← Data Access Layer (repository pattern; pure DB queries, no logic)
│   ├── assignment_repo.py
│   ├── customer_repo.py
│   ├── embedding_repo.py    ← pgvector ANN queries
│   ├── enrollment_repo.py
│   ├── followup_repo.py
│   ├── message_repo.py
│   ├── salesperson_repo.py
│   └── visit_repo.py
├── services/            ← Pure business logic (unit-testable, no I/O)
│   ├── matching.py          ← cosine band classification
│   ├── templates.py         ← WhatsApp template variable builders
│   ├── wa_webhook.py        ← pure Meta payload parsers (InboundTextMessage, StatusUpdate)
│   └── wa_window.py         ← 24-hour window check logic
└── tasks/               ← Celery task definitions
```

**Security Design:**

- Edge → API: `EDGE_API_KEY` header (pre-shared secret).
- Meta → webhook: `X-Hub-Signature-256` HMAC-SHA256 over raw body using `WA_APP_SECRET`. Fail-closed: if `WA_TOKEN` is set but `WA_APP_SECRET` is not, the webhook rejects with 503.
- Dashboard → send: `DASHBOARD_API_KEY` header; server action only, never exposed to browser.

### 5.3 Celery Task Engine

**Location:** `apps/api/src/tasks/`

All async/background work runs through Celery with Redis as broker and result backend. Celery Beat runs two scheduled tasks.

```
tasks/
├── celery_app.py           ← Celery app factory + Beat schedule
├── recognition.py          ← process_recognition_event (core pipeline)
├── whatsapp.py             ← send_template_message, send_freeform_message,
│                              process_inbound_webhook, update_message_status
├── ai.py                   ← draft_followup, handle_inbound_reply
├── followup.py             ← schedule_customer_followups, send_due_followups
└── pipeline.py             ← close_stale_followups
```

**Celery Beat Schedule:**

| Task | Schedule | Purpose |
|---|---|---|
| `tasks.followup.send_due_followups` | Every 30 min | Window closed → template; window open → trigger AI draft |
| `tasks.pipeline.close_stale_followups` | Daily at 1 AM | Cancel pending followups for Won/Lost customers |

#### `process_recognition_event` — Core Recognition Logic

```python
# Simplified internal logic:
def process_recognition_event(raw_event_id, embedding, quality_score, photo_key, camera_id, captured_at):
    # 1. IDEMPOTENCY CHECK
    #    Check visits.raw_event_id — if exists, skip (safe retry on Celery restart)

    # 2. pgvector ANN QUERY
    #    SELECT top-5 nearest embeddings WHERE consents.face_tracking = TRUE
    #    Compute cosine similarity = 1 - cosine_distance

    # 3. BAND CLASSIFICATION
    #    similarity >= 0.45 → REPEAT
    #    0.30 <= similarity < 0.45 → UNCERTAIN
    #    similarity < 0.30 (or no match) → NEW

    # 4. ROUTE BY BAND
    #    REPEAT:    load customer + primary salesperson → send salesperson_arrival_alert template
    #    NEW:       create anonymous customer + consent stub → broadcast to all available salespersons
    #    UNCERTAIN: alert duty salesperson with "possible match" + signed photo URL

    # 5. WRITE VISIT ROW
    #    INSERT visits (customer_id, match_band, match_score, photo_key, raw_event_id)

    # 6. PIPELINE INIT
    #    If first visit for this customer → INSERT pipeline_stages (stage='new')

    # 7. SCHEDULE FOLLOW-UP
    #    If whatsapp_marketing consent = TRUE → schedule_customer_followups.delay()
    #    Also: draft_followup.delay() to pre-create the Day-0 AI draft
```

### 5.4 AI Follow-Up System

**Location:** `apps/api/src/tasks/ai.py`

The AI system uses **Anthropic Claude** (claude-haiku-4-5) to draft personalised WhatsApp follow-ups signed as the assigned salesperson.

#### `draft_followup` Task — Internal Logic

```python
async def _draft_followup(customer_id, visit_id):
    # 1. Load customer — skip if ai_followup_enabled=FALSE or alerts_muted=TRUE
    # 2. Load primary salesperson name from customer_assignments
    # 3. Fetch last 3 messages for conversation context
    # 4. Build LLM prompt:
    #    System: "You are {salesperson_name}, a sales consultant at Topaz Furniture..."
    #    User: "Customer: {name}. Interest: {primary_interest}. Recent chat: [...]. Write a follow-up."
    # 5. Call Claude API (claude-haiku-4-5, max 200 tokens)
    #    On failure → fall back to hardcoded template body
    # 6. Save message row:
    #    direction='outbound', sender_type='ai',
    #    draft_status='pending_approval'  (if ai_autosend=FALSE)
    #    OR → send immediately via send_freeform_message  (if ai_autosend=TRUE)
```

**AI Guardrails (ADR-15):**

- Never assert a price or delivery date unless it comes from a structured DB field.
- Never invent stock or availability.
- If it cannot ground a claim, it drafts "let me confirm and revert" and flags the human handler.
- Max 80 words, plain text only, no markdown, no bullet points.
- Signs off as `— {salesperson_name}, Topaz`.

#### `handle_inbound_reply` Task — Internal Logic

```python
async def _handle_inbound(wa_id, content, wamid, received_at):
    # 1. Look up customer by wa_id (WhatsApp number)
    # 2. Save inbound message (direction='inbound', sender_type='customer')
    # 3. Update customers.last_inbound_at → opens/resets the 24h free-form window
    # 4. Route by handler_mode:
    #    'human' → Realtime notification to human handler + collaborators; no auto-reply
    #    'ai' + ai_followup_enabled=TRUE → queue draft_followup.delay()
```

### 5.5 WhatsApp Integration

**Outbound (Celery → Meta Cloud API):**

```python
# Every outbound message checks the window first:
def choose_channel(customer):
    window_open = (now() - customer.last_inbound_at) <= timedelta(hours=24)
    if window_open:
        return "freeform"    # AI reply or human text — no template needed
    else:
        return "template"    # Must use Meta-approved template to re-open the window
```

**Inbound (Meta → FastAPI webhook):**

```
POST /api/whatsapp/webhook
  1. Verify X-Hub-Signature-256 HMAC-SHA256 (constant-time compare)
  2. Parse payload: extract messages[] + statuses[]
  3. For each message: queue handle_inbound_reply.delay()
  4. For each status: update messages.status via update_status_by_wamid
  5. Return 200 immediately — Meta retries on non-200 (safe: wamid deduplication)
```

**24-Hour Window State Machine:**

```
Customer sends message
         │
         ▼
last_inbound_at = now()    ← 24h window OPEN
         │
         ├── handler_mode = 'human' ──→ Realtime flag to human; no auto-reply
         │
         └── handler_mode = 'ai' ────→ draft_followup queued
                                             │
                                   ai_autosend=FALSE → draft_status='pending_approval'
                                             │        salesperson sees ⏳ chip → taps Send
                                   ai_autosend=TRUE  → send_freeform_message now
                                                        (sender_type='ai', signed as primary)

> 24h since last_inbound_at (window CLOSED)
         ▼
send_due_followups Beat task
         └──→ Send APPROVED TEMPLATE (re-opens the window on customer reply)
```

### 5.6 Supabase Data Platform

**Row Level Security (RLS) Rules:**

| Role | Access Scope |
|---|---|
| `salesperson` | Can only read/write customers in `customer_assignments` where they are active (primary OR collaborator) |
| `owner` | Full admin access to all tables |
| `service_role` | Used by FastAPI/Celery (bypasses RLS for backend writes) |

**Realtime Channels:**

- `visits` table `INSERT` → pushed to connected salesperson dashboards.
- `messages` table `INSERT` → shared conversation thread updates live.

**Storage:**

- Bucket: `topaz-captures` (private).
- Face crops uploaded by edge worker before recognition POST.
- 1-hour signed URLs generated for WhatsApp photo attachments (NEW/UNCERTAIN cases).
- Periodic cleanup: delete crops older than 90 days (DPDPA retention compliance).

---

## 6. Web App — Next.js Dashboard

**Location:** `apps/dashboard/src/`

### 6.1 Routes & Pages

| Route | Access | Purpose |
|---|---|---|
| `/login` | Public | Supabase phone-OTP login |
| `/consent` (kiosk) | Public | DPDPA consent capture for new customers |
| `/dashboard` | Salesperson | My assigned customers + live visit alerts |
| `/dashboard/customers/[id]` | Salesperson | Customer detail: visits, shared thread, AI draft approval |
| `/dashboard/walkins` | Salesperson | Unassigned/recent walk-ins to claim |
| `/owner` | Admin (owner) | Pipeline board + daily metrics |
| `/owner/salespersons` | Admin (owner) | Manage staff list + assignments + availability |

### 6.2 Component Architecture

```
src/
├── app/
│   ├── layout.tsx               ← Root layout; Supabase session provider
│   ├── page.tsx                 ← Root redirect (→ /login or /dashboard)
│   ├── login/page.tsx           ← Phone OTP form
│   ├── kiosk/                   ← Consent kiosk (tablet-optimised)
│   ├── dashboard/
│   │   ├── layout.tsx           ← Sidebar + mobile nav; Realtime subscription setup
│   │   ├── page.tsx             ← Customer list + live alert banner
│   │   ├── loading.tsx          ← Skeleton loader
│   │   ├── actions.ts           ← Server actions for this section
│   │   ├── customers/
│   │   │   └── [id]/page.tsx    ← Customer detail + conversation thread
│   │   └── walkins/             ← Walk-in claim queue
│   └── owner/
│       ├── layout.tsx           ← Owner sidebar + nav
│       ├── page.tsx             ← Pipeline kanban board
│       ├── loading.tsx
│       └── salespersons/page.tsx ← Staff management
├── components/
│   ├── Sidebar.tsx              ← Navigation sidebar (role-aware nav items)
│   ├── MobileNav.tsx            ← Bottom nav for mobile salesperson view
│   ├── MobileBrand.tsx          ← Header brand for mobile
│   ├── AvailabilityToggle.tsx   ← Salesperson on-duty toggle
│   ├── VisitAlertBanner.tsx     ← Real-time "Customer arrived" banner
│   ├── SignOutButton.tsx        ← Auth sign-out
│   ├── Skeleton.tsx             ← Loading skeleton components
│   └── nav-config.tsx           ← Role-based navigation configuration
├── hooks/                       ← Custom React hooks
└── lib/
    ├── supabase/                ← Browser + server Supabase client factories
    └── types.ts                 ← Generated Supabase DB TypeScript types
```

#### `VisitAlertBanner.tsx` — Internal Logic

```typescript
// Subscribes to Supabase Realtime on the 'visits' table
// On INSERT → fetches the new visit (with customer + salesperson join)
// If the visit is relevant to the current salesperson (via RLS):
//   → shows a banner: "🔔 Repeat customer Priya has arrived — last wanted teak dining sets"
// Auto-dismisses after 30s
// Uses: supabase.channel('visit-alerts')
//         .on('postgres_changes', { event: 'INSERT', table: 'visits' }, handler)
```

#### `AvailabilityToggle.tsx` — Internal Logic

```typescript
// Reads salespersons.available for the current user
// On toggle → server action updates salespersons.available = !current
// If switching to FALSE (going on leave):
//   → Triggers coverage_request creation for active customers
```

### 6.3 Server Actions & Mutations

All mutations run as **Next.js Server Actions** on the server with the user's Supabase session. The browser never receives the service role key.

| Server Action | What It Does |
|---|---|
| `claimCustomer` | Atomic INSERT into `customer_assignments` as primary (first-tap wins via unique index) |
| `logConversation` | INSERT into `conversations` with notes, budget, products |
| `updateCustomer` | Update customer name, phone, interest, budget |
| `movePipelineStage` | Update `pipeline_stages.stage` (new/talking/follow_up/won/lost) |
| `cancelFollowup` | Set `followups.status = 'cancelled'` |
| `approveAiDraft` | Set `messages.draft_status = 'approved'` → triggers send via `/api/whatsapp/send` |
| `takeOverThread` | Set `handler_mode = 'human'`, `handler_salesperson_id = current user` |
| `releaseThread` | Set `handler_mode = 'ai'` (if `ai_followup_enabled = TRUE`) |
| `addCollaborator` | INSERT into `customer_assignments` with `role='collaborator'` |
| `setPrimary` | Owner: demote old primary to collaborator, set new primary |
| `reassignSalesperson` | Owner: full reassignment |
| `requestCoverage` | Create `coverage_requests` row when primary goes on leave |

### 6.4 Realtime Subscriptions

The dashboard layout sets up Supabase Realtime subscriptions on mount:

```typescript
// Channel 1: New visit alerts (salesperson view)
supabase.channel('visit-alerts')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visits' },
    (payload) => {
      // RLS ensures this only fires for visits relevant to current salesperson
      showAlertBanner(payload.new)
    })
  .subscribe()

// Channel 2: Message updates (shared thread, live)
supabase.channel('message-updates')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
      filter: `customer_id=eq.${customerId}` },
    (payload) => { appendMessage(payload.new) })
  .subscribe()
```

### 6.5 Auth & RLS Scope

- Login: Supabase phone OTP → session stored in cookies via `@supabase/ssr`.
- Middleware (`src/middleware.ts`): redirects unauthenticated requests → `/login`.
- **Salesperson scope:** RLS policy ensures a salesperson can only see customers where they have an active `customer_assignments` row (primary or collaborator).
- **Owner scope:** `salespersons.role = 'owner'` bypasses salesperson-scoped policies via `is_admin()` RLS function.

---

## 7. Key Business Flows (End-to-End)

### 7.1 New Customer Arrival

```
Camera detects face
  ↓
Edge worker: embed → quality filter → POST /api/recognition
  ↓
FastAPI: authenticate API key → queue process_recognition_event
  ↓
Celery: idempotency check (raw_event_id already processed? skip)
  ↓
pgvector ANN → similarity < 0.30 → band = NEW
  ↓
Create anonymous customer row + consent stub
  ↓
INSERT visit (match_band='NEW', match_score, photo_key)
  ↓
INSERT pipeline_stages (stage='new')
  ↓
Send WhatsApp template (salesperson_arrival_alert) to ALL available salespersons
  "🔔 New customer has arrived at the showroom. Time: {timestamp}."
  (+ signed photo URL attached for NEW cases)
  ↓
Dashboard (Realtime): all available salespersons see banner
  → first to tap "Claim" wins
  ↓
claimCustomer server action → atomic INSERT into customer_assignments (primary)
  → losing salespersons see "Already claimed"
  ↓
Schedule follow-up cadence (if whatsapp_marketing consent = TRUE)
  + queue Day-0 AI draft
```

### 7.2 Repeat Customer Arrival

```
Camera detects face
  ↓
Edge: embed → POST /api/recognition
  ↓
Celery: pgvector ANN → similarity ≥ 0.45 → band = REPEAT
  ↓
Load: customer name, primary_interest, assigned primary salesperson
  ↓
Send WhatsApp alert to PRIMARY salesperson only:
  "🔔 Repeat customer – Priya has arrived. Last wanted: teak dining sets."
  ↓
Dashboard (Realtime): primary salesperson sees banner with customer context
  ↓
INSERT visit, update pipeline_stages if needed
  ↓
If primary.available = FALSE → open coverage_request + notify primary
```

### 7.3 AI Follow-Up Cadence

```
Day 0:  customer_thank_you template  (MARKETING — only if whatsapp_marketing=TRUE)
Day 2:  followup_nudge template      (re-opens the 24h window)
Day 5:  followup_nudge template      (different variable set)
Day 10: followup_nudge template      (final nudge)

Celery Beat every 30 min:
  → Query followups WHERE status='pending' AND scheduled_at <= now()
  → For each due followup:
      window CLOSED (>24h) → send approved template
      window OPEN   (<24h) → trigger ai.draft_followup
                              (Claude drafts contextual reply signed as primary)
```

### 7.4 Inbound Customer Reply

```
Customer replies on WhatsApp
  ↓
Meta sends POST to /api/whatsapp/webhook
  ↓
FastAPI: verify HMAC signature → parse inbound → queue handle_inbound_reply
  ↓
Celery: look up customer by wa_id
  ↓
Save message (direction='inbound', sender_type='customer')
  ↓
Update customers.last_inbound_at → window OPEN (24h reset)
  ↓
Route by handler_mode:
  ├── 'human' → Realtime notification to human handler + collaborators; no auto-reply
  └── 'ai' + ai_followup_enabled=TRUE
          → queue draft_followup
            ├── ai_autosend=FALSE → save draft (pending_approval)
            │                       salesperson sees ⏳ chip → taps "Send" to approve
            └── ai_autosend=TRUE  → send_freeform_message immediately
                                    (sender_type='ai', signed as primary)
```

### 7.5 Human Takeover & Release

```
Salesperson taps "Take over" on customer thread
  ↓
takeOverThread server action:
  customers.handler_mode = 'human'
  customers.handler_salesperson_id = salesperson.id
  customers.handler_since = now()
  ↓
AI pauses — draft_followup skips customers where handler_mode='human'
  ↓
Salesperson sends messages manually
  ↓
Salesperson taps "Release" (or inactivity timeout)
  ↓
releaseThread server action:
  customers.handler_mode = 'ai'
  customers.handler_salesperson_id = NULL
  (only if customers.ai_followup_enabled = TRUE)
  ↓
AI resumes on next inbound or scheduled followup
```

### 7.6 Consent Kiosk & DPDPA Gate

```
Customer at entrance kiosk (tablet)
  ↓
Next.js /consent page (public — no auth required)
  ↓
Customer sees three separate checkboxes (unbundled — DPDPA requirement):
  [ ] Face recognition tracking
  [ ] Personal data storage (name, phone)
  [ ] WhatsApp marketing messages
  ↓
Submit → POST /api/enrollment
  ↓
FastAPI:
  1. INSERT consents (method='kiosk', ip, given_at)
  2. INSERT customers (FK to consent)
  3. If face_tracking=TRUE AND embedding provided:
     INSERT face_embeddings  ← HARD GATE enforced by DB FK + app check
```

### 7.7 Coverage Handoff (Primary on Leave)

```
Primary salesperson marks available=FALSE (going on leave)
  ↓
For each active customer where they are primary:
  → CREATE coverage_requests (status='open', requested_by=primary)
  → Notify available teammates via WhatsApp
  ↓
Teammate taps "Cover"
  ↓
assignment_service.accept_coverage():
  → INSERT customer_assignments (role='collaborator') for teammate
  → coverage_requests.status = 'claimed', claimed_by = teammate
  ↓
Optional: teammate taps "Make me primary"
  → old primary assignment active=FALSE
  → teammate promoted to primary (partial unique index enforced)
  → coverage_requests.became_primary = TRUE, status = 'closed'
```

---

## 8. API Contract Reference

### FastAPI Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/recognition` | `EDGE_API_KEY` header | Recognition event from edge worker → Celery |
| POST | `/api/whatsapp/webhook` | HMAC-SHA256 (`WA_APP_SECRET`) | Inbound messages + delivery statuses from Meta |
| GET | `/api/whatsapp/webhook` | Verify token query param | Meta webhook registration challenge |
| POST | `/api/whatsapp/send` | `DASHBOARD_API_KEY` header | Dashboard → enqueue outbound message |
| POST | `/api/enrollment` | None (public kiosk) | New customer consent + face enrollment |
| POST | `/api/auth/link-salesperson` | Supabase session | First-login: link auth UID to salespersons row |
| GET | `/api/health` | None | Liveness probe |

### Recognition Event Schema (Edge → API)

```python
class RecognitionEvent(BaseModel):
    raw_event_id: UUID        # idempotency key; generated by edge worker
    embedding: list[float]    # 512 floats, L2-normalised
    quality_score: float      # insightface det_score; reject < 0.4
    captured_at: datetime
    camera_id: str            # "bhatar_entrance_01"
    photo_key: str | None     # Supabase Storage object key (uploaded before POST)
```

### Outbound Send Schema (Dashboard → API)

```python
class SendRequest(BaseModel):
    wa_id: str      # phone without + (validated: digits only, >=10 chars)
    content: str    # validated: non-empty
    message_id: str # messages.id — the send task updates its status
```

---

## 9. WhatsApp Templates

All 4 templates are submitted to Meta for approval (Week 0 — can take 2-48h).

| # | Name | Category | Variables | Use Case |
|---|---|---|---|---|
| 1 | `salesperson_arrival_alert` | UTILITY | customer type, last interest, timestamp | Salesperson notified on customer entry |
| 2 | `customer_thank_you` | MARKETING | customer name, products, salesperson name | Day-0 thank-you (requires `whatsapp_marketing` consent) |
| 3 | `followup_nudge` | MARKETING | customer name, interest, showroom name | Re-engagement on Day 2/5/10 |
| 4 | `quote_ready` | UTILITY | customer name, product, amount, salesperson | Quote notification |

> **24-Hour Rule:** Templates 2, 3, 4 (sent to customers) go when the 24h window is CLOSED (re-engagement). Inside the window, free-form text is allowed. Template 1 goes to *salespersons*, not customers.

---

## 10. Environment Variables

### Backend (`apps/api/.env`)

```bash
# Supabase
DATABASE_URL=postgresql+asyncpg://postgres:PASS@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server-side only; bypasses RLS
SUPABASE_STORAGE_BUCKET=topaz-captures

# Redis / Celery
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/1

# WhatsApp (Meta Cloud API)
WA_TOKEN=EAA...                       # System User access token (long-lived)
META_PHONE_NUMBER_ID=12345678
META_WABA_ID=98765432
WA_WEBHOOK_VERIFY_TOKEN=your_random_token
WA_APP_SECRET=abc123                  # HMAC webhook signature verification

# AI follow-up (Claude)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# App
EDGE_API_KEY=...                      # edge worker auth
DASHBOARD_API_KEY=...                 # dashboard → /api/whatsapp/send auth
CAMERA_ID=bhatar_entrance_01
SHOWROOM_NAME=Topaz Furniture Bhatar
MATCH_THRESHOLD=0.45
NEW_THRESHOLD=0.30
```

### Frontend (`apps/dashboard/.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # public; RLS enforces access
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server actions only (never shipped to client)
NEXT_PUBLIC_BACKEND_URL=https://api.topaz.dmc.digital
DASHBOARD_API_KEY=...                 # server action → FastAPI /send
```

---

## 11. Compliance & Legal Constraints

These are **binding constraints** from the feasibility report — violating them is a defect:

### 1. DPDPA Consent-First (Highest Legal Risk)

No face embedding, capture photo, or match may exist for anyone without prior, explicit `face_tracking` consent. Enforced via DB FK chain (`face_embeddings.customer_id` → `customers.consent_id`) + app-layer check in enrollment service. Passive/ambient capture is unlawful under India's DPDPA.

### 2. WhatsApp 24-Hour Window

Free-form messages (AI or human) only inside the 24h customer-service window. Outside it: only pre-approved templates. Every outbound message routes through the window-check chokepoint.

### 3. Price & Stock via DB Only

Embeddings discover context. The DB answers price/stock/availability. AI never states a price or delivery date unless it comes from a structured DB field.

### 4. Face Recognition as Staff-Assist, Not Access Gate

85-95% field accuracy → always expose NEW/REPEAT/**UNCERTAIN** band. Never auto-assert identity for uncertain matches.

### 5. Consent Withdrawal (INCOMPLETE — see §12)

`cascade_on_consent_withdrawal` DB trigger purges `face_embeddings` on withdrawal. Storage face-crop files: **not yet purged** (DPDPA risk — must fix before go-live).

---

## 12. Known Gaps & Open Items

| # | Gap | Risk | Required Action |
|---|---|---|---|
| 1 | **Consent withdrawal: Storage purge** | DPDPA legal risk | Build server action to delete `topaz-captures/*.{customer_id}` on consent withdrawal |
| 2 | **`coverage_requests`** | Missing feature | Schema + RLS exists but no repository, Celery task, or UI. Build before relying on coverage handoff |
| 3 | **`conversations` table** | Dead code | Schema defined, RLS'd, indexed — but zero reads/writes anywhere. Build meeting-notes feature or drop the table (requires explicit sign-off) |
| 4 | **Primary salesperson self-serve handoff** | UX gap | A primary cannot hand off without the owner; `ca_insert` RLS is owner-only by design (§19-A.2) |
| 5 | **Autostart service for edge worker** | Ops risk | Edge code is complete but no systemd/launchd autostart on the entrance machine |
| 6 | **Rate limiting** | Security | `slowapi` on API endpoints + 429 handling on Meta API calls not yet implemented |
| 7 | **Dead-letter queue** | Reliability | No dead-letter queue for failed Celery tasks; no alerting to owner on repeated failures |

---

*Generated by DMC Digital. Source of truth for architecture decisions: [`docs/EXECUTION_PLAN.md`](EXECUTION_PLAN.md). Source of truth for deployment status: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).*
