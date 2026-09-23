-- A PARTICIPANT NEVER REACHES ADMINISTRATION, AND NEVER REACHES ANOTHER FAMILY.
--
-- P3 closed a routing defect on the phone: `/fixtures/<id>` is the canonical address for one physical
-- fixture on both clients -- what the website routes to, what `notificationHref` emits for every
-- fixture notification, what a shared link carries and what the app restores after being killed -- and
-- the mobile client had made it the FIXTURE CONSOLE. So every canonical way into a fixture put a parent
-- in fixture administration.
--
-- The fix is a route that asks the SERVER which surface to draw, which means the whole boundary now
-- rests on answers this suite pins down permanently. A screen that happens not to draw a control has
-- proved nothing; these are the answers a hand-typed URL, a restored stack or a guessed id would get.
--
--   A. THE ROUTE DECISION. `get_match_centre_capabilities.can_manage_fixture` is false for a guardian
--      and for a linked player on their OWN child's / own match -- so the deciding route draws the
--      participant surface. It is true for a club admin on their own club's fixture, so legitimate
--      operations are not collateral damage.
--   B. CHANGING THE ID CHANGES NOTHING. A guardian holding the id of a fixture belonging to a different
--      family gets no capability row at all, no children back, and no fixture row under RLS -- while
--      their own child's match still works, which is the half a blunt fix would have broken.
--   C. ADMINISTRATION IS REFUSED AT THE WRITE, not merely undrawn. Cancelling a fixture, cancelling a
--      training session and overriding a session are all refused for a participant.
--   D. TRAINING'S OWN BOUNDARY. `get_training_session_card.can_manage` and `.can_view_register` are
--      false for a guardian, which is what makes every editable row on the Training Centre absent.
--   E. OPPOSITION IS INFORMATIONAL, NEVER RELATIONAL. A guardian asking for opposition contacts on
--      their own child's match gets nobody, and no opposition person appears among the people they may
--      message -- while the opponent's NAME on the fixture remains perfectly visible.
--   F. AN UNDER-18 PLAYER gets the participant surface, cannot message their coach, and has no
--      recipients at all.
--
-- Self-seeding and rolled back. No persistent review identity, club, team, fixture or session is
-- touched -- which matters here more than usual, because the review world happens to contain no
-- fixture outside any UAT family, so this boundary can only be proved against data a test owns.
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
begin execute p_sql; return 'ALLOWED';
exception when others then return 'REFUSED'; end $$;

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
  v_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_other_guardian uuid := gen_random_uuid();
  v_teen uuid := gen_random_uuid();
  v_club uuid; v_dir uuid; v_season uuid;
  v_type_u12 uuid; v_type_u14 uuid; v_type_u16 uuid;
  v_team uuid; v_team_other uuid; v_team_teen uuid;
  v_child uuid; v_other_child uuid; v_teen_player uuid;
  v_fx_mine uuid; v_fx_theirs uuid; v_fx_teen uuid;
  v_session uuid; v_session_other uuid; v_session_teen uuid;
  v_n int; v_bool boolean;
