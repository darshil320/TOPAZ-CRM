-- Topaz CRM — 0003 · indexes (§19-C + the HNSW ANN index)
-- Depends on 0002. Covers the RLS hot paths and the highest-frequency reads.

-- ─── pgvector HNSW (cosine ANN over consented embeddings) ────────────────────
-- m=16, ef_construction=64 = production defaults; fine at showroom scale.
-- ef_search is set per-query (SET LOCAL hnsw.ef_search) in the embedding repo (§19-D).
create index face_embeddings_hnsw_idx
    on face_embeddings using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);

-- ─── FK + hot-path indexes ───────────────────────────────────────────────────
create index customers_consent_id_idx           on customers (consent_id);
-- AI routing scan: due-followup picks 'ai' + enabled customers
create index customers_ai_active_idx            on customers (handler_mode)
    where handler_mode = 'ai' and ai_followup_enabled = true;

-- RLS hot path: "which customers is this salesperson on?"
create index customer_assignments_salesperson_idx on customer_assignments (salesperson_id);
create index customer_assignments_active_idx       on customer_assignments (customer_id) where active = true;

create index coverage_requests_customer_idx     on coverage_requests (customer_id);
create index coverage_requests_requested_by_idx on coverage_requests (requested_by);
create index coverage_requests_claimed_by_idx   on coverage_requests (claimed_by) where claimed_by is not null;
create index coverage_requests_open_idx         on coverage_requests (status)      where status = 'open';

create index conversations_customer_idx         on conversations (customer_id);
create index conversations_salesperson_idx      on conversations (salesperson_id);

-- The single highest-frequency query in the system: thread read, newest first.
create index messages_customer_created_idx      on messages (customer_id, created_at desc);
create index messages_pending_drafts_idx        on messages (draft_status) where draft_status = 'pending_approval';

create index visits_customer_occurred_idx       on visits (customer_id, occurred_at desc);
create index visits_salesperson_idx             on visits (salesperson_id);

create index face_embeddings_customer_idx       on face_embeddings (customer_id);

-- Beat scan: due, still-pending followups
create index followups_due_idx                  on followups (scheduled_at) where status = 'pending';
create index followups_customer_idx             on followups (customer_id);
