-- =====================================================================================================
-- THE SITE ADMIN PROFILE MATRIX (Identity/Auth Slice 7; Phase 2 AI #36, #37, #41; Q.1, Q.3, R)
--
-- Deterministic, self-seeding, and GENERATED rather than hand-listed.
--
-- AI #36 says "READ_ONLY Site Admin calls every master-control RPC". A hand-written list of RPCs is
-- wrong the day somebody adds the next one, and wrong silently -- the suite still passes, just over a
-- smaller surface. So this discovers the master-control surface from the catalogue: every
-- public.site_* function whose body carries internal.master_control_preamble.
--
-- HOW A GENERIC CALL IS POSSIBLE, and why it is the right test rather than a trick:
--
-- Q.3 fixes the preamble as the FIRST thing every master-control RPC does -- capability, then recent
-- authenticator, then reason, then self-target -- before any argument is looked at. So an unauthorised
-- caller passing nothing but NULLs must still get 42501, because the refusal happens before the
-- arguments matter. Any other SQLSTATE means the function validated something first, and a function
-- that validates before it authorises is one that tells an unauthorised caller whether a club exists.
--
-- That makes "call it with NULLs and expect 42501" a real assertion about ordering, not a shortcut.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'SAPM',p_label,p_email,(current_date - interval '36 years')::date,'ACTIVE');
  return v;
end $$;

-- Calls a function with one NULL per parameter, cast to that parameter's own type, inside a savepoint
-- that is always rolled back -- so an RPC that DOES run for an authorised caller cannot leave state
-- behind and change a later answer.
create or replace function pg_temp.call_with_nulls(p_subject uuid, p_oid oid) returns text language plpgsql as $$
declare v_sql text; v_state text;
begin
  select 'select ' || n.nspname || '.' || p.proname || '(' ||
         coalesce((select string_agg('null::' || format_type(t.oid, null), ', ')
                     from unnest(p.proargtypes) with ordinality as a(oid, ord)
                     join pg_type t on t.oid = a.oid), '') || ')'
    into v_sql
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.oid = p_oid;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin
    set local role authenticated;
    execute v_sql;
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims','', true);
  return v_state;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_ro uuid; v_ops uuid; v_data uuid; v_mod uuid; v_club_admin uuid; v_member uuid; v_anon_ish uuid;
  v_dir uuid; v_club uuid;
  r record;
  v_surface int := 0;
  v_bad text[] := '{}';
  v_state text;
  v_persona record;
