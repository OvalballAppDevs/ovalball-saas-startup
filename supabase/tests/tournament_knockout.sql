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
-- A KNOCKOUT IS THE SAME TOURNAMENT WITH A DIFFERENT CONSEQUENCE.
--
-- WHAT IS BEING PROTECTED
--
-- A bracket is the first thing in Ovalball where the RESULT OF ONE GAME DECIDES WHO PLAYS THE NEXT ONE.
-- That makes a particular set of mistakes possible, and every one of them puts a real club in the wrong
-- place on a real Saturday:
--
--   * inventing a participant called "Bye" or "Winner QF1" -- a club that does not exist, in a
--     competition, with an attendance list and a crest nobody can draw;
--   * a bye becoming a 0-0 game, so a side that played nobody has a result and a points difference;
--   * dropping a side when the field is not a power of two;
--   * advancing somebody from a score nobody has agreed, or from a level score decided by row order;
--   * redrawing a competition that has already been played;
--   * rewiring a semi-final that two clubs have already turned up for.
--
-- THE FIELD IS DELIBERATELY SIX. A power of two would never exercise byes, and six is the shape a real
-- junior festival most often has.
--
-- IT REUSES EVERYTHING. The same tournament, competition, participants, games, result lifecycle,
-- scheduler and result visibility -- asserted, so a future knockout feature cannot quietly fork them.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir_host uuid; v_h_u12 uuid; v_ca uuid; v_venue uuid; v_pitch uuid;
  v_outsider uuid; v_out_club uuid; v_parent uuid; v_child uuid;
  v_away uuid; v_dir_away uuid; v_a_u12 uuid; v_away_ca uuid;
  v_t uuid; v_plan uuid; v_sides uuid[]; v_g uuid; v_w uuid; v_n int; v_i int; v_first uuid;
  v_d uuid[]; v_order uuid[]; v_side_host uuid; v_side_away uuid;
begin

v_host := pg_temp.club('KOHost');
select directory_id into v_dir_host from public.clubs where id = v_host;
v_h_u12 := pg_temp.team(v_host, 'U12');
v_ca := pg_temp.person('KOCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_away := pg_temp.club('KOAway');
select directory_id into v_dir_away from public.clubs where id = v_away;
v_a_u12 := pg_temp.team(v_away, 'U12');
v_away_ca := pg_temp.person('KOAwayCA', v_adult); perform pg_temp.member(v_away, v_away_ca, 'CLUB_ADMIN');
v_out_club := pg_temp.club('KOOutsider');
v_outsider := pg_temp.person('KOOut', v_adult); perform pg_temp.member(v_out_club, v_outsider, 'CLUB_ADMIN');
v_parent := pg_temp.person('KOParent', v_adult);
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tres', 'KOChild', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child;
insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_h_u12, 'active');
insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'KO Ground', 'ko-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

-- A TWO-DAY KNOCKOUT, so the multi-day rule is exercised rather than assumed.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date - 3, current_date - 2, 'confirmed', 'KO Cup',
  gen_random_uuid(), 'knockout', 'private', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

-- TWO REAL OVALBALL CLUBS AND FOUR DIRECTORY ONES. Both halves are needed: a game between two clubs
-- that can answer proves a submitted score advances nobody, and a game against a club that cannot
-- proves a recorded one does.
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_side_host;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_away, v_away, v_a_u12, 'U12', 'added') returning id into v_side_away;
v_d := '{}'::uuid[];
for v_i in 1..4 loop
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('KO'||v_i), null, 'U12', 'A', 'added') returning id into v_g;
  v_d := v_d || v_g;
end loop;

insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, current_date - 3, '09:00', '16:00', v_ca),
       (v_t, v_pitch, current_date - 2, '09:00', '16:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[(current_date - 3)::date, (current_date - 2)::date]);
perform public.set_tournament_plan_settings(v_plan, 20);
perform public.set_tournament_knockout_settings(v_plan, p_tie_resolution => 'organiser_decision', p_third_place_playoff => true);
v_n := public.randomise_tournament_bracket(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

-- ============ A. THE DRAW SEATS EVERYBODY, AND INVENTS NOBODY ============

perform pg_temp.check(v_n = 8, format('1 (A): six sides are drawn into an EIGHT-place bracket (%s)', v_n));
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and is_bye;
perform pg_temp.check(v_n = 2, format('2 (A): with exactly two byes (%s)', v_n));
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and participant_id is not null;
perform pg_temp.check(v_n = 6, format('3 (A): and all six sides placed -- nobody is dropped to make the numbers work (%s)', v_n));
select count(*) into v_n from public.tournament_participants where tournament_id = v_t;
perform pg_temp.check(v_n = 6, format('4 (A): and NO participant called Bye was invented (%s)', v_n));
select count(*) into v_n from public.club_directory where name ilike '%bye%';
perform pg_temp.check(v_n = 0, '5 (A): nor a club in the directory');
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null;
perform pg_temp.check(v_n = 2, format('6 (A): the two sides opposite a bye are through immediately, with no game to wait for (%s)', v_n));
-- 8 places, then 4, then 2 -- and no round above the final. WINNING THE FINAL IS WINNING THE
-- COMPETITION, so there is no further place for the champion to be moved into, and a bracket that
-- carried one would be inviting somebody to advance a side out of a tournament they had just won.
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan;
perform pg_temp.check(v_n = 8 + 4 + 2 + 2, format('7 (A): and the whole shape exists from the start -- 8 + 4 + 2 places, no place above the final, plus the two the third-place play-off is LOST into (%s)', v_n));

-- EVERY EMPTY PLACE KNOWS WHICH GAME FILLS IT, long before that game is played -- which is what lets a
-- bracket print "Winner QF1" without a club of that name existing anywhere.
select count(*) into v_n from public.tournament_bracket_slots
where plan_id = v_plan and round_number > 1 and source_kind = 'winner' and not is_third_place;
perform pg_temp.check(v_n = 6, format('7b (A): six later places are fed by WINNING (%s)', v_n));
select count(*) into v_n from public.tournament_bracket_slots
where plan_id = v_plan and source_kind = 'loser';
perform pg_temp.check(v_n = 2, format('7c (A): and exactly two by LOSING -- the third-place play-off, and nothing else (%s)', v_n));
perform pg_temp.check(
  (select internal.bracket_slot_label(id) from public.tournament_bracket_slots
   where plan_id = v_plan and round_number = 3 and position = 1 and not is_third_place) = 'Winner SF1',
  '7d (A): and an empty place is CALLED what fills it -- "Winner SF1" is a sentence, not a team');

-- THE BYES ARE SPREAD, not bunched into one corner.
select count(*) into v_n from public.tournament_bracket_slots a
join public.tournament_bracket_slots b on b.plan_id = a.plan_id and b.round_number = 1 and b.position = a.position + 1
where a.plan_id = v_plan and a.round_number = 1 and a.position % 2 = 1 and a.is_bye and b.is_bye;
perform pg_temp.check(v_n = 0, '8 (A): no bye is drawn against another bye -- the byes are separated by the bracket order');

-- ============ B. A BYE IS NOT A GAME ============

perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.generate_tournament_knockout_fixtures(%L::uuid)', v_plan)) = 'OK',
  '9 (B): the competition generates');
select count(*) into v_n from public.tournament_games where plan_id = v_plan and round_number = 1;
perform pg_temp.check(v_n = 2, format('10 (B): round one holds TWO games, not four -- a bye produces none (%s)', v_n));
select count(*) into v_n from public.tournament_games where plan_id = v_plan;
perform pg_temp.check(v_n = 2, format('11 (B): and no later game exists while its sides are unknown (%s)', v_n));
select count(*) into v_n from public.tournament_games where plan_id = v_plan and result_status <> 'none';
perform pg_temp.check(v_n = 0, '12 (B): a bye creates no result, and no 0-0');
select count(*) into v_n from public.tournament_games where plan_id = v_plan and start_time is null;
perform pg_temp.check(v_n = 0, format('13 (B): every game is placed by the SHARED scheduler, not a knockout copy of one (%s)', v_n));

-- ============ C. ONLY A SETTLED, DECISIVE RESULT ADVANCES ============
--
-- A DELIBERATE DRAW, so the two clubs that can both answer meet in the opening round. Seeds 4 and 5 sit
-- in the same pairing at every bracket size, which is the classic order's own arrangement.
v_order := array[v_d[1], v_d[2], v_d[3], v_side_host, v_side_away, v_d[4]];
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, v_order)) = 'OK',
  '13b (C): the organiser arranges the draw by hand');
