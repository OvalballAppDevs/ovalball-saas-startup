-- TEAM OPERATIONS (CA-M7) -- THE TEAM WORKSPACE, PROVED WHERE IT IS ENFORCED.
--
-- A team context is a WORKSPACE, not a smaller club admin panel. Everything the phone draws for a team
-- comes from one capability read at team scope, and everything it writes is refused again by the server.
-- This suite proves the authority the workspace consumes and cannot widen:
--
--   TO-A  the team authority probe: a Team Manager's role default at team scope; a Coach's narrower one;
--         the Planner, Import, bulk edit and delete are never offered at team scope to anybody
--   TO-B  fixture mutation by a non-protected Team Manager: create, edit, cancel on THEIR team; a Club Admin
--         withholds edit -> the same role is refused mid-edit; restore -> it returns; the same for cancel
--   TO-C  cross-team and cross-club isolation: a U12 manager creates, edits and cancels nothing on U14 or
--         on another club's U12, and holds no capability at those scopes
--   TO-D  no club-wide escalation: no Planner, Import, bulk edit or delete at club scope; no club-wide
--         membership administration; no club ledger read
--   TO-E  subscriptions: the team-scoped operation answers only the holder, only for their team; the
--         underlying rows stay refused to a team holder; no provider column exists in the result;
--         a withhold refuses, a restore returns
--   TO-F  people: the roster reader refuses the wrong team and the wrong club; a Coach reads but does not
--         decide; a Team Manager decides; the reader carries no contact column
--   TO-G  fixture requests: a request from another club is seen by the target team, answered only by a
--         holder of fixture.request.respond, and a Coach's crafted acceptance is refused
--   TO-H  messaging: a parent and a player cannot message the opposition; a minor cannot message the
--         coach and the coach cannot message the minor; the fixture route exists for staff only
--   TO-I  availability: no staff override -- a Team Manager cannot answer for a player; the summary is
--         absent for a team the viewer has no attendance authority on
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.count_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return v;
exception when others then return -1; end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'to-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'To', p_label, 'to-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'to-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'to-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.player(p_label text, p_years int, p_team uuid, p_user uuid default null, p_state text default 'ACTIVE') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('P', p_label, (current_date - (p_years || ' years')::interval)::date, 'MALE', p_user) returning id into v;
  insert into public.player_team_memberships (player_id, team_id, state) values (v, p_team, p_state);
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.count_of(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

-- =====================================================================================================
-- CA-M8 -- NOTIFICATIONS, INBOX & ACTION CENTRE: the canonical attention system, proven at the boundary.
--
--   AC   the availability response reaches the side's staff -- by the capability decision, never a role
--        list; not the guardian, not the other team, not a withheld holder, not the responder; once per
--        change and never stacking while unread
--   RR   READ IS NOT RESOLVED: marking read leaves the answer alone; answering leaves read_at alone
--   RM   the read mutation is self-only and touches read_at alone; there is no delete and no dismiss
--   FD   the feed is the bell's own membership rule, keyset-paged, unread-filterable, and agrees with
--        my_unread_counts
--   CI   context isolation: one side's answer is one side's news
--
-- Self-seeding, and rolled back.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid;
  v_ca uuid; v_tm uuid; v_coach uuid; v_member uuid; v_cab uuid; v_tmb uuid; v_tm14 uuid; v_parent uuid; v_grown uuid;
  v_ms_tm uuid; v_ms_coach uuid; v_ms_member uuid; v_ms_tmb uuid; v_ms_ca uuid; v_ms_tm14 uuid;
  v_child uuid; v_grown_player uuid; v_b_player uuid;
  v_fixture uuid; v_fixture_b uuid; v_session uuid; v_season uuid; v_plan uuid;
  v_n bigint; v_m bigint; v_state text; v_id uuid; v_id2 uuid; v_read timestamptz; v_json jsonb;
  v_before timestamptz; v_before_id uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_session_id uuid := gen_random_uuid();
  r record;
begin
  -- =====================================================================================
  -- SEED (as postgres)
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');

  v_ca := pg_temp.person('ClubAdmin'); v_ms_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TeamManager'); v_ms_tm := pg_temp.member(v_club, v_tm);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  v_coach := pg_temp.person('Coach'); v_ms_coach := pg_temp.member(v_club, v_coach);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  v_tm14 := pg_temp.person('OtherSideManager'); v_ms_tm14 := pg_temp.member(v_club, v_tm14);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm14, v_t14, 'manager');
  v_member := pg_temp.person('Member'); v_ms_member := pg_temp.member(v_club, v_member);
  v_cab := pg_temp.person('OtherClubAdmin'); perform pg_temp.member(v_club_b, v_cab, 'CLUB_ADMIN');
  v_tmb := pg_temp.person('OtherTeamManager'); v_ms_tmb := pg_temp.member(v_club_b, v_tmb);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tmb, v_tb, 'manager');

  v_parent := pg_temp.person('Parent');
  v_grown := pg_temp.person('Grown', (current_date - interval '30 years')::date);
  v_child := pg_temp.player('Child ' || v_tag, 11, v_t12);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent);
  v_grown_player := pg_temp.player('Grown ' || v_tag, 30, v_t14, v_grown);
  v_b_player := pg_temp.player('Bee ' || v_tag, 11, v_tb);

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;

  -- U12 v club B's U12: a fixture BOTH sides are involved in, so staff on each side hold the register for
  -- their own squad and the other side's answer is not theirs.
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, v_tb, 'Home', 'TO Away RUFC', current_date + 10, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t14, 'Home', 'TO External RFC', current_date + 12, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture_b;

  insert into public.training_sessions (club_id, team_id, session_date, start_time, status, created_by)
  values (v_club, v_t12, current_date + 3, '18:00', 'PLANNED', v_ca) returning id into v_session;

  -- A live session for whoever acts: the response operations require one.
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_session_id, v_parent, now(), now(), 'aal1');

  perform pg_temp.check(v_fixture is not null and v_session is not null,
    'NA-0 seeded: two clubs, a shared U12 fixture, a U14 fixture, a training session, staff on each side, a parent and an adult player');

  -- =====================================================================================
  -- AC. The availability response reaches the staff
  -- =====================================================================================
  select count(*) into v_n from internal.availability_notification_recipients(v_t12);
  perform pg_temp.check(v_n = 3 and exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id = v_ca)
                        and exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id = v_tm)
                        and exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id = v_coach),
    format('AC-1 the recipients of a U12 answer are exactly the holders of team.attendance.view at U12 -- Club Admin, Team Manager, Coach (%s)', v_n));
  perform pg_temp.check(not exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id in (v_member, v_parent, v_tm14, v_tmb, v_cab)),
    'AC-2 and NOT a plain member, the parent, the U14 manager, or anybody at the other club');

  perform pg_temp.act('authenticated', v_parent, v_session_id);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture, v_child));
  perform pg_temp.check(v_state = 'OK', format('AC-3 the parent answers "can make it" through the canonical operation (%s)', v_state));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture::text and data->>'player_id' = v_child::text;
  perform pg_temp.check(v_n = 3, format('AC-4 three staff were told, once each (%s rows)', v_n));
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture::text and user_id in (v_parent, v_member, v_tm14, v_tmb, v_cab);
  perform pg_temp.check(v_n = 0, 'AC-5 and nobody else was -- not the parent, not the other side, not the other club');
  select title, body, data into r from public.notifications where type = 'fixture_availability_responded' and user_id = v_tm and data->>'fixture_id' = v_fixture::text;
  perform pg_temp.check(r.title like 'P Child%can make it' and r.body like 'Under 12 Boys v TO Away RUFC % Under 12 Boys, %' and r.data ? 'team_id' and r.data ? 'club_id' and r.data->>'status' = 'ATTENDING',
    format('AC-6 the card says who, what and when, and carries the team and club it concerns (%s / %s)', r.title, r.body));
  perform pg_temp.check(exists (select 1 from public.notification_types where type_key = 'fixture_availability_responded' and topic_key = 'fixture_updates')
                        and exists (select 1 from public.notification_types where type_key = 'training_availability_responded' and topic_key = 'calendar_training_updates'),
    'AC-7 both types are registered in the topics whose preference already governs them');

  -- The same answer again: nothing new is said.
  perform pg_temp.act('authenticated', v_parent, v_session_id);
  perform public.respond_to_attendance(v_fixture, v_child, 'ATTENDING');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture::text and data->>'player_id' = v_child::text;
  perform pg_temp.check(v_n = 3, format('AC-8 repeating the same answer tells nobody anything (%s rows, still)', v_n));

  -- A changed answer: the earlier unread row is settled, the new one carries the current answer.
  perform pg_temp.act('authenticated', v_parent, v_session_id);
  perform public.respond_to_attendance(v_fixture, v_child, 'CANNOT_ATTEND');
  perform pg_temp.act_postgres();
  select count(*) filter (where read_at is null), count(*) into v_n, v_m from public.notifications
    where type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture::text and data->>'player_id' = v_child::text and user_id = v_tm;
  perform pg_temp.check(v_n = 1 and v_m = 2 and exists (select 1 from public.notifications where user_id = v_tm and type = 'fixture_availability_responded' and read_at is null and data->>'status' = 'CANNOT_ATTEND'),
    format('AC-9 a changed answer never stacks: one unread row per person per event, carrying the current answer (%s unread of %s)', v_n, v_m));

  -- The decision, not the role label. team.attendance.view is safeguarding-sensitive, so a Club Admin
  -- cannot withhold it (only Site Admin may); what a club CAN do is end the standing the capability
  -- follows from, and the recipients follow the decision the moment it changes.
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''team.attendance.view'', ''team'', %L, %L, ''deny'', ''CA-M8: not the register'')', v_coach, v_club, v_t12));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501' and (select safeguarding_sensitive from public.capabilities where key = 'team.attendance.view'),
    format('AC-10 a Club Admin cannot withhold team.attendance.view -- it is safeguarding-sensitive and Site Admin''s to decide (%s)', v_state));
  delete from public.team_permissions where membership_id = v_ms_coach and team_id = v_t12;
  perform pg_temp.check(not exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id = v_coach)
                        and (select allowed from internal.capability_decision(v_coach, 'team.attendance.view', 'team', null, v_t12, null, false, false)) = false,
    'AC-11 the Coach''s team standing ends and the Coach drops out of the recipients -- the decision, asked fresh, not a remembered list');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  perform pg_temp.check(exists (select 1 from internal.availability_notification_recipients(v_t12) where user_id = v_coach), 'AC-11b and restoring it restores them');

  -- The responder is never told about their own answer, even when they also run the side.
  perform pg_temp.act_postgres();
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_tm, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_tm);
  update auth.sessions set user_id = v_tm where id = v_session_id;
  perform pg_temp.act('authenticated', v_tm, v_session_id);
  perform public.respond_to_attendance(v_fixture, v_child, 'UNSURE');
  perform pg_temp.act_postgres();
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_tm and type = 'fixture_availability_responded' and data->>'status' = 'UNSURE')
                        and exists (select 1 from public.notifications where user_id = v_ca and type = 'fixture_availability_responded' and data->>'status' = 'UNSURE'),
    'AC-12 a Team Manager who is also the guardian answers and is not told about it; the Club Admin is');
  update auth.sessions set user_id = v_parent where id = v_session_id;
  delete from public.guardians where guardian_user_id = v_tm and player_id = v_child;

  -- Training takes the same path.
  perform pg_temp.act('authenticated', v_parent, v_session_id);
  v_state := pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, ''ATTENDING'')', v_session, v_child));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'training_availability_responded' and data->>'training_session_id' = v_session::text;
  perform pg_temp.check(v_state = 'OK' and v_n = 3 and (select body from public.notifications where type = 'training_availability_responded' and user_id = v_tm) like 'Under 12 Boys training,%',
    format('AC-13 a training answer reaches the same three, worded as training (%s / %s)', v_state, v_n));

  -- =====================================================================================
  -- CI. Context isolation: an answer on the U14 side is the U14 side's news
  -- =====================================================================================
  update auth.sessions set user_id = v_grown where id = v_session_id;
  perform pg_temp.act('authenticated', v_grown, v_session_id);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture_b, v_grown_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK'
      and exists (select 1 from public.notifications where user_id = v_tm14 and type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture_b::text)
      and exists (select 1 from public.notifications where user_id = v_ca and type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture_b::text)
      and not exists (select 1 from public.notifications where user_id in (v_tm, v_coach) and type = 'fixture_availability_responded' and data->>'fixture_id' = v_fixture_b::text),
    format('CI-1 an adult player''s answer on U14 reaches the U14 manager and the Club Admin, never the U12 staff (%s)', v_state));
  perform pg_temp.check((select data->>'team_id' from public.notifications where user_id = v_tm14 and type = 'fixture_availability_responded' limit 1) = v_t14::text,
    'CI-2 and the card names the U14 side, so a client can stand in that context before it opens');
  update auth.sessions set user_id = v_parent where id = v_session_id;

  -- =====================================================================================
  -- RR. READ IS NOT RESOLVED
  -- =====================================================================================
  -- The Club Admin holds an unread "is not sure yet" about the child (AC-12) and reads it.
  select id into v_id from public.notifications where user_id = v_ca and type = 'fixture_availability_responded' and read_at is null and data->>'fixture_id' = v_fixture::text and data->>'status' = 'UNSURE';
  update auth.sessions set user_id = v_ca where id = v_session_id;
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  perform pg_temp.check(v_id is not null and public.mark_notification_read(v_id) = true, 'RR-1 the Club Admin marks the answer read');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child) = 'UNSURE',
    'RR-2 and the child''s answer is exactly what it was: reading changed nothing about the fixture');
  -- The other way round: answering leaves every read mark alone.
  select read_at into v_read from public.notifications where id = v_id;
  update auth.sessions set user_id = v_parent where id = v_session_id;
  perform pg_temp.act('authenticated', v_parent, v_session_id);
  perform public.respond_to_attendance(v_fixture, v_child, 'ATTENDING');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select read_at from public.notifications where id = v_id) = v_read
                        and exists (select 1 from public.notifications where user_id = v_ca and type = 'fixture_availability_responded' and read_at is null and data->>'status' = 'ATTENDING' and data->>'fixture_id' = v_fixture::text),
    'RR-3 a new answer leaves the row already read exactly as read; the new row is the unread one');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name in ('resolved', 'resolved_at', 'dismissed_at', 'archived_at', 'completed_at')),
    'RR-4 a notification has no resolved, dismissed or archived column: whether the job is done is the domain''s to say');

  -- =====================================================================================
  -- RM. The read mutation: self-only, read_at only, no delete
  -- =====================================================================================
  select id into v_id2 from public.notifications where user_id = v_tm and type = 'training_availability_responded' and read_at is null limit 1;
  update auth.sessions set user_id = v_ca where id = v_session_id;
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  perform pg_temp.check(v_id2 is not null and public.mark_notification_read(v_id2) = false and public.mark_notification_unread(v_id2) = false,
    'RM-1 marking somebody else''s notification read or unread changes nothing and says so');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select read_at from public.notifications where id = v_id2) is null, 'RM-2 the Team Manager''s row is still unread');
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  -- Sequenced deliberately: the mutation first, the read after -- inside one boolean expression the
  -- STABLE read may be planned before the VOLATILE call and report the row as it was.
  v_json := to_jsonb(public.mark_notification_unread(v_id));
  perform pg_temp.check(v_json = 'true'::jsonb and (select read_at from public.my_notifications(50) where id = v_id) is null,
    'RM-3 unread is a real state the storage holds: the Club Admin marks their own row unread again');
  select count(*) into v_n from public.my_notifications(50) where read_at is null;
  v_m := public.mark_all_notifications_read();
  perform pg_temp.check(v_m = v_n and v_m >= 2 and not exists (select 1 from public.my_notifications(50) where read_at is null),
    format('RM-4 mark all reads exactly the bell''s unread rows (%s) and no more', v_m));
  v_state := pg_temp.try(format('delete from public.notifications where id = %L', v_id));
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.notifications where id = v_id), format('RM-5 there is no delete: the row is still there after a client tried (%s)', v_state));
  perform pg_temp.check(not exists (select 1 from pg_policy where polrelid = 'public.notifications'::regclass and polcmd = 'd'), 'RM-6 and no delete policy exists to grant it');
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  v_state := pg_temp.try(format('update public.notifications set title = ''rewritten'' where id = %L', v_id));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state <> 'OK' and (select title from public.notifications where id = v_id) <> 'rewritten', format('RM-7 only read_at may change: rewriting a notification is refused (%s)', v_state));

  -- =====================================================================================
  -- FD. The feed: the bell's rule, paged, filterable, in step with the count
  -- =====================================================================================
  -- Messenger's rows and Support's are not the bell's.
  insert into public.notifications (user_id, type, title, body, data) values
    (v_ca, 'new_direct_message', 'A message', 'Hello', jsonb_build_object('direct_conversation_id', gen_random_uuid())),
    (v_ca, 'support_ticket_update', 'Support', 'Updated', jsonb_build_object('support_ticket_id', gen_random_uuid(), 'reference', 'OV-1'));
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  select count(*) into v_n from public.my_notifications(50) where type in ('new_direct_message', 'support_ticket_update');
  perform pg_temp.check(v_n = 0, 'FD-1 the feed is the bell''s: a direct message and a support update belong to their own badges');
  select count(*) filter (where read_at is null) into v_n from public.my_notifications(50);
  select notifications into v_m from public.my_unread_counts();
  perform pg_temp.check(v_n = v_m, format('FD-2 the feed''s unread rows and the bell''s badge are the same figure (%s = %s)', v_n, v_m));
  select messages into v_m from public.my_unread_counts();
  perform pg_temp.check(v_m = 1, 'FD-3 and the message is counted where Messenger counts it, untouched by mark-all');
  -- Keyset paging: the page after the first row never repeats it and holds the rest.
  select created_at, id into v_before, v_before_id from public.my_notifications(1);
  select count(*) into v_n from public.my_notifications(1, v_before, v_before_id) where id = v_before_id;
  select count(*) into v_m from public.my_notifications(50);
  perform pg_temp.check(v_n = 0 and (select count(*) from public.my_notifications(50, v_before, v_before_id)) = v_m - 1,
    format('FD-4 the cursor walks on from the last row: the next page never repeats it and holds the rest (%s of %s)', v_m - 1, v_m));
  perform public.mark_notification_unread(v_id);
  select count(*) into v_n from public.my_notifications(50, null, null, true);
  perform pg_temp.check(v_n = 1 and (select id from public.my_notifications(50, null, null, true)) = v_id, 'FD-5 the unread-only page is the storage''s answer, not a client''s filter');
  perform pg_temp.check((select count(*) from public.my_notifications(500)) <= 50, 'FD-6 a page is never more than fifty rows, whatever was asked for');
  perform pg_temp.act_postgres();
  perform pg_temp.check(not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('mobile_notifications', 'mobile_action_items', 'action_items', 'attention_items')),
    'FD-7 there is no second notification store and no action-item table: one domain, projected');

  -- The mandatory topic rule is untouched.
  perform pg_temp.act('authenticated', v_ca, v_session_id);
  v_state := pg_temp.try('select public.set_notification_preference(''account_security'', false, null)');
  perform pg_temp.check(v_state = '23514', format('FD-8 a mandatory topic still cannot be switched off (%s)', v_state));
  perform pg_temp.act_postgres();
end $$;

rollback;
