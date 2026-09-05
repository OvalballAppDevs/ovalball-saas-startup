-- Manual verification for 20260925080000_player_movement_eligibility_resolver.sql:
-- internal.resolve_player_movement_eligibility() -- the single canonical
-- resolver behind both the fixture call-up and dispensation domains.
-- Pure/stable function, no writes -- rolled back anyway since it needs
-- isolated test teams to exercise every shape.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_eligibility_resolver.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0030', 'Resolver Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'resolver-test-club-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0031', 'Resolver Test Club League', 'Testville', 'Testshire', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'resolver-test-club-league-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0030', '9d000000-0000-0000-0000-0000000d0030', 'resolver-test-club-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0031', '9d000000-0000-0000-0000-0000000d0031', 'resolver-test-club-league-9d000000', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000d01', '9d000000-0000-0000-0000-0000000c0030', 'union', 'youth', 'U14', 'boys', null, 'U14', 'rtc-u14', true),
  ('9d000000-0000-0000-0000-000000000d02', '9d000000-0000-0000-0000-0000000c0030', 'union', 'youth', 'U14', 'boys', 'B', 'U14 B', 'rtc-u14b', true),
  ('9d000000-0000-0000-0000-000000000d03', '9d000000-0000-0000-0000-0000000c0030', 'union', 'youth', 'U15', 'boys', null, 'U15', 'rtc-u15', true),
  ('9d000000-0000-0000-0000-000000000d04', '9d000000-0000-0000-0000-0000000c0030', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'rtc-sc', true),
  ('9d000000-0000-0000-0000-000000000d05', '9d000000-0000-0000-0000-0000000c0030', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'rtc-mens2', true),
  ('9d000000-0000-0000-0000-000000000d06', '9d000000-0000-0000-0000-0000000c0031', 'league', 'colts', 'SeniorColts', null, null, 'Senior Colts L', 'rtcl-sc', true),
  ('9d000000-0000-0000-0000-000000000d07', '9d000000-0000-0000-0000-0000000c0031', 'league', 'senior', null, 'mens', '1st', 'Men''s 1st L', 'rtcl-mens1', true),
  ('9d000000-0000-0000-0000-000000000d08', '9d000000-0000-0000-0000-0000000c0031', 'league', 'youth', 'U14', 'boys', null, 'U14 L', 'rtcl-u14', true),
  ('9d000000-0000-0000-0000-000000000d09', '9d000000-0000-0000-0000-0000000c0031', 'league', 'youth', 'U14', 'boys', 'B', 'U14 B L', 'rtcl-u14b', true),
  ('9d000000-0000-0000-0000-000000000d10', '9d000000-0000-0000-0000-0000000c0031', 'league', 'youth', 'U15', 'boys', null, 'U15 L', 'rtcl-u15', true);

