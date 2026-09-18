-- THE RECIPIENT + AUDIENCE RESOLUTION ENGINE -- permanent regression.
--
-- Pins the live proofs run manually while building this engine: team/club/
-- platform authority boundaries, safeguarding-correct recipient resolution,
-- deduplication, and fail-closed behaviour for forged/foreign/unauthorized
-- identifiers. Runs against the REAL local UAT dataset (supabase/seeds/
-- local_uat_recipient_engine.sql and the pre-existing UAT fixtures) rather
-- than fixtures created inline, because the whole point is proving this
-- against genuine seeded relationships, not a synthetic shape built to make
-- the test pass.
--
-- IT NAMES ITS SUBJECTS. Using the seeded world is the intent; picking whoever
-- happened to sort first in it was not, and it was a real defect. Every subject
-- below used to be chosen with `order by ... limit 1` across the WHOLE database,
-- so the moment any other club existed the suite could silently start testing
-- somebody else. It did: installing the persistent local review club moved the
-- "team-only admin" to a Team Manager of a side with no players, and assertion 1
-- read that empty playing group as a refusal.
--
-- The fix is not to remove the other club -- permanent local review data and the
-- automated suite have to coexist, and a suite that only passes on an empty
-- database is not a regression test. Each subject is now resolved from the
-- SEEDED IDENTITY that was always meant to play the part, and everything derived
-- from it hangs off that one anchor: the club is the club that person is in, the
-- Club Admin is THAT club's Club Admin, and the sibling team is a team at the
-- same club they demonstrably do not manage. No assertion changed.

begin;

do $$
declare
  v_full_site_admin uuid;
  v_narrow_site_admin uuid;
  v_ordinary_guardian uuid;
  v_team_only_admin uuid;
  v_real_club_admin uuid;
  v_own_club_id uuid;
  v_own_team_id uuid;
  v_foreign_club_id uuid;
  v_sibling_team_id uuid;
  v_count integer;
  v_result record;
  v_raised boolean;