perform pg_temp.try_as(v_ca, format('select public.generate_tournament_knockout_fixtures(%L::uuid)', v_plan));
-- PUBLISHED BEFORE IT IS PLAYED (20270721): a draft game has no result, so the draw is published --
-- directly, as the knockout parity suite does -- before anybody submits a score.
update public.tournament_plans set publication_state = 'PUBLISHED', published_at = now(), published_by = created_by where id = v_plan;

select g.id into v_g from public.tournament_games g
where g.plan_id = v_plan and g.round_number = 1
  and g.side_a_id in (v_side_host, v_side_away) and g.side_b_id in (v_side_host, v_side_away);
perform pg_temp.check(v_g is not null, '13c (C): and the two Ovalball clubs meet in the opening round');

select count(*) into v_n from public.tournament_bracket_slots
where plan_id = v_plan and round_number = 2 and participant_id is not null and not is_third_place;
perform pg_temp.check(v_n = 2, format('13d (C): two sides are already through on byes (%s)', v_n));

perform pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 20, 10)', v_g));
perform pg_temp.check((select result_status from public.tournament_games where id = v_g) = 'awaiting_confirmation',
  '14a (C): one club''s score is awaiting the other''s answer');
perform pg_temp.check((select winner_participant_id from public.tournament_games where id = v_g) is null,
  '14 (C): a score ONE side submitted advances nobody');
select count(*) into v_n from public.tournament_bracket_slots
where plan_id = v_plan and round_number = 2 and participant_id is not null and not is_third_place;
perform pg_temp.check(v_n = 2, format('15 (C): and the bracket is unchanged (%s)', v_n));

-- A CONTEST ADVANCES NOBODY EITHER.
perform pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 20, 24, ''We won it'')', v_g));
perform pg_temp.check((select result_status from public.tournament_games where id = v_g) = 'disputed',
  '15a (C): the other club contests it');
perform pg_temp.check((select winner_participant_id from public.tournament_games where id = v_g) is null,
  '15b (C): and a CONTESTED result advances nobody');

select side_a_id into v_first from public.tournament_games where id = v_g;
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 20, 10, ''Referee''''s card'')', v_g));
perform pg_temp.check((select winner_participant_id from public.tournament_games where id = v_g) = v_first,
  '16 (C): a SETTLED decisive result records its winner');
select count(*) into v_n from public.tournament_bracket_slots
where plan_id = v_plan and round_number = 2 and participant_id is not null and not is_third_place;
perform pg_temp.check(v_n = 3, format('17 (C): and that winner takes their place in the next round (%s)', v_n));

-- the other opening game, between two sides that are not on Ovalball
select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 1 and result_status = 'none' limit 1;
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 9, 3, ''Recorded at the desk'')', v_g));
select count(*) into v_n from public.tournament_games where plan_id = v_plan and round_number = 2;
perform pg_temp.check(v_n = 2, format('18 (C): both semi-finals now exist, each with two real sides (%s)', v_n));
select count(*) into v_n from public.tournament_games g
join public.tournament_participants a on a.id = g.side_a_id
join public.tournament_participants b on b.id = g.side_b_id
where g.plan_id = v_plan;
perform pg_temp.check(v_n = 4, '19 (C): and every game''s sides are real participating sides');

-- ============ D. A LEVEL GAME HAS NO WINNER ============

for v_g in select id from public.tournament_games where plan_id = v_plan and round_number = 2 loop
  perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 15, 7, ''Recorded'')', v_g));
end loop;
select count(*) into v_n from public.tournament_games where plan_id = v_plan and round_number = 3 and not is_third_place;
perform pg_temp.check(v_n = 1, format('20 (D): the final exists (%s)', v_n));
select count(*) into v_n from public.tournament_games where plan_id = v_plan and is_third_place;
perform pg_temp.check(v_n = 1, format('21 (D): and the third-place play-off, built from the two SEMI-FINAL LOSERS (%s)', v_n));

select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 3 and not is_third_place;
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 12, 12, ''Level after full time'')', v_g));
perform pg_temp.check((select winner_participant_id from public.tournament_games where id = v_g) is null,
  '22 (D): a LEVEL result produces NO winner -- never the side listed first, never the lower id');

select side_b_id into v_w from public.tournament_games where id = v_g;
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.declare_tournament_game_winner(%L::uuid, %L::uuid, '''')', v_g, v_w)) = '22023',
  '23 (D): and deciding one needs a stated reason');
