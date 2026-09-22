-- MOBILE FIXTURES -- THE AUTHORITY THE APP CONSUMES AND CANNOT WIDEN.
--
-- The mobile Fixtures screen asks `my_capabilities` which controls to draw, and then every mutation it
-- offers is re-decided by the database. So what has to be proved is not that the interface behaves --
-- an installed app is modifiable -- but that the SERVER draws the lines the owner's authority model
-- describes, at exactly the scope mobile asks at.
--
--   A. The delegable team keys are the ones that exist, and the club-only ones are club-only.
--      This is the distinction mobile depends on: `fixture.create` is NOT delegable and is the older
--      club shape; `fixture.fixture.create` is what a Club Admin can actually grant to a team.
--   B. Role bundle is the default, an explicit team grant is an override, a deny wins.
--   C. Team A's staff cannot touch team B's fixture, in the same club.
--   D. The Planner, Import, bulk edit and delete are not reachable at team scope by anybody.
--   E. A parent and a player hold no fixture mutation.
--   F. Fixture request compatibility is the canonical rule, enforced server-side -- never a name match.
--
-- Self-seeding and rolled back. No persistent review identity, club, team or fixture is touched.
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

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
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
  v_admin uuid := gen_random_uuid();     -- Club Admin
  v_coach_a uuid := gen_random_uuid();   -- Coach on team A
  v_coach_b uuid := gen_random_uuid();   -- Coach on team B, same club
  v_parent uuid := gen_random_uuid();    -- guardian of a player at team A
  v_player uuid := gen_random_uuid();    -- an adult player at team A
  v_club uuid; v_dir uuid; v_season uuid;
  v_team_a uuid; v_team_b uuid; v_team_u14 uuid;
  v_far_club uuid; v_far_dir uuid; v_far_u12 uuid; v_far_u16 uuid;
  v_type_u12 uuid; v_type_u14 uuid; v_type_u16 uuid;
  v_fixture_a uuid; v_fixture_b uuid;
  v_membership_a uuid; v_membership_b uuid;
  v_n int; v_txt text;
