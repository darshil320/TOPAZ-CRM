-- Topaz CRM — 0002 · core tables (dependency order, §19-hardened)
-- Depends on 0001 (vector ext + enums). gen_random_uuid() is a PG16 builtin.
-- Indexes are in 0003; functions/triggers in 0004; RLS in 0005.

-- ─── salespersons ──────────────────────────────────────────────────────────
-- id = stable internal CRM identity. auth_uid links to Supabase Auth, set on the
-- salesperson's first phone-OTP login (owner pre-creates the row). RLS maps
-- auth.uid() → salespersons.id via current_salesperson_id() in 0004 (§19-B).
create table salespersons (
    id          uuid primary key default gen_random_uuid(),
    auth_uid    uuid unique,                              -- Supabase auth.uid(); null until first login
    name        text not null,
    whatsapp    text not null unique,                     -- E.164: +919XXXXXXXXX
    role        text not null default 'salesperson' check (role in ('salesperson', 'owner')),
    active      boolean not null default true,            -- employed / has a login
    available   boolean not null default true,            -- present today (false = on leave → coverage flow)
    created_at  timestamptz not null default now()
);

-- ─── consents ────────────────────────────────────────────────────────────────
-- Three unbundled consents. method excludes 'signage_implicit'/'verbal' (§19-E):
-- biometric consent must be explicit and individually recorded.
create table consents (
    id                 uuid primary key default gen_random_uuid(),
    face_tracking      boolean not null default false,
    personal_data      boolean not null default false,
    whatsapp_marketing boolean not null default false,
    method             text not null check (method in ('kiosk', 'app', 'web_form')),
    given_at           timestamptz not null default now(),
    ip                 text,
    withdrawn_at       timestamptz
);

-- ─── customers ───────────────────────────────────────────────────────────────
-- One WhatsApp thread per customer (single number) → thread/window/handler state
-- lives here (architect H4). The conversations table is meeting-notes only.
create table customers (
    id                     uuid primary key default gen_random_uuid(),
    consent_id             uuid not null references consents(id),
    name                   text,
    phone                  text,
    wa_id                  text unique,                   -- WhatsApp ID (phone without +)
    budget_range           text,
    primary_interest       text,
    -- AI follow-up control (§19-A/F) ---------------------------------------
    ai_followup_enabled    boolean not null default true,  -- owner per-customer master toggle
    ai_autosend            boolean not null default false, -- false = draft + human approve (launch default)
    handler_mode           text not null default 'ai' check (handler_mode in ('ai', 'human')),
    handler_salesperson_id uuid references salespersons(id),
    handler_since          timestamptz,
    last_inbound_at        timestamptz,                    -- drives the 24h free-form window
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    -- ai ⇒ no human handler; human ⇒ a human handler (§19-C)
    constraint customers_handler_consistency check (
        (handler_mode = 'ai'    and handler_salesperson_id is null)
     or (handler_mode = 'human' and handler_salesperson_id is not null)
    )
);

-- ─── face_embeddings ───────────────────────────────────────────────────────
-- HARD GATE: inserts blocked unless face_tracking consent is active (trigger in 0004).
-- The ANN query does NOT join consents (§19-D) — the write-time gate guarantees
-- every stored embedding is consented, so the HNSW index keeps full selectivity.
create table face_embeddings (
    id            uuid primary key default gen_random_uuid(),
    customer_id   uuid not null references customers(id) on delete cascade,
    embedding     vector(512) not null,                   -- ArcFace 512-d, L2-normalised
    model_version text not null default 'buffalo_l',
    quality_score real,
    enrolled_at   timestamptz not null default now()
);

-- ─── visits ──────────────────────────────────────────────────────────────────
create table visits (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid references customers(id),          -- null = uncertain / anonymous footfall
    salesperson_id uuid references salespersons(id),       -- null until claimed
    occurred_at    timestamptz not null default now(),
    match_score    real,
    match_band     text not null check (match_band in ('NEW', 'REPEAT', 'UNCERTAIN')),
    photo_key      text,                                   -- Storage key; set ONLY if consented (§19-E)
    raw_event_id   uuid unique not null                    -- edge-worker idempotency key
);