perform pg_temp.check(pg_temp.try_as(v_outsider, format('select public.declare_tournament_game_winner(%L::uuid, %L::uuid, ''Kicks'')', v_g, v_w)) = '42501',
  '24 (D): only the organiser may decide it');
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.declare_tournament_game_winner(%L::uuid, %L::uuid, ''Decided by kicks at goal'')', v_g, v_w)) = 'OK',
  '25 (D): the organiser records who went through');
perform pg_temp.check((select winner_participant_id from public.tournament_games where id = v_g) = v_w,
  '26 (D): which becomes the winner, attributed and reasoned');
perform pg_temp.check((select winner_decided_by from public.tournament_games where id = v_g) = v_ca,
  '27 (D): with the person who decided it on the record');
perform pg_temp.check((select side_a_score from public.tournament_games where id = v_g) = 12,
  '28 (D): and the SCORE is untouched -- the game was drawn, and the record still says so');

-- A DECISIVE SCORE IS NOT OVERRIDDEN by a declaration: that would be changing a result, not settling a tie.
select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 1 limit 1;
select side_b_id into v_w from public.tournament_games where id = v_g;
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.declare_tournament_game_winner(%L::uuid, %L::uuid, ''Prefer them'')', v_g, v_w)) = '22023',
  '29 (D): a game whose score already decided it cannot have its winner declared away');

-- ============ E. HISTORY IS NEVER SILENTLY REWRITTEN ============

perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.randomise_tournament_bracket(%L::uuid)', v_plan)) = '22023',
  '30 (E): redrawing a knockout that has been played is REFUSED');

select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 2 limit 1;
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 7, 15, ''Swap the winner'')', v_g)) = '22023',
  '31 (E): and so is a correction that would delete a game already played below it');
-- Two opening games, two semi-finals, the final and the third-place play-off.
select count(*) into v_n from public.tournament_games where plan_id = v_plan;
perform pg_temp.check(v_n = 6, format('32 (E): nothing was destroyed by the attempt (%s)', v_n));

-- ============ F. THE COMPETITION IS STILL ONE TOURNAMENT ============

select count(distinct game_date) into v_n from public.tournament_games where plan_id = v_plan;
perform pg_temp.check(v_n between 1 and 2,
  format('33 (F): the games fall on the competition''s own selected days, and only those (%s)', v_n));
select count(*) into v_n from public.tournament_games g
where g.plan_id = v_plan and g.game_date not in (select day_date from public.tournament_plan_days where plan_id = v_plan);
perform pg_temp.check(v_n = 0, '34 (F): no game lands on a day the competition does not play');

perform pg_temp.check(
  (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('knockout_games', 'knockout_participants', 'knockout_results', 'bracket_games')) = 0,
  '35 (F): and no second game, participant or result model was created for knockout');

-- ============ G. THE DRAW IS THE ORGANISER'S ============

perform pg_temp.check(pg_temp.try_as(v_outsider, format('select public.randomise_tournament_bracket(%L::uuid)', v_plan)) = '42501',
  '36 (G): an unrelated club cannot redraw somebody else''s competition');
perform pg_temp.check(pg_temp.try_as(v_parent, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, internal.tournament_plan_sides(v_plan))) = '42501',
  '37 (G): and nor can a parent');
perform pg_temp.check(
  pg_temp.try_as(v_outsider, format('insert into public.tournament_bracket_slots (plan_id, round_number, position) values (%L, 9, 9)', v_plan)) <> 'OK',
  '38 (G): the draw cannot be written straight from a browser -- there is no client write policy at all');

end $$;

-- ---- a second competition, to prove the draw rules without a played bracket in the way ---------------

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir_host uuid; v_ca uuid; v_venue uuid; v_t uuid; v_plan uuid;
  v_sides uuid[]; v_n int; v_i int; v_dup uuid[];
  v_read uuid[]; v_before uuid[]; v_after uuid[]; v_swapped uuid[]; v_plan_json jsonb;
