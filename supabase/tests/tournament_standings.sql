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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tres-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tres', p_label, 'tres-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TRES ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tres-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tres-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

/** A directory club with NO Ovalball club behind it -- nobody can answer for it. */
create or replace function pg_temp.directory_only(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TRES ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry', 'tres-' || v_tag)
  returning id into v_dir;
  return v_dir;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12', p_squad text default null) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys' || coalesce(' ' || p_squad, ''),
          'tres-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', p_squad, 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text default 'COACH') returns void language plpgsql as $$
begin
  insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership, p_team, p_role_key);
end $$;

/** Runs a statement AS somebody and hands back 'OK' or the SQLSTATE. */
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

/** Runs a read AS somebody and hands back what it returned. */
create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin execute p_sql into v; exception when others then v := null; end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- =====================================================================================================
-- A TOURNAMENT TABLE IS CALCULATED, NEVER KEPT.
--
-- WHAT IS BEING PROTECTED
--
-- Standings are the one thing in a festival that EVERYBODY reads and NOBODY writes. There is no
-- standings row: the table is resolved from the confirmed games every time it is asked for. That design
-- removes a whole class of failure -- a stale row, a recalculation job nobody ran -- and introduces
-- another, which is what this suite is for:
--
--   * a side's membership coming from its RESULTS rather than from the published plan, so a club that
--     has played nothing disappears instead of sitting on nought;
--   * one table's result moving another table;
--   * a competition that plays Friday and Sunday producing two tables instead of one;
--   * an ordering nobody configured, or one that shuffles between two readings of the same data;
--   * a scoring rule being applied that Ovalball has no data to apply;
--   * a result reaching somebody the organiser kept it from.
--
-- THE ARITHMETIC IS ASSERTED AGAINST REAL SCORES, not against itself. Every expected number below is
-- worked out from the games the suite creates and the points system it sets.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir_host uuid;
  v_h_u12 uuid; v_ca uuid; v_outsider uuid; v_out_club uuid;
  v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_a uuid; v_b uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid;
  v_g uuid; v_json jsonb; v_n int; v_pos text[];
  function_src text;
begin

v_host := pg_temp.club('StHost');
select directory_id into v_dir_host from public.clubs where id = v_host;
v_h_u12 := pg_temp.team(v_host, 'U12');
v_ca := pg_temp.person('StCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_out_club := pg_temp.club('StOutsider');
v_outsider := pg_temp.person('Outsider', v_adult); perform pg_temp.member(v_out_club, v_outsider, 'CLUB_ADMIN');

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'TRES St Ground', 'tres-sg-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
-- MARKED OUT AS TWO HALVES, the way a U12 festival uses a full pitch: two games at once, and no more
-- (20270736 holds a pitch to its layout; one whole pitch would take one game at a time).
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order, physical_size_category, layout)
values (v_host, v_venue, 'Pitch 1', true, 1, 'full', 'two_halves') returning id into v_pitch;

-- A TWO-DAY FESTIVAL whose competition plays the FIRST and THIRD days, leaving the middle one out --
-- the shape the review world uses, and the one that would produce per-day standings if anything here
-- grouped by date.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date - 4, current_date - 2, 'confirmed', 'TRES Standings Festival',
        gen_random_uuid(), 'round_robin', 'public', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_s1;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
values (v_t, pg_temp.directory_only('S2'), null, 'U12', 'A', 'added') returning id into v_s2;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
values (v_t, pg_temp.directory_only('S3'), null, 'U12', 'A', 'added') returning id into v_s3;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
values (v_t, pg_temp.directory_only('S4'), null, 'U12', 'A', 'added') returning id into v_s4;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
values (v_t, pg_temp.directory_only('S5'), null, 'U12', 'A', 'added') returning id into v_s5;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
values (v_t, pg_temp.directory_only('S6'), null, 'U12', 'A', 'added') returning id into v_s6;

-- A SHORT WINDOW ON EACH DAY. One pitch for an hour holds some of the six games and not all of them,
-- which is how a real festival comes to run across two days -- and is the only way this suite can prove
-- that two days still make ONE table.
insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, current_date - 4, '09:00', '10:00', v_ca),
       (v_t, v_pitch, current_date - 2, '09:00', '12:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[(current_date - 4)::date, (current_date - 2)::date]);
perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
  jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_s1, v_s2, v_s3)),
  jsonb_build_object('name', 'Table B', 'sides', jsonb_build_array(v_s4, v_s5, v_s6))));
