-- AVAILABILITY IS ONE PRODUCT -- THE FIXTURE HALF AND THE TRAINING HALF ANSWER ALIKE.
--
-- M6 brought Match Centre and Training Centre to the phone, and the archaeology that preceded it found
-- the FIXTURE half of availability weaker than the TRAINING half for the same person under the same
-- policy. Each of those gaps would otherwise have been worked around in React Native. This suite is the
-- permanent proof that they are fixed in the database, where both clients inherit them, and that they
-- stay fixed.
--
--   A. A cancelled FIXTURE refuses an answer, exactly as a cancelled SESSION always has. The rule used
--      to live only in the web Match Centre resolver, so any other caller could record an answer to a
--      match that is not happening.
--   B. A fixture whose orientation is TBD or Not Applicable is ANSWERABLE. The writer used to locate
--      the fixture's teams through the generated home_team_id/away_team_id columns, which are NULL for
--      both of those -- so a legitimate answer was refused with "this player is not associated with a
--      team involved in this fixture".
--   C. A Mini-Rugby SCHEDULING GROUP fixture is answerable. The writer knew nothing about groups; the
--      Match Centre page offered the control to every group member and the write refused all of them.
--   D. get_my_players_for_fixture is the fixture twin of the training reader: one call, the family's
--      own children only, the current answer, and whether an answer can actually be recorded.
--   E. The safeguarding rule is UNCHANGED and is still the database's. Guardian always; self at 18+;
--      16-17 only with recorded guardian consent; under 16 never.
--   F. Both readers carry can_respond and denial_reason, so neither client draws a control the write
--      would refuse -- and a cancelled event still SHOWS what was answered rather than hiding it.
--   G. One vocabulary of states: the three the database accepts, and nothing else.
--
-- Self-seeding and rolled back. No persistent review identity, club, team, fixture or session is
-- touched.
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