begin
v_host := pg_temp.club('KO2Host');
select directory_id into v_dir_host from public.clubs where id = v_host;
v_ca := pg_temp.person('KO2CA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'KO2 Ground', 'ko2-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date - 2, current_date - 2, 'confirmed', 'KO2 Cup',
  gen_random_uuid(), 'knockout', 'private', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
for v_i in 1..8 loop
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('KO2S'||v_i), null, 'U12', 'A', 'added');
end loop;

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[(current_date - 2)::date]);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

v_sides := internal.tournament_plan_sides(v_plan);

-- ============ H. EIGHT SIDES NEED NO BYES ============

perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.randomise_tournament_bracket(%L::uuid)', v_plan)) = 'OK',
  '39 (H): an eight-side field is drawn');
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and is_bye;
perform pg_temp.check(v_n = 0, format('40 (H): with no byes at all (%s)', v_n));
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null;
perform pg_temp.check(v_n = 0, format('41 (H): and nobody through before a ball is kicked (%s)', v_n));

-- ============ I. ARRANGING A DRAW NEVER CHANGES WHO IS IN IT ============

perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, v_sides[1:7])) = '22023',
  '42 (I): a draw missing a side is refused -- entered and unplaced is nobody''s intention');
v_dup := v_sides[1:7] || v_sides[1];
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, v_dup)) = '22023',
  '43 (I): and a side placed twice is refused');
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan,
  array[v_sides[1],v_sides[2],v_sides[3],v_sides[4],v_sides[5],v_sides[6],v_sides[7],gen_random_uuid()])) = '22023',
  '44 (I): and a side from outside this competition is refused');

-- SWAPPING TWO SIDES is the same call with two entries exchanged, and changes nothing but places.
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan,
  array[v_sides[2],v_sides[1]] || v_sides[3:8])) = 'OK',
  '45 (I): swapping two sides is accepted');
select count(*) into v_n from public.tournament_participants where tournament_id = v_t;
perform pg_temp.check(v_n = 8, format('46 (I): and creates or destroys no participant (%s)', v_n));
select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and participant_id is not null;
perform pg_temp.check(v_n = 8, format('47 (I): with all eight still seated (%s)', v_n));

-- ============ J. SEEDS ARE NAMED, NEVER INFERRED ============

perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.seed_tournament_bracket(%L::uuid, %L::uuid[])', v_plan, array[v_sides[1], v_sides[2]])) = 'OK',
  '48 (J): the organiser names the seeds, and everybody else is drawn around them');
perform pg_temp.check((select draw_method from public.tournament_plans where id = v_plan) = 'seeded',
  '49 (J): and the competition records that it was seeded');
perform pg_temp.check(
  (select position from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and participant_id = v_sides[1]) = 1,
  '50 (J): seed one takes the first place');
perform pg_temp.check(
  (select (position > 4) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and participant_id = v_sides[2]),
  '51 (J): and seed two is in the OTHER half, so the top two cannot meet before the final');
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.seed_tournament_bracket(%L::uuid, %L::uuid[])', v_plan, array[v_sides[1], v_sides[1]])) = '22023',
  '52 (J): a side cannot be seeded twice');

-- Ovalball has no ranking authority, and the seeded draw must not invent one.
perform pg_temp.check(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'seed_tournament_bracket'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'tournament_table_standings|competition_points') = 0,
  '53 (J): and a seeded draw never reads Round Robin standings -- a progression between competitions is a different product idea');

-- ============ L. A DRAW IS READ BACK IN THE TERMS IT IS WRITTEN IN ============
--
-- `set_tournament_bracket_draw` takes the sides in SEED order. The bracket's games are in PLACE order,
-- and the map between the two is not the identity: an eight-place bracket plays 1v8, 4v5, 2v7, 3v6. A
-- control that read places and wrote seeds would therefore appear to exchange two sides and in fact
-- re-permute all eight through the seeding map, silently and without an error. That is not hypothetical
-- -- it is what the organiser's "move a team" control did until the draw was published in the writer's
-- own terms, and it was found by swapping two sides on an eight-side draw and watching all eight move.
--
-- Both halves are asserted, because either alone would pass a broken implementation: writing back
-- exactly what was read must change nothing, AND exchanging two entries must move those two only.

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
perform public.randomise_tournament_bracket(v_plan);
select array(select jsonb_array_elements_text(public.get_tournament_bracket(v_t, 'U12') -> 'drawOrder'))::uuid[]
  into v_read;