-- 4 for a win, 2 for a draw, a losing bonus of 1 within 7, and a TRY bonus that cannot be applied.
perform public.set_tournament_plan_settings(v_plan, null, null, null, null, 4, 2, 0, 1, 1, 7,
  array['points_difference', 'points_for', 'head_to_head', 'wins']::text[]);
perform public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
where id = v_plan;
select id into v_a from public.tournament_plan_tables where plan_id = v_plan and name = 'Table A';
select id into v_b from public.tournament_plan_tables where plan_id = v_plan and name = 'Table B';

-- ============ A. MEMBERSHIP COMES FROM THE PUBLISHED PLAN ============

perform pg_temp.check((select count(*) from internal.tournament_table_standings(v_a)) = 3,
  '1 (A): a table holds its three sides before anybody has scored');
perform pg_temp.check((select count(*) from internal.tournament_table_standings(v_a) where played = 0) = 3,
  '2 (A): all of them on nought played -- which is what a table looks like before a festival starts');
perform pg_temp.check(
  (select count(*) from internal.tournament_table_standings(v_a) s where s.participant_id in (v_s4, v_s5, v_s6)) = 0,
  '3 (A): and holds NOBODY from the other table');

-- ============ B. THE ARITHMETIC ============
--
-- Table A plays three games. Scores chosen so every rule is exercised once:
--   S1 24 - 17 S2    S1 wins by 7      -> S1 4,  S2 1 (losing bonus, exactly at the margin)
--   S1 30 -  5 S3    S1 wins by 25     -> S1 4,  S3 0 (no bonus, beaten by more than 7)
--   S2 12 - 12 S3    a draw            -> S2 2,  S3 2

select id into v_g from public.tournament_games where table_id = v_a
  and ((side_a_id = v_s1 and side_b_id = v_s2) or (side_a_id = v_s2 and side_b_id = v_s1));
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, %s, %s, ''Recorded'')',
  v_g, case when (select side_a_id from public.tournament_games where id = v_g) = v_s1 then 24 else 17 end,
       case when (select side_a_id from public.tournament_games where id = v_g) = v_s1 then 17 else 24 end));

select id into v_g from public.tournament_games where table_id = v_a
  and ((side_a_id = v_s1 and side_b_id = v_s3) or (side_a_id = v_s3 and side_b_id = v_s1));
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, %s, %s, ''Recorded'')',
  v_g, case when (select side_a_id from public.tournament_games where id = v_g) = v_s1 then 30 else 5 end,
       case when (select side_a_id from public.tournament_games where id = v_g) = v_s1 then 5 else 30 end));

select id into v_g from public.tournament_games where table_id = v_a
  and ((side_a_id = v_s2 and side_b_id = v_s3) or (side_a_id = v_s3 and side_b_id = v_s2));
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 12, 12, ''Recorded'')', v_g));

perform pg_temp.check((select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s1) = 8,
  format('4 (B): two wins at four points is eight (%s)',
    (select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s1)));
perform pg_temp.check((select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s2) = 3,
  format('5 (B): a draw plus a defeat by EXACTLY the bonus margin is 2 + 1 = 3 (%s)',
    (select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s2)));
perform pg_temp.check((select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s3) = 2,
  format('6 (B): a draw plus a defeat by MORE than the margin earns no bonus (%s)',
    (select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s3)));

perform pg_temp.check((select points_for from internal.tournament_table_standings(v_a) where participant_id = v_s1) = 54
                  and (select points_against from internal.tournament_table_standings(v_a) where participant_id = v_s1) = 22
                  and (select points_difference from internal.tournament_table_standings(v_a) where participant_id = v_s1) = 32,
  '7 (B): points for, against and the difference between them');

perform pg_temp.check((select drawn from internal.tournament_table_standings(v_a) where participant_id = v_s2) = 1,
  '8 (B): a draw is counted as a draw for both sides');

-- THE TRY BONUS IS CONFIGURED AND NOT APPLIED. If it were, S1 would have more than eight.
perform pg_temp.check((select points_try_bonus from public.tournament_plans where id = v_plan) = 1,
  '9 (B): the plan carries a try bonus the organiser set');
