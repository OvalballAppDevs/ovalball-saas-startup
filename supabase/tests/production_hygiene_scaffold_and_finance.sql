-- Two things a release put into production that should never have been there.
--
-- THE FIRST: an author who was never a person.
--
-- Two Hub content migrations minted themselves an author on a TEST domain --
-- hub-admin-<section>-<uuid>@ovalball.test -- and did it in every environment
-- the migrations ran in, production included. 20270301000000 moves what they
-- published onto the canonical system author and removes them.
--
-- The delicate part is the removal, not the move: the guard points at
-- auth.users, and a guard that is even slightly too broad there deletes real
-- people. So most of this file is about proving the guard is narrow -- it
-- plants accounts that match the scaffold pattern but fail one other
-- condition each, and requires every one of them to survive.
--
-- THE SECOND: a finance function anyone could call.
--
-- cancel_club_platform_subscription and record_payment_refund are correct
-- inside -- both check capability or site-admin and raise 42501 -- but both
-- carried PostgreSQL's default PUBLIC EXECUTE grant, so an anonymous caller
-- could enter a definer-rights function that cancels subscriptions or writes
-- refunds and only be turned away once inside. 20270302000000 moves the
-- refusal to the privilege layer, and this file holds it there.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_canonical uuid;
  v_n int;
  v_decoy_password uuid := gen_random_uuid();
  v_decoy_member   uuid := gen_random_uuid();
  v_decoy_admin    uuid := gen_random_uuid();
  v_club uuid;
  v_ok boolean;