select array_agg(participant_id order by position) into v_before
from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and not is_third_place;
perform public.set_tournament_bracket_draw(v_plan, v_read);
select array_agg(participant_id order by position) into v_after
from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and not is_third_place;
v_dup := array[v_read[8]] || v_read[2:7] || array[v_read[1]];
perform public.set_tournament_bracket_draw(v_plan, v_dup);
select array_agg(participant_id order by position) into v_swapped
from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and not is_third_place;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

perform pg_temp.check(cardinality(v_read) = 8,
  format('54 (L): the draw is published in seed order, one entry per side (%s)', cardinality(v_read)));
perform pg_temp.check(v_before = v_after,
  '55 (L): writing the draw back exactly as it was read moves nobody');
select count(*) into v_n from unnest(v_before, v_swapped) as t(b, a) where b is distinct from a;
perform pg_temp.check(v_n = 2,
  format('56 (L): exchanging two entries moves exactly two sides, not the whole bracket (%s moved)', v_n));

-- ============ M. A PLAN READS BACK THE SETTINGS IT WAS GIVEN ============
--
-- Planning's Settings step is a set of controls over these columns and SAVES what they hold when the
-- organiser generates. A plan payload that omits them therefore does more than display defaults: the
-- step opens on the defaults and writes them back, discarding the extra time, the tie resolution, the
-- play-off and the round scheduling somebody chose earlier. So the read is asserted against a plan
-- configured away from every default, one key at a time.

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
perform public.set_tournament_knockout_settings(v_plan,
  p_tie_resolution => 'organiser_decision', p_extra_time_minutes => 7, p_third_place_playoff => true);
perform public.set_tournament_round_days(v_plan, jsonb_build_array(jsonb_build_object('round', 1, 'day', (current_date - 2)::text)));
v_plan_json := public.get_tournament_plan(v_t, 'U12') -> 'plan';
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

perform pg_temp.check(v_plan_json ->> 'tieResolution' = 'organiser_decision',
  format('57 (M): the plan reads back how a level game is settled (%s)', v_plan_json ->> 'tieResolution'));
perform pg_temp.check((v_plan_json ->> 'extraTimeMinutes')::int = 7,
  format('58 (M): and the extra time that was chosen (%s)', v_plan_json ->> 'extraTimeMinutes'));
perform pg_temp.check((v_plan_json ->> 'thirdPlacePlayoff')::boolean,
  '59 (M): and whether a third-place play-off is being run');
perform pg_temp.check((v_plan_json -> 'roundDays' -> 0 ->> 'round')::int = 1
                      and (v_plan_json -> 'roundDays' -> 0 ->> 'day')::date = current_date - 2,
  format('60 (M): and which day each round is played on (%s)', v_plan_json -> 'roundDays'));
perform pg_temp.check(v_plan_json ->> 'drawMethod' is not null,
  format('61 (M): and how the draw was made (%s)', v_plan_json ->> 'drawMethod'));

end $$;

-- =====================================================================================================
-- K. EVERY FIELD SIZE, NOT JUST THE TIDY ONES.
--
-- A junior festival turns up with whatever number of sides entered. The arithmetic that must come out
-- for every one of them:
--
--   BRACKET      the smallest power of two that seats them.
--   BYES         the places left over.
--   GAMES        exactly n - 1, because every game eliminates one side and n - 1 must be eliminated
--                before one is left standing. Plus one if there is a third-place play-off, and only
--                that.
--   SIDES        each one in the draw exactly once, and never twice in the same round.
--   PHANTOMS     none. No participant, and no club in the directory, called Bye or Winner anything.
--
-- The sizes are the brief's: 2, 3, 4, 5, 6, 7, 8, 9, 15 and 16 -- every awkward shape between the
-- powers of two, and the two boundaries either side of them.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir uuid; v_ca uuid; v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_n int; v_i int; v_size int; v_count int; v_expected int;
  v_sizes int[] := array[2, 3, 4, 5, 6, 7, 8, 9, 15, 16];
