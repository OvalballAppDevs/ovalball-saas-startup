-- Manual verification for age-grade terminology (Boys/Girls/Mixed for
-- youth, Men's/Women's for senior) and the U11 Mixed -> U12 structural
-- transition (20260903300000). NOT a migration -- run AFTER
-- permission_matrix.sql and season_rollover.sql (reuses seasons/teams
-- from both).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_rollover.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gender_age_grade_rules.sql

\set ON_ERROR_STOP off
\pset pager off

-- ============================================================
-- Section 1: canonical write-boundary terminology matrix (spec 66).
-- ============================================================

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U8', 'mixed', null, 'Burnley RUFC U8 Mixed', 'burnley-u8-mixed');
  raise notice 'PASS 1: U8 Mixed team insert succeeds';
exception when others then
  raise notice 'FAIL 1: U8 Mixed insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U8', 'boys', null, 'Burnley RUFC U8 Boys', 'burnley-u8-boys');
  raise notice 'PASS 2: U8 Boys team insert succeeds';
exception when others then
  raise notice 'FAIL 2: U8 Boys insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  -- Deliberately NOT U12 -- section 3 below exercises the real U11
  -- Mixed -> U12 Girls structural transition at this same Burnley club,
  -- and confirm_mixed_boundary_rollover refuses to create a second
  -- active Girls team at an age group that already has one (any squad).
  -- This terminology check only needs SOME Girls team to insert
  -- successfully, so it uses a different, non-colliding age group.
  values ('99600000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U13', 'girls', null, 'Burnley RUFC U13 Girls', 'burnley-u13-girls');
  raise notice 'PASS 3: Girls team insert succeeds';
exception when others then
  raise notice 'FAIL 3: Girls team insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'boys', null, 'Burnley RUFC U12 Boys', 'burnley-u12-boys');
  raise notice 'PASS 4: U12 Boys team insert succeeds';
exception when others then
  raise notice 'FAIL 4: U12 Boys insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U12', 'girls', null, 'Rossendale RUFC U12 Girls', 'rossendale-u12-girls-terminology');
  raise notice 'PASS 5: U12 Girls team insert succeeds';
exception when others then
  raise notice 'FAIL 5: U12 Girls insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'mixed', 'ZZ1', 'Should Not Exist', 'burnley-u12-mixed-invalid');
  raise notice 'FAIL 6: U12 Mixed team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 6: U12 Mixed team insert rejected -- U12+ may not be Mixed';
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'mens', 'ZZ2', 'Should Not Exist', 'burnley-u12-mens-invalid');
  raise notice 'FAIL 7: U12 Men''s team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 7: U12 Men''s team insert rejected -- senior vocabulary is not valid for age-grade rugby';
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'womens', 'ZZ3', 'Should Not Exist', 'burnley-u12-womens-invalid');
  raise notice 'FAIL 8: U12 Women''s team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 8: U12 Women''s team insert rejected -- senior vocabulary is not valid for age-grade rugby';
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mens', '3rd', 'Burnley RUFC Men''s 3rd', 'burnley-mens-3rd');
  raise notice 'PASS 9: Senior Men''s team insert succeeds';
exception when others then
  raise notice 'FAIL 9: Senior Men''s insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'womens', '3rd', 'Burnley RUFC Women''s 3rd', 'burnley-womens-3rd');
  raise notice 'PASS 10: Senior Women''s team insert succeeds';
exception when others then
  raise notice 'FAIL 10: Senior Women''s insert unexpectedly rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'boys', 'ZZ4', 'Should Not Exist', 'burnley-senior-boys-invalid');
  raise notice 'FAIL 11: Senior Boys team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 11: Senior Boys team insert rejected -- age-grade vocabulary is not valid for senior rugby';
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'girls', 'ZZ5', 'Should Not Exist', 'burnley-senior-girls-invalid');
  raise notice 'FAIL 12: Senior Girls team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 12: Senior Girls team insert rejected -- age-grade vocabulary is not valid for senior rugby';
end $$;

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mixed', 'ZZ6', 'Should Not Exist', 'burnley-senior-mixed-invalid');
  raise notice 'FAIL 13: Senior Mixed team insert unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 13: Senior Mixed team insert rejected -- Mixed is age-grade-only vocabulary, never valid for senior rugby';
end $$;

-- Edit path uses the same constraint as create (no dedicated team RPC).
do $$
begin
  update public.teams set gender = 'mixed' where id = '30000000-0000-0000-0000-000000000001'; -- Burnley U12 A, existing shared fixture
  raise notice 'FAIL 14: editing Burnley U12 A to Mixed unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 14: editing an existing U12 team to Mixed is rejected -- the constraint enforces edits identically to creates';