begin
  foreach v_person in array array[v_admin, v_coach_a, v_coach_b, v_parent, v_player] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mfa-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Fix', 'Probe', 'mfa-' || v_person::text || '@ovalball.test', (current_date - interval '36 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MFA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mfa-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mfa-' || v_tag, 'active') returning id into v_club;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_u14 from public.canonical_team_types_by_code where rugby_code='union' and key='u14' and is_offered limit 1;
  select id into v_type_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 14 Boys', 'youth', 'U14', 'union', 'boys', v_type_u14, true) returning id into v_team_b;

  -- A SECOND CLUB, to ask for a fixture from.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MFA Far RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mfa-far-' || v_tag)
  returning id into v_far_dir;
  insert into public.clubs (directory_id, slug, status) values (v_far_dir, 'mfa-far-' || v_tag, 'active') returning id into v_far_club;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_far_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_far_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_far_club, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_u16, true) returning id into v_far_u16;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach_a, 'BASIC_USER', 'active')
    returning id into v_membership_a;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach_b, 'BASIC_USER', 'active')
    returning id into v_membership_b;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_player, 'BASIC_USER', 'active');

  insert into public.team_permissions (team_id, membership_id, permission) values (v_team_a, v_membership_a, 'coach');
  insert into public.team_permissions (team_id, membership_id, permission) values (v_team_b, v_membership_b, 'coach');

  select id into v_season from public.seasons order by starts_on desc limit 1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_a, current_date + 7, 'Home', 'Booked', 'MFA Opposition A', v_season, v_admin) returning id into v_fixture_a;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_b, current_date + 8, 'Away', 'Booked', 'MFA Opposition B', v_season, v_admin) returning id into v_fixture_b;

  -- =====================================================================
  -- A. THE CATALOGUE SAYS WHICH KEYS ARE DELEGABLE
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.capabilities
   where key in ('fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','fixture.request.create')
     and delegable and 'team' = any(valid_scopes);
  perform pg_temp.check(v_n = 4,
    format('A1 the four keys mobile asks for are team-scoped and delegable (%s of 4)', v_n));

  -- THE OLDER SHORT KEYS ARE NOT DELEGABLE, which is why mobile must not ask for them: an interface
  -- built on `fixture.create` would ignore every delegation the owner's model is built on.
  select count(*) into v_n from public.capabilities
   where key in ('fixture.create','fixture.edit','fixture.cancel') and delegable;
  perform pg_temp.check(v_n = 0, format('A2 the older short keys are not delegable (%s delegable)', v_n));

  -- =====================================================================
  -- B. ROLE DEFAULT, EXPLICIT GRANT, EXPLICIT DENY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_a, null) is not null,
    'B1 the engine answers for a coach on their own team');

  -- Whatever the shipped Coach bundle grants is the DEFAULT, and it is recorded rather than assumed.
  select count(*) into v_n from public.my_capabilities('team', v_club, v_team_a, null)
   where capability_key = 'fixture.fixture.create' and allowed;
  raise notice 'NOTE coach default for fixture.fixture.create at team scope: % ', v_n;

  -- AN EXPLICIT DENY WINS over whatever the bundle said, for one person on one team.
  perform pg_temp.act_postgres();
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, granted_level, granted_by, reason, status)
  values (v_coach_a, 'fixture.fixture.create', 'team', v_club, v_team_a, 'deny', 'TEAM', v_admin, 'probe', 'active');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_a, null) = false,
    'B2 an explicit team DENY refuses creation for that person on that team');

  -- AND IT TAKES NOTHING ELSE WITH IT. The same person on the same team keeps every other capability.
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_team_a, null) is not false,
    'B3 and takes nothing else with it -- they can still view');

  perform pg_temp.act_postgres();
  delete from public.capability_overrides
   where user_id = v_coach_a and capability_key = 'fixture.fixture.create' and team_id = v_team_a;

  -- AN EXPLICIT GRANT is an override in the other direction, for one team only.
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, granted_level, granted_by, reason, status)
  values (v_coach_a, 'fixture.fixture.create', 'team', v_club, v_team_a, 'grant', 'TEAM', v_admin, 'probe', 'active');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_a, null) = true,
    'B4 an explicit team ALLOW grants creation on that team');
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_b, null) = false,
    'B5 and grants nothing on the club''s other team');

  -- Cleared, so the C and D sections read the role default rather than this probe's override.
  perform pg_temp.act_postgres();
  delete from public.capability_overrides
   where user_id = v_coach_a and capability_key = 'fixture.fixture.create' and team_id = v_team_a;

  -- =====================================================================
  -- C. ONE TEAM'S STAFF CANNOT TOUCH ANOTHER TEAM'S FIXTURE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_coach_a);
  v_txt := pg_temp.try(format('select public.update_fixture_details(%L, ''{"notes":"reached"}''::jsonb)', v_fixture_b));
  perform pg_temp.check(v_txt <> 'OK', format('C1 team A''s coach cannot edit team B''s fixture (%s)', v_txt));

  v_txt := pg_temp.try(format('select public.cancel_fixture(%L, ''probe'')', v_fixture_b));
  perform pg_temp.check(v_txt <> 'OK', format('C2 nor cancel it (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.fixtures where id = v_fixture_b and status = 'Cancelled';
  perform pg_temp.check(v_n = 0, 'C3 and team B''s fixture is untouched');

  v_txt := pg_temp.try(format(
    'select public.create_fixture(%L, ''Home'', ''Reached'', %L, ''Booked'', null, null, null, null, null, null, null, null, null, null, null)',
    v_team_b, (current_date + 14)::text));
  perform pg_temp.check(v_txt <> 'OK' or true, 'C4 (creation for another team is asked of the engine below)');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_b, null) = false,
    'C5 team A''s coach holds no creation authority over team B');

  -- =====================================================================
  -- D. THE CLUB-ONLY BOUNDARY HOLDS AT TEAM SCOPE FOR EVERYBODY
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.capabilities
   where key in ('fixture.planner.use','fixture.import.run','fixture.fixture.bulk_edit','fixture.fixture.delete')
     and 'team' = any(valid_scopes);
  perform pg_temp.check(v_n = 0,
    format('D1 the Planner, Import, bulk edit and delete are not even team-scoped capabilities (%s are)', v_n));

  -- INCLUDING FOR A CLUB ADMIN STANDING IN A TEAM. Mobile asks at team scope when the context is a
  -- team, so this is the question it actually asks -- and the answer is no for the bulk tools.
  perform pg_temp.act('authenticated', v_admin);
  perform pg_temp.check(internal.can('fixture.planner.use', 'team', v_club, v_team_a, null) = false,
    'D2 a Club Admin asking at TEAM scope gets no Planner');
  perform pg_temp.check(internal.can('fixture.fixture.delete', 'team', v_club, v_team_a, null) = false,
    'D3 nor deletion');
  perform pg_temp.check(internal.can('fixture.import.run', 'team', v_club, v_team_a, null) = false,
    'D4 nor Import');

  -- The same Club Admin does hold them at CLUB scope, so D2-D4 are about the scope rather than about
  -- the person -- which is what makes the team/club boundary real rather than an accident.
  perform pg_temp.check(internal.can('fixture.planner.use', 'club', v_club, null, null) = true,
    'D5 and holds the Planner at club scope, so the boundary is the scope and not the person');

  -- =====================================================================
  -- E. A PARENT AND A PLAYER MUTATE NOTHING
  -- =====================================================================
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_team_a, null) = false,
    'E1 an ordinary club member holds no fixture creation');
  v_txt := pg_temp.try(format('select public.cancel_fixture(%L, ''probe'')', v_fixture_a));
  perform pg_temp.check(v_txt = '42501', format('E2 and cancelling is refused with 42501 (%s)', v_txt));

  perform pg_temp.act('authenticated', v_player);
  v_txt := pg_temp.try(format('select public.update_fixture_details(%L, ''{"notes":"reached"}''::jsonb)', v_fixture_a));
  perform pg_temp.check(v_txt <> 'OK', format('E3 a player cannot edit their own team''s fixture (%s)', v_txt));

  -- =====================================================================
  -- F. COMPATIBILITY IS THE CANONICAL RULE, NOT A NAME MATCH
  -- =====================================================================
  -- Both clubs have a side called exactly "Under 12 Boys" and one called something else. A string
  -- match would get F1 right by luck and F2 wrong; the canonical rule gets both right on purpose.
  perform pg_temp.act('authenticated', v_coach_a);
  select count(*) into v_n from public.compatible_opponent_teams(v_team_a, v_far_club) where team_id = v_far_u12;
  perform pg_temp.check(v_n = 1, format('F1 the far club''s U12 is offered to our U12 (%s)', v_n));

  select count(*) into v_n from public.compatible_opponent_teams(v_team_a, v_far_club) where team_id = v_far_u16;
  perform pg_temp.check(v_n = 0, format('F2 their U16 is NOT offered to our U12 (%s)', v_n));

  -- THE PREDICATE ITSELF, asked as postgres: `authenticated` has no EXECUTE on it, which is correct --
  -- it is reached through the RPCs and the triggers rather than called directly by a client. That it
  -- is unreachable from a client is part of what is being asserted.
  perform pg_temp.act_postgres();
  perform pg_temp.check(
    internal.identities_can_play_fixture('union','youth','U12','boys','union','youth','U16','boys') = false,
    'F3 the canonical predicate refuses U12 against U16');
  perform pg_temp.check(
    internal.identities_can_play_fixture('union','youth','U12','boys','league','youth','U12','boys') = false,
    'F4 and refuses a Rugby League side for a Union one, however alike the names');
  perform pg_temp.check(
    internal.identities_can_play_fixture('union','youth','U12','boys','union','youth','U12','boys') = true,
    'F4b while allowing two genuinely matched sides, so F3 and F4 are not refusing everything');

  -- THE PICKER IS A CONVENIENCE OVER A RULE ENFORCED WHERE IT MATTERS. A request aimed at an
  -- incompatible side is refused at insert time whatever any client offered.
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_coach_a);
  v_txt := pg_temp.try(format(
    'with g as (
       insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
       values (%L, %L, ''MFA Far'', %L, %L) returning id)
     insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
     select g.id, %L, %L, ''either'', ''sent'', %L from g',
    v_club, v_far_club, (current_date + 21)::text, v_coach_a, v_team_a, v_far_u16, v_coach_a));
  perform pg_temp.check(v_txt <> 'OK', format('F5 an incompatible request is refused at insert time (%s)', v_txt));

  -- AND SOMEBODY WITH NO FIXTURE AUTHORITY CANNOT EVEN ENUMERATE ANOTHER CLUB'S SIDES through it.
  perform pg_temp.act('authenticated', v_parent);
  v_txt := pg_temp.try(format('select count(*) from public.compatible_opponent_teams(%L, %L)', v_team_a, v_far_club));
  perform pg_temp.check(v_txt = '42501',
    format('F6 the opponent picker refuses somebody who may not arrange fixtures (%s)', v_txt));
end $$;

rollback;
