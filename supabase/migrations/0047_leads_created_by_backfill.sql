-- 0047 — attribute existing leads, and narrow leads_update to creator-or-owner.
--
-- Two things were true before this migration:
--
--   1. `apps/api/src/api/leads.py` passed `created_by=None` on every insert, so
--      `leads.created_by` is NULL on every existing row. Creator-scoped edit is
--      unenforceable against NULL.
--   2. 0046's `leads_update` policy allowed owner OR assignee OR creator. The product
--      decision is creator + owner only. Leaving the assignee in place would let a
--      direct-from-browser write do something `PATCH /api/leads/{id}` now refuses —
--      exactly the API/RLS drift RLS is meant to prevent.
--
-- Both are fixed here. The API side (assert_can_edit_lead) is the enforcing copy, since
-- apps/api connects as service role and RLS does not run on that connection at all.

-- ── Backfill ────────────────────────────────────────────────────────────────────────
-- The assignee is the best available proxy for who captured the lead. Rows with neither
-- a creator nor an assignee stay owner-editable only, which is the safe default.
--
-- Caveat, accepted deliberately: where a receptionist captured a lead and assigned it to
-- a salesperson, this grants edit rights to the salesperson rather than the receptionist.
-- With created_by NULL everywhere there is no data to tell the two cases apart, and the
-- assignee is the person actually working the lead.
--
-- rollback: update leads set created_by = null;
--   Exact, not approximate: created_by was NULL on every row before this migration, so a
--   blanket reset restores the prior state precisely.
update leads
   set created_by = assigned_to
 where created_by is null
   and assigned_to is not null;

-- The leads_set_phone_digits trigger fires `before insert or update of phone`. This
-- statement does not touch phone, so the trigger does not fire and updated_at is left
-- alone — the rows keep their real last-edited time.

create index if not exists leads_created_by_idx on leads (created_by);

-- ── Narrow the update policy ─────────────────────────────────────────────────────────
-- (select ...) wrappers per 0044: they hoist to an InitPlan so the helper runs once per
-- query rather than once per row.
--
-- Status changes and conversion are NOT creator-scoped and never were — they go through
-- the API's /status and /convert routes, because 0046's own header notes that "the person
-- who picks up the phone is rarely the one who took the original enquiry". This policy
-- governs field edits (a typo'd phone number, a corrected requirement), which belong to
-- whoever captured the lead.
drop policy if exists leads_update on leads;

create policy leads_update on leads for update to authenticated
    using (
        (select is_owner())
        or created_by = (select current_salesperson_id())
    )
    with check (
        (select is_owner())
        or created_by = (select current_salesperson_id())
    );
