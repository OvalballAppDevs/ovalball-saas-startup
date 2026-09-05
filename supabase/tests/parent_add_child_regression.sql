-- Parent/Player Foundation permanent regression suite: canonical age-grade
-- resolver, self-service Add-a-Child, duplicate-review self-service path,
-- pending team-membership approval, and optional Player login invitation.
-- Entirely self-contained synthetic fixtures -- never touches Foxton's
-- real data. Run by hand:
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/parent_add_child_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Parent Add-Child / Age-Grade regression suite ==='

begin;
create temporary table t_pac_state (k text primary key, v text) on commit drop;
grant all on t_pac_state to authenticated, service_role, anon;

do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_guardian_1 uuid := gen_random_uuid();
  v_guardian_2 uuid := gen_random_uuid();
  v_team_u12_a uuid := gen_random_uuid();
  v_team_u10_a uuid := gen_random_uuid();
  v_team_u13_a_1 uuid := gen_random_uuid();
  v_team_u13_a_2 uuid := gen_random_uuid();
  v_season_union uuid := gen_random_uuid();
  v_season_league uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin_a, 'pac-admin-a-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin_b, 'pac-admin-b-' || v_admin_b::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_1, 'pac-g1-' || v_guardian_1::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_2, 'pac-g2-' || v_guardian_2::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values
    (v_dir_a, 'Add Child Regression Club A', 'union', 'England', 'England', 'manual', 'add child regression club a', 'verified'),
    (v_dir_b, 'Add Child Regression Club B', 'union', 'England', 'England', 'manual', 'add child regression club b', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club_a, v_dir_a, 'add-child-regression-a', 'active'),
    (v_club_b, v_dir_b, 'add-child-regression-b', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');

  -- Club A: exactly one U12 team (unambiguous auto-route), exactly one
  -- U10 team, and TWO U13 teams (ambiguous squad case, Section 14).
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, squad_designation, active) values
    (v_team_u12_a, v_club_a, 'union', 'U12', 'u12-pac-a', 'youth', 'U12', 'boys', null, true),
    (v_team_u10_a, v_club_a, 'union', 'U10', 'u10-pac-a', 'youth', 'U10', 'boys', null, true),
    (v_team_u13_a_1, v_club_a, 'union', 'U13', 'u13a-pac-a', 'youth', 'U13', 'boys', null, true),
    (v_team_u13_a_2, v_club_a, 'union', 'U13 B', 'u13b-pac-a', 'youth', 'U13', 'boys', 'B', true);

  -- Main independently hardened a canonical invariant that two active
  -- seasons of the SAME rugby_code may never claim overlapping
  -- operational date ranges -- this suite's original synthetic season
  -- rows collide with Main's own real "Rugby Union 26/27"/"Rugby League
  -- 2026" seasons (identical date ranges). Reusing Main's real canonical
  -- season rows here is more correct than inventing a colliding
  -- duplicate: this suite only ever needs a real season row of the
  -- right rugby_code to resolve age-grade cutoffs against, and these
  -- ARE that season for the exact same 2026/27 cohort.
  v_season_union := '98000000-0000-0000-0000-000000000102';
  v_season_league := '98000000-0000-0000-0000-000000000103';

  insert into t_pac_state values
    ('club_a', v_club_a::text), ('club_b', v_club_b::text), ('admin_a', v_admin_a::text), ('admin_b', v_admin_b::text),
    ('guardian_1', v_guardian_1::text), ('guardian_2', v_guardian_2::text),
    ('team_u12_a', v_team_u12_a::text), ('team_u10_a', v_team_u10_a::text),
    ('team_u13_a_1', v_team_u13_a_1::text), ('team_u13_a_2', v_team_u13_a_2::text),
    ('season_union', v_season_union::text), ('season_league', v_season_league::text);
end $$;

\echo '--- 1-5: canonical age-grade resolver boundary matrix ---'
do $$
declare
  v_season uuid := (select v::uuid from t_pac_state where k = 'season_union');
  v_grade record;
