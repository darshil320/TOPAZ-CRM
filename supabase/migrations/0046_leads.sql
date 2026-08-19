-- Topaz CRM — 0046 · lead capture (manual entry)
--
-- The client's ask: a form to add a walk-in/phone enquiry and a table listing them,
-- with status, source, and the enquiry's own details.
--
-- ─── WHY THIS IS NOT THE `customers` TABLE ───────────────────────────────────
-- A `customer` row REQUIRES a consent row (customers.consent_id is NOT NULL, 0002).
-- A lead has given no consent — a salesperson typed their number off a phone call.
-- Forcing leads into `customers` would mean fabricating a consent record for every
-- enquiry, which is exactly what DPDPA forbids and what the kiosk flow exists to
-- collect properly. So leads live in their own table until the person themselves
-- consents, at which point `convert` creates the customer (see 'converted' below).
--
-- ─── PHONE IS THE JOIN KEY, AND IT IS DELIBERATELY SOFT ──────────────────────
-- `linked_customer_id` answers "is this enquiry already someone we know?". It is a
-- nullable FK, NOT a uniqueness constraint on phone: the same number can legitimately
-- enquire twice about two different pieces months apart, and collapsing those into one
-- row would destroy the second enquiry's requirement text. The link is resolved at
-- write time by matching the normalised phone against customers.phone/wa_id, and is
-- re-checked on convert.
--
-- ON DELETE SET NULL, not CASCADE: a DPDPA consent withdrawal purges the customer, and
-- the lead must survive that as a business record of an enquiry — but it must stop
-- pointing at a person who asked to be forgotten.

create table if not exists leads (
    id                 uuid primary key default gen_random_uuid(),

    -- Identity. phone is the only near-mandatory field: an enquiry nobody can call
    -- back is not a lead. Stored E.164; `phone_digits` is the match key (below).
    name               text,
    phone              text not null,
    -- Normalised digits-only form, maintained by trigger. Matching on this rather than
    -- on `phone` means "+91 94265 29230", "9426529230" and "+919426529230" are the
    -- same lead — salespeople type all three.
    phone_digits       text not null,

    -- Where they are. `society` is called out separately from `address` because in
    -- Surat the society name alone identifies the delivery area and is what the
    -- salesperson actually asks for; burying it in a free-text address makes it
    -- unfilterable.
    society            text,
    address            text,

    -- What they want, in their words. Free text on purpose — a dropdown here would
    -- lose the detail that makes the follow-up call useful.
    requirement        text,
    comments           text,

    -- Where the lead came from. instagram/facebook/google are present as VALUES even
    -- though automated ingestion from those channels is a separate, unbuilt module —
    -- a salesperson copying an Instagram DM in by hand needs somewhere to put it.
    source             text not null default 'walk_in' check (source in
                           ('walk_in', 'phone', 'referral', 'instagram',
                            'facebook', 'google', 'whatsapp', 'other')),
    -- Free text for "from whom": the referrer's name, the ad campaign, the staff
    -- member who took the call. Distinct from `source`, which is the channel.
    source_detail      text,

    status             text not null default 'new' check (status in
                           ('new', 'contacted', 'qualified', 'converted', 'lost')),
    -- Required when status = 'lost', by the same reasoning as an order cancellation:
    -- a dead lead with no stated reason teaches nobody anything.
    lost_reason        text,

    assigned_to        uuid references salespersons(id),

    -- Soft link to an existing customer with the same number (see header).
    linked_customer_id uuid references customers(id) on delete set null,
    -- Set only by the convert path. Distinct from linked_customer_id: a lead can be
    -- LINKED to a known customer without having been CONVERTED by this lead.
    converted_customer_id uuid references customers(id) on delete set null,
    converted_at       timestamptz,

    created_by         uuid references salespersons(id),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint leads_lost_has_reason check (
        status <> 'lost' or (lost_reason is not null and lost_reason <> '')),
    constraint leads_converted_has_customer check (
        status <> 'converted' or converted_customer_id is not null)
);

-- Keep phone_digits in sync. Done in the DB rather than the API so a row written by
-- any path (backfill, future import, psql) still matches.
create or replace function leads_set_phone_digits() returns trigger
language plpgsql as $$
begin
    new.phone_digits := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists leads_phone_digits on leads;
create trigger leads_phone_digits
    before insert or update of phone on leads
    for each row execute function leads_set_phone_digits();

-- The table's own list view: newest first, filtered by status.
create index if not exists leads_status_created_idx on leads (status, created_at desc);
-- The dedupe/link lookup.
create index if not exists leads_phone_digits_idx on leads (phone_digits);
-- "my leads" for a salesperson.
create index if not exists leads_assigned_idx on leads (assigned_to, status);

alter table leads enable row level security;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Leads are shared floor knowledge, not private property: any active salesperson may
-- SEE every lead, because the person who picks up the phone is rarely the one who took
-- the original enquiry, and a lead nobody can find is a lost sale. This is a weaker
-- boundary than `customers` (which is assignment-scoped) and it is deliberate — a lead
-- holds no biometric data and no consent record, so the DPDPA exposure that justifies
-- the customer boundary does not exist here.
--
-- WRITES are narrower: anyone may create, but only the assignee, the creator, or the
-- owner may edit. Otherwise two salespeople racing the same enquiry overwrite each
-- other's status silently.
--
-- (select ...) wrappers per 0044: they hoist to an InitPlan so the helper runs once per
-- query rather than once per row.

create policy leads_select on leads for select to authenticated
    using (true);

create policy leads_insert on leads for insert to authenticated
    with check ((select current_salesperson_id()) is not null);

create policy leads_update on leads for update to authenticated
    using (
        (select is_owner())
        or assigned_to = (select current_salesperson_id())
        or created_by  = (select current_salesperson_id())
    )
    with check (
        (select is_owner())
        or assigned_to = (select current_salesperson_id())
        or created_by  = (select current_salesperson_id())
    );

-- No delete policy: a lead is marked 'lost', never removed. Deleting one destroys the
-- only evidence the enquiry ever happened, which is the number the owner's conversion
-- rate is computed from.