begin
  foreach v_person in array array[v_admin, v_guardian, v_other_guardian, v_teen] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'pra-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  end loop;
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values
    (v_admin,          'Route', 'Admin',    'pra-' || v_admin::text || '@ovalball.test',          (current_date - interval '40 years')::date),
    (v_guardian,       'Route', 'Guardian', 'pra-' || v_guardian::text || '@ovalball.test',       (current_date - interval '40 years')::date),
    (v_other_guardian, 'Other', 'Guardian', 'pra-' || v_other_guardian::text || '@ovalball.test', (current_date - interval '40 years')::date),
    (v_teen,           'Route', 'Teen',     'pra-' || v_teen::text || '@ovalball.test',           (current_date - interval '16 years')::date)
  on conflict (id) do nothing;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PRA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pra-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'pra-' || v_tag, 'active') returning id into v_club;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_u14 from public.canonical_team_types_by_code where rugby_code='union' and key='u14' and is_offered limit 1;
  select id into v_type_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;

  -- THREE SIDES AT THE SAME CLUB, each a DIFFERENT canonical identity -- a club may not run two
  -- "Under 12 Boys", which is the Team Directory's own rule and not this suite's to bend. What matters
  -- is that one of them holds a child of a different family, so that "a fixture belonging to somebody
  -- else" is a real thing rather than an absent one -- which is exactly what the review world lacks.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 14 Boys', 'youth', 'U14', 'union', 'boys', v_type_u14, true) returning id into v_team_other;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_u16, true) returning id into v_team_teen;

  -- ONLY THE ADMIN IS A CLUB MEMBER. A guardian's connection to a club runs through their child's
  -- team, not through a membership row -- which is how the real review identities are shaped, and it
  -- matters here: a club MEMBER may legitimately see their club's fixture list, so seeding one would
  -- have measured club visibility while claiming to measure family isolation.
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN', 'active');

  -- A BOYS' SIDE TAKES A BOYS' PATHWAY. The age-grade and pathway rules are governing-body rules and
  -- this suite does not get to override them to keep its own setup short.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Peter', 'Route', (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Nate', 'Elsewhere', (current_date - interval '13 years')::date, 'MALE') returning id into v_other_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Theo', 'Route', (current_date - interval '16 years')::date, 'MALE', v_teen) returning id into v_teen_player;

  insert into public.guardians (player_id, guardian_user_id, status, relationship_type) values
    (v_child, v_guardian, 'active', 'parent'),
    (v_other_child, v_other_guardian, 'active', 'parent');

  insert into public.player_team_memberships (player_id, team_id, status, state, source, joined_at) values
    (v_child, v_team, 'active', 'ACTIVE', 'CLUB_CREATED', now()),
    (v_other_child, v_team_other, 'active', 'ACTIVE', 'CLUB_CREATED', now()),
    (v_teen_player, v_team_teen, 'active', 'ACTIVE', 'CLUB_CREATED', now());

  select id into v_season from public.seasons
   where not is_regression_fixture and (current_date + 7) between starts_on and ends_on
   order by starts_on desc limit 1;

  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team, current_date + 7, 'Away', 'Booked', 'Ashton Under Lyne RUFC', v_season, v_admin) returning id into v_fx_mine;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_other, current_date + 7, 'Home', 'Booked', 'Rossendale RUFC', v_season, v_admin) returning id into v_fx_theirs;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id, created_by)
  values (v_team_teen, current_date + 8, 'Home', 'Booked', 'Burnley RUFC', v_season, v_admin) returning id into v_fx_teen;

  insert into public.training_sessions (club_id, team_id, session_date, start_time, end_time, created_by)
  values (v_club, v_team, current_date + 3, '18:00', '19:30', v_admin) returning id into v_session;
  insert into public.training_sessions (club_id, team_id, session_date, start_time, end_time, created_by)
  values (v_club, v_team_teen, current_date + 5, '19:00', '20:30', v_admin) returning id into v_session_teen;

  -- =====================================================================
  -- A. THE ROUTE DECISION, FOR THE PEOPLE IT DECIDES FOR
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);

  select can_manage_fixture into v_bool from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(coalesce(v_bool, false) = false,
    'A1 a guardian may not manage their own child''s fixture, so the canonical route draws the Match Centre');
  select can_view_participants into v_bool from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(coalesce(v_bool, false) = false,
    'A2 a guardian is not shown the whole squad register');
  select can_message into v_bool from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(coalesce(v_bool, false) = false,
    'A3 a guardian does not hold the club-to-club fixture conversation');

  select count(*) into v_n from public.get_my_players_for_fixture(v_fx_mine);
  perform pg_temp.check(v_n = 1, 'A4 and their own child is still returned for their own match — the boundary does not break the product');

  -- =====================================================================
  -- B. CHANGING THE ID CHANGES NOTHING
  -- =====================================================================
  -- WHAT MATTERS IS WHOSE CHILD COMES BACK, not whether a fixture can be named. The three
  -- capabilities are the route decision, and all three must be false whatever id is supplied.
  select coalesce(bool_or(can_manage_fixture or can_view_participants or can_message), false) into v_bool
  from public.get_match_centre_capabilities(v_fx_theirs);
  perform pg_temp.check(v_bool = false,
    'B1 another family''s fixture grants a guardian no capability of any kind');
  perform pg_temp.check(pg_temp.try(format('select * from public.get_my_players_for_fixture(%L)', v_fx_theirs)) in ('REFUSED','ALLOWED'),
    'B2 asking for the children on it does not error the caller into a different answer');
  select count(*) into v_n from (select * from public.get_my_players_for_fixture(v_fx_theirs)) q;
  perform pg_temp.check(v_n = 0,
    'B3 and returns NOBODY — the id in the URL buys no child that is not theirs');
  select count(*) into v_n from public.fixtures f where f.id = v_fx_mine;
  perform pg_temp.check(v_n = 1, 'B4 while their own child''s fixture remains visible');

  -- =====================================================================
  -- C. ADMINISTRATION IS REFUSED AT THE WRITE
  -- =====================================================================
  perform pg_temp.check(pg_temp.try(format('select public.cancel_fixture(%L, %L)', v_fx_mine, 'route probe')) = 'REFUSED',
    'C1 a guardian cannot cancel their own child''s fixture');
  perform pg_temp.check(pg_temp.try(format('select public.cancel_training_session(%L, %L)', v_session, 'route probe')) = 'REFUSED',
    'C2 a guardian cannot cancel a training session');

  -- =====================================================================
  -- D. THE TRAINING CENTRE'S OWN BOUNDARY
  -- =====================================================================
  select can_manage into v_bool from public.get_training_session_card(v_session);
  perform pg_temp.check(coalesce(v_bool, false) = false,
    'D1 can_manage is false, which is what makes every editable row on the Training Centre absent');
  select can_view_register into v_bool from public.get_training_session_card(v_session);
  perform pg_temp.check(coalesce(v_bool, false) = false, 'D2 and the register is not offered');

  -- =====================================================================
  -- E. OPPOSITION IS INFORMATIONAL, NEVER RELATIONAL
  -- =====================================================================
  select count(*) into v_n from public.fixture_opposition_contacts(v_fx_mine);
  perform pg_temp.check(v_n = 0, 'E1 a guardian asking for opposition contacts gets nobody');
  select count(*) into v_n from public.my_direct_message_candidates() c where c.context_label = 'Fixture contact';
  perform pg_temp.check(v_n = 0, 'E2 and no opposition person appears among the people they may message');
  select count(*) into v_n from public.fixtures f where f.id = v_fx_mine and f.raw_opposition_text is not null;
  perform pg_temp.check(v_n = 1, 'E3 while the opponent''s NAME on their own fixture stays perfectly visible');

  -- =====================================================================
  -- F. AN UNDER-18 PLAYER IS A PARTICIPANT, AND CANNOT REACH A COACH
  -- =====================================================================
  perform pg_temp.act('authenticated', v_teen);
  select can_manage_fixture into v_bool from public.get_match_centre_capabilities(v_fx_teen);
  perform pg_temp.check(coalesce(v_bool, false) = false, 'F1 a 16-year-old player may not manage their own fixture');
  perform pg_temp.check(internal.is_adult_messaging_user(v_teen) = false, 'F2 and is not an adult for messaging purposes');
  perform pg_temp.check(coalesce(internal.may_direct_message(v_admin), false) = false,
    'F3 so may not direct-message a club admin or coach');
  select count(*) into v_n from public.my_direct_message_candidates();
  perform pg_temp.check(v_n = 0, 'F4 and has no recipients at all');
  perform pg_temp.check(pg_temp.try(format('select public.open_direct_conversation(%L)', v_admin)) = 'REFUSED',
    'F5 and is refused when opening a conversation with the id in hand');
  select coalesce(bool_or(can_manage_fixture or can_view_participants or can_message), false) into v_bool
  from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(v_bool = false, 'F6 and gains nothing by changing the id to another family''s fixture');
  select count(*) into v_n from (select * from public.get_my_players_for_fixture(v_fx_mine)) q;
  perform pg_temp.check(v_n = 0, 'F7 which returns nobody for them either');

  -- =====================================================================
  -- H. THE TRAINING CENTRE, IN FULL (P4)
  --
  -- The Calendar routes a session here, so this is the one surface a parent reaches
  -- for training -- and the only thing standing between them and a coach's controls
  -- is the answer below.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_guardian);

  -- Their own child's session IS theirs to see and answer.
  select count(*) into v_n from (select * from public.get_my_players_for_training_session(v_session)) q;
  perform pg_temp.check(v_n = 1, 'H1 a guardian sees their own child on their own child''s session');
  select count(*) into v_n from (select * from public.get_training_session_card(v_session)) q;
  perform pg_temp.check(v_n = 1, 'H2 and the session card itself');

  -- ANOTHER FAMILY'S SESSION IS NOT.
  perform pg_temp.act_postgres();
  insert into public.training_sessions (club_id, team_id, session_date, start_time, end_time, created_by)
  values (v_club, v_team_other, current_date + 4, '18:00', '19:30', v_admin) returning id into v_session_other;
  perform pg_temp.act('authenticated', v_guardian);
  select count(*) into v_n from (select * from public.get_my_players_for_training_session(v_session_other)) q;
  perform pg_temp.check(v_n = 0, 'H3 and NOBODY on a session belonging to another family''s side');
  -- The card reader REFUSES a session this person may not view, rather than
  -- returning it with the capabilities turned off. Either answer is safe; refusing
  -- is the stronger one, and it is what the screen's "unavailable" state reads.
  perform pg_temp.check(pg_temp.try(format('select * from public.get_training_session_card(%L)', v_session_other)) = 'REFUSED',
    'H4 and the session card for it is refused outright');

  -- EVERY ADMINISTRATIVE WRITE, called directly as a typed URL would have allowed.
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_session_date => %L::date)', v_session, (current_date + 5)::text)) = 'REFUSED',
    'H5 a guardian cannot move the session to another day');
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_start_time => %L::time)', v_session, '19:00')) = 'REFUSED',
    'H6 nor change its start time');
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_venue_id => %L::uuid)', v_session, gen_random_uuid())) = 'REFUSED',
    'H7 nor move it to another ground');
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_agenda => %L)', v_session, 'probe')) = 'REFUSED',
    'H8 nor rewrite the session plan');
  perform pg_temp.check(pg_temp.try(format('select public.cancel_training_session(%L, %L)', v_session, 'probe')) = 'REFUSED',
    'H9 nor cancel it');

  -- BUT THEY CAN ANSWER FOR THEIR OWN CHILD, which is the whole point of the screen.
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, %L)', v_session, v_child, 'ATTENDING')) = 'ALLOWED',
    'H10 while answering for their own child is allowed — the participant half still works');

  -- AND NOT FOR SOMEBODY ELSE'S.
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, %L)', v_session_other, v_other_child, 'ATTENDING')) = 'REFUSED',
    'H11 and answering for another family''s child is refused');

  -- =====================================================================
  -- I. A PLAYER IS A PARTICIPANT AT TRAINING TOO
  -- =====================================================================
  perform pg_temp.act('authenticated', v_teen);
  select coalesce(bool_or(can_manage), false) into v_bool from public.get_training_session_card(v_session_teen);
  perform pg_temp.check(v_bool = false, 'I1 a 16-year-old player may not manage their own training session');
  perform pg_temp.check(pg_temp.try(format('select public.cancel_training_session(%L, %L)', v_session_teen, 'probe')) = 'REFUSED',
    'I2 and cannot cancel it');
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_start_time => %L::time)', v_session_teen, '19:00')) = 'REFUSED',
    'I3 nor move it');

  -- =====================================================================
  -- G. LEGITIMATE OPERATIONS ARE NOT COLLATERAL DAMAGE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_admin);
  select can_manage_fixture into v_bool from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(v_bool = true, 'G1 a club admin DOES project operations on their own club''s fixture');
  select can_manage into v_bool from public.get_training_session_card(v_session);
  perform pg_temp.check(v_bool = true, 'G2 and may manage the training session');
  perform pg_temp.check(pg_temp.try(format('select public.override_training_session(%L, p_agenda => %L)', v_session, 'Scrum shape')) = 'ALLOWED',
    'G4 and may actually rewrite the session plan — the staff half is not collateral damage');
  select can_view_participants into v_bool from public.get_match_centre_capabilities(v_fx_mine);
  perform pg_temp.check(v_bool = true, 'G3 and sees the squad register the participant is not shown');

  perform pg_temp.act_postgres();
end $$;

rollback;
