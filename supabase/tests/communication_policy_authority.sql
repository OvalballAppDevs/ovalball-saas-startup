-- Who may change communication policy (20270243000000, 20270256000000).
--
-- The audit found no permanent coverage of the ADMIN MUTATION path. Every
-- policy value was tested; nobody had tested who is allowed to set one.
-- That is the gap where a privilege escalation would live, so it is closed
-- here.
--
-- The asymmetry under test: a Club Admin genuinely administers their club,
-- and that must not become authority over Ovalball's own settings or over a
-- club they have nothing to do with.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/communication_policy_authority.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_site_admin uuid;
  v_club_admin uuid;
  v_ordinary uuid;
  v_club uuid;
  v_other_club uuid;
  v_value boolean;
begin
  select id into v_site_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_club_admin from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_ordinary   from auth.users where email = 'uat.guardian.one@ovalball.test';

  if v_site_admin is null or v_club_admin is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  select club_id into v_club from public.club_memberships
  where user_id = v_club_admin and status = 'active' limit 1;
  select id into v_other_club from public.clubs where id <> v_club limit 1;

  perform set_config('role', 'authenticated', true);

  -- =================================================================
  -- 1-2. SITE POLICY IS THE SITE ADMIN'S ALONE
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_site_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(null, '{"allow_direct_messaging": false}'::jsonb);
    raise notice 'PASS 1: a Full Site Admin may change the platform policy';
  exception when others then
    raise notice 'FAIL 1: the Site Admin was refused (%)', left(sqlerrm, 60);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(null, '{"allow_direct_messaging": true}'::jsonb);
    raise notice 'FAIL 2: a Club Admin changed the PLATFORM policy';
  exception when insufficient_privilege then
    raise notice 'PASS 2: a Club Admin cannot change the platform policy';
  end;

  -- 3. And an ordinary member certainly cannot.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ordinary, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(null, '{"allow_direct_messaging": true}'::jsonb);
    raise notice 'FAIL 3: an ordinary member changed the platform policy';
  exception when insufficient_privilege then
    raise notice 'PASS 3: an ordinary member cannot change the platform policy';
  end;

  -- Restore the platform value before the club tests.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_site_admin, 'role', 'authenticated')::text, true);
  perform public.update_message_communication_policy(null, '{"allow_direct_messaging": true}'::jsonb);

  -- =================================================================
  -- 4-6. A CLUB ADMIN ADMINISTERS THEIR OWN CLUB, AND ONLY THAT ONE
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(v_club, '{"allow_direct_messaging": false}'::jsonb);
    raise notice 'PASS 4: a Club Admin may restrict their own club';
  exception when others then
    raise notice 'FAIL 4: the Club Admin was refused on their own club (%)', left(sqlerrm, 60);
  end;

  if v_other_club is not null then
    begin
      perform public.update_message_communication_policy(v_other_club, '{"allow_direct_messaging": false}'::jsonb);
      raise notice 'FAIL 5: a Club Admin changed ANOTHER club''s policy';
    exception when insufficient_privilege then
      raise notice 'PASS 5: a Club Admin cannot change another club''s policy';
    end;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ordinary, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(v_club, '{"allow_direct_messaging": true}'::jsonb);
    raise notice 'FAIL 6: an ordinary member changed a club policy';
  exception when insufficient_privilege then
    raise notice 'PASS 6: an ordinary member cannot change a club policy';
  end;

  -- =================================================================
  -- 7-8. THE STORED VALUE IS WHAT THE RESOLVER READS
  -- A policy screen that saved without taking effect would be worse than no
  -- screen at all, so the two are compared directly.
  -- =================================================================
  perform set_config('role', 'postgres', true);
  select allow_direct_messaging into v_value from public.message_policies where club_id = v_club;
  if v_value is false then
    raise notice 'PASS 7: the club''s restriction was actually stored';
  else raise notice 'FAIL 7: the club row does not reflect the change'; end if;

  if not internal.direct_messaging_allowed_for_club(v_club) then
    raise notice 'PASS 8: the effective resolver reflects the stored configuration';
  else raise notice 'FAIL 8: the resolver ignored the stored club setting'; end if;

  -- =================================================================
  -- 9. A CLUB CANNOT DELEGATE TO ITSELF
  -- The override ceiling is Ovalball's to set, so a club naming one is
  -- refused rather than quietly ignored.
  -- =================================================================
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(
      v_club, '{"allow_group_discussion_club_override_allowed": true}'::jsonb);
    raise notice 'FAIL 9: a club granted itself an override permission';
  exception when insufficient_privilege then
    raise notice 'PASS 9: a club cannot grant itself an override permission';
  end;

  -- =================================================================
  -- 10. POLICY CHANGES ARE AUDITED
  -- =================================================================
  perform set_config('role', 'postgres', true);
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.message_policies'::regclass
      and tgname = 'audit_row_change' and not tgisinternal
  ) then
    raise notice 'PASS 10: communication policy changes enter the audit trail';
  else
    raise notice 'FAIL 10: policy changes are not audited';
  end if;
end $$;

rollback;