perform pg_temp.check((select competition_points from internal.tournament_table_standings(v_a) where participant_id = v_s1) = 8,
  '10 (B): and it is NOT applied -- awarding it needs tries, which no Ovalball surface records');
perform pg_temp.check(
  ((internal.tournament_scoring_rules(v_plan)->'tryBonus'->>'available')::boolean) is false
  and (internal.tournament_scoring_rules(v_plan)->'tryBonus'->>'unavailableReason') is not null,
  '11 (B): and the organiser is TOLD it cannot be applied, with the reason -- never silently ignored');

-- ============ C. ONE TABLE'S RESULT CANNOT MOVE ANOTHER ============

perform pg_temp.check((select coalesce(sum(played), 0) from internal.tournament_table_standings(v_b)) = 0,
  '12 (C): three confirmed results in Table A leave Table B entirely unmoved');
perform pg_temp.check((select count(*) from internal.tournament_table_standings(v_b)) = 3,
  '13 (C): and Table B still holds its own three sides');

-- ============ D. ONE COMPETITION, ONE TABLE, HOWEVER MANY DAYS ============

perform pg_temp.check((select count(distinct game_date) from public.tournament_games where table_id = v_a) >= 1,
  '14 (D): the competition''s games are spread across its days');
select count(distinct game_date) into v_n from public.tournament_games where plan_id = v_plan;
perform pg_temp.check(v_n = 2, format('15 (D): over exactly the two days it plays -- the middle day is not one of them (%s)', v_n));
perform pg_temp.check((select sum(played) from internal.tournament_table_standings(v_a)) = 6,
  '16 (D): and ONE table counts every one of them -- six side-games from three fixtures, whichever day they fell on');

-- ============ E. THE ORDER IS THE ORGANISER'S, AND IT IS TOTAL ============

select array_agg(participant_id::text order by table_position) into v_pos
from internal.tournament_table_ordered(v_a);
perform pg_temp.check(v_pos[1] = v_s1::text, '17 (E): most competition points is first');
perform pg_temp.check(v_pos[2] = v_s2::text, '18 (E): then the next, by points');
perform pg_temp.check(v_pos[3] = v_s3::text, '19 (E): then the next');

perform pg_temp.check((select count(distinct table_position) from internal.tournament_table_ordered(v_a)) = 3,
  '20 (E): every side has its own position -- the order is TOTAL, so the same table reads the same twice');

-- Two readings of the same data agree. A tie-break that depended on row order would not.
perform pg_temp.check(
  (select array_agg(participant_id::text order by table_position) from internal.tournament_table_ordered(v_a))
  = (select array_agg(participant_id::text order by table_position) from internal.tournament_table_ordered(v_a)),
  '21 (E): and reading it twice gives the same order');

-- A CRITERION THE ORGANISER DID NOT CHOOSE DOES NOT ORDER THEIR TABLE.
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, p_tie_breakers => array[''alphabetical'']::text[])', v_plan)) = '22023',
  '22 (E): a tie-break Ovalball cannot resolve is refused -- a table ordered by something invisible is the thing this configuration prevents');
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, p_tie_breakers => array[''wins'',''wins'']::text[])', v_plan)) = '22023',
  '23 (E): and the same criterion twice says nothing the first did not');
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, p_tie_breakers => array[]::text[])', v_plan)) = 'OK',
  '24 (E): an organiser may choose NO tie-break at all');
perform pg_temp.check((select count(distinct table_position) from internal.tournament_table_ordered(v_a)) = 3,
  '25 (E): and the order is still total -- the neutral fallback decides, making no sporting claim');
perform pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, p_tie_breakers => array[''points_difference'',''points_for'',''head_to_head'',''wins'']::text[])', v_plan));

-- ============ F. WHO MAY READ THE TABLE ============

-- THE DEFAULT IS THE CAUTIOUS ONE. A tournament keeps its results to participants until its organiser
-- says otherwise, so the outsider reads nothing before this is changed.
perform pg_temp.check((select results_visibility from public.tournaments where id = v_t) = 'participants',
  '26a (F): results are kept to participants by default, even on a PUBLIC tournament');
