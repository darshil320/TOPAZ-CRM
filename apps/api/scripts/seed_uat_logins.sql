-- Topaz CRM — UAT/staging login seed (NOT for production).
--
-- Creates three Supabase Auth users + matching salespersons rows so the money-path
-- E2E and manual UAT have real logins for each role gate. Idempotent: re-running
-- updates the password + role and never duplicates a user.
--
-- Roles seeded (the three the Phase 2A money path exercises):
--   sales@topaz.test    salesperson  — builds/sends quotes (E2E login)
--   accounts@topaz.test accounts     — records payments (flow 4; salesperson is 403)
--   owner@topaz.test    owner        — refunds / owner-only guards (flow 5)
--
-- Usage (password is a psql var so no secret lands in the repo):
--   psql "$DATABASE_URL" -v pw="ChooseAStrongUATPassword" -f seed_uat_logins.sql
-- Pass the RAW password with NO inner quotes — :'pw' adds the SQL quoting itself.
--
-- Mechanism: GoTrue authenticates against auth.users.encrypted_password (bcrypt)
-- and requires a matching auth.identities row (provider 'email'). We set both,
-- mark the email confirmed, then link a salespersons row via auth_uid.

\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

-- psql does NOT substitute :'pw' inside a $$-quoted block, so stash it in a
-- session GUC out here (interpolation works) and read it back inside the block.
select set_config('topaz.uat_pw', :'pw', false);

do $$
declare
  r record;
  uid uuid;
  pw text := current_setting('topaz.uat_pw', true);
  logins constant jsonb := '[
    {"email": "sales@topaz.test",    "name": "UAT Sales",    "role": "salesperson", "whatsapp": "+919800000001"},
    {"email": "accounts@topaz.test", "name": "UAT Accounts", "role": "accounts",    "whatsapp": "+919800000002"},
    {"email": "owner@topaz.test",    "name": "UAT Owner",    "role": "owner",       "whatsapp": "+919800000003"}
  ]'::jsonb;
begin
  if pw is null or length(pw) < 8 then
    raise exception 'pass a password of >=8 chars: -v pw="''YourPassword''"';
  end if;

  for r in select * from jsonb_to_recordset(logins)
             as x(email text, name text, role text, whatsapp text)
  loop
    -- Reuse the existing auth user for this email, or mint one.
    select id into uid from auth.users where email = r.email;

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
        crypt(pw, gen_salt('bf')), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object('name', r.name),
        now(), now()
      );
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        uid, uid,
        jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    else
      -- Refresh the password so a re-run always yields a known credential.
      update auth.users
         set encrypted_password = crypt(pw, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = uid;
    end if;

    -- Link (or refresh) the salespersons row that RLS reads via auth_uid.
    if exists (select 1 from salespersons where auth_uid = uid) then
      update salespersons
         set name = r.name, role = r.role, whatsapp = r.whatsapp,
             active = true, available = true
       where auth_uid = uid;
    else
      insert into salespersons (id, auth_uid, name, whatsapp, role, active, available)
      values (gen_random_uuid(), uid, r.name, r.whatsapp, r.role, true, true);
    end if;

    raise notice 'login ready: % (%）-> auth_uid %', r.email, r.role, uid;
  end loop;
end $$;

-- Show what exists now.
select s.role, s.name, u.email, u.email_confirmed_at is not null as confirmed
from salespersons s join auth.users u on u.id = s.auth_uid
where u.email like '%@topaz.test'
order by s.role;
