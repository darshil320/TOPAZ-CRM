-- Topaz CRM — 0034 · revoke the privileges RLS cannot police
--
-- Supabase's stock bootstrap grants ALL on every table in `public` to `anon`
-- and `authenticated`, and the repo's careful per-table grants (0005, 0020,
-- 0031, 0033) only ever ADD to that — nothing ever took the blanket away. A
-- grant audit on the live database found `anon` and `authenticated` holding
-- TRUNCATE, TRIGGER and REFERENCES on all 38 public tables.
--
-- Why that matters: **TRUNCATE is not subject to row-level security.** Every
-- other write verb is filtered by the policies this schema is built on; TRUNCATE
-- empties the table regardless. It is not reachable through PostgREST today
-- (no HTTP verb maps to it, and no SECURITY INVOKER function issues one), so
-- this is a latent hole rather than a live one — but the day someone adds an
-- RPC that runs dynamic SQL, or a pooler credential for one of these roles
-- leaks, `customers` and `face_embeddings` are one statement from empty.
--
-- The revokes below are narrow on purpose. SELECT / INSERT / UPDATE stay exactly
-- as they are, because those ARE policed by RLS and the app depends on them:
--   · TRUNCATE   — never used by application code, cannot be policed. Gone.
--   · TRIGGER    — lets a role attach a trigger to a table it does not own.
--   · REFERENCES — lets a role FK against a table it cannot read.
--   · DELETE for anon — no anon DELETE policy exists anywhere, so the grant is
--     inert; removing it keeps the privilege list honest.
-- Authenticated DELETE is left alone: it is RLS-gated and owner/admin delete
-- policies (o_delete, q_delete) rely on it.
--
-- Also resets the DEFAULT privileges, so a table created by a future migration
-- does not silently inherit the blanket again.
-- ════════════════════════════════════════════════════════════════════════════

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke delete on all tables in schema public from anon;

alter default privileges in schema public
    revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges in schema public
    revoke delete on tables from anon;