end $$;

-- identity_key includes gender: a same-age Boys and Girls team must NOT
-- collide (needed for the U11-Mixed-boundary Girls-team creation below,
-- and for any club that genuinely runs both at the same age). U16 --
-- never a rollover source or destination elsewhere in this file -- keeps
-- this terminology check fully independent of section 2/3's own U12/U13
-- rollover-identity claims.
do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U16', 'boys', null, 'Burnley RUFC U16 Boys', 'burnley-u12-boys-par');
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U16', 'girls', null, 'Burnley RUFC U16 Girls', 'burnley-u12-girls-par');
  raise notice 'PASS 15: a Boys team and a Girls team at the same age group coexist independently -- identity_key is gender-aware';
exception when others then
  raise notice 'FAIL 15: parallel Boys/Girls teams at the same age unexpectedly collided: %', sqlerrm;
end $$;

-- girls-youth flexible age matching now keys on gender='girls' (not the
-- old 'womens').
do $$
declare
  v_eligible boolean;
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('99600000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U15', 'girls', null, 'Rossendale RUFC U15 Girls', 'rossendale-u15-girls')
  on conflict (id) do nothing;
  select internal.teams_can_play_fixture('99600000-0000-0000-0000-000000000003', '99600000-0000-0000-0000-000000000016') into v_eligible;
  if v_eligible then
    raise notice 'PASS 16: two Girls youth teams at different age groups (U13 vs U15) are still eligible to fixture each other -- girls youth rugby is deliberately flexible on age';
  else
    raise notice 'FAIL 16: expected Girls-vs-Girls flexible-age eligibility, got false';
  end if;
end $$;

-- ============================================================
-- Section 2: normal rollover stability -- same team_id, squad, and
-- team_permissions survive an ordinary Boys/Girls age progression.
-- ============================================================

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_id uuid;
  v_perm_count_before integer;
  v_perm_count_after integer;
  v_final_age_group text;
begin
  select count(*) into v_perm_count_before from public.team_permissions where team_id = '99600000-0000-0000-0000-000000000004';

  v_rollover_id := public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'union', '98000000-0000-0000-0000-000000000102');
  select id into v_proposal_id from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000004';
  perform public.confirm_rollover_team_proposal(v_proposal_id, 'confirm', null, null, null, null);

  select age_group into v_final_age_group from public.teams where id = '99600000-0000-0000-0000-000000000004';
  select count(*) into v_perm_count_after from public.team_permissions where team_id = '99600000-0000-0000-0000-000000000004';

  if v_final_age_group = 'U13' and v_perm_count_after = v_perm_count_before then
    raise notice 'PASS 17: normal U12 Boys -> U13 Boys rollover keeps the SAME team_id (age_group updated in place) and team_permissions rows are untouched';
  else
    raise notice 'FAIL 17: final_age_group=%, perm_count_before=%, perm_count_after=%', v_final_age_group, v_perm_count_before, v_perm_count_after;
  end if;
end $$;
commit;

-- ============================================================
-- Section 3: the U11 Mixed -> U12 structural transition.
-- ============================================================

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values
    ('99600000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U11', 'mixed', null, 'Burnley RUFC U11 Mixed', 'burnley-u11-mixed-struct'),
    ('99600000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U11', 'mixed', 'B', 'Burnley RUFC U11 Mixed B', 'burnley-u11-mixed-b-struct'),
    ('99600000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U11', 'mixed', 'C', 'Burnley RUFC U11 Mixed C', 'burnley-u11-mixed-c-struct');

  -- A PAST fixture on the "A" cohort, so its historical age-grade identity
  -- (captured by the pre-existing snapshot trigger) can be checked after
  -- rollover -- it must stay U11, never silently become U12.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('99600000-0000-0000-0000-000000000023', '99600000-0000-0000-0000-000000000020', null, 'Home', 'Old Rivals U11', '2026-02-10', 'Completed', 'club_created');
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_a uuid;
  v_requires_manual boolean;
  v_is_boundary boolean;
  v_proposed text;
