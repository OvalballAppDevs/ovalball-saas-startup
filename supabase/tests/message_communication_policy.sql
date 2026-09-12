-- Communication feature policy: platform ceiling, club choice beneath it
-- (20270243000000).
--
-- Three properties, and the third is a defect this migration closed:
--
--   1. A club may differ from the platform where the platform permits it.
--   2. Two settings are never a club's -- Ovalball's own announcement
--      channel, and an individual's ability to block another individual.
--   3. WITHDRAWING an override permission takes effect on overrides that
--      already exist. Before this migration the ceiling was enforced when a
--      club WROTE an override and not when the value was READ, so a club that
--      set one while it was permitted kept winning afterwards.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/message_communication_policy.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_club uuid;
  v_ordinary uuid;
  v_effective record;
  v_ok boolean;
begin
  select id into v_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_ordinary from auth.users where email = 'uat.coach@ovalball.test';
  select club_id into v_club from public.club_memberships
  where user_id = v_ordinary limit 1;

  if v_admin is null or v_club is null or v_ordinary is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if not internal.is_full_site_admin() then
    raise notice 'SKIP: uat.fullsiteadmin is not a Full Site Admin in this database';
    return;
  end if;

  -- =================================================================
  -- 1. THE PLATFORM SETS ITS POSITION
  -- =================================================================
  perform public.update_message_communication_policy(null, jsonb_build_object(
    'allow_group_discussion', true,
    'allow_group_discussion_club_override_allowed', true,
    'allow_direct_messaging', true,
    'allow_direct_messaging_club_override_allowed', true
  ));
  select * into v_effective from public.get_effective_message_policy(v_club);
  if v_effective.allow_group_discussion and v_effective.allow_group_discussion_origin = 'global_default' then
    raise notice 'PASS 1: with no club opinion, the platform position is what is in force';
  else
    raise notice 'FAIL 1: group discussion = %, origin = %',
      v_effective.allow_group_discussion, v_effective.allow_group_discussion_origin;
  end if;

  -- =================================================================
  -- 2. A CLUB MAY DIFFER, WHERE IT IS PERMITTED TO
  -- =================================================================
  perform public.update_message_communication_policy(v_club,
    jsonb_build_object('allow_group_discussion', false));
  select * into v_effective from public.get_effective_message_policy(v_club);
  if v_effective.allow_group_discussion = false and v_effective.allow_group_discussion_origin = 'club_override' then
    raise notice 'PASS 2: a club may switch a permitted feature off for itself';
  else
    raise notice 'FAIL 2: group discussion = %, origin = %',
      v_effective.allow_group_discussion, v_effective.allow_group_discussion_origin;
  end if;

  -- 2b. And that choice is the CLUB'S, not the platform's own row.
  select * into v_effective from public.get_effective_message_policy(null);
  if v_effective.allow_group_discussion then
    raise notice 'PASS 2b: one club opting out does not change the platform position';
  else
    raise notice 'FAIL 2b: a club override leaked into the global row';
  end if;

  -- =================================================================
  -- 3. THE DEFECT: WITHDRAWING PERMISSION MUST REACH STANDING OVERRIDES
  -- The club override above stays in the table; Ovalball now withdraws the
  -- right to hold one. The effective answer must revert to the platform's.
  -- =================================================================
  perform public.update_message_communication_policy(null,
    jsonb_build_object('allow_group_discussion_club_override_allowed', false));
  select * into v_effective from public.get_effective_message_policy(v_club);
  if v_effective.allow_group_discussion and v_effective.allow_group_discussion_origin = 'global_default' then
    raise notice 'PASS 3: withdrawing an override permission also overrides the club''s standing choice';
  else
    raise notice 'FAIL 3: a stale club override still wins -- value %, origin %',
      v_effective.allow_group_discussion, v_effective.allow_group_discussion_origin;
  end if;

  -- 3b. And the club is told, rather than silently ignored, if it tries again.
  begin
    perform public.update_message_communication_policy(v_club,
      jsonb_build_object('allow_group_discussion', false));
    raise notice 'FAIL 3b: a club set a feature Ovalball had withdrawn from it';
  exception when insufficient_privilege then
    raise notice 'PASS 3b: a club is refused, not silently ignored, when the platform has withdrawn the choice';
  end;

  -- 3c. Clearing an override is never itself an override, so it stays allowed.
  begin
    perform public.update_message_communication_policy(v_club,
      jsonb_build_object('allow_group_discussion', null));
    raise notice 'PASS 3c: a club may always clear its own override and follow the platform';
  exception when others then
    raise notice 'FAIL 3c: clearing an override was refused (%)', sqlerrm;
  end;

  perform public.update_message_communication_policy(null,
    jsonb_build_object('allow_group_discussion_club_override_allowed', true));

  -- =================================================================
  -- 4. THE TWO SETTINGS THAT ARE NOT A CLUB'S
  -- =================================================================
  begin
    perform public.update_message_communication_policy(v_club,
      jsonb_build_object('allow_platform_announcements', false));
    raise notice 'FAIL 4: a club switched off Ovalball''s own announcement channel';
  exception when insufficient_privilege then
    raise notice 'PASS 4: a club cannot opt out of Ovalball''s own channel';
  end;

  -- 5. PERSONAL BLOCKING IS NO LONGER A SETTING AT ALL. 20270261000000
  -- retired the flag rather than wiring it: an administrator must not be able
  -- to take away a person's ability to decline contact, so the safest shape
  -- is for the switch not to exist. Naming it is now an unknown setting.
  begin
    perform public.update_message_communication_policy(v_club,
      jsonb_build_object('allow_personal_blocking', false));
    raise notice 'FAIL 5: allow_personal_blocking is still an accepted setting';
  exception when others then
    raise notice 'PASS 5: personal blocking is not an administrator setting -- the flag is retired';
  end;

  -- 6. Not even Ovalball can delegate them, and the table says so.
  begin
    perform public.update_message_communication_policy(null,
      jsonb_build_object('allow_personal_blocking_club_override_allowed', true));
    raise notice 'FAIL 6: a retired flag was still delegable';
  exception when others then
    raise notice 'PASS 6: the retired flag cannot be delegated either';
  end;

  begin
    update public.message_policies
    set allow_platform_announcements_club_override_allowed = true where club_id is null;
    raise notice 'FAIL 6b: a direct write delegated the platform channel to clubs';
  exception when check_violation then
    raise notice 'PASS 6b: the constraint refuses it at the table, not only at the RPC';
  end;

  -- =================================================================
  -- 7. AUTHORITY
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ordinary, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(null,
      jsonb_build_object('allow_direct_messaging', false));
    raise notice 'FAIL 7: an ordinary member changed the platform policy';
  exception when insufficient_privilege then
    raise notice 'PASS 7: only a Full Site Admin may change the platform position';
  end;

  -- 8. A typo must not report a save that did not happen.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.update_message_communication_policy(null,
      jsonb_build_object('allow_group_disscussion', false));
    raise notice 'FAIL 8: an unknown setting name was accepted and silently did nothing';
  exception when others then
    raise notice 'PASS 8: an unknown setting name is rejected rather than silently ignored';
  end;

  -- 9. And a club row still cannot physically hold a platform-only value.
  -- 9. The column is gone from the table entirely, so there is no dead
  -- configuration left for a future screen to bind to.
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'message_policies' and column_name = 'allow_personal_blocking'
  ) then
    raise notice 'PASS 9: the retired column no longer exists on message_policies';
  else
    raise notice 'FAIL 9: dead configuration remains on the table';
  end if;
end $$;

rollback;