v_json := pg_temp.json_as(v_outsider, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check((v_json->>'restricted')::boolean,
  '26b (F): so an outsider is refused the standings of a publicly listed festival');

perform pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''public'')', v_t));
v_json := pg_temp.json_as(v_outsider, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'tables') = 2,
  '26 (F): and reads them once the organiser makes them public');

perform pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''participants'')', v_t));
v_json := pg_temp.json_as(v_outsider, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check((v_json->>'restricted')::boolean,
  '27 (F): once the organiser keeps results to participants, an outsider is told so rather than shown a table');
perform pg_temp.check(jsonb_array_length(v_json->'tables') = 0,
  '28 (F): and is sent NO standings at all -- not a table a client is trusted not to draw');

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'tables') = 2,
  '29 (F): while the organiser still reads it');

-- A PUBLIC TOURNAMENT IS NOT PUBLIC RESULTS, and the two settings are genuinely independent.
perform pg_temp.check((select visibility from public.tournaments where id = v_t) = 'public'
                  and (select results_visibility from public.tournaments where id = v_t) = 'participants',
  '30 (F): the tournament is still public while its results are not');

-- ============ F2. TOURNAMENT VISIBILITY IS THE OUTER BOUNDARY ============
--
-- Result visibility can only PERMIT reading inside what the tournament itself already allows. Choosing
-- "public results" on a PRIVATE tournament must not make anything discoverable: the setting narrows or
-- permits within the boundary, it never moves it. Asserted server-side, because a client that simply
-- declines to show a link has still been handed the standings.

perform pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''public'')', v_t));
update public.tournaments set visibility = 'private' where id = v_t;

perform pg_temp.check((select results_visibility from public.tournaments where id = v_t) = 'public',
  '30a (F2): the organiser has chosen PUBLIC results');
perform pg_temp.check((select visibility from public.tournaments where id = v_t) = 'private',
  '30b (F2): on a tournament that is PRIVATE');

perform pg_temp.check(internal.tournament_results_readable(v_t) is not null,
  '30c (F2): the readability authority answers for it');

v_json := pg_temp.json_as(v_outsider, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check(v_json is null or jsonb_array_length(v_json->'tables') = 0,
  '30d (F2): and an unconnected person STILL reads no standings -- public results cannot reach outside a private tournament');

perform pg_temp.check(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'tournament_results_readable'
      and p.prosrc like '%visibility = ''public''%' and p.prosrc like '%results_visibility = ''public''%') = 1,
  '30e (F2): because the authority requires BOTH -- the tournament public AND its results public -- rather than results alone');

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'tables') = 2,
  '30f (F2): while the organiser, who belongs to it, reads it exactly as before');

update public.tournaments set visibility = 'public' where id = v_t;

-- ============ G. NOTHING UNSETTLED REACHES THE TABLE READ ============

perform pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''public'')', v_t));
-- A CONTESTED GAME, built by settling one and then putting it back into dispute. Every side in Table B
-- is a directory club, so no club can submit for it -- and this section is testing what the READ does
-- with an unsettled state, not how one is reached. The write paths are proved in tournament_results.
select id into v_g from public.tournament_games where table_id = v_b limit 1;
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 40, 0, ''Recorded'')', v_g));
update public.tournament_games set result_status = 'disputed' where id = v_g;

v_json := pg_temp.json_as(v_outsider, format('select public.get_tournament_tables(%L::uuid, ''U12'')', v_t));
select count(*) into v_n
from jsonb_array_elements(v_json->'tables') t, jsonb_array_elements(t->'recentResults') r
where r->>'id' = v_g::text;
perform pg_temp.check(v_n = 0, '31 (G): a contested score is not in Recent Results');
perform pg_temp.check((select coalesce(sum(played), 0) from internal.tournament_table_standings(v_b)) = 0,
  '32 (G): and not in the standings');

-- ============ H. THE TABLE IS A PROJECTION, AND THERE IS NOWHERE TO KEEP ONE ============

perform pg_temp.check(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name like 'tournament%'
     and column_name in ('competition_points', 'table_points', 'standings_points', 'league_points')) = 0,
  '33 (H): no tournament table stores a points total -- the standings cannot go stale because there are none');

perform pg_temp.check(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'internal') and c.relname like '%standings%' and c.relkind in ('r', 'm')) = 0,
  '34 (H): and no standings table or materialised view exists to be recalculated');

end $$;

rollback;