begin
  v_rollover_id := public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'union', '98000000-0000-0000-0000-000000000102');
  select id, requires_manual_choice, is_mixed_boundary, proposed_age_group
    into v_proposal_a, v_requires_manual, v_is_boundary, v_proposed
    from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000020';
  if v_requires_manual = true and v_is_boundary = true and v_proposed = 'U12' then
    raise notice 'PASS 18: a U11 Mixed team''s rollover proposal is flagged is_mixed_boundary with an AUTOMATIC U12 proposal -- the Boys continuation is the default, never a bare "choose anything"';
  else
    raise notice 'FAIL 18: requires_manual_choice=%, is_mixed_boundary=%, proposed_age_group=%', v_requires_manual, v_is_boundary, v_proposed;
  end if;

  begin
    perform public.confirm_rollover_team_proposal(v_proposal_a, 'confirm', null, null, null, null);
    raise notice 'FAIL 19: the ordinary confirm_rollover_team_proposal path unexpectedly accepted a mixed-boundary row';
  exception when others then
    raise notice 'PASS 19: the ordinary Confirm/Adjust path refuses a mixed-boundary row -- it must go through the dedicated Girls-team decision flow';
  end;

  begin
    perform public.confirm_mixed_boundary_rollover(v_proposal_a, null, null, null);
    raise notice 'FAIL 20: confirm_mixed_boundary_rollover accepted a NULL Girls-team answer';
  exception when others then
    raise notice 'PASS 20: confirm_mixed_boundary_rollover refuses a null Yes/No answer -- the rollover cannot silently finish unanswered';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 21/22: answer NO -- Boys continuation applies, no Girls team created.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_a uuid;
  v_boys_id uuid;
  v_girls_id uuid;
  v_final_age_group text;
  v_final_gender text;
  v_girls_created boolean;
  v_snapshot_age text;
begin
  select id into v_rollover_id from public.age_grade_rollovers where club_id = '10000000-0000-0000-0000-000000000001' and rugby_code = 'union' and to_season_id = '98000000-0000-0000-0000-000000000102' order by created_at desc limit 1;
  select id into v_proposal_a from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000020';

  select boys_team_id, girls_team_id into v_boys_id, v_girls_id from public.confirm_mixed_boundary_rollover(v_proposal_a, false, null, null);

  select age_group, gender into v_final_age_group, v_final_gender from public.teams where id = '99600000-0000-0000-0000-000000000020';
  select girls_team_created into v_girls_created from public.age_grade_rollover_team_proposals where id = v_proposal_a;
  select owning_team_age_group_snapshot into v_snapshot_age from public.fixtures where id = '99600000-0000-0000-0000-000000000023';

  if v_boys_id = '99600000-0000-0000-0000-000000000020' and v_girls_id is null and v_final_age_group = 'U12' and v_final_gender = 'boys' and v_girls_created = false then
    raise notice 'PASS 21: answering No -- the SAME team_id continues as U12 Boys, no Girls team is created, and the decision records girls_team_created=false';
  else
    raise notice 'FAIL 21: boys_id=%, girls_id=%, age_group=%, gender=%, girls_created=%', v_boys_id, v_girls_id, v_final_age_group, v_final_gender, v_girls_created;
  end if;

  if v_snapshot_age = 'U11' then
    raise notice 'PASS 22: the pre-rollover fixture''s historical age-grade snapshot stays U11 -- rolling the team forward never rewrites past fixture identity';
  else
    raise notice 'FAIL 22: expected historical snapshot U11, got %', v_snapshot_age;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 23-26: answer YES on a DIFFERENT U11 Mixed team -- Boys continues,
-- a genuinely new Girls team is created with no inherited history.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_b uuid;
  v_boys_id uuid;
  v_girls_id uuid;
  v_girls_category text;
  v_girls_age_group text;
  v_girls_gender text;
  v_girls_fixture_count integer;
begin
  select id into v_rollover_id from public.age_grade_rollovers where club_id = '10000000-0000-0000-0000-000000000001' and rugby_code = 'union' and to_season_id = '98000000-0000-0000-0000-000000000102' order by created_at desc limit 1;
  select id into v_proposal_b from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000021';

  select boys_team_id, girls_team_id into v_boys_id, v_girls_id from public.confirm_mixed_boundary_rollover(v_proposal_b, true, null, null);

  if v_boys_id = '99600000-0000-0000-0000-000000000021' and v_girls_id is not null and v_girls_id <> v_boys_id then
    raise notice 'PASS 23: answering Yes -- the continuing team stays U11 Mixed B''s own team_id (now Boys), and a NEW, genuinely different team_id is created for Girls';
  else
    raise notice 'FAIL 23: boys_id=%, girls_id=%', v_boys_id, v_girls_id;
  end if;

  select category, age_group, gender into v_girls_category, v_girls_age_group, v_girls_gender from public.teams where id = v_girls_id;
  if v_girls_category = 'youth' and v_girls_age_group = 'U12' and v_girls_gender = 'girls' then
    raise notice 'PASS 24: the new team is genuinely U12 Girls (category/age_group/gender all correct)';
  else
    raise notice 'FAIL 24: category=%, age_group=%, gender=%', v_girls_category, v_girls_age_group, v_girls_gender;
  end if;

  select count(*) into v_girls_fixture_count from public.fixtures where owning_team_id = v_girls_id or opponent_team_id = v_girls_id;
  if v_girls_fixture_count = 0 then
    raise notice 'PASS 25: the new Girls team has zero fixtures -- no inherited match/result history from the Mixed team it split from';
  else
    raise notice 'FAIL 25: expected 0 fixtures for the new Girls team, found %', v_girls_fixture_count;
  end if;