begin
v_host := pg_temp.club('KOSizes');
select directory_id into v_dir from public.clubs where id = v_host;
v_ca := pg_temp.person('KOSizesCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'KOS Ground', 'kos-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

foreach v_count in array v_sizes loop
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
    conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, v_dir, 'union', current_date - 2, current_date - 2, 'confirmed', 'KO Size ' || v_count,
    gen_random_uuid(), 'knockout', 'private', v_venue, '08:00', '20:00')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  for v_i in 1 .. v_count loop
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
    values (v_t, pg_temp.directory_only('KOS' || v_count || '-' || v_i), null, 'U12', 'A', 'added');
  end loop;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (v_t, v_pitch, current_date - 2, '08:00', '20:00', v_ca);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[(current_date - 2)::date]);
  perform public.randomise_tournament_bracket(v_plan);
  perform public.generate_tournament_knockout_fixtures(v_plan);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  v_size := internal.bracket_size(v_count);

  select count(*) into v_n from public.tournament_bracket_slots
  where plan_id = v_plan and round_number = 1 and not is_third_place;
  perform pg_temp.check(v_n = v_size,
    format('K%s.1 a field of %s is seated in a %s-place bracket (%s)', v_count, v_count, v_size, v_n));

  select count(*) into v_n from public.tournament_bracket_slots
  where plan_id = v_plan and round_number = 1 and not is_third_place and participant_id is not null;
  perform pg_temp.check(v_n = v_count,
    format('K%s.2 every one of the %s sides is drawn, and none is dropped (%s)', v_count, v_count, v_n));

  select count(*) into v_n from public.tournament_bracket_slots
  where plan_id = v_plan and round_number = 1 and not is_third_place and is_bye;
  perform pg_temp.check(v_n = v_size - v_count,
    format('K%s.3 with %s bye(s) (%s)', v_count, v_size - v_count, v_n));

  -- NO SIDE TWICE, anywhere in the draw.
  select count(*) into v_n from (
    select participant_id from public.tournament_bracket_slots
    where plan_id = v_plan and round_number = 1 and not is_third_place and participant_id is not null
    group by participant_id having count(*) > 1) x;
  perform pg_temp.check(v_n = 0, format('K%s.4 and no side drawn into two places (%s)', v_count, v_n));

  -- THE GAMES A SINGLE-ELIMINATION COMPETITION PLAYS: n - 1, whatever shape the field is.
  select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan;
  perform pg_temp.check(v_n = v_count - 1,
    format('K%s.5 the competition will play exactly %s game(s) -- one per side eliminated (%s)', v_count, v_count - 1, v_n));
  perform pg_temp.check(internal.knockout_expected_games(v_plan) = v_count - 1,
    format('K%s.6 and the planner says so before a ball is kicked', v_count));

  -- EXACTLY ONE FINAL, and nothing above it.
  select count(*) into v_n from public.tournament_bracket_slots
  where plan_id = v_plan and not is_third_place
    and round_number = internal.bracket_rounds(v_size);
  perform pg_temp.check(v_n = 2,
    format('K%s.7 and resolves to a single Final of two places (%s)', v_count, v_n));

  -- NO PHANTOMS, of either kind.
  select count(*) into v_n from public.tournament_participants where tournament_id = v_t;
  perform pg_temp.check(v_n = v_count,
    format('K%s.8 and invented no participant to make the numbers work (%s)', v_count, v_n));

  -- A THIRD-PLACE PLAY-OFF ADDS EXACTLY ONE GAME, and only where there is a semi-final to lose.
  if v_count >= 3 then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.set_tournament_knockout_settings(v_plan, p_third_place_playoff => true);
    perform public.randomise_tournament_bracket(v_plan);
    perform public.generate_tournament_knockout_fixtures(v_plan);
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan;
    perform pg_temp.check(v_n = v_count,
      format('K%s.9 turning the third-place play-off on adds exactly one game, never more (%s)', v_count, v_n));
  end if;
end loop;

select count(*) into v_n from public.club_directory where name ilike '%bye%' or name ilike 'winner %';
perform pg_temp.check(v_n = 0, 'K.10 and across every field size, no club called Bye or Winner anything was ever created');
end $$;

rollback;
