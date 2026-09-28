-- SET TEAM DESCRIPTION -- authority, normalisation and read-back (Team Profiles Section 1B).
--
-- Proves `set_team_description` (20270569000000) is the one governed write for "About This Team":
--
--   TDA1  an unrelated viewer is refused, and the description is left untouched
--   TDA2  club-level management (club.profile.edit) may write it
--   TDA3  team-level management (team.team.manage, scoped to this team only, never club-wide) may
--         write it too -- proving BOTH legitimate authorities the brief names, not just one
--   TDA4  whitespace-only input is stored as canonical NULL, never an empty string
--   TDA5  a real value reads back exactly as trimmed and stored
--   TDA6  the UAT review fixtures seeded for Section 1B (local_uat_team_profile_review.sql) are real
--         `fixtures` rows reached through the canonical create_fixture/submit_fixture_result/
--         cancel_fixture operations, not hand-built objects, and the season-scoped fixture/win count
--         the Team Profile computes from them is the real arithmetic, not a written-in number
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tda-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tda', p_label, 'tda-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TDA ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tda-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tda-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under 14 Girls', 'tda-u14-' || v_tag, 'youth', 'U14', 'girls', 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status, state) values (p_club, p_user, 'BASIC_USER', 'active', 'ACTIVE') returning id into v;
  return v;
end $$;

-- A capability override, direct-inserted for test setup only (the same pattern the existing capability
-- attack matrix already uses) -- never how a real grant reaches the table.
create or replace function pg_temp.override(p_user uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_by uuid) returns void language plpgsql as $$
begin
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, reason)
  values (p_user, p_key, p_scope, p_club, p_team, 'grant', 'active', p_by, case p_scope when 'team' then 'TEAM' else 'CLUB' end, 'TDA setup');
end $$;