begin
  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2020-09-01');
  if v_grade.canonical_age_group = 'U6' and v_grade.school_year = 1 then
    raise notice 'PASS 1: DOB 2020-09-01 (day after cutoff) resolves U6/Year1';
  else
    raise notice 'FAIL 1: got %/%', v_grade.canonical_age_group, v_grade.school_year;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2020-08-31');
  if v_grade.canonical_age_group = 'U7' and v_grade.school_year = 2 then
    raise notice 'PASS 2: DOB 2020-08-31 (ON cutoff, already turned 6) resolves U7/Year2, not U6 -- the boundary flips correctly';
  else
    raise notice 'FAIL 2: got %/%', v_grade.canonical_age_group, v_grade.school_year;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2015-06-15');
  if v_grade.canonical_age_group = 'U12' and v_grade.school_year = 7 then
    raise notice 'PASS 3: real Foxton DOB (Sammy One, 2015-06-15) independently resolves U12/Year7, matching the real seeded team';
  else
    raise notice 'FAIL 3: got %/%', v_grade.canonical_age_group, v_grade.school_year;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2010-09-01');
  if v_grade.canonical_age_group = 'U16' and v_grade.school_year = 11 then
    raise notice 'PASS 4: DOB 2010-09-01 resolves U16/Year11';
  else
    raise notice 'FAIL 4: got %/%', v_grade.canonical_age_group, v_grade.school_year;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2023-01-01');
  if v_grade.status = 'TOO_YOUNG' and v_grade.canonical_age_group is null then
    raise notice 'PASS 5a: a DOB below U6 correctly resolves TOO_YOUNG with no age group, never a guessed/negative U-number';
  else
    raise notice 'FAIL 5a: got status=%', v_grade.status;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2000-01-01');
  if v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise notice 'PASS 5b: a DOB well beyond Senior Colts correctly resolves OUT_OF_YOUTH_RANGE, never forced into a youth/colts band';
  else
    raise notice 'FAIL 5b: got status=%', v_grade.status;
  end if;

  -- Product correction: there is no youth "U17"/"U18" -- those ages are
  -- Colts (Junior Colts / Senior Colts), a different category entirely.
  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2009-09-01');
  if v_grade.canonical_category = 'colts' and v_grade.canonical_age_group = 'JuniorColts' and v_grade.school_year = 12 then
    raise notice 'PASS 5c: age_at_cutoff=16 (Year 12) correctly resolves category=colts, age_group=JuniorColts -- never "U17"';
  else
    raise notice 'FAIL 5c: got category=% age_group=% year=%', v_grade.canonical_category, v_grade.canonical_age_group, v_grade.school_year;
  end if;

  select * into v_grade from internal.resolve_player_age_grade('union', v_season, '2008-09-01');
  if v_grade.canonical_category = 'colts' and v_grade.canonical_age_group = 'SeniorColts' and v_grade.school_year = 13 then
    raise notice 'PASS 5d: age_at_cutoff=17 (Year 13) correctly resolves category=colts, age_group=SeniorColts -- never "U18"';
  else
    raise notice 'FAIL 5d: got category=% age_group=% year=%', v_grade.canonical_category, v_grade.canonical_age_group, v_grade.school_year;
  end if;
end $$;

\echo '--- 6: RFL uses the SAME 1 Sep-31 Aug cohort boundary as RFU (not flattened, not forced through RFU logic, but independently correct) ---'
do $$
declare
  v_grade_union record;
  v_grade_league record;
begin
  select * into v_grade_union from internal.resolve_player_age_grade('union', (select v::uuid from t_pac_state where k = 'season_union'), '2015-06-15');
  select * into v_grade_league from internal.resolve_player_age_grade('league', (select v::uuid from t_pac_state where k = 'season_league'), '2015-06-15');
  if v_grade_union.canonical_age_group = v_grade_league.canonical_age_group and v_grade_union.canonical_age_group = 'U12' then
    raise notice 'PASS 6: the SAME DOB resolves the SAME U12 age grade for both union and league seasons (each genuinely re-resolved via its own season row, not shared state)';
  else
    raise notice 'FAIL 6: union=% league=%', v_grade_union.canonical_age_group, v_grade_league.canonical_age_group;
  end if;