begin
  -- =================================================================
  -- 1-3. THE CLEANUP ACTUALLY HAPPENED AND COST NOTHING
  -- =================================================================
  select count(*) into v_n from auth.users where email like 'hub-admin-%@ovalball.test';
  if v_n = 0 then
    raise notice 'PASS 1: no test-domain Hub scaffold identity remains in auth.users';
  else
    raise notice 'FAIL 1: % scaffold identity/identities still present', v_n;
  end if;

  select count(*) into v_n from public.profiles where email like 'hub-admin-%@ovalball.test';
  if v_n = 0 then
    raise notice 'PASS 2: and no scaffold profile remains either';
  else
    raise notice 'FAIL 2: % scaffold profile(s) still present', v_n;
  end if;

  -- The point of moving rather than deleting: published content keeps an
  -- author. A cleanup that nulled these out would pass test 1 and be wrong.
  select count(*) into v_n
  from public.hub_content_items where status = 'PUBLISHED' and published_by is null;
  if v_n = 0 then
    raise notice 'PASS 3: every published Hub item still has an author';
  else
    raise notice 'FAIL 3: % published Hub item(s) lost their author', v_n;
  end if;

  select count(*) into v_n from public.hub_glossary_terms where published_by is null;
  if v_n = 0 then
    raise notice 'PASS 4: every glossary term still has an author';
  else
    raise notice 'FAIL 4: % glossary term(s) lost their author', v_n;
  end if;

  -- 5. And the author they were moved to is the canonical one, not just anyone.
  select id into v_canonical from auth.users
   where email = 'rugby-hub-content-import@system.ovalball.internal';
  if v_canonical is not null
     and exists (select 1 from public.hub_content_items where published_by = v_canonical) then
    raise notice 'PASS 5: Hub content is attributed to the canonical system author';
  else
    raise notice 'FAIL 5: canonical system author owns no Hub content';
  end if;

  -- 6. No reference anywhere points at a user that no longer exists.
  declare v_ref record; v_orphans bigint := 0; v_c bigint;
  begin
    for v_ref in
      select n.nspname as sch, c.relname as tbl, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join unnest(k.conkey) with ordinality as ck(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.oid and a.attnum = ck.attnum
      where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
    loop
      execute format(
        'select count(*) from %I.%I t where t.%I is not null
           and not exists (select 1 from auth.users u where u.id = t.%I)',
        v_ref.sch, v_ref.tbl, v_ref.col, v_ref.col) into v_c;
      v_orphans := v_orphans + v_c;
    end loop;
    if v_orphans = 0 then
      raise notice 'PASS 6: no row anywhere references a deleted user';
    else
      raise notice 'FAIL 6: % dangling user reference(s)', v_orphans;
    end if;
  end;

  -- =================================================================
  -- 7-9. THE GUARD IS NARROW -- THE ASSERTIONS THAT MATTER MOST
  --
  -- Three accounts that all MATCH the scaffold email pattern, each failing
  -- exactly one of the other conditions. Re-running the cleanup must leave
  -- all three untouched. If the guard ever degrades to "delete anything on
  -- @ovalball.test", these are the accounts that die first.
  -- =================================================================
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_decoy_password, 'hub-admin-glossary-' || v_decoy_password::text || '@ovalball.test',
          'a-real-password-hash', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_decoy_member, 'hub-admin-officiating-' || v_decoy_member::text || '@ovalball.test',
          '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  select id into v_club from public.clubs limit 1;
  if v_club is not null then
    insert into public.club_memberships (user_id, club_id, role, status)
    values (v_decoy_member, v_club, 'BASIC_USER', 'active');
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_decoy_admin, 'hub-admin-glossary-' || v_decoy_admin::text || '@ovalball.test',
          '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.site_admins (user_id, status, admin_role)
  values (v_decoy_admin, 'active', 'full');

  -- The guard, exactly as the migration expresses it.
  select count(*) into v_n
  from auth.users u
  where u.email like 'hub-admin-%@ovalball.test'
    and coalesce(u.encrypted_password, '') = ''
    and not exists (select 1 from auth.identities i where i.user_id = u.id)
    and not exists (select 1 from auth.sessions s where s.user_id = u.id)
    and not exists (select 1 from public.club_memberships m where m.user_id = u.id)
    and not exists (select 1 from public.site_admins a where a.user_id = u.id);

  if v_n = 0 then
    raise notice 'PASS 7: an account with a password is not treated as scaffold';
    raise notice 'PASS 8: an account with a club membership is not treated as scaffold';
    raise notice 'PASS 9: an account with a site-admin row is not treated as scaffold';
  else
    raise notice 'FAIL 7-9: the guard selected % account(s) it should have spared', v_n;
  end if;

  -- =================================================================
  -- 10-13. THE FINANCE FUNCTIONS
  -- =================================================================
  if not has_function_privilege('anon','public.cancel_club_platform_subscription(uuid,text)','EXECUTE') then
    raise notice 'PASS 10: anon cannot execute cancel_club_platform_subscription';
  else
    raise notice 'FAIL 10: anon can still execute cancel_club_platform_subscription';
  end if;

  if not has_function_privilege('anon','public.record_payment_refund(uuid,integer,text)','EXECUTE') then
    raise notice 'PASS 11: anon cannot execute record_payment_refund';
  else
    raise notice 'FAIL 11: anon can still execute record_payment_refund';
  end if;

  if has_function_privilege('authenticated','public.cancel_club_platform_subscription(uuid,text)','EXECUTE')
     and has_function_privilege('service_role','public.cancel_club_platform_subscription(uuid,text)','EXECUTE')
     and has_function_privilege('authenticated','public.record_payment_refund(uuid,integer,text)','EXECUTE')
     and has_function_privilege('service_role','public.record_payment_refund(uuid,integer,text)','EXECUTE') then
    raise notice 'PASS 12: the callers that legitimately use them still can';
  else
    raise notice 'FAIL 12: a legitimate caller lost access';
  end if;

  -- 13. And the authorization INSIDE is untouched -- the grant change must not
  -- have been used as a substitute for the capability check.
  select (pg_get_functiondef(p.oid) ~* 'has_capability' and pg_get_functiondef(p.oid) ~* '42501')
    into v_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='cancel_club_platform_subscription';
  if v_ok then
    raise notice 'PASS 13: the capability check inside the function is still there';
  else
    raise notice 'FAIL 13: the in-function authorization check has gone';
  end if;
end $$;

rollback;