do $$
declare r record;
begin
  -- A. U14 -> different U14 squad (team-to-team only)
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d01', '9d000000-0000-0000-0000-000000000d02');
  if r.requirement = 'permitted' then raise notice 'PASS A: same age group -> permitted'; else raise notice 'FAIL A: %', r.requirement; end if;

  -- B. U14 -> U15 (ordinary progression, team approval only)
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d01', '9d000000-0000-0000-0000-000000000d03');
  if r.requirement = 'team_approval_only' then raise notice 'PASS B: U14->U15 -> team_approval_only'; else raise notice 'FAIL B: %', r.requirement; end if;

  -- C. 17yo Senior Colts -> adult Union: external approval required
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '17 years')::date, '9d000000-0000-0000-0000-000000000d04', '9d000000-0000-0000-0000-000000000d05');
  if r.requirement = 'external_approval_required' and r.governing_body = 'RFU' then raise notice 'PASS C: 17yo -> adult union -> external_approval_required (RFU)'; else raise notice 'FAIL C: requirement=% gb=%', r.requirement, r.governing_body; end if;

  -- D. 16yo Senior Colts -> adult Union: not permitted outright
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '16 years')::date, '9d000000-0000-0000-0000-000000000d04', '9d000000-0000-0000-0000-000000000d05');
  if r.requirement = 'not_permitted' then raise notice 'PASS D: 16yo -> adult union -> not_permitted'; else raise notice 'FAIL D: %', r.requirement; end if;

  -- E. 18yo -> adult Union: permitted outright
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '18 years')::date, '9d000000-0000-0000-0000-000000000d04', '9d000000-0000-0000-0000-000000000d05');
  if r.requirement = 'permitted' then raise notice 'PASS E: 18yo -> adult union -> permitted'; else raise notice 'FAIL E: %', r.requirement; end if;

  -- F. No DOB -> adult: not permitted (never assume adulthood)
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, null, '9d000000-0000-0000-0000-000000000d04', '9d000000-0000-0000-0000-000000000d05');
  if r.requirement = 'not_permitted' then raise notice 'PASS F: no DOB -> adult union -> not_permitted'; else raise notice 'FAIL F: %', r.requirement; end if;

  -- G. League: same-age team-to-team -> permitted (no RFU assumptions leaking in)
  -- (reuse two league colts teams as a stand-in same-category pair isn't quite "same age group" so skip; test adult crossing instead)

  -- H/I. League: 17yo colts -> adult league: external approval required, RFL-labelled, no fabricated regulation number
  select * into r from internal.resolve_player_movement_eligibility('league', current_date, (current_date - interval '17 years')::date, '9d000000-0000-0000-0000-000000000d06', '9d000000-0000-0000-0000-000000000d07');
  if r.requirement = 'external_approval_required' and r.governing_body = 'RFL' and r.rule_reference not like '%Regulation 15%' then
    raise notice 'PASS H: 17yo -> adult league -> external_approval_required (RFL, no RFU regulation number leaked)';
  else
    raise notice 'FAIL H: requirement=% gb=% ref=%', r.requirement, r.governing_body, r.rule_reference;
  end if;

  -- J. League 18yo -> adult: permitted (universal adult line, no sport-specific citation needed)
  select * into r from internal.resolve_player_movement_eligibility('league', current_date, (current_date - interval '18 years')::date, '9d000000-0000-0000-0000-000000000d06', '9d000000-0000-0000-0000-000000000d07');
  if r.requirement = 'permitted' then raise notice 'PASS J: 18yo -> adult league -> permitted'; else raise notice 'FAIL J: %', r.requirement; end if;

  -- K. Cross-club: not_permitted
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d01', '9d000000-0000-0000-0000-000000000d06');
  if r.requirement = 'not_permitted' then raise notice 'PASS K: cross-club -> not_permitted'; else raise notice 'FAIL K: %', r.requirement; end if;

  -- L. Skipped grade (U14 -> ... need a U16 team) is covered structurally by the "else" branch; spot check with U14->SeniorColts (not an ordinary progression)
  select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d01', '9d000000-0000-0000-0000-000000000d04');
  if r.requirement = 'external_approval_required' then raise notice 'PASS L: U14 -> Senior Colts (not ordinary progression) -> external_approval_required'; else raise notice 'FAIL L: %', r.requirement; end if;

  -- M. Incompatible pathway/gender: a same-age-boundary crossing that
  -- ALSO changes gender/pathway (boys -> girls) is never an ordinary
  -- progression, regardless of the age_group step being +1. Found live
  -- during the closure verification pass -- the resolver originally
  -- ignored gender entirely on this branch.
  declare
    v_boys_team uuid := '9d000000-0000-0000-0000-0000a0000010';
    v_girls_team uuid := '9d000000-0000-0000-0000-0000a0000011';
  begin
    insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
      (v_boys_team, '9d000000-0000-0000-0000-0000000c0030', 'union', 'youth', 'U12', 'boys', 'U12 Boys', 'rtc-u12boys', true),
      (v_girls_team, '9d000000-0000-0000-0000-0000000c0030', 'union', 'youth', 'U13', 'girls', 'U13 Girls', 'rtc-u13girls', true);
    select * into r from internal.resolve_player_movement_eligibility('union', current_date, (current_date - interval '12 years')::date, v_boys_team, v_girls_team);
    if r.requirement = 'external_approval_required' then
      raise notice 'PASS M: boys U12 -> girls U13 (age steps up one grade, but pathway changes) -> external_approval_required, never waved through as ordinary';
    else
      raise notice 'FAIL M: %', r.requirement;
    end if;
  end;

  -- N. League same-age team-to-team (U14 -> U14 B) -> permitted, on the
  -- SAME generic branch Union uses -- proving League doesn't need its
  -- own copy of the ordinary same-age rule, and isn't silently blocked
  -- just for being League.
  select * into r from internal.resolve_player_movement_eligibility('league', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d08', '9d000000-0000-0000-0000-000000000d09');
  if r.requirement = 'permitted' and r.governing_body is null then
    raise notice 'PASS N: League same-age (U14 -> U14 B) -> permitted, no governing-body citation needed for an ordinary team-to-team request';
  else
    raise notice 'FAIL N: requirement=% gb=%', r.requirement, r.governing_body;
  end if;

  -- O. League one-grade-up (U14 -> U15) -> team_approval_only, same as
  -- Union's ordinary progression -- proving this is a genuinely shared,
  -- code-agnostic rule rather than something copied from RFU and
  -- silently mislabelled RFL.
  select * into r from internal.resolve_player_movement_eligibility('league', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d08', '9d000000-0000-0000-0000-000000000d10');
  if r.requirement = 'team_approval_only' and r.governing_body is null then
    raise notice 'PASS O: League U14 -> U15 (one grade up) -> team_approval_only, no fabricated RFL citation attached to an ordinary progression';
  else
    raise notice 'FAIL O: requirement=% gb=%', r.requirement, r.governing_body;
  end if;

  -- P. League skip-grade (U14 -> Senior Colts, not an ordinary
  -- progression and not an adult crossing) -> falls to the same
  -- conservative default Union uses for an unrecognised shape:
  -- external_approval_required with NO governing body or rule
  -- reference invented. This is the disclosure the closure directive
  -- demands: Ovalball does not assert it knows an RFL rule for this
  -- movement, unlike the youth->adult crossing (PASS H) where a real,
  -- club-owned Player Dispensation Policy citation is used instead.
  select * into r from internal.resolve_player_movement_eligibility('league', current_date, (current_date - interval '14 years')::date, '9d000000-0000-0000-0000-000000000d08', '9d000000-0000-0000-0000-000000000d06');
  if r.requirement = 'external_approval_required' and r.governing_body is null and r.rule_reference is null then
    raise notice 'PASS P: League skip-grade (U14 -> Senior Colts) -> external_approval_required with NO fabricated RFL rule/regulation number -- honestly unencoded, routed to a real recorded decision instead of a guessed rule';
  else
    raise notice 'FAIL P: requirement=% gb=% ref=%', r.requirement, r.governing_body, r.rule_reference;
  end if;
end $$;

rollback;