-- ─── customer_assignments (many-to-many: one primary + collaborators) ────────
create table customer_assignments (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id) on delete cascade,
    salesperson_id uuid not null references salespersons(id),
    role           assignment_role not null default 'primary',
    added_by       uuid references salespersons(id),       -- who looped them in (null = system, e.g. first claim)
    active         boolean not null default true,
    created_at     timestamptz not null default now(),
    unique (customer_id, salesperson_id)
);
-- Exactly one active primary per customer. ALSO the ON CONFLICT arbiter for the
-- atomic "first tap wins" claim (§19-A.1) and the demote→promote handoff (§19-A.2).
create unique index one_active_primary_per_customer
    on customer_assignments (customer_id)
    where role = 'primary' and active = true;

-- ─── coverage_requests (primary on leave → teammate covers) ──────────────────
-- MUST be created after visits (FK to visits) — §19-C ordering.
create table coverage_requests (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id) on delete cascade,
    visit_id       uuid references visits(id),             -- the live revisit that triggered it
    requested_by   uuid not null references salespersons(id),  -- the absent primary
    claimed_by     uuid references salespersons(id),       -- teammate who covered
    became_primary boolean not null default false,         -- did the coverer take over as primary?
    status         coverage_status not null default 'open',
    created_at     timestamptz not null default now(),
    resolved_at    timestamptz
);

-- ─── conversations (meeting notes only — thread state is on customers) ───────
create table conversations (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id),
    salesperson_id uuid references salespersons(id),
    visit_id       uuid references visits(id),
    budget         text,
    products       text[],
    notes          text,
    stage_at_time  text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ─── pipeline_stages ─────────────────────────────────────────────────────────
create table pipeline_stages (
    customer_id   uuid primary key references customers(id),
    stage         pipeline_stage not null default 'new',
    closing_notes text,
    updated_at    timestamptz not null default now()
);

-- ─── messages (WhatsApp; multi-salesperson + AI attribution) ─────────────────
create table messages (
    id                     uuid primary key default gen_random_uuid(),
    customer_id            uuid not null references customers(id),
    wamid                  text unique,                    -- Meta message id (dedupe key)
    direction              text not null check (direction in ('outbound', 'inbound')),
    category               text,                           -- 'marketing' | 'utility' | 'service'
    template_name          text,
    content                text not null,
    sender_type            text not null default 'customer'
                             check (sender_type in ('ai', 'salesperson', 'customer', 'system')),
    sender_salesperson_id  uuid references salespersons(id),   -- human who actually sent
    sent_as_salesperson_id uuid references salespersons(id),   -- identity the AI signed as ("— Ramesh")
    ai_generated           boolean not null default false,
    draft_status           text check (draft_status in ('pending_approval', 'approved', 'rejected')),
    approved_by            uuid references salespersons(id),   -- approver of an AI draft (human-in-loop)
    status                 text not null default 'pending'
                             check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
    sent_at                timestamptz,
    received_at            timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- ─── followups (cadence queue) ─────────────────────────────────────────────
create table followups (
    id             uuid primary key default gen_random_uuid(),
    customer_id    uuid not null references customers(id),
    scheduled_at   timestamptz not null,
    template_name  text not null,
    template_vars  jsonb not null default '{}',
    -- 'sending' is the atomic claim state for the Beat dedupe (§19-A.4)
    status         text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'skipped', 'cancelled')),
    celery_task_id text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ─── audit_log (append-only; RLS makes it insert-only for non-service roles) ─
create table audit_log (
    id         bigint generated always as identity primary key,
    entity     text not null,
    entity_id  uuid,
    action     text not null,
    actor      text,
    changed_at timestamptz not null default now(),
    payload    jsonb
);
