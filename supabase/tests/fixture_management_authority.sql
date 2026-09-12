-- Fixture Management authority and the bounded competition-options view
-- (20270271000000).
--
-- Two things are proved here. First, that the new fixture.import and
-- fixture.bulk_edit capabilities resolve through the SAME canonical engine
-- every other capability uses -- site/club/team scope, role defaults, and
-- per-user overrides -- rather than becoming a second permission system
-- bolted onto the planner. Second, that the club ceiling and the Site
-- ceiling behave the way the delegation product promises.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_management_authority.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_coach uuid;
  v_other uuid;
  v_club uuid;
  n integer;
begin
  select id into v_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_coach from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_other from auth.users where email = 'uat.team.manager@ovalball.test';
  select club_id into v_club from public.club_memberships
  where user_id = v_coach and status = 'active' limit 1;

  if v_admin is null or v_coach is null or v_other is null or v_club is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- =================================================================
  -- 1. THE CAPABILITIES EXIST AND ARE SCOPED HONESTLY
  -- Import is a club-wide act, so it is never a team-scope capability;
  -- bulk editing is the batched form of an edit a team role already has.
  -- =================================================================
  select count(*) into n from public.capabilities
  where key in ('fixture.import', 'fixture.bulk_edit', 'club.capabilities.manage');
  if n = 3 then
    raise notice 'PASS 1: the three fixture-management capabilities are registered';
  else
    raise notice 'FAIL 1: expected 3 capabilities, found %', n;
  end if;

  if not ('team' = any (select unnest(applicable_scopes) from public.capabilities where key = 'fixture.import')) then
    raise notice 'PASS 2: fixture.import is not offered at team scope -- importing a season is club-wide';
  else
    raise notice 'FAIL 2: fixture.import is grantable at team scope';
  end if;

  -- =================================================================
  -- 3. CURRENT ACCESS IS PRESERVED
  -- The roles that could already import (the only club-wide fixture
  -- authorities) must still be able to, or this migration is a silent
  -- removal of an ability somebody had this morning.
  -- =================================================================
  select count(*) into n from public.role_capability_defaults
  where scope_type = 'club' and capability_key = 'fixture.import'
    and role_key in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  if n = 2 then
    raise notice 'PASS 3: Club Admin and Fixture Secretary keep the import authority they already had';
  else
    raise notice 'FAIL 3: only % of the two club-wide roles can import', n;
  end if;

  -- =================================================================
  -- 4. A CLUB MAY WITHHOLD IT FROM AN INDIVIDUAL
  -- This is the whole point of the delegation product: a role is a
  -- starting position, not the final answer.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if internal.has_capability('fixture.create', 'club', v_club, null) then
    raise notice 'PASS 4: the club fixture authority resolves before any override';
  else
    raise notice 'FAIL 4: this identity cannot create fixtures at all -- the rest of the suite is meaningless';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_capability_override(
    v_coach, 'fixture.import', 'club', v_club, null, 'deny', 'automated coverage'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if not internal.has_capability('fixture.import', 'club', v_club, null) then
    raise notice 'PASS 5: a deny override withholds importing from one person without touching their other authority';
  else
    raise notice 'FAIL 5: a deny override did not take effect';
  end if;

  -- 6. AND IT IS SURGICAL. Withholding import must not quietly remove the
  -- ordinary fixture editing the same person does every week.
  if internal.has_capability('fixture.edit', 'club', v_club, null) then
    raise notice 'PASS 6: withholding import leaves ordinary fixture editing intact';
  else
    raise notice 'FAIL 6: denying import also removed unrelated fixture authority';
  end if;

  -- =================================================================
  -- 7. THE COMPETITION-OPTIONS VIEW IS BOUNDED AND HONEST
  -- It must return one row per edition IN USE -- never one per fixture,
  -- which is the unbounded read it replaced.
  -- =================================================================
  select count(*) into n from public.fixture_competition_edition_usage;
  if n <= (select count(*) from public.competition_editions) then
    raise notice 'PASS 7: the view returns at most one row per competition edition (%), not one per fixture', n;
  else
    raise notice 'FAIL 7: the view returned % rows -- more than there are editions', n;
  end if;

  if not exists (
    select 1 from public.fixture_competition_edition_usage u
    where not exists (select 1 from public.fixtures f where f.competition_edition_id = u.competition_edition_id)
  ) then
    raise notice 'PASS 8: every edition the filter offers is one a fixture actually uses';
  else
    raise notice 'FAIL 8: the filter offers an edition no fixture uses';
  end if;

  -- =================================================================
  -- 9-13. A CLUB MAY DELEGATE ITS OWN OPERATIONS, AND ONLY THOSE
  --
  -- set_capability_override was Site-Admin-only, so the delegation the
  -- product promises ("this coach may run training but not fixtures") was
  -- a decision no club could actually make. Widening the caller is only
  -- safe while these boundaries hold.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  begin
    perform public.set_capability_override(
      v_other, 'fixture.import', 'club', v_club, null, 'deny', 'automated coverage'
    );
    raise notice 'PASS 9: a club administrator may withhold an operational capability from one of their own people';
  exception when others then
    raise notice 'FAIL 9: a club administrator could not delegate at all (%)', sqlerrm;
  end;

  -- 10. NO SELF-ESCALATION. Handing out the delegation authority itself
  -- would let one administrator mint others, or strip a peer and lock the
  -- club out of its own permissions screen.
  begin
    perform public.set_capability_override(
      v_other, 'club.capabilities.manage', 'club', v_club, null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 10: a club administrator granted the delegation authority itself';
  exception when insufficient_privilege then
    raise notice 'PASS 10: the delegation authority is not a club''s to hand out';
  end;

  -- 11. ONLY OPERATIONAL CAPABILITIES. The allow-list is explicit so a
  -- capability added later is not silently a club's to grant.
  begin
    perform public.set_capability_override(
      v_other, 'club.platform_billing.manage', 'club', v_club, null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 11: a club administrator granted a non-operational capability';
  exception when insufficient_privilege then
    raise notice 'PASS 11: a non-delegable capability is refused';
  end;

  -- 12. AND ONLY THEIR OWN CLUB.
  begin
    perform public.set_capability_override(
      v_other, 'fixture.edit', 'club',
      (select id from public.clubs where id <> v_club limit 1), null, 'grant', 'automated coverage'
    );
    raise notice 'FAIL 12: a club administrator reached another club';
  exception when others then
    raise notice 'PASS 12: a club administrator cannot delegate at another club';
  end;

  -- 13. SOMEBODY WITHOUT THE AUTHORITY CANNOT DELEGATE AT ALL, and cannot
  -- reach it by calling the function directly instead of using the screen.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform public.set_capability_override(
      v_coach, 'fixture.edit', 'club', v_club, null, 'deny', 'automated coverage'
    );
    raise notice 'FAIL 13: a member without club.capabilities.manage changed somebody''s capabilities';
  exception when insufficient_privilege then
    raise notice 'PASS 13: delegation requires club.capabilities.manage, not merely club membership';
  end;
end $$;

rollback;
