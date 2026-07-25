-- Topaz CRM — 0021 · publish messages INSERTs to realtime
-- ConversationThread subscribes to Postgres INSERTs on `messages`, but the table
-- was never added to the supabase_realtime publication (0010 added only `alerts`),
-- so new inbound/outbound messages never streamed in — the thread needed a manual
-- reload. Same guarded pattern as 0010_alerts.sql: safe if the publication is
-- absent or already carries the table.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'messages'
    ) then
        execute 'alter publication supabase_realtime add table messages';
    end if;
exception
    when undefined_object then
        null;  -- publication not present in this environment; realtime configured elsewhere
end $$;