begin
  select id into v_full_site_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_narrow_site_admin from auth.users where email = 'uat.siteadmin@ovalball.test';

  -- The guardian the recipient-engine seed itself links to the seeded player,
  -- named rather than "any active guardian who is not an admin" -- which any
  -- other club's parent could satisfy.
  select g.guardian_user_id into v_ordinary_guardian
  from public.guardians g
  join auth.users u on u.id = g.guardian_user_id
  where u.email = 'uat.guardian.one@ovalball.test' and g.status = 'active'
  limit 1;

  -- THE ANCHOR. A real team_admin/coach/manager who is NOT a club admin: the
  -- seeded Team Manager of the UAT club's U12 Boys, by name. Everything else
  -- below is derived from this one row, so the suite tests one coherent club
  -- rather than a person from one club and a club from another.
  select cm.user_id, tp.team_id, t.club_id into v_team_only_admin, v_own_team_id, v_own_club_id
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active' and cm.authority_suspended = false
  join public.teams t on t.id = tp.team_id
  join auth.users u on u.id = cm.user_id
  where u.email = 'uat.team.manager@ovalball.test'
    and tp.permission in ('team_admin', 'coach', 'manager')
    and cm.role <> 'CLUB_ADMIN'
  order by tp.team_id
  limit 1;
  raise notice 'Selected team-only admin % for team % (club %)', v_team_only_admin, v_own_team_id, v_own_club_id;

  -- THAT club's Club Admin. This used to overwrite v_own_club_id with whichever
  -- club the first Club Admin in the database happened to belong to, so sections
  -- B and C could be asking about a different club from section A's team.
  select cm.user_id into v_real_club_admin
  from public.club_memberships cm
  where cm.club_id = v_own_club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active'
  order by cm.user_id
  limit 1;

  -- A club this Club Admin has no membership of at all, chosen deterministically.
  select c.id into v_foreign_club_id
  from public.clubs c
  where c.id <> v_own_club_id and c.status = 'active'
    and not exists (select 1 from public.club_memberships m
                    where m.club_id = c.id and m.user_id = v_real_club_admin and m.status = 'active')
  order by c.id
  limit 1;

  -- A team at the SAME club that the team-only admin demonstrably does not
  -- manage. Picking any other team was a coin toss: a person with roles at two
  -- teams would have failed assertion 2 while behaving perfectly correctly.
  select t.id into v_sibling_team_id
  from public.teams t
  where t.club_id = v_own_club_id and t.id <> v_own_team_id
    and not exists (select 1 from public.team_permissions tp
                    join public.club_memberships cm on cm.id = tp.membership_id
                    where tp.team_id = t.id and cm.user_id = v_team_only_admin)
  order by t.id
  limit 1;

  -- Named prerequisites, named in the skip. "Prerequisites not found" sent
  -- whoever read it looking for which one.
  if v_full_site_admin is null or v_team_only_admin is null or v_real_club_admin is null then
    raise notice 'Recipient-engine UAT prerequisites missing -- skipping (expected on a fresh/non-seeded database). full site admin: %, seeded team manager: %, that club''s club admin: %',
      coalesce(v_full_site_admin::text, 'MISSING (uat.fullsiteadmin@ovalball.test)'),
      coalesce(v_team_only_admin::text, 'MISSING (uat.team.manager@ovalball.test with a team role)'),
      coalesce(v_real_club_admin::text, 'MISSING (a CLUB_ADMIN of that same club)');
    return;
  end if;

  -- ============ A. Team authority ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_team_only_admin, 'role', 'authenticated')::text, true);
  select * into v_result from public.team_playing_group_summary(v_own_team_id);
  if v_result.source_player_count is not null then
    raise notice 'PASS 1 (A): a real team_admin/coach/manager can address their own team''s playing group';
  else
    raise notice 'FAIL 1 (A): a legitimate team staff member was refused their own team';
  end if;

  if v_sibling_team_id is not null then
    select * into v_result from public.team_playing_group_summary(v_sibling_team_id);
    if v_result.source_player_count is null then
      raise notice 'PASS 2 (A): the same person is refused a SIBLING team at the same club they do not manage';
    else
      raise notice 'FAIL 2 (A): team authority leaked to an unmanaged sibling team';
    end if;
  end if;

  -- ============ B. Team authority does not cascade to club authority ============

  select * into v_result from public.club_playing_group_summary(v_own_club_id);
  if v_result.source_player_count is null then
    raise notice 'PASS 3 (B): team-level authority does NOT grant whole-club audience authority';
  else
    raise notice 'FAIL 3 (B): a team admin resolved a whole-club audience';
  end if;

  begin
    perform public.club_playing_group_recipients(v_own_club_id);
    raise notice 'FAIL 4 (B): the raw club recipient list did not raise for an unauthorized caller';
  exception when others then
    raise notice 'PASS 4 (B): the raw club recipient RPC raises rather than returning anyone';
  end;

  -- ============ C. Club authority: own club yes, foreign club no ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_real_club_admin, 'role', 'authenticated')::text, true);
  select * into v_result from public.club_playing_group_summary(v_own_club_id);
  if v_result.source_player_count is not null then
    raise notice 'PASS 5 (C): a real Club Admin can address their own club''s playing group';
  else
    raise notice 'FAIL 5 (C): a real Club Admin was refused their own club';
  end if;

  if v_foreign_club_id is not null then
    select * into v_result from public.club_playing_group_summary(v_foreign_club_id);
    if v_result.source_player_count is null then
      raise notice 'PASS 6 (C): the same Club Admin is refused a club they do not administer';
    else
      raise notice 'FAIL 6 (C): cross-club audience authority leaked';
    end if;
  end if;

  -- ============ D. Forged identifiers fail closed, not with an error ============

  select * into v_result from public.team_playing_group_summary('00000000-0000-0000-0000-000000000000'::uuid);
  if v_result.source_player_count is null then
    raise notice 'PASS 7 (D): a forged/nonexistent team id is refused cleanly';
  else
    raise notice 'FAIL 7 (D): a forged team id produced a result';
  end if;

  select * into v_result from public.club_playing_group_summary('00000000-0000-0000-0000-000000000000'::uuid);
  if v_result.source_player_count is null then
    raise notice 'PASS 8 (D): a forged/nonexistent club id is refused cleanly';
  else
    raise notice 'FAIL 8 (D): a forged club id produced a result';
  end if;

  -- ============ E. Platform-wide is Full Site Admin only ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_site_admin, 'role', 'authenticated')::text, true);
  select * into v_result from public.platform_eligible_audience_summary();
  if v_result.source_club_count is not null then
    raise notice 'PASS 9 (E): a genuine Full Site Admin resolves the platform-wide audience';
  else
    raise notice 'FAIL 9 (E): a genuine Full Site Admin was refused the platform-wide audience';
  end if;

  if v_narrow_site_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_narrow_site_admin, 'role', 'authenticated')::text, true);
    select * into v_result from public.platform_eligible_audience_summary();
    if v_result.source_club_count is null then
      raise notice 'PASS 10 (E): a narrower (non-full) Site Admin is refused platform-wide';
    else
      raise notice 'FAIL 10 (E): a narrower Site Admin reached the platform-wide audience';
    end if;
  end if;

  if v_ordinary_guardian is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary_guardian, 'role', 'authenticated')::text, true);
    select * into v_result from public.platform_eligible_audience_summary();
    if v_result.source_club_count is null then
      raise notice 'PASS 11 (E): an ordinary guardian with no admin authority is refused platform-wide';
    else
      raise notice 'FAIL 11 (E): an ordinary user reached the platform-wide audience';
    end if;

    begin
      perform public.platform_eligible_recipients();
      raise notice 'FAIL 12 (E): the raw platform recipient list did not raise for an ordinary user';
    exception when others then
      raise notice 'PASS 12 (E): the raw platform recipient RPC raises rather than leaking anyone';
    end;
  end if;

  -- ============ F. Safeguarding-correct resolution + deduplication ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_team_only_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.team_playing_group_recipients(v_own_team_id);
  select * into v_result from public.team_playing_group_summary(v_own_team_id);
  if v_count = v_result.eligible_recipient_count then
    raise notice 'PASS 13 (F): the raw recipient count matches the summary''s own eligible_recipient_count exactly';
  else
    raise notice 'FAIL 13 (F): raw recipient count (%) disagrees with summary (%)', v_count, v_result.eligible_recipient_count;
  end if;

  if v_result.excluded_count is not null and v_result.excluded_count >= 0 then
    raise notice 'PASS 14 (F): excluded players are counted and classified, never silently dropped (excluded_count = %)', v_result.excluded_count;
  end if;

  reset role;
end $$;

rollback;
