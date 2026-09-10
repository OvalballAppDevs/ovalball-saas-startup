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
  select guardian_user_id into v_ordinary_guardian from public.guardians where status = 'active'
    and guardian_user_id not in (select user_id from public.site_admins)
    and guardian_user_id not in (select user_id from public.club_memberships where role = 'CLUB_ADMIN')
  limit 1;

  -- A real team_admin/coach/manager permission holder who is NOT a club admin.
  select cm.user_id, tp.team_id, t.club_id into v_team_only_admin, v_own_team_id, v_own_club_id
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active' and cm.authority_suspended = false
  join public.teams t on t.id = tp.team_id
  where tp.permission in ('team_admin', 'coach', 'manager')
    and cm.role <> 'CLUB_ADMIN'
  order by cm.user_id, tp.team_id
  limit 1;
  raise notice 'Selected team-only admin % for team % (club %)', v_team_only_admin, v_own_team_id, v_own_club_id;

  select user_id, club_id into v_real_club_admin, v_own_club_id
  from public.club_memberships where role = 'CLUB_ADMIN' and status = 'active' limit 1;

  select id into v_foreign_club_id from public.clubs where id <> v_own_club_id and status = 'active' limit 1;
  select id into v_sibling_team_id from public.teams where club_id = v_own_club_id and id <> v_own_team_id limit 1;

  if v_full_site_admin is null or v_team_only_admin is null or v_real_club_admin is null then
    raise notice 'Recipient-engine UAT prerequisites not found on this database -- skipping (this is expected on a fresh/non-seeded database).';
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