create or replace function pg_temp.msg(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return '';
exception when others then return sqlerrm; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.msg(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();      -- guardian of the U12 child AND of the 15-year-old
  v_other_guardian uuid := gen_random_uuid();-- a different family entirely
  v_consented uuid := gen_random_uuid();     -- a 17-year-old WITH recorded guardian consent
  v_teen uuid := gen_random_uuid();          -- a 16-year-old WITHOUT it
  v_club uuid; v_dir uuid; v_season uuid;
  v_team uuid; v_team_b uuid; v_team_c uuid; v_team_d uuid; v_group uuid;
  v_type_u12 uuid; v_type_u14 uuid; v_type_u16 uuid; v_type_u18 uuid;
  v_child uuid; v_teen_player uuid; v_consented_player uuid; v_other_child uuid; v_group_child uuid;
  v_fx_home uuid; v_fx_tbd uuid; v_fx_na uuid; v_fx_cancelled uuid; v_fx_group uuid; v_fx_self uuid; v_fx_teen uuid;
  v_session uuid; v_session_cancelled uuid;
  v_n int; v_txt text; v_bool boolean;
begin
  foreach v_person in array array[v_admin, v_guardian, v_other_guardian, v_consented, v_teen] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'aop-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  end loop;
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values
    (v_admin,          'Avail', 'Admin',    'aop-' || v_admin::text || '@ovalball.test',          (current_date - interval '40 years')::date),
    (v_guardian,       'Avail', 'Guardian', 'aop-' || v_guardian::text || '@ovalball.test',       (current_date - interval '40 years')::date),
    (v_other_guardian, 'Other', 'Guardian', 'aop-' || v_other_guardian::text || '@ovalball.test', (current_date - interval '40 years')::date),
    (v_consented,      'Avail', 'Consented','aop-' || v_consented::text || '@ovalball.test',      (current_date - interval '17 years')::date),
    (v_teen,           'Avail', 'Teen',     'aop-' || v_teen::text || '@ovalball.test',           (current_date - interval '16 years')::date)
  on conflict (id) do nothing;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AOP RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'aop-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'aop-' || v_tag, 'active') returning id into v_club;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_u14 from public.canonical_team_types_by_code where rugby_code='union' and key='u14' and is_offered limit 1;
  select id into v_type_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;
  select id into v_type_u18 from public.canonical_team_types_by_code where rugby_code='union' and key='u18' and is_offered limit 1;

  -- FOUR TEAMS, because the age-grade and playing-pathway rules are real and this suite does not get
  -- to put an eleven-year-old and a seventeen-year-old on the same side to keep its own setup short.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_u16, true) returning id into v_team_b;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 14 Boys', 'youth', 'U14', 'union', 'boys', v_type_u14, true) returning id into v_team_c;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 18 Boys', 'youth', 'U18', 'union', 'boys', v_type_u18, true) returning id into v_team_d;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN', 'active'),
    (v_club, v_guardian, 'BASIC_USER', 'active'),
    (v_club, v_other_guardian, 'BASIC_USER', 'active'),
    (v_club, v_consented, 'BASIC_USER', 'active'),
    (v_club, v_teen, 'BASIC_USER', 'active');

  -- THE PEOPLE. One child of 11, one teenager of 16 with their own login, one adult player, and one
  -- child belonging to a DIFFERENT family, so a reader that leaked across families would be caught.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Harry', 'Availability', (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Theo', 'Availability', (current_date - interval '16 years')::date, 'MALE', v_teen) returning id into v_teen_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Owen', 'Availability', (current_date - interval '17 years')::date, 'MALE', v_consented) returning id into v_consented_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Nate', 'Elsewhere', (current_date - interval '11 years')::date, 'MALE') returning id into v_other_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Group', 'Member', (current_date - interval '13 years')::date, 'MALE') returning id into v_group_child;

  insert into public.guardians (player_id, guardian_user_id, status, relationship_type) values
    (v_child, v_guardian, 'active', 'parent'),
    (v_teen_player, v_guardian, 'active', 'parent'),
    (v_group_child, v_guardian, 'active', 'parent'),
    (v_consented_player, v_guardian, 'active', 'parent'),
    (v_other_child, v_other_guardian, 'active', 'parent');

  -- THE CONSENT THAT MAKES SELF-SERVICE LEGITIMATE AT 16-17. Recorded as the canonical
  -- guardian_player_permissions decision, never as a role or a flag on the player.
  insert into public.guardian_player_permissions (player_id, guardian_user_id, permission_key, granted, actor)
  values (v_consented_player, v_guardian, 'approve_own_attendance', true, v_guardian);

  insert into public.player_team_memberships (player_id, team_id, status, state, source, joined_at) values
    (v_child, v_team, 'active', 'ACTIVE', 'CLUB_CREATED', now()),
    (v_teen_player, v_team_b, 'active', 'ACTIVE', 'CLUB_CREATED', now()),
    (v_consented_player, v_team_d, 'active', 'ACTIVE', 'CLUB_CREATED', now()),
    (v_other_child, v_team, 'active', 'ACTIVE', 'CLUB_CREATED', now());

  select id into v_season
    from public.seasons
   where not is_regression_fixture and (current_date + 7) between starts_on and ends_on
   order by starts_on desc
   limit 1;

  -- FIVE FIXTURES, differing only in the thing being proved.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 7, 'Home', 'Booked', 'AOP Home', v_season, v_admin) returning id into v_fx_home;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 8, 'TBD', 'To Be Determined', 'AOP TBD', v_season, v_admin) returning id into v_fx_tbd;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 9, 'Not Applicable', 'Festival', 'AOP Festival', v_season, v_admin) returning id into v_fx_na;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 10, 'Home', 'Booked', 'AOP Doomed', v_season, v_admin) returning id into v_fx_cancelled;

  -- =====================================================================
  -- A. A CANCELLED FIXTURE REFUSES AN ANSWER
  -- =====================================================================
  perform pg_temp.act_postgres();
  update public.fixtures set status = 'Cancelled', cancelled_at = now(), cancellation_reason = 'AOP probe'
   where id = v_fx_cancelled;

  perform pg_temp.check(internal.fixture_accepts_attendance(v_fx_cancelled) is not null,
    'A1 the shared fixture rule refuses a cancelled fixture');
  perform pg_temp.check(internal.fixture_accepts_attendance(v_fx_home) is null,
    'A2 and admits a live one');
  perform pg_temp.check(internal.fixture_accepts_attendance(gen_random_uuid()) is not null,
    'A3 and refuses a fixture that does not exist rather than returning null');

  perform pg_temp.act('authenticated', v_guardian);
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_cancelled, v_child));
  perform pg_temp.check(v_txt = '42501',
    format('A4 the WRITER refuses an answer to a cancelled fixture (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_fx_cancelled;
  perform pg_temp.check(v_n = 0, 'A5 and nothing was recorded against it');

  -- The training half has always done this, and still does -- so the two now agree.
  -- =====================================================================
  -- B. ORIENTATION-FREE FIXTURES ARE ANSWERABLE
  -- =====================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check((select home_team_id is null and away_team_id is null from public.fixtures where id = v_fx_tbd),
    'B1 a TBD fixture genuinely has no generated home or away team -- which is what used to break it');

  perform pg_temp.act('authenticated', v_guardian);
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_tbd, v_child));
  perform pg_temp.check(v_txt = 'OK', format('B2 a guardian CAN answer a TBD fixture (%s)', v_txt));

  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''CANNOT_ATTEND'')', v_fx_na, v_child));
  perform pg_temp.check(v_txt = 'OK', format('B3 and a Not Applicable one (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_fixture_attendance
   where player_id = v_child and fixture_id in (v_fx_tbd, v_fx_na);
  perform pg_temp.check(v_n = 2, format('B4 both answers are recorded (%s of 2)', v_n));

  -- AND THE TEAM CHECK STILL BITES. A child on no participating team is still refused, so the fix
  -- widened the resolution of "which teams" without widening who may answer.
  perform pg_temp.act('authenticated', v_guardian);
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_tbd, v_teen_player));
  perform pg_temp.check(v_txt = '42501',
    format('B5 a child on a DIFFERENT team is still refused on this fixture (%s)', v_txt));

  -- =====================================================================
  -- C. A MINI-RUGBY SCHEDULING GROUP FIXTURE IS ANSWERABLE
  -- =====================================================================
  perform pg_temp.act_postgres();
  insert into public.scheduling_groups (club_id, display_tag, active, season_id, created_by)
  values (v_club, 'AOP Minis ' || v_tag, true, v_season, v_admin) returning id into v_group;
  -- TWO teams in the group, and the child is on the one that does NOT own the fixture. That is the
  -- whole point: the old writer resolved the fixture's teams from home_team_id/away_team_id, which
  -- name the owning and opponent TEAMS and know nothing about a group -- so a Mini-Rugby player on a
  -- partner team inside the same group was told they are not associated with the fixture.
  insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_team_c), (v_group, v_team);
  insert into public.player_team_memberships (player_id, team_id, status, state, source, joined_at)
  values (v_group_child, v_team_c, 'active', 'ACTIVE', 'CLUB_CREATED', now());

  insert into public.fixtures (owning_team_id, owning_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_c, v_group, current_date + 11, 'Home', 'Booked', 'AOP Group', v_season, v_admin) returning id into v_fx_group;

  perform pg_temp.check((select count(*) from internal.fixture_participant_team_ids(v_fx_group)) >= 1,
    'C1 the canonical participant resolver answers for a group fixture');

  perform pg_temp.act('authenticated', v_guardian);
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''UNSURE'')', v_fx_group, v_group_child));
  perform pg_temp.check(v_txt = 'OK', format('C2 a group member''s guardian can answer (%s)', v_txt));

  -- A child on the group's OTHER team -- not the owning team -- is reachable only through the group.
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_group, v_child));
  perform pg_temp.check(v_txt = 'OK',
    format('C3 and so can a child on the group''s other team, which is not the owning side (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from internal.fixture_participant_team_ids(v_fx_group);
  perform pg_temp.check(v_n >= 2, format('C4 the resolver names every team in the group, not just the owner (%s)', v_n));

  -- =====================================================================
  -- D. ONE READER, THE FAMILY'S OWN CHILDREN ONLY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);
  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_home) where player_id = v_child;
  perform pg_temp.check(v_n = 1, 'D1 the reader returns this guardian''s own child on this fixture');

  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_home) where player_id = v_other_child;
  perform pg_temp.check(v_n = 0, 'D2 and never another family''s child on the same team');

  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_home) where player_id = v_teen_player;
  perform pg_temp.check(v_n = 0, 'D3 nor their own child who is not in this fixture');

  -- "SELF" COMES FROM players.user_id, resolved by the RPC -- never inferred from a name or a role.
  perform pg_temp.act_postgres();
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_d, current_date + 13, 'Home', 'Booked', 'AOP Self', v_season, v_admin) returning id into v_fx_self;

  perform pg_temp.act('authenticated', v_consented);
  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_self)
   where player_id = v_consented_player and relationship = 'self';
  perform pg_temp.check(v_n = 1, 'D4 a player with their own login is returned as "self", not as a guardian');

  select can_respond into v_bool from public.get_my_players_for_fixture(v_fx_self) where player_id = v_consented_player;
  perform pg_temp.check(v_bool,
    'D5 and a 17-year-old WITH recorded guardian consent may answer for themselves');
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_self, v_consented_player));
  perform pg_temp.check(v_txt = 'OK', format('D6 and the write accepts it (%s)', v_txt));

  -- =====================================================================
  -- E. THE SAFEGUARDING RULE IS UNCHANGED AND IS STILL THE DATABASE'S
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);
  select can_respond into v_bool from public.get_my_players_for_fixture(v_fx_home) where player_id = v_child;
  perform pg_temp.check(v_bool, 'E1 a guardian may answer for their own child');

  -- A 16-YEAR-OLD ANSWERING FOR THEMSELVES needs recorded guardian consent, and does not have it yet.
  perform pg_temp.act_postgres();
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_b, current_date + 12, 'Home', 'Booked', 'AOP Teen', v_season, v_admin) returning id into v_fx_teen;

  perform pg_temp.act('authenticated', v_teen);
  select can_respond, denial_reason into v_bool, v_txt
    from public.get_my_players_for_fixture(v_fx_teen) where player_id = v_teen_player;
  perform pg_temp.check(v_bool is not true,
    format('E2 a 16-year-old without recorded consent may NOT answer for themselves (%s)', coalesce(v_txt, 'no reason')));
  perform pg_temp.check(v_txt is not null, 'E3 and the reader states the reason rather than leaving it blank');

  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fx_teen, v_teen_player));
  perform pg_temp.check(v_txt = '42501', format('E4 and the WRITE is refused too, not only the control (%s)', v_txt));

  -- The under-16 rule, asked directly of the canonical resolver rather than of a surface.
  perform pg_temp.act('authenticated', v_guardian);
  select can_respond into v_bool from public.get_my_attendance_authority(v_other_child);
  perform pg_temp.check(v_bool is not true,
    'E5 a guardian of one child holds no authority over another family''s child');

  -- =====================================================================
  -- F. THE READERS AND THE WRITER AGREE, INCLUDING ON A CANCELLED EVENT
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);
  select can_respond, denial_reason into v_bool, v_txt
    from public.get_my_players_for_fixture(v_fx_cancelled) where player_id = v_child;
  perform pg_temp.check(v_bool is not true, 'F1 a cancelled fixture reports can_respond false');
  perform pg_temp.check(v_txt is not null and v_txt ilike '%cancel%',
    format('F2 and says why, in the words the writer uses (%s)', coalesce(v_txt, 'null')));
  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_cancelled) where player_id = v_child;
  perform pg_temp.check(v_n = 1,
    'F3 and the child is STILL LISTED -- a parent can see what was answered before it was called off');

  -- TRAINING, the same shape.
  perform pg_temp.act_postgres();
  insert into public.training_sessions (club_id, team_id, session_date, start_time, duration_minutes, status, source, created_by)
  values (v_club, v_team, current_date + 7, '18:00', 60, 'PLANNED', 'MANUAL', v_admin) returning id into v_session;
  insert into public.training_sessions (club_id, team_id, session_date, start_time, duration_minutes, status, source, created_by)
  values (v_club, v_team, current_date + 14, '18:00', 60, 'CANCELLED', 'MANUAL', v_admin) returning id into v_session_cancelled;

  perform pg_temp.act('authenticated', v_guardian);
  select can_respond into v_bool from public.get_my_players_for_training_session(v_session) where player_id = v_child;
  perform pg_temp.check(v_bool, 'F4 the training reader now carries can_respond, as the fixture one does');

  select can_respond, denial_reason into v_bool, v_txt
    from public.get_my_players_for_training_session(v_session_cancelled) where player_id = v_child;
  perform pg_temp.check(v_bool is not true, 'F5 a cancelled session reports can_respond false');
  perform pg_temp.check(v_txt is not null and v_txt ilike '%cancel%',
    format('F6 and says why, in the words respond_to_training_attendance raises (%s)', coalesce(v_txt, 'null')));

  v_txt := pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, ''ATTENDING'')', v_session_cancelled, v_child));
  perform pg_temp.check(v_txt = '42501', format('F7 and the training write refuses it (%s)', v_txt));

  v_txt := pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, ''ATTENDING'')', v_session, v_child));
  perform pg_temp.check(v_txt = 'OK', format('F8 while a live session accepts the same answer (%s)', v_txt));

  -- ONE RECORD FOR BOTH. Fixture and training answers are rows of the same table, which is why there
  -- is one response model rather than two -- proved rather than asserted.
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_fixture_attendance
   where player_id = v_child and training_session_id = v_session;
  perform pg_temp.check(v_n = 1, 'F9 a training answer is a player_fixture_attendance row, like a fixture answer');

  -- =====================================================================
  -- G. ONE VOCABULARY OF STATES
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''MAYBE'')', v_fx_tbd, v_child));
  perform pg_temp.check(v_txt <> 'OK', format('G1 "MAYBE" is not one of the three states (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''AWAITING'')', v_fx_tbd, v_child));
  perform pg_temp.check(v_txt <> 'OK', format('G2 nor is "AWAITING" -- it is the ABSENCE of a row (%s)', v_txt));

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_fixture_attendance
   where status not in ('ATTENDING','CANNOT_ATTEND','UNSURE');
  perform pg_temp.check(v_n = 0, format('G3 no stored answer is outside the three canonical states (%s strays)', v_n));

  -- BOTH READERS HAVE THE SAME SHAPE, so a client cannot need two projections of one idea.
  perform pg_temp.check(
    (select array_agg(a.attname::text order by a.attnum) from pg_proc p
       join unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, attmode, attnum) on a.attmode = 't'
      where p.oid = 'public.get_my_players_for_fixture(uuid)'::regprocedure)
    =
    (select array_agg(a.attname::text order by a.attnum) from pg_proc p
       join unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, attmode, attnum) on a.attmode = 't'
      where p.oid = 'public.get_my_players_for_training_session(uuid)'::regprocedure),
    'G4 the fixture reader and the training reader return the identical column set');
end $$;

rollback;
