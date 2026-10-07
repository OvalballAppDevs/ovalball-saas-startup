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
-- A RESULT AGAINST A SIDE THAT IS NOT ON OVALBALL.
--
-- WHY THIS IS ITS OWN SUITE
--
-- Most clubs in a festival are CLUB DIRECTORY entries -- real clubs with no Ovalball account. A game
-- against one of them cannot follow the ordinary lifecycle, because confirmation needs somebody at the
-- other end and there is nobody. Found by driving the real review festival: a side submitted 10-10
-- against a directory club and the game sat in `awaiting_confirmation` for ever, waiting on a club that
-- has never heard of Ovalball.
--
-- IT IS SEPARATE FROM tournament_results DELIBERATELY. Running the two paths through one suite would
-- let a change to the ordinary lifecycle quietly satisfy the external one's assertions, which is the
-- specific failure that makes a merged suite worth less than its assertion count suggests.
--
-- WHAT IS BEING PROTECTED
--
--   * A recorded result is NEVER described as confirmed, and never implies two clubs agreed.
--   * It DOES count towards the table -- otherwise a Round Robin containing directory clubs could not
--     have a table at all, which is most festivals.
--   * Who recorded it, and when, survives.
--   * The organiser can review and correct it.
--   * The private side of the lifecycle still does not leak.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_dir_host uuid; v_dir_ext uuid; v_dir_ext2 uuid;
  v_h_u12 uuid; v_ca uuid; v_parent uuid; v_child uuid;
  v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_tbl uuid;
  v_sh uuid; v_se uuid; v_se2 uuid;
  v_game uuid; v_ext_game uuid;
  v_state text; v_json jsonb;
begin

v_host := pg_temp.club('ExtHost');
select directory_id into v_dir_host from public.clubs where id = v_host;
v_dir_ext  := pg_temp.directory_only('Directory');
v_dir_ext2 := pg_temp.directory_only('Directory Two');
v_h_u12 := pg_temp.team(v_host, 'U12');
v_ca := pg_temp.person('ExtCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_parent := pg_temp.person('ExtParent', v_adult);
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tres', 'ExtChild', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child;
insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_h_u12, 'active');
insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'TRES Ext Ground', 'tres-eg-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date - 2, current_date - 2, 'confirmed', 'TRES Ext Festival',
        gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

-- THE HOST, and TWO DIRECTORY CLUBS -- one entered the ordinary way ('added') and one deliberately
-- marked as recorded-externally. Both have NO Ovalball club, which is the fact that matters, and the
-- suite proves the two are treated the same for this purpose.
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_sh;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, squad_label, status)
values (v_t, v_dir_ext, null, null, 'U12', 'Reds', 'added') returning id into v_se;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, squad_label, status)
values (v_t, v_dir_ext2, null, null, 'U12', 'Blues', 'external_recorded') returning id into v_se2;

insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, current_date - 2, '09:00', '16:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[(current_date - 2)::date]);
perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
  jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_sh, v_se, v_se2))));
perform public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
where id = v_plan;
select id into v_tbl from public.tournament_plan_tables where plan_id = v_plan;

select id into v_game from public.tournament_games
where plan_id = v_plan and (side_a_id = v_se or side_b_id = v_se) and (side_a_id = v_sh or side_b_id = v_sh);
select id into v_ext_game from public.tournament_games
where plan_id = v_plan and side_a_id in (v_se, v_se2) and side_b_id in (v_se, v_se2);

-- ============ A. NOBODY CAN ANSWER FOR A DIRECTORY CLUB ============

perform pg_temp.check(internal.tournament_side_answerable(v_sh),
  '1 (A): a side with an active Ovalball club behind it is answerable');
perform pg_temp.check(not internal.tournament_side_answerable(v_se),
  '2 (A): a directory-only side is NOT -- even though its status is the ordinary "added"');
perform pg_temp.check(not internal.tournament_side_answerable(v_se2),
  '3 (A): and nor is one marked external_recorded');

-- THE DEFECT THIS REPLACED. `status <> ''external_recorded''` called the first directory club
-- answerable, because an organiser adding a real directory club enters it as 'added'.
perform pg_temp.check((select status from public.tournament_participants where id = v_se) = 'added'
                      and not internal.tournament_side_answerable(v_se),
  '4 (A): the two tests genuinely disagree here -- which is the defect this one replaced');

perform pg_temp.check(
  (internal.tournament_side_summary(v_se, v_host)->>'onOvalball')::boolean is false,
  '5 (A): so the shared side shape reports it as NOT on Ovalball');
perform pg_temp.check(
  (internal.tournament_side_summary(v_sh, v_host)->>'onOvalball')::boolean,
  '6 (A): and a real club as on it');

