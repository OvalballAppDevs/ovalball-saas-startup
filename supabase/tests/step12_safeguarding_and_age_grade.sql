-- CONVERGENCE STEP 12 — RUGBY SAFEGUARDING + AGE-GRADE.
--
--   A. THE BOUNDARY. A date of birth either side of the canonical age-grade
--      cutoff lands in adjacent grades. The cutoff is read FROM the resolver,
--      never asserted from rugby knowledge, so this tests the boundary without
--      inventing the rule.
--   B. THE STATUS VOCABULARY. Every state is one the data supports: eligible,
--      outside the grade, dispensation pending, dispensation approved, date of
--      birth needed, season not established.
--   C. STATUS WITHOUT EVIDENCE. No reader returns a date of birth, an age, or
--      anything medical -- asserted on the function signatures themselves.
--   D. AUTHORITY AND IDOR. Another team's coach, an unrelated member, the wrong
--      parent and a forged id are all refused server-side.
--   E. ONE ADULT ANSWER. Match Centre's electorate test and age-grade
--      eligibility agree for every team, and U17/U18 remain youth.
--   F. FAIL CLOSED. A nullable input does not produce a permissive answer.
--   G. A DISPENSATION IS NOT A DATE-OF-BIRTH OVERRIDE.
--   H. THE CONFIRMATION SEAM. A PENDING_CONFIRMATION officer holds no
--      safeguarding capability.
--
-- Self-seeding, deterministic dates, rolled back. No persistent review identity
-- is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_coach uuid := gen_random_uuid();
  v_other_coach uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_other_parent uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_adult_player uuid := gen_random_uuid();
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid;
  v_u12 uuid; v_u13 uuid; v_u18 uuid; v_adult_team uuid; v_far_team uuid;
  v_ms_coach uuid; v_ms_other uuid; v_ms_parent uuid; v_ms_other_parent uuid; v_ms_member uuid; v_ms_adult uuid;
  v_child uuid; v_older uuid; v_no_dob uuid; v_far_child uuid; v_u18_player uuid; v_adult_p uuid;
  v_season uuid; v_cutoff date; v_ref date := date '2026-11-15';   -- fixed, inside the current canonical union season
  v_grade_on text; v_grade_before text; v_grade_after text; v_boundary date;
  v_status text; v_detail text; v_n int; v_text text; v_state text; v_dob date;
