-- Topaz CRM — 0001 · extensions + enums
-- Runs FIRST. PG16's gen_random_uuid() is built in — no uuid-ossp needed (§19-C).
-- All enums are created here, before any table references them (§19-C migration order).

create extension if not exists vector;          -- pgvector (HNSW + cosine ANN)

create type assignment_role as enum ('primary', 'collaborator');           -- §19-A
create type coverage_status as enum ('open', 'claimed', 'closed');
create type pipeline_stage  as enum ('new', 'talking', 'follow_up', 'won', 'lost');  -- Hemant's states