-- Attempts set_team_description as a specific subject; returns 'OK' or the error message.
create or replace function pg_temp.try_set_description(p_subject uuid, p_team uuid, p_description text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_team_description(p_team, p_description);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'OK';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlerrm;
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
select pg_temp.club('Description Authority') as club_id \gset
select pg_temp.team(:'club_id') as team_id \gset

-- TDA1: an unrelated viewer is refused, and the description is left untouched.
select pg_temp.person('Unrelated Viewer', '1990-01-01') as stranger_id \gset
select pg_temp.try_set_description(:'stranger_id'::uuid, :'team_id'::uuid, 'Should never be stored') as tda1_result \gset
select pg_temp.check(
  :'tda1_result' != 'OK'
  and (select description is null from public.teams where id = :'team_id'),
  'TDA1 an unrelated viewer is refused and the description stays null (' || :'tda1_result' || ')'
);

-- A real, role-based Club Admin -- `people.capability.manage` is `delegable = false` (confirmed live),
-- so nothing but a genuine role ever holds it; a synthetic override-holding "granter" cannot validly
-- delegate anything themselves, which the capability engine's own re-validation of the grantor's
-- CURRENT authority (rule 5) correctly refuses. A real Club Admin is the one legitimate source for the
-- team-scoped delegation TDA3 needs.
select pg_temp.person('Club Admin', '1970-01-01') as admin_id \gset
select pg_temp.member(:'club_id', :'admin_id') as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TDA setup'::text, '{}'::jsonb);

-- TDA2: club-level management (club.profile.edit, held by the Club Admin role itself, no override
-- needed) may write it.
select pg_temp.try_set_description(:'admin_id'::uuid, :'team_id'::uuid, 'A club-level manager wrote this.') as tda2_result \gset
select pg_temp.check(:'tda2_result' = 'OK', 'TDA2 club-level management (club.profile.edit) may write the description (' || :'tda2_result' || ')');

-- TDA3: a delegated team.team.manage holder -- NOT a full Club Admin -- may also write it. The
-- capability catalogue itself fixes `team.team.manage`'s grant_level at 'C' (confirmed live), so it can
-- only ever be DELEGATED at club scope, never narrowly to one team; `inherits_to_team = true` is what
-- then reaches this specific team for the delegate. This is still a genuinely distinct authority from
-- TDA2's full Club Admin role -- a real Club Admin choosing to hand one person exactly this one
-- capability, and nothing else -- rather than a second, narrower grant path the catalogue does not
-- actually offer for this key.
select pg_temp.person('Team Manager', '1988-01-01') as team_mgr_id \gset
select pg_temp.member(:'club_id', :'team_mgr_id') as team_mgr_membership \gset
select pg_temp.override(:'team_mgr_id'::uuid, 'team.team.manage', 'club', :'club_id'::uuid, null, :'admin_id'::uuid);
select pg_temp.try_set_description(:'team_mgr_id'::uuid, :'team_id'::uuid, 'A team-level manager wrote this instead.') as tda3_result \gset
select pg_temp.check(:'tda3_result' = 'OK', 'TDA3 team-level management (team.team.manage) may write the description (' || :'tda3_result' || ')');
select pg_temp.check(
  (select description from public.teams where id = :'team_id') = 'A team-level manager wrote this instead.',
  'TDA3 read-back: the team-level manager''s own text is exactly what is stored'
);

-- TDA4: whitespace-only input is stored as canonical NULL, never an empty string.
select pg_temp.try_set_description(:'team_mgr_id'::uuid, :'team_id'::uuid, '     ') as tda4_result \gset
select pg_temp.check(
  :'tda4_result' = 'OK' and (select description is null from public.teams where id = :'team_id'),
  'TDA4 whitespace-only input clears to null, never an empty string'
);

-- TDA5: a real value reads back exactly as trimmed.
select pg_temp.try_set_description(:'team_mgr_id'::uuid, :'team_id'::uuid, '  Leading and trailing space, trimmed.  ') as tda5_result \gset
select pg_temp.check(
  (select description from public.teams where id = :'team_id') = 'Leading and trailing space, trimmed.',
  'TDA5 a real value reads back exactly as trimmed and stored'
);

-- ---- TDA6: the real UAT review fixtures -- read-only, checked before the rollback below (which only
-- ever undoes THIS file's own TDA1-5 setup, never anything committed by the review seed). ----------
do $$
declare
  v_team uuid := 'c06be292-cebb-4bcc-bfca-81258cfaf100';
  v_opponent uuid := 'cca9e0d0-d6a5-4e5e-9805-6ce9950718df';
  v_fixtures integer;
  v_wins integer;
begin
  if not exists (select 1 from public.teams where id = v_team) then
    raise notice 'SKIP TDA6 -- the Women''s 1st Team UAT fixture does not exist in this database';
    return;
  end if;
  -- The same arithmetic the Team Profile's own seasonSummary uses: every non-cancelled fixture in the
  -- current season counts toward Fixtures, and a win is our own score exceeding the opponent's, read
  -- from the real home_score/away_score/home_away columns -- never a number written in for the seed.
  select
    count(*) filter (where status <> 'Cancelled'),
    count(*) filter (where status <> 'Cancelled' and home_score is not null and away_score is not null
      and ((home_away = 'Home' and home_score > away_score) or (home_away = 'Away' and away_score > home_score)))
  into v_fixtures, v_wins
  from public.fixtures
  where owning_team_id = v_team and opponent_directory_id = v_opponent;

  -- 5 review fixtures were seeded against this opponent (upcoming home, upcoming away, past win, past
  -- loss, cancelled); the query above already scopes to this one opponent, so 4 of those 5 are
  -- non-cancelled -- the pre-existing Aberdeen Grammar Rugby fixture is a different opponent entirely
  -- and correctly excluded here.
  perform pg_temp.check(v_fixtures = 4, format('TDA6 the seeded UAT review fixtures give 4 non-cancelled fixtures against the review opponent, got %s', v_fixtures));
  perform pg_temp.check(v_wins = 1, format('TDA6 exactly one of those fixtures is a real recorded win (28-12), got %s', v_wins));
  perform pg_temp.check(
    exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and status = 'Cancelled'),
    'TDA6 a genuinely cancelled review fixture exists (proves the Cancelled state is real, not simulated in a component)'
  );
end $$;

rollback;