-- ============ B. ONE SIDE RECORDS, AND NOTHING IS WAITED FOR ============

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 31, 5, ''They are not on Ovalball'')', v_game)) = 'OK',
  '7 (B): the Ovalball side records the score');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'external_recorded',
  format('8 (B): and it is RECORDED, not awaiting a confirmation that can never come (%s)', v_state));

perform pg_temp.check(v_state <> 'final',
  '9 (B): and it is NOT final -- "final" means somebody agreed, and nobody did');

perform pg_temp.check((select status from public.tournament_games where id = v_game) = 'PLAYED',
  '10 (B): the game is PLAYED');

-- ============ C. IT IS HONESTLY LABELLED ============

perform pg_temp.check((select kind from public.tournament_game_result_submissions where game_id = v_game) = 'external_recorded',
  '11 (C): the audit trail names it as a recording, not as a confirmation');

perform pg_temp.check((select result_confirmed_by from public.tournament_games where id = v_game) is null,
  '12 (C): nobody is recorded as having confirmed it');

perform pg_temp.check((select result_submitted_by from public.tournament_games where id = v_game) = v_ca
                      and (select result_submitted_at from public.tournament_games where id = v_game) is not null,
  '13 (C): but WHO recorded it and WHEN both survive');

perform pg_temp.check((select result_submitted_by_participant_id from public.tournament_games where id = v_game) = v_sh,
  '14 (C): attributed to the side that recorded it');

-- ============ D. IT COUNTS TOWARDS THE TABLE ============

perform pg_temp.check(internal.tournament_result_counts('external_recorded'),
  '15 (D): a recorded result counts -- otherwise a Round Robin with directory clubs could have no table at all');

perform pg_temp.check((select played from internal.tournament_table_standings(v_tbl) where participant_id = v_sh) = 1,
  '16 (D): the Ovalball side has played one');
perform pg_temp.check((select played from internal.tournament_table_standings(v_tbl) where participant_id = v_se) = 1,
  '17 (D): and so has the directory club -- a table is about games, not accounts');
perform pg_temp.check((select points_for from internal.tournament_table_standings(v_tbl) where participant_id = v_se) = 5,
  '18 (D): with its real score against it');

-- ============ E. THE ORGANISER CAN REVIEW AND CORRECT IT ============

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 31, 12, ''Scorer''''s sheet said 12'')', v_game)) = 'OK',
  '19 (E): the organiser can correct a recorded result');

perform pg_temp.check((select result_status from public.tournament_games where id = v_game) = 'final',
  '20 (E): and their correction IS a settlement -- they ran the competition');

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game) = 2,
  '21 (E): the original recording survives alongside it');

perform pg_temp.check((select points_against from internal.tournament_table_standings(v_tbl) where participant_id = v_sh) = 12,
  '22 (E): and the table follows the corrected score');

-- ============ F. TWO SIDES THAT ARE BOTH EXTERNAL ============

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 7, 7)', v_ext_game)) = '42501',
  '23 (F): nobody may SUBMIT for a game between two clubs that are not on Ovalball');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 7, 7, ''Recorded at the desk'')', v_ext_game)) = 'OK',
  '24 (F): but the organiser records it, because they were there');

perform pg_temp.check((select result_status from public.tournament_games where id = v_ext_game) = 'final',
  '25 (F): as a settled result -- the organiser''s own record of their own competition');

-- ============ G. THE PRIVATE SIDE STILL DOES NOT LEAK ============

perform pg_temp.check(pg_temp.json_as(v_parent, format('select public.get_tournament_game_result(%L::uuid)', v_game)) is null,
  '26 (G): a parent cannot read the recording, its note or who made it');

-- THE THIRD GAME: the host against the side whose STATUS is external_recorded, to prove the two kinds
-- of directory club take the same route. The status is not what decides it; having no club is.
select id into v_game from public.tournament_games
where plan_id = v_plan and result_status = 'none'
  and (side_a_id = v_se2 or side_b_id = v_se2) and (side_a_id = v_sh or side_b_id = v_sh);
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 19, 0)', v_game)) = 'OK',
  '27 (G): a side whose status is external_recorded takes the same route as one merely added');
perform pg_temp.check((select result_status from public.tournament_games where id = v_game) = 'external_recorded',
  '28 (G): and is recorded, not awaited');

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''confirmed'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'games') = 3,
  format('29 (G): the organiser''s settled filter now holds all three games (%s)', jsonb_array_length(v_json->'games')));

-- ============ H. AND IT IS NEVER CALLED CONFIRMED ============
--
-- The word is the product's promise. Asserted against the one place the vocabulary is defined, so a
-- screen cannot be relabelled without this failing.

perform pg_temp.check(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'tournament_result_counts'
     and p.prosrc like '%external_recorded%') = 1,
  '30 (H): external_recorded is named in the counting rule, so it is a deliberate inclusion rather than an accident');

end $$;

rollback;
