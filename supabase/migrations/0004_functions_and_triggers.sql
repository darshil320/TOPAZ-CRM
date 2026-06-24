-- Topaz CRM — 0004 · functions + triggers
-- Depends on 0002. Defines the RLS helper functions used by 0005, the consent
-- hard gate (§19-E), the consent-withdrawal cascade (§19-E / security HIGH-6),
-- updated_at automation, and the owner-only-column guard.

-- ════════════════════════════════════════════════════════════════════════════
-- RLS helpers (SECURITY DEFINER so they can read salespersons regardless of RLS)
-- ════════════════════════════════════════════════════════════════════════════

-- Maps the logged-in Supabase auth user → internal salespersons.id (§19-B).
create or replace function current_salesperson_id()
returns uuid language sql stable security definer set search_path = public as $$
    select id from salespersons where auth_uid = (select auth.uid());
$$;

create or replace function is_owner()
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from salespersons
        where auth_uid = (select auth.uid()) and role = 'owner' and active = true
    );
$$;

-- True if the current salesperson is primary OR collaborator on this customer.
create or replace function is_assigned_to_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from customer_assignments
        where customer_id = p_customer_id
          and salesperson_id = current_salesperson_id()
          and active = true
    );
$$;

-- Atomic "first tap wins" claim (§19-A.1). SECURITY DEFINER controlled entry point:
-- forces the caller as primary and relies ONLY on the one_active_primary_per_customer
-- unique index (the exception-catch sidesteps any ON CONFLICT-inference fragility,
-- database-review HIGH-1). Browser claims via: select claim_customer($1).
-- This is the ONLY browser path to an assignment row (ca_insert is owner-only) — closes
-- the self-assign-to-any-customer hole (database-review CRITICAL-1).
create or replace function claim_customer(p_customer_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
    v_sp uuid := current_salesperson_id();
begin
    if v_sp is null then
        raise exception 'no salesperson for current user' using errcode = 'insufficient_privilege';
    end if;
    insert into customer_assignments (customer_id, salesperson_id, role, active)
    values (p_customer_id, v_sp, 'primary', true);
    return true;                        -- won the claim
exception
    when unique_violation then
        return false;                   -- a primary already exists → "already claimed"
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at automation
-- ════════════════════════════════════════════════════════════════════════════
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger customers_set_updated_at       before update on customers       for each row execute function set_updated_at();
create trigger conversations_set_updated_at   before update on conversations   for each row execute function set_updated_at();
create trigger messages_set_updated_at        before update on messages        for each row execute function set_updated_at();
create trigger followups_set_updated_at       before update on followups       for each row execute function set_updated_at();
create trigger pipeline_stages_set_updated_at before update on pipeline_stages for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Consent HARD GATE (§19-E) — no embedding stored without active face_tracking
-- consent. Fires for everyone, including the service role.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function enforce_face_embedding_consent()
returns trigger language plpgsql as $$
begin
    if not exists (
        select 1 from consents co
        join customers c on c.consent_id = co.id
        where c.id = new.customer_id
          and co.face_tracking = true
          and co.withdrawn_at is null
    ) then
        raise exception 'face_tracking consent required before storing embedding'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger face_embedding_consent_gate
    before insert on face_embeddings
    for each row execute function enforce_face_embedding_consent();

-- ════════════════════════════════════════════════════════════════════════════
-- Consent withdrawal cascade (§19-E / security HIGH-6)
-- On withdrawal, delete embeddings + audit it. NOTE: Storage face-crop purge is
-- app-layer — SQL cannot delete Storage objects. The withdrawal server action
-- MUST also storage.remove() the visits.photo_key files (see §19-E / HIGH-6).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function cascade_on_consent_withdrawal()
returns trigger language plpgsql as $$
begin
    if (old.face_tracking = true and new.face_tracking = false)
       or (old.withdrawn_at is null and new.withdrawn_at is not null) then
        delete from face_embeddings fe
            using customers c
            where c.consent_id = new.id and fe.customer_id = c.id;
        insert into audit_log (entity, entity_id, action, actor, payload)
            values ('consents', new.id, 'face_tracking_withdrawn:embeddings_purged',
                    'system', jsonb_build_object('consent_id', new.id, 'at', now()));
    end if;
    return new;
end;
$$;

create trigger consent_withdrawal_cascade
    after update on consents
    for each row execute function cascade_on_consent_withdrawal();

-- ════════════════════════════════════════════════════════════════════════════
-- Owner-only column guard (§19-A/F): only the owner may flip the AI toggles.
-- Assigned salespersons may still change handler_mode (manual override) — that
-- is the take-over feature, so it is NOT blocked here.
-- auth.uid() IS NULL ⇒ backend/service role ⇒ trusted, skip the check.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function protect_customer_owner_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is not null and not is_owner() then
        if new.ai_followup_enabled is distinct from old.ai_followup_enabled
           or new.ai_autosend is distinct from old.ai_autosend then
            raise exception 'only the owner can change the AI toggles'
                using errcode = 'insufficient_privilege';
        end if;
    end if;
    return new;
end;
$$;

create trigger customers_protect_owner_fields
    before update on customers
    for each row execute function protect_customer_owner_fields();

-- Message thread integrity (database-review MEDIUM-3): content + sender/direction
-- fields are immutable once written. Legitimate browser UPDATEs are the approval
-- workflow only (draft_status, approved_by, status). Service role (auth.uid() null) exempt.
create or replace function protect_message_immutable_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (select auth.uid()) is not null then
        if new.content               is distinct from old.content
        or new.direction             is distinct from old.direction
        or new.sender_type           is distinct from old.sender_type
        or new.sender_salesperson_id is distinct from old.sender_salesperson_id
        or new.ai_generated          is distinct from old.ai_generated then
            raise exception 'message content and sender fields are immutable'
                using errcode = 'insufficient_privilege';
        end if;
    end if;
    return new;
end;
$$;

create trigger messages_protect_immutable_fields
    before update on messages
    for each row execute function protect_message_immutable_fields();