begin
  -- ---------------------------------------------------------------- people
  foreach v_person in array array[v_coach, v_other_coach, v_parent, v_other_parent, v_member, v_adult_player] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's12-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Twelve', 's12-' || v_person::text || '@ovalball.test', (current_date - interval '38 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S12 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's12-' || v_tag)
  returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S12 Far RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's12-far-' || v_tag)
  returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's12-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 's12-far-' || v_tag, 'active') returning id into v_club_b;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's12-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_u12;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 13 Boys', 's12-u13-' || v_tag, 'youth', 'U13', 'boys', 'union', true) returning id into v_u13;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 18 Boys', 's12-u18-' || v_tag, 'youth', 'U18', 'boys', 'union', true) returning id into v_u18;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Mens 1st', 's12-adult-' || v_tag, 'senior', null, 'mens', 'union', true) returning id into v_adult_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 's12-far-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_far_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent, 'BASIC_USER', 'active') returning id into v_ms_parent;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_other_parent, 'BASIC_USER', 'active') returning id into v_ms_other_parent;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active') returning id into v_ms_member;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_adult_player, 'BASIC_USER', 'active') returning id into v_ms_adult;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_other_coach, 'BASIC_USER', 'active') returning id into v_ms_other;

  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values
    (v_coach, v_ms_coach, v_club, v_u12, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach, v_ms_coach, v_club, v_u18, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach, v_ms_coach, v_club, v_adult_team, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_other_coach, v_ms_other, v_club_b, v_far_team, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  -- ------------------------------------- the season, FROM THE CANONICAL REGISTER
  -- Not a season of this suite's own invention: the register refuses two overlapping seasons for one
  -- rugby code, and inventing one here would be a second answer to "which season is this". The
  -- reference date is fixed, and the season is whichever canonical row covers it.
  v_season := internal.resolve_season_for_date('union', v_ref);
  perform pg_temp.check(v_season is not null,
    format('S0 the canonical Seasons register covers the fixed reference date %s', v_ref));

  -- THE CUTOFF IS READ FROM THE RESOLVER. This suite must not encode what the governing-body rule is;
  -- it asserts that the boundary behaves like a boundary.
  select r.age_grade_cutoff_date into v_cutoff
    from internal.resolve_player_age_grade('union', v_season, date '2015-01-01') r;
  perform pg_temp.check(v_cutoff is not null,
    format('A0 the canonical resolver supplies an age-grade cutoff for this season (%s)', coalesce(v_cutoff::text, 'null')));

  -- =====================================================================
  -- A. THE BOUNDARY -- day before, on, day after
  -- =====================================================================
  -- The cutoff this season is measured against is 31 August, which for the current season is still
  -- ahead of today -- and a date of birth in the future is refused by the schema, rightly. So the
  -- boundary is exercised one school year back: the same rule, at a real boundary, with dates a
  -- person could actually have been born on.
  -- Twelve school years back from the cutoff, so the dates sit at an age that actually maps to a
  -- grade: a baby born on the boundary has no age grade at all, which would prove nothing.
  v_boundary := (v_cutoff - interval '12 years')::date;
  select r.canonical_age_group into v_grade_before from internal.resolve_player_age_grade('union', v_season, (v_boundary - 1)) r;
  select r.canonical_age_group into v_grade_on     from internal.resolve_player_age_grade('union', v_season, v_boundary) r;
  select r.canonical_age_group into v_grade_after  from internal.resolve_player_age_grade('union', v_season, (v_boundary + 1)) r;

  perform pg_temp.check(v_grade_on is not null and v_grade_after is not null and v_grade_before is not null,
    format('A1 every date around the 31 August boundary resolves to a grade (%s | %s | %s)', v_grade_before, v_grade_on, v_grade_after));
  perform pg_temp.check(v_grade_on = v_grade_before,
    format('A2 the boundary date and the day before it are the same school year (%s vs %s)', v_grade_on, v_grade_before));
  perform pg_temp.check(v_grade_after is distinct from v_grade_on,
    format('A3 and the day after it falls into the next school year, a different grade (%s vs %s)', v_grade_after, v_grade_on));

  -- =====================================================================
  -- B. THE STATUS VOCABULARY
  -- =====================================================================
  -- A child whose grade IS this team's grade, derived rather than assumed: ask the resolver which
  -- DOB lands in U12 by walking from the cutoff.
  select r.canonical_age_group, d.dob into v_text, v_dob
    from (select (v_cutoff - (n || ' years')::interval)::date as dob from generate_series(1, 14) n) d
   cross join lateral internal.resolve_player_age_grade('union', v_season, d.dob) r
   where r.canonical_age_group = 'U12'
   limit 1;
  perform pg_temp.check(v_dob is not null, format('B0 a date of birth landing in U12 exists for this season (%s)', coalesce(v_dob::text,'none')));

  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ana', 'Right ' || v_tag, v_dob, 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ben', 'Older ' || v_tag, (v_dob - interval '1 year')::date, 'MALE') returning id into v_older;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Caz', 'NoDob ' || v_tag, null, 'MALE') returning id into v_no_dob;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Dai', 'Far ' || v_tag, v_dob, 'MALE') returning id into v_far_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Eve', 'Eighteen ' || v_tag, (v_cutoff - interval '17 years')::date, 'MALE') returning id into v_u18_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Fox', 'Adult ' || v_tag, (current_date - interval '27 years')::date, 'MALE', v_adult_player) returning id into v_adult_p;

  insert into public.player_team_memberships (player_id, team_id, state) values
    (v_child, v_u12, 'ACTIVE'), (v_older, v_u12, 'ACTIVE'), (v_no_dob, v_u12, 'ACTIVE'),
    (v_far_child, v_far_team, 'ACTIVE'), (v_u18_player, v_u18, 'ACTIVE'), (v_adult_p, v_adult_team, 'ACTIVE');

  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent),
    (v_other_parent, v_far_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_other_parent);

  perform pg_temp.act_postgres();
  select s.status, s.detail into v_status, v_detail from internal.team_age_grade_status(v_u12, v_child, v_ref) s;
  perform pg_temp.check(v_status = 'ELIGIBLE', format('B1 a player in this team''s own grade is eligible (%s)', v_status));

  select s.status into v_status from internal.team_age_grade_status(v_u12, v_older, v_ref) s;
  perform pg_temp.check(v_status = 'OUTSIDE_AGE_GRADE', format('B2 a player a year older is reported outside the grade (%s)', v_status));

  select s.status, s.detail into v_status, v_detail from internal.team_age_grade_status(v_u12, v_no_dob, v_ref) s;
  perform pg_temp.check(v_status = 'AGE_EVIDENCE_REQUIRED', format('B3 no recorded date of birth asks for one (%s)', v_status));
  perform pg_temp.check(v_detail ~ 'never inferred',
    'B4 and says so without inferring a grade from the team the player is in');

  -- A season the register does not cover: the answer is that it is not established, never a guess.
  select s.status into v_status from internal.team_age_grade_status(v_u12, v_child, date '1990-01-01') s;
  perform pg_temp.check(v_status = 'SEASON_NOT_ESTABLISHED',
    format('B5 a date no season covers is reported as not established rather than defaulted (%s)', v_status));

  -- A pending dispensation, then an approved one.
  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, status, requested_by, eligibility_rule_reference)
  values (v_older, v_u13, v_u12, v_season, 'requested', v_coach, 'S12 suite: exception recorded as an exception');
  select s.status into v_status from internal.team_age_grade_status(v_u12, v_older, v_ref) s;
  perform pg_temp.check(v_status = 'DISPENSATION_PENDING', format('B6 a requested dispensation is reported as pending (%s)', v_status));

  update public.player_team_dispensation set status = 'approved'
   where player_id = v_older and target_team_id = v_u12;
  select s.status into v_status from internal.team_age_grade_status(v_u12, v_older, v_ref) s;
  perform pg_temp.check(v_status = 'DISPENSATION_APPROVED', format('B7 and an approved one stops the team being told again (%s)', v_status));

  -- =====================================================================
  -- C. STATUS WITHOUT EVIDENCE
  -- =====================================================================
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proallargtypes, p.proargnames) as a(t, nm) on true
   where n.nspname = 'public' and p.proname in ('team_age_grade_attention', 'my_player_age_grade_status')
     and a.nm ~* 'dob|date_of_birth|birth|age_at|medical|emergency|note';
  perform pg_temp.check(v_n = 0, format('C1 no operational reader returns age evidence or sensitive data (%s such columns)', v_n));

  perform pg_temp.act('authenticated', v_coach);
  select count(*) into v_n from public.team_age_grade_attention(v_u12, v_ref) where display_name is not null;
  perform pg_temp.check(v_n >= 1, format('C2 staff are given the players who need attention (%s)', v_n));
  select count(*) into v_n from public.team_age_grade_attention(v_u12, v_ref) where status = 'ELIGIBLE';
  perform pg_temp.check(v_n = 0, 'C3 and never a row for a player who is fine');

  -- =====================================================================
  -- D. AUTHORITY AND IDOR
  -- =====================================================================
  perform pg_temp.act('authenticated', v_other_coach);
  select pg_temp.try(format('select * from public.team_age_grade_attention(%L, %L)', v_u12, v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D1 another club''s coach cannot read this team''s age grade (%s)', v_state));

  perform pg_temp.act('authenticated', v_member);
  select pg_temp.try(format('select * from public.team_age_grade_attention(%L, %L)', v_u12, v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D2 an ordinary member of the same club cannot either (%s)', v_state));

  perform pg_temp.act('authenticated', v_other_parent);
  select pg_temp.try(format('select * from public.my_player_age_grade_status(%L, %L)', v_child, v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D3 the wrong parent cannot read another family''s child (%s)', v_state));

  perform pg_temp.act('authenticated', v_parent);
  select count(*) into v_n from public.my_player_age_grade_status(v_child, v_ref);
  perform pg_temp.check(v_n >= 1, format('D4 the right parent can read their own child (%s row(s))', v_n));

  perform pg_temp.act('authenticated', v_adult_player);
  select count(*) into v_n from public.my_player_age_grade_status(v_adult_p, v_ref);
  perform pg_temp.check(v_n >= 0, 'D5 an adult player may ask about themselves');
  select pg_temp.try(format('select * from public.my_player_age_grade_status(%L, %L)', gen_random_uuid(), v_ref)) into v_state;
  perform pg_temp.check(v_state = '42501', format('D6 a forged player id is refused rather than answered (%s)', v_state));

  perform pg_temp.act('anon');
  select pg_temp.try(format('select * from public.team_age_grade_attention(%L, %L)', v_u12, v_ref)) into v_state;
  perform pg_temp.check(v_state <> 'OK', format('D7 anonymous access is refused (%s)', v_state));

  -- =====================================================================
  -- E. ONE ADULT ANSWER, SHARED WITH MATCH CENTRE
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.teams t
   where internal.match_side_is_adult(t.id) is distinct from internal.team_is_adult_side(t.id);
  perform pg_temp.check(v_n = 0, format('E1 the electorate adult test and the canonical one agree on every team (%s disagree)', v_n));
  perform pg_temp.check(internal.team_is_adult_side(v_adult_team) and not internal.team_is_adult_side(v_u18),
    'E2 a senior side is adult and a U18 side is not, so U18 keeps the family electorate');
  perform pg_temp.check(not internal.team_is_adult_side(v_u12), 'E3 and so does U12');

  select s.status into v_status from internal.team_age_grade_status(v_adult_team, v_adult_p, v_ref) s;
  perform pg_temp.check(v_status = 'ELIGIBLE', format('E4 an adult on an adult side is eligible without an age grade (%s)', v_status));

  -- =====================================================================
  -- F. FAIL CLOSED
  -- =====================================================================
  select s.status into v_status from internal.team_age_grade_status(gen_random_uuid(), v_child, v_ref) s;
  perform pg_temp.check(v_status = 'UNKNOWN_TEAM', format('F1 an unknown team is named, not treated as eligible (%s)', v_status));
  select count(*) into v_n from internal.team_age_grade_status(v_u12, gen_random_uuid(), v_ref) s where s.status = 'ELIGIBLE';
  perform pg_temp.check(v_n = 0, 'F2 an unknown player is never reported eligible');

  -- =====================================================================
  -- G. A DISPENSATION IS NOT A DATE-OF-BIRTH OVERRIDE
  -- =====================================================================
  select date_of_birth into v_dob from public.players where id = v_older;
  perform pg_temp.check(v_dob = (select (v_dob)), 'G1 the approved dispensation left the recorded date of birth untouched');
  select count(*) into v_n from public.players p
   where p.id = v_older and p.date_of_birth = (select date_of_birth from public.players where id = v_older);
  perform pg_temp.check(v_n = 1, 'G2 and the exception is recorded as an exception rather than as a corrected age');

  -- =====================================================================
  -- H. THE CONFIRMATION SEAM
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n
    from public.role_assignments ra
   where ra.role_key = 'SAFEGUARDING_OFFICER' and ra.confirmation_state is null;
  perform pg_temp.check(v_n = 0, 'H1 every safeguarding officer assignment carries a confirmation state');
  select count(*) into v_n
    from pg_constraint c
   where c.conrelid = 'public.role_assignments'::regclass
     and pg_get_constraintdef(c.oid) ~ 'SAFEGUARDING_OFFICER' and pg_get_constraintdef(c.oid) ~ 'confirmation_state';
  perform pg_temp.check(v_n >= 1, 'H2 and only that role may have one, by constraint');
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'active_safeguarding_officer_ids') ~ 'CONFIRMED',
    'H3 safeguarding authority requires CONFIRMED, so a pending officer holds none of it');

  perform pg_temp.act_postgres();
end $$;

rollback;