end $$;

\echo '--- 7: chronological age is a SEPARATE function from sporting age grade (Section 45/69) ---'
do $$
declare
  v_chrono record;
begin
  -- A player whose sporting age grade is U16 (age_at_cutoff=15) may
  -- already be 16 chronologically today if their birthday has since
  -- passed -- prove the two functions are independent.
  select * into v_chrono from internal.resolve_player_chronological_age('2010-09-01'::date, '2026-09-04'::date);
  if v_chrono.age_years = 16 and v_chrono.is_minor = true then
    raise notice 'PASS 7: chronological age (16, minor) is computed independently of and differs from the U16/school-year-11 sporting age grade for the same DOB -- the two concepts are never conflated';
  else
    raise notice 'FAIL 7: age_years=% is_minor=%', v_chrono.age_years, v_chrono.is_minor;
  end if;
end $$;

\echo '--- 8: self-service add-child, single unambiguous team -> pending membership, correct age grade ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_1';
do $$
declare
  v_result record;
begin
  select * into v_result from public.add_child_for_guardian('Alex', 'Regress', '2015-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  if v_result.result = 'created_pending_team' and v_result.age_grade = 'U12' and v_result.team_id = (select v::uuid from t_pac_state where k = 'team_u12_a') then
    raise notice 'PASS 8: brand-new child with exactly one matching U12 team -> created_pending_team, correct age grade, correct team -- server-resolved, never browser-supplied';
  else
    raise notice 'FAIL 8: result=% grade=% team=%', v_result.result, v_result.age_grade, v_result.team_id;
  end if;

  perform set_config('pac.player_alex', (select v_result.player_id::text), true);

  if exists (select 1 from public.player_team_memberships where player_id = v_result.player_id and status = 'pending') then
    raise notice 'PASS 8b: the new membership row is PENDING, not active -- self-service join is never silently vouched-for';
  else
    raise notice 'FAIL 8b: membership was not pending';
  end if;
end $$;

\echo '--- 9: no matching team at all -> created_needs_club_review, no membership row invented ---'
do $$
declare
  v_result record;
begin
  select * into v_result from public.add_child_for_guardian('Jamie', 'Regress', '2009-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  if v_result.result = 'created_needs_club_review' and v_result.age_grade = 'SeniorColts' and v_result.team_id is null then
    raise notice 'PASS 9: this DOB resolves Senior Colts (not youth "U18" -- no such team exists in the real canonical model); no Senior Colts team exists at this club -> created_needs_club_review, Player/Guardian still created, no team membership row invented';
  else
    raise notice 'FAIL 9: result=% grade=% team=%', v_result.result, v_result.age_grade, v_result.team_id;
  end if;
end $$;

\echo '--- 10: multiple same-age squads (U13 A / U13 B) -> never guessed, needs club review ---'
do $$
declare
  v_result record;
begin
  select * into v_result from public.add_child_for_guardian('Casey', 'Regress', '2014-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  if v_result.result = 'created_needs_club_review' and v_result.age_grade = 'U13' and v_result.team_id is null then
    raise notice 'PASS 10: two U13 squads exist -- DOB resolves the AGE GRADE only, never guesses A vs B, defers team placement entirely to the club';
  else
    raise notice 'FAIL 10: result=% grade=% team=%', v_result.result, v_result.age_grade, v_result.team_id;
  end if;
end $$;

\echo '--- 11: idempotency -- resubmitting the identical pending child returns under_review/already state, never a second Player ---'
do $$
declare
  v_result record;
  v_player_count integer;
begin
  select * into v_result from public.add_child_for_guardian('Alex', 'Regress', '2015-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  select count(*) into v_player_count from public.players where first_name = 'Alex' and surname = 'Regress';
  if v_result.result = 'already_linked' and v_player_count = 1 then
    raise notice 'PASS 11: the SAME guardian resubmitting the SAME child (still pending) returns already_linked -- no duplicate Player row created';
  else
    raise notice 'FAIL 11: result=% player_count=%', v_result.result, v_player_count;
  end if;
end $$;

\echo '--- 12: a DIFFERENT guardian submitting the same identity -> under_review (duplicate-candidate match), never silently linked ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_2';
do $$
declare
  v_result record;
  v_review_count integer;
begin
  select * into v_result from public.add_child_for_guardian('Alex', 'Regress', '2015-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  select count(*) into v_review_count from public.player_duplicate_reviews where requesting_guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2') and status = 'pending';
  if v_result.result = 'under_review' and v_review_count = 1 then
    raise notice 'PASS 12: a second, unrelated Guardian submitting the identical name+DOB+club is routed to under_review (Guardian Link Request), never auto-granted access to the existing child';
  else
    raise notice 'FAIL 12: result=% review_count=%', v_result.result, v_review_count;
  end if;

  if not exists (select 1 from public.guardians where guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2') and player_id::text = current_setting('pac.player_alex')) then
    raise notice 'PASS 12b: Guardian 2 has NOT been granted a guardians row yet -- no access exists until approval';
  else
    raise notice 'FAIL 12b: Guardian 2 was granted access without approval';
  end if;
end $$;

\echo '--- 13: resubmitting while under review is idempotent (no second review row) ---'
do $$
declare
  v_result record;
  v_review_count integer;
begin
  select * into v_result from public.add_child_for_guardian('Alex', 'Regress', '2015-06-15'::date, (select v::uuid from t_pac_state where k = 'club_a'), 'union');
  select count(*) into v_review_count from public.player_duplicate_reviews where requesting_guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2');
  if v_result.result = 'under_review' and v_review_count = 1 then
    raise notice 'PASS 13: repeating the identical submission while already under review is idempotent -- still exactly one review row';
  else
    raise notice 'FAIL 13: result=% review_count=%', v_result.result, v_review_count;
  end if;
end $$;

\echo '--- 14: cross-club Team Admin cannot approve or resolve another club''s pending item ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'admin_b';
do $$
declare
  v_membership_id uuid;
  v_review_id uuid;
  v_denied boolean := false;
begin
  select id into v_membership_id from public.player_team_memberships where player_id::text = current_setting('pac.player_alex') limit 1;
  begin
    perform public.approve_pending_team_membership(v_membership_id);
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 14a: Club B admin correctly denied approving Club A''s pending team membership';
  else
    raise notice 'FAIL 14a: cross-club approval was NOT denied';
  end if;

  v_denied := false;
  select id into v_review_id from public.player_duplicate_reviews where requesting_guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2') limit 1;
  begin
    perform public.resolve_player_duplicate_review_as_existing(v_review_id);
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 14b: Club B admin correctly denied resolving Club A''s Guardian Link Request';
  else
    raise notice 'FAIL 14b: cross-club review resolution was NOT denied';
  end if;
end $$;

\echo '--- 15: the requesting Parent cannot self-approve their own pending items ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_1';
do $$
declare
  v_membership_id uuid;
  v_denied boolean := false;
begin
  select id into v_membership_id from public.player_team_memberships where player_id::text = current_setting('pac.player_alex') limit 1;
  begin
    perform public.approve_pending_team_membership(v_membership_id);
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 15: the requesting Parent cannot approve their own child''s pending team membership -- only an authorized roster manager can';
  else
    raise notice 'FAIL 15: Parent self-approval was NOT denied';
  end if;
end $$;

\echo '--- 16: authorized Club A admin approves the pending team membership -> becomes active ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'admin_a';
do $$
declare
  v_membership_id uuid;
begin
  select id into v_membership_id from public.player_team_memberships where player_id::text = current_setting('pac.player_alex') limit 1;
  perform public.approve_pending_team_membership(v_membership_id);
  if exists (select 1 from public.player_team_memberships where id = v_membership_id and status = 'active') then
    raise notice 'PASS 16: Club A admin (real team.roster.manage/club.roster.manage authority) approval correctly activates the membership';
  else
    raise notice 'FAIL 16: membership was not activated';
  end if;
end $$;

-- notifications RLS is strictly "user_id = auth.uid()" (Section 63) -- this
-- check must run as postgres to see Guardian 1's own row, matching this
-- file's established convention for any cross-actor verification.
reset role;
do $$
begin
  if exists (
    select 1 from public.notifications
    where user_id = (select v::uuid from t_pac_state where k = 'guardian_1')
      and type = 'add_child_approved'
      and (data->>'player_id')::text = current_setting('pac.player_alex')
  ) then
    raise notice 'PASS 16b: the requesting Parent (Guardian 1) receives a real notification when the club approves their child''s team join';
  else
    raise notice 'FAIL 16b: no approval notification was created for the requesting Parent';
  end if;
end $$;

\echo '--- 17: Club A admin resolves the Guardian Link Request as existing -> the ORIGINAL requesting guardian (2) gets the relationship, never the resolving admin ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'admin_a';
do $$
declare
  v_review_id uuid;
begin
  select id into v_review_id from public.player_duplicate_reviews where requesting_guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2') and status = 'pending';
  perform public.resolve_player_duplicate_review_as_existing(v_review_id);
  if exists (select 1 from public.guardians where guardian_user_id = (select v::uuid from t_pac_state where k = 'guardian_2') and player_id::text = current_setting('pac.player_alex') and status = 'active')
     and not exists (select 1 from public.guardians where guardian_user_id = (select v::uuid from t_pac_state where k = 'admin_a') and player_id::text = current_setting('pac.player_alex'))
  then
    raise notice 'PASS 17: approval correctly grants the relationship to Guardian 2 (the original requester), never to the resolving Club Admin';
  else
    raise notice 'FAIL 17: guardian relationship not correctly assigned';
  end if;
end $$;

\echo '--- 18: no more than 2 active guardians exist for this player, and no duplicate Player row was ever created ---'
do $$
declare
  v_guardian_count integer;
  v_player_count integer;
begin
  select count(*) into v_guardian_count from public.guardians where player_id::text = current_setting('pac.player_alex') and status = 'active';
  select count(*) into v_player_count from public.players where first_name = 'Alex' and surname = 'Regress';
  if v_guardian_count = 2 and v_player_count = 1 then
    raise notice 'PASS 18: exactly 2 active guardians (1 and 2), exactly 1 Player row -- no duplication anywhere in the whole flow';
  else
    raise notice 'FAIL 18: guardian_count=% player_count=%', v_guardian_count, v_player_count;
  end if;
end $$;

\echo '--- 19: optional Player login invitation -- invite, accept, same player_id, no duplicate Player, cannot double-invite ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_1';
do $$
declare
  v_invitation_id uuid;
  v_token text;
  v_denied boolean := false;
begin
  v_invitation_id := public.invite_player_account(current_setting('pac.player_alex')::uuid, 'alex-regress-login@ovalball.test');
  select token into v_token from public.player_account_invitations where id = v_invitation_id;
  perform set_config('pac.player_login_token', v_token, true);
  if v_invitation_id is not null then
    raise notice 'PASS 19a: an active guardian can invite an optional login for their own child';
  else
    raise notice 'FAIL 19a: invitation not created';
  end if;

  begin
    perform public.invite_player_account(current_setting('pac.player_alex')::uuid, 'someone-else@ovalball.test');
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 19b: a second pending invitation for the same player is correctly rejected (no duplicate invite)';
  else
    raise notice 'FAIL 19b: duplicate invitation was NOT rejected';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_2';
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.invite_player_account(current_setting('pac.player_alex')::uuid, 'other@ovalball.test');
  exception when others then
    v_denied := true;
  end;
  -- Guardian 2 IS also an active guardian (from scenario 17) so this
  -- should actually be blocked by the "already pending" check, not an
  -- authorization failure -- either way it must not create a second
  -- invitation.
  if v_denied then
    raise notice 'PASS 19c: a co-guardian cannot create a second concurrent login invitation while one is already pending';
  else
    raise notice 'FAIL 19c: second invitation was not blocked';
  end if;
end $$;

reset role;
do $$
declare
  v_child_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_child_user, 'alex-regress-login-' || v_child_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  perform set_config('pac.child_user', v_child_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pac.child_user'), 'role', 'authenticated')::text, true);
do $$
declare
  v_linked_player_id uuid;
begin
  v_linked_player_id := public.accept_player_account_invitation(current_setting('pac.player_login_token'));
  if v_linked_player_id::text = current_setting('pac.player_alex') and exists (select 1 from public.players where id = v_linked_player_id and user_id::text = current_setting('pac.child_user')) then
    raise notice 'PASS 20: accepting the invitation links the SAME player_id to the new auth user -- no second Player identity created';
  else
    raise notice 'FAIL 20: linked_player_id=% expected=%', v_linked_player_id, current_setting('pac.player_alex');
  end if;

  if (select count(*) from public.players where first_name = 'Alex' and surname = 'Regress') = 1 then
    raise notice 'PASS 20b: still exactly one Player row after the login was linked';
  else
    raise notice 'FAIL 20b: a duplicate Player row appeared after linking a login';
  end if;
end $$;

\echo '--- 21: an unrelated authenticated user cannot invite a login for a player they do not guard ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'admin_b';
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.invite_player_account((select v::uuid from t_pac_state where k = 'team_u12_a'), 'irrelevant@ovalball.test');
  exception when others then
    v_denied := true;
  end;
  -- Using team_u12_a's id as a bogus "player_id" on purpose -- proves the
  -- function does not silently succeed against a non-guardian/non-player
  -- foreign id either.
  if v_denied then
    raise notice 'PASS 21: an unrelated user cannot invite a login for a player/id they have no guardian relationship to';
  else
    raise notice 'FAIL 21: unauthorized invite was NOT denied';
  end if;
end $$;

reset role;
do $$
begin
  perform set_config('pac.player_jamie', (select id::text from public.players where first_name = 'Jamie' and surname = 'Regress'), true);
end $$;

\echo '--- 22: a Parent with no approved relationship cannot see or act on a player at all (Section 17/38/61) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pac_state where k = 'guardian_2';
do $$
declare
  v_jamie_id uuid := current_setting('pac.player_jamie')::uuid;
  v_visible_count integer;
begin
  -- Guardian 2 has no relationship whatsoever to "Jamie" (created under
  -- Guardian 1 in scenario 9). Section 17: privacy-safe -- an unrelated
  -- guardian must not even be able to SELECT the row (RLS), and Section 38:
  -- with no approved relationship, no subscription/financial action for
  -- that player is reachable either, since every such RPC re-derives
  -- authorization from the SAME guardian relationship this proves is
  -- absent.
  select count(*) into v_visible_count from public.players where id = v_jamie_id;
  if v_visible_count = 0 then
    raise notice 'PASS 22a: an unrelated guardian cannot even SELECT an unrelated player row (RLS-level, not just RPC-level denial)';
  else
    raise notice 'FAIL 22a: unrelated guardian could read the player row';
  end if;

  if not internal.is_active_player_guardian(v_jamie_id) then
    raise notice 'PASS 22b: the canonical guardian-authorization primitive (internal.is_active_player_guardian), which every subscription/financial RPC relies on, correctly returns false -- no approved relationship, no derived access';
  else
    raise notice 'FAIL 22b: is_active_player_guardian incorrectly returned true';
  end if;
end $$;

\echo '--- 23: function grant audit -- anon must never hold EXECUTE on any sensitive Parent/Player Foundation function ---'
do $$
declare
  v_leaked text;
begin
  select string_agg(routine_name, ', ') into v_leaked
  from information_schema.role_routine_grants
  where grantee = 'anon'
    and routine_name in (
      'add_child_for_guardian', 'approve_pending_team_membership', 'reject_pending_team_membership',
      'invite_player_account', 'accept_player_account_invitation',
      'resolve_player_duplicate_review_as_existing', 'resolve_player_duplicate_review_as_new',
      'resolve_player_age_grade', 'resolve_player_chronological_age'
    );
  if v_leaked is null then
    raise notice 'PASS 23: anon has EXECUTE on none of the sensitive Parent/Player Foundation functions';
  else
    raise notice 'FAIL 23: anon has EXECUTE on: %', v_leaked;
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