begin
  v_ro         := pg_temp.person('RO','sapm-ro-'||v_tag||'@ovalball.test');
  v_ops        := pg_temp.person('OPS','sapm-ops-'||v_tag||'@ovalball.test');
  v_data       := pg_temp.person('DATA','sapm-data-'||v_tag||'@ovalball.test');
  v_mod        := pg_temp.person('MOD','sapm-mod-'||v_tag||'@ovalball.test');
  v_club_admin := pg_temp.person('CA','sapm-ca-'||v_tag||'@ovalball.test');
  v_member     := pg_temp.person('MEMBER','sapm-m-'||v_tag||'@ovalball.test');

  insert into public.site_admins (user_id, status, profile_key) values
    (v_ro,'active','SITE_RO'), (v_ops,'active','SITE_OPS'),
    (v_data,'active','SITE_DATA'), (v_mod,'active','SITE_MOD');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SAPM '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'verified','site_admin_manual','sapm-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'sapm-'||v_tag,'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status, state)
  values (v_club, v_club_admin, 'CLUB_ADMIN', 'active', 'ACTIVE'),
         (v_club, v_member, 'BASIC_USER', 'active', 'ACTIVE');

  -- =============================================================================================
  -- The surface itself. If this is small, the rest of the suite is measuring almost nothing, so the
  -- count is asserted before anything is concluded from it.
  -- =============================================================================================
  select count(*) into v_surface
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'site\_%'
     and p.prosrc ~ 'master_control_preamble';
  perform pg_temp.check(v_surface >= 15,
    format('SAPM-01 the master-control surface is %s RPCs, discovered from the catalogue rather than listed here', v_surface));

  -- =============================================================================================
  -- SAPM-02  AI #36 and #37. Every Site Admin profile that is NOT Full is refused every
  -- master-control RPC it does not specifically hold the capability for.
  --
  -- Read Only is the sharpest case and the reason Slice 7 exists: before it, `is_site_admin()` was
  -- true for a Read Only Site Admin, so ninety policies and sixty function bodies let them write.
  -- =============================================================================================
  for v_persona in
    select * from (values (v_ro,'Read Only'), (v_mod,'Message Moderator')) as t(id, label)
  loop
    v_bad := '{}';
    for r in
      select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'site\_%' and p.prosrc ~ 'master_control_preamble'
       order by p.proname
    loop
      v_state := pg_temp.call_with_nulls(v_persona.id, r.oid);
      if v_state <> '42501' then
        v_bad := v_bad || (r.proname || ' -> ' || v_state);
      end if;
    end loop;
    perform pg_temp.check(cardinality(v_bad) = 0,
      format('SAPM-02 a %s Site Admin is refused every master-control RPC%s',
             v_persona.label,
             case when cardinality(v_bad) = 0 then '' else ' -- got: ' || array_to_string(v_bad, '; ') end));
  end loop;

  -- =============================================================================================
  -- SAPM-03  AI #41. A Club Admin has real authority, in their own club. None of it is site
  -- authority, and calling a site_* RPC directly is the obvious thing to try.
  -- =============================================================================================
  v_bad := '{}';
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'site\_%' and p.prosrc ~ 'master_control_preamble'
     order by p.proname
  loop
    v_state := pg_temp.call_with_nulls(v_club_admin, r.oid);
    if v_state <> '42501' then v_bad := v_bad || (r.proname || ' -> ' || v_state); end if;
  end loop;
  perform pg_temp.check(cardinality(v_bad) = 0,
    format('SAPM-03 a Club Admin is refused every master-control RPC%s',
           case when cardinality(v_bad) = 0 then '' else ' -- got: ' || array_to_string(v_bad, '; ') end));

  v_bad := '{}';
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'site\_%' and p.prosrc ~ 'master_control_preamble'
     order by p.proname
  loop
    v_state := pg_temp.call_with_nulls(v_member, r.oid);
    if v_state <> '42501' then v_bad := v_bad || (r.proname || ' -> ' || v_state); end if;
  end loop;
  perform pg_temp.check(cardinality(v_bad) = 0,
    format('SAPM-04 an ordinary club member is refused every master-control RPC%s',
           case when cardinality(v_bad) = 0 then '' else ' -- got: ' || array_to_string(v_bad, '; ') end));

  -- =============================================================================================
  -- SAPM-05  THE POSITIVE CONTROL FOR THE WHOLE SUITE.
  --
  -- Everything above is a refusal, and every one of them would also pass if the RPCs were simply
  -- broken, or if call_with_nulls were constructing SQL that never ran. A Full Site Admin passes the
  -- preamble, so the SAME generic call must get PAST the capability check -- and then fail on the
  -- NULL arguments, which is a different error entirely. Anything still returning 42501 for FULL
  -- would mean this suite has been proving nothing at all.
  --
  -- The two-admin grant RPCs are excluded, and only those: they refuse a Full Site Admin too, for a
  -- reason that is the whole of 7c rather than a capability failure.
  -- =============================================================================================
  declare v_full uuid; v_past int := 0; v_total int := 0;
  begin
    v_full := pg_temp.person('FULL','sapm-full-'||v_tag||'@ovalball.test');
    insert into public.site_admins (user_id, status, profile_key) values (v_full,'active','SITE_FULL');
    for r in
      select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'site\_%' and p.prosrc ~ 'master_control_preamble'
         and p.proname not in ('site_approve_site_admin_grant','site_reject_site_admin_grant')
       order by p.proname
    loop
      v_total := v_total + 1;
      v_state := pg_temp.call_with_nulls(v_full, r.oid);
      if v_state <> '42501' then v_past := v_past + 1; else v_bad := v_bad || r.proname; end if;
    end loop;
    perform pg_temp.check(v_past = v_total,
      format('SAPM-05 POSITIVE CONTROL: a Full Site Admin gets PAST the capability check on all %s of them (%s did)',
             v_total, v_past));
  end;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