end $$;
commit;

-- audit_log is Site-Admin-select-only (RLS) -- checked as postgres
-- (bypasses RLS), not inside the Club Admin session above.
do $$
declare
  v_girls_id uuid;
begin
  select id into v_girls_id from public.teams
  where club_id = '10000000-0000-0000-0000-000000000001' and category = 'youth' and age_group = 'U12' and gender = 'girls' and squad_designation is null;

  if exists (select 1 from public.audit_log where table_name = 'teams' and record_id = v_girls_id and action = 'insert') then
    raise notice 'PASS 26: the new Girls team''s creation is recorded in audit_log';
  else
    raise notice 'FAIL 26: no audit_log entry found for the new Girls team creation';
  end if;
end $$;

-- ------------------------------------------------------------
-- 27-29: existing-team collisions -- never a duplicate Girls team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_c uuid;
begin
  select id into v_rollover_id from public.age_grade_rollovers where club_id = '10000000-0000-0000-0000-000000000001' and rugby_code = 'union' and to_season_id = '98000000-0000-0000-0000-000000000102' order by created_at desc limit 1;
  select id into v_proposal_c from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000022';

  begin
    perform public.confirm_mixed_boundary_rollover(v_proposal_c, true, null, null);
    raise notice 'FAIL 27: creating a second U12 Girls team unexpectedly succeeded -- the one from proposal B already exists';
  exception when others then
    raise notice 'PASS 27: an existing active U12 Girls team blocks creating another -- never a duplicate';
  end;
end $$;
commit;

-- Squads before primary -- a primary cannot deactivate while a B/C
-- sibling at the same level is still active, and a single multi-row
-- UPDATE does not guarantee squad-before-primary row processing order.
do $$
begin
  update public.teams set active = false, folded_at = now(), fold_reason = 'test: folded for collision check'
  where club_id = '10000000-0000-0000-0000-000000000001' and category = 'youth' and age_group = 'U12' and gender = 'girls' and squad_designation is not null;
  update public.teams set active = false, folded_at = now(), fold_reason = 'test: folded for collision check'
  where club_id = '10000000-0000-0000-0000-000000000001' and category = 'youth' and age_group = 'U12' and gender = 'girls' and squad_designation is null;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_c uuid;
begin
  select id into v_rollover_id from public.age_grade_rollovers where club_id = '10000000-0000-0000-0000-000000000001' and rugby_code = 'union' and to_season_id = '98000000-0000-0000-0000-000000000102' order by created_at desc limit 1;
  select id into v_proposal_c from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000022';

  begin
    perform public.confirm_mixed_boundary_rollover(v_proposal_c, true, null, null);
    raise notice 'FAIL 28: creating a U12 Girls team unexpectedly succeeded while a FOLDED one already exists';
  exception when others then
    if sqlerrm like '%folded%' then
      raise notice 'PASS 28: a folded U12 Girls team is also detected and blocks creating a duplicate, with a message distinguishing it as folded';
    else
      raise notice 'FAIL 28: blocked, but message did not identify the existing team as folded: %', sqlerrm;
    end if;
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 29: idempotency -- a proposal that is already decided cannot be
-- re-applied, so a repeated submit/refresh can never produce a second
-- Girls team or double-apply the Boys continuation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_proposal_a uuid;
begin
  select id into v_rollover_id from public.age_grade_rollovers where club_id = '10000000-0000-0000-0000-000000000001' and rugby_code = 'union' and to_season_id = '98000000-0000-0000-0000-000000000102' order by created_at desc limit 1;
  select id into v_proposal_a from public.age_grade_rollover_team_proposals where rollover_id = v_rollover_id and team_id = '99600000-0000-0000-0000-000000000020'; -- already confirmed in test 21

  begin
    perform public.confirm_mixed_boundary_rollover(v_proposal_a, true, null, null);
    raise notice 'FAIL 29: re-confirming an already-decided mixed-boundary proposal unexpectedly succeeded';
  exception when others then
    raise notice 'PASS 29: an already-decided proposal cannot be re-applied -- repeated submission/refresh cannot create a duplicate Girls team';
  end;
end $$;
commit;
