-- SEASON PLANNER: A CLUB DAY ANSWERED AS ONE (20270761000000)
--   G1-G3   one grouped notice to the receiving club's club-scope schedulers; nothing per team; no player detail
--   G4-G6   the club day as either club sees it; nobody else does
--   G7-G13  answering: a note on one fixture, decline one, a suggested date survives Accept All, Accept All, retries;
--           answering in several goes leaves one live summary notice (G10b); the history quotes the right club (G10c)
--           and double taps change nothing, a scheduling conflict fails honestly, one grouped notice back
--   G14-G15 Decline All; the planning club cannot answer its own club day
--   G16-G18 the return club day is linked to the day it returns; the list of club days counts each state
--   G19-G25 playing days: club, kind of team, team override; authority; an ad-hoc weekday is still allowed
--   G26-G28 fallback recipients; an ordinary request is still notified per team; the opponent side of a fixture blocks

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','spg-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Spg',p_label,'spg-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SPG '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','spg-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'spg-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  select p_club, 'SPG '||p_key, 'spg-'||p_key||'-'||v_tag, c.category, c.age_group, c.gender, 'union', c.id, true
    from public.canonical_team_types_by_code c where c.rugby_code = 'union' and c.key = p_key returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club,p_user,p_role,'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text) returns void language plpgsql as $$
begin insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership,p_team,p_role_key); end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if; end $$;

create or replace function pg_temp.act(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
end $$;
create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.act(uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_home uuid; v_opp uuid; v_far uuid; v_bare uuid;
  v_u13 uuid; v_u14 uuid; v_u15 uuid; v_u16 uuid; v_men uuid;
  v_o13 uuid; v_o14 uuid; v_o15 uuid; v_o16 uuid; v_b13 uuid;
  v_ca uuid; v_fs uuid; v_tm uuid; v_opp_ca uuid; v_opp_fs uuid; v_opp_tm13 uuid; v_far_ca uuid; v_bare_tm uuid; v_m uuid;
  v_season uuid; v_day date; v_day2 date; v_return date; v_wed date;
  v_r jsonb; v_j jsonb; v_group uuid; v_group2 uuid; v_return_group uuid; v_txt text; v_n int;
  r13 uuid; r14 uuid; r15 uuid; r16 uuid; v_notes_before int;
begin
  v_home := pg_temp.club('Ashby'); v_opp := pg_temp.club('Burnley'); v_far := pg_temp.club('Far'); v_bare := pg_temp.club('Bare');
  v_u13 := pg_temp.team(v_home,'u13'); v_u14 := pg_temp.team(v_home,'u14'); v_u15 := pg_temp.team(v_home,'u15'); v_u16 := pg_temp.team(v_home,'u16');
  v_men := pg_temp.team(v_home,'mens_1st');
  v_o13 := pg_temp.team(v_opp,'u13'); v_o14 := pg_temp.team(v_opp,'u14'); v_o15 := pg_temp.team(v_opp,'u15'); v_o16 := pg_temp.team(v_opp,'u16');
  v_b13 := pg_temp.team(v_bare,'u13');

  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_home, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FS'); perform pg_temp.member(v_home, v_fs, 'FIXTURE_SECRETARY');
  v_tm := pg_temp.person('TM'); v_m := pg_temp.member(v_home, v_tm); perform pg_temp.team_role(v_m, v_u13, 'TEAM_MANAGER');
  v_opp_ca := pg_temp.person('OPPCA'); perform pg_temp.member(v_opp, v_opp_ca, 'CLUB_ADMIN');
  v_opp_fs := pg_temp.person('OPPFS'); perform pg_temp.member(v_opp, v_opp_fs, 'FIXTURE_SECRETARY');
  v_opp_tm13 := pg_temp.person('OPPTM13'); v_m := pg_temp.member(v_opp, v_opp_tm13); perform pg_temp.team_role(v_m, v_o13, 'TEAM_MANAGER');
  v_far_ca := pg_temp.person('FARCA'); perform pg_temp.member(v_far, v_far_ca, 'CLUB_ADMIN');
  -- A club with nobody holding club-scope authority: only a team manager.
  v_bare_tm := pg_temp.person('BARETM'); v_m := pg_temp.member(v_bare, v_bare_tm); perform pg_temp.team_role(v_m, v_b13, 'TEAM_MANAGER');

  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date + 20 between coalesce(pre_season_starts_on, starts_on) and ends_on
    and current_date + 90 between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('SPG Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'spg-'||v_tag) returning id into v_season;
  end if;
  v_day := current_date + 21; v_day2 := current_date + 28; v_return := current_date + 70;
  v_wed := current_date + 30 + ((3 - extract(isodow from current_date + 30)::int + 7) % 7);

  -- ===== SEND: ONE NOTICE =====
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u13, 'target_team_id', v_o13, 'venue_preference', 'home', 'note', 'Pitch 2 if possible'),
    jsonb_build_object('requesting_team_id', v_u14, 'target_team_id', v_o14, 'venue_preference', 'away'),
    jsonb_build_object('requesting_team_id', v_u15, 'target_team_id', v_o15, 'venue_preference', 'home'),
    jsonb_build_object('requesting_team_id', v_u16, 'target_team_id', v_o16, 'venue_preference', 'away')));
  v_group := (v_r->>'group_id')::uuid;
  perform pg_temp.act_postgres();
  select r.id into r13 from public.fixture_requests r where r.group_id = v_group and r.requesting_team_id = v_u13;
  select r.id into r14 from public.fixture_requests r where r.group_id = v_group and r.requesting_team_id = v_u14;
  select r.id into r15 from public.fixture_requests r where r.group_id = v_group and r.requesting_team_id = v_u15;
  select r.id into r16 from public.fixture_requests r where r.group_id = v_group and r.requesting_team_id = v_u16;
  perform pg_temp.check(
    (select count(*) from public.notifications where type = 'club_day_request_received' and data->>'group_id' = v_group::text and user_id = v_opp_ca) = 1
    and (select count(*) from public.notifications where type = 'club_day_request_received' and data->>'group_id' = v_group::text and user_id = v_opp_fs) = 1
    and (select count(*) from public.notifications where type = 'club_day_request_received' and data->>'group_id' = v_group::text) = 2,
    'G1 four fixtures, ONE Club Day notice each to the receiving Club Admin and Fixture Secretary (club-scope respond)');
  perform pg_temp.check(
    (select count(*) from public.notifications where user_id = v_opp_tm13 and type in ('fixture_request_received', 'club_day_request_received')) = 0
    and (select count(*) from public.notifications where user_id in (v_ca, v_fs, v_tm)) = 0,
    'G2 no per-team notice to the receiving team staff, and nothing back to the planning club or its teams');
  perform pg_temp.check(
    (select body from public.notifications where type = 'club_day_request_received' and user_id = v_opp_ca and data->>'group_id' = v_group::text) like '%4 fixtures%'
    and (select body from public.notifications where type = 'club_day_request_received' and user_id = v_opp_ca and data->>'group_id' = v_group::text) not like '%SPG u1%',
    'G3 the notice names a club, a count and a date -- no team or player');

  -- ===== WHO SEES IT =====
  perform pg_temp.act(v_opp_ca);
  v_j := public.planner_club_day_detail(v_group);
  perform pg_temp.check(v_j->>'side' = 'received' and jsonb_array_length(v_j->'fixtures') = 4
    and (select f->>'note' from jsonb_array_elements(v_j->'fixtures') f where (f->>'request_id')::uuid = r13) = 'Pitch 2 if possible',
    'G4 the receiving club sees the club day, all four fixtures and the planner''s note on U13');
  perform pg_temp.act(v_fs);
  perform pg_temp.check((public.planner_club_day_detail(v_group))->>'side' = 'sent', 'G5 the planning club''s Fixture Secretary sees it as sent');
  perform pg_temp.act(v_far_ca);
  v_txt := pg_temp.try(format('select public.planner_club_day_detail(%L)', v_group));
  perform pg_temp.act(v_opp_tm13);
  perform pg_temp.check(v_txt = 'P0002' and pg_temp.try(format('select public.planner_club_day_detail(%L)', v_group)) = 'P0002',
    'G6 another club and a team-scope manager get the same "not found" as a missing club day');

  -- ===== ANSWERING =====
  perform pg_temp.act(v_opp_ca);
  perform public.planner_note_club_day_fixture(r15, 'Could this kick off at 10:30?');
  v_r := public.planner_respond_club_day(v_group, 'decline', array[r14], jsonb_build_object(r14::text, 'Our U14 are away on tour'));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status from public.fixture_requests where id = r14) = 'declined'
    and (select response_note from public.fixture_requests where id = r14) = 'Our U14 are away on tour'
    and (select response_note from public.fixture_requests where id = r15) = 'Could this kick off at 10:30?'
    and (select group_id from public.fixture_requests where id = r14) = v_group,
    'G7 one fixture declined with its own note; another carries a note without an answer; both stay in the club day');
  perform pg_temp.check(
    (select count(*) from public.notifications where type = 'fixture_request_declined' and data->>'fixture_request_id' = r14::text) = 0
    and (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text and user_id = v_ca) = 1
    and (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text) = 2,
    'G8 the planning club hears once (Club Admin and Fixture Secretary), not with a per-fixture decline');
  -- U16: Burnley suggest another date through the canonical counter-proposal.
  perform pg_temp.act(v_opp_ca);
  perform public.counter_fixture_request(r16, v_day + 1, '10:30'::time, 'home', 'Saturday suits us better');
  -- U15's opponent team now has a fixture that day elsewhere: accepting it must fail honestly.
  perform pg_temp.act_postgres();
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_o15, 'Home', 'Somebody Else RFC', v_day, 'Booked', 'club_created');
  perform pg_temp.act(v_opp_fs);
  v_r := public.planner_respond_club_day(v_group, 'accept');
  perform pg_temp.check(
    (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'request_id')::uuid = r13) = 'accepted'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'request_id')::uuid = r14) = 'already_resolved'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'request_id')::uuid = r16) = 'not_actionable'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'request_id')::uuid = r15) = 'failed',
    'G9 Accept All: U13 accepted, the declined U14 untouched, the suggested date on U16 left for its own answer, U15 fails on the clash');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status from public.fixture_requests where id = r14) = 'declined'
    and (select status from public.fixture_requests where id = r16) = 'counter_proposed'
    and (select status from public.fixture_requests where id = r15) = 'sent'
    and (select resulting_fixture_id from public.fixture_requests where id = r13) is not null
    and (select f.owning_team_id from public.fixtures f join public.fixture_requests r on r.resulting_fixture_id = f.id where r.id = r13) = v_u13,
    'G10 the canonical states are exactly that: one fixture created through the canonical accept, nothing overwritten');
  perform pg_temp.check(
    (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text and user_id = v_ca) = 1
    and (select body from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text and user_id = v_ca) like '%1 accepted · 1 declined%',
    'G10b answering in two goes leaves ONE live summary for the planning club, describing the club day as it now stands');
  perform pg_temp.act(v_opp_ca);
  perform pg_temp.check(
    -- Asserted on each TRANSITION, never on "latest": every change in one transaction shares its timestamp.
    exists (select 1 from public.fixture_request_history(r13) h where h.status_before = 'sent' and h.status_after = 'accepted' and h.note_after is null)
    and not exists (select 1 from public.fixture_request_history(r13) h where h.status_before is not null and h.note_after = 'Pitch 2 if possible')
    and exists (select 1 from public.fixture_request_history(r13) h where h.status_before is null and h.note_after = 'Pitch 2 if possible')
    and exists (select 1 from public.fixture_request_history(r14) h where h.status_before = 'sent' and h.status_after = 'declined' and h.note_after = 'Our U14 are away on tour'),
    'G10c the history quotes each club''s own words: the planner''s note on the request, the answering club''s on its decline, none on a plain accept');
  perform pg_temp.act_postgres();
  v_n := (select count(*) from public.fixtures where owning_team_id = v_u13 and kickoff_date = v_day);
  v_notes_before := (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text);
  perform pg_temp.act(v_opp_ca);
  v_r := public.planner_respond_club_day(v_group, 'accept');
  v_r := public.planner_respond_club_day(v_group, 'accept');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select count(*) from public.fixtures where owning_team_id = v_u13 and kickoff_date = v_day) = v_n
    and (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text) = v_notes_before,
    'G11 Accept All again (a retry, a double tap, a second admin) creates no fixture and no notice');
  perform pg_temp.check((v_r->'summary'->>'accepted')::int = 1 and (v_r->'summary'->>'declined')::int = 1
    and (v_r->'summary'->>'pending')::int = 1 and (v_r->'summary'->>'countered')::int = 1,
    'G12 the summary tells the truth: 1 accepted, 1 declined, 1 awaiting, 1 with a suggested date');
  perform pg_temp.check(
    (select count(*) from public.notifications n where n.type = 'fixture_request_accepted' and n.data->>'fixture_request_id' = r13::text and n.user_id in (v_ca, v_fs, v_opp_ca, v_opp_fs)) = 0,
    'G13 accepting through the club day does not copy the club schedulers into each team''s "fixture confirmed"');

  -- ===== DECLINE ALL / WRONG SIDE =====
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day2, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u13, 'target_team_id', v_o13, 'venue_preference', 'away'),
    jsonb_build_object('requesting_team_id', v_u14, 'target_team_id', v_o14, 'venue_preference', 'home')));
  v_group2 := (v_r->>'group_id')::uuid;
  v_txt := pg_temp.try(format('select public.planner_respond_club_day(%L, ''accept'')', v_group2));
  perform pg_temp.check(v_txt = 'P0002', format('G14 the planning club cannot answer its own club day (%s)', v_txt));
  perform pg_temp.act(v_opp_ca);
  v_r := public.planner_respond_club_day(v_group2, 'decline');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select count(*) from public.fixture_requests where group_id = v_group2 and status = 'declined') = 2
    and (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group2::text and user_id = v_ca) = 1,
    'G15 Decline All declines both and tells the planning club once');

  -- ===== THE RETURN CLUB DAY =====
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_return, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u13, 'target_team_id', v_o13, 'venue_preference', 'away'),
    jsonb_build_object('requesting_team_id', v_u14, 'target_team_id', v_o14, 'venue_preference', 'home')), v_group);
  v_return_group := (v_r->>'group_id')::uuid;
  perform pg_temp.check((select reverse_of_group_id from public.fixture_request_groups where id = v_return_group) = v_group
    and (public.planner_club_day_detail(v_group))->'return_group_ids' ? v_return_group::text,
    'G16 the return club day records the day it returns, and that day knows its return (including the once-declined U14)');
  perform pg_temp.act(v_far_ca);
  perform pg_temp.check(pg_temp.try(format('select public.planner_send_club_day(%L, %L, %L, %L, %L::jsonb, %L)', v_far, v_opp, v_return, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('requesting_team_id', v_u13, 'target_team_id', v_o13, 'venue_preference', 'away')), v_group)) = '22023',
    'G17 another club cannot hang its club day off this club''s');
  perform pg_temp.act(v_ca);
  perform pg_temp.check(
    (select accepted = 1 and declined = 1 and pending = 1 and countered = 1 and total = 4 and direction = 'sent' and has_return
       from public.planner_club_days(v_home, v_season) d where d.group_id = v_group),
    'G18 the planning club''s list counts the club day''s own states and knows it has a return');
  perform pg_temp.act(v_opp_ca);
  perform pg_temp.check(exists (select 1 from public.planner_club_days(v_opp, v_season) d where d.group_id = v_group and d.direction = 'received'),
    'G18b and the receiving club sees the same club day as received');

  -- ===== PLAYING DAYS =====
  perform pg_temp.act(v_ca);
  perform public.set_club_playing_days(v_home, 7::smallint, 6::smallint, null, null, null);
  perform public.set_team_playing_day(v_u15, 3::smallint);
  v_j := public.planner_playing_days(v_home);
  perform pg_temp.check((v_j->>'club_default')::int = 7 and (v_j->'categories'->>'senior_mens')::int = 6,
    'G19 the club default (Sunday) and the senior men''s default (Saturday) are kept');
  perform pg_temp.check(
    (select (t->>'effective')::int = 6 and t->>'source' = 'category' from jsonb_array_elements(v_j->'teams') t where (t->>'team_id')::uuid = v_men)
    and (select (t->>'effective')::int = 3 and t->>'source' = 'team' from jsonb_array_elements(v_j->'teams') t where (t->>'team_id')::uuid = v_u15)
    and (select (t->>'effective')::int = 7 and t->>'source' = 'club' from jsonb_array_elements(v_j->'teams') t where (t->>'team_id')::uuid = v_u13),
    'G20 each team resolves: its own override (U15 Wednesday), else its kind (senior men Saturday), else the club (Sunday)');
  perform pg_temp.check(
    (select (t->>'preferred_day')::int from jsonb_array_elements((public.planner_club_day(v_home, v_opp, v_return))->'teams') t where (t->>'team_id')::uuid = v_u15) = 3,
    'G21 the club-day read model carries each team''s playing day');
  perform public.set_team_playing_day(v_u15, null);
  perform pg_temp.check(
    (select (t->>'effective')::int from jsonb_array_elements((public.planner_playing_days(v_home))->'teams') t where (t->>'team_id')::uuid = v_u15) = 7,
    'G22 clearing the override returns the team to the club default');
  perform pg_temp.act(v_tm);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_playing_days(%L, 3::smallint)', v_home)) = '42501'
    and pg_temp.try(format('select public.set_team_playing_day(%L, 3::smallint)', v_u13)) = '42501'
    and pg_temp.try(format('select public.planner_playing_days(%L)', v_home)) = '42501',
    'G23 a team manager can neither read nor set the club''s playing days, even for their own team');
  perform pg_temp.act(v_far_ca);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_playing_days(%L, 3::smallint)', v_home)) = '42501',
    'G24 nor can another club''s admin');
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_wed, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u16, 'target_team_id', v_o16, 'venue_preference', 'home')));
  perform pg_temp.check((v_r->'results'->0->>'outcome') = 'sent', 'G25 a Wednesday club day is still allowed: the playing day is a preference');

  -- ===== RECIPIENTS AND THE ORDINARY PATH =====
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_bare, v_day + 12, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u13, 'target_team_id', v_b13, 'venue_preference', 'home')));
  perform pg_temp.act_postgres();
  perform pg_temp.check((v_r->'results'->0->>'outcome') = 'sent' and
    (select count(*) from public.notifications where type = 'club_day_request_received' and user_id = v_bare_tm and data->>'group_id' = v_r->>'group_id') = 1,
    'G26 a club with nobody holding club-scope authority is told through its team staff, once');
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by)
  values (v_home, 'Burnley', v_opp, v_day + 3, v_ca) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group, v_u13, v_o13, 'home', 'sent', v_ca) returning id into r13;
  perform pg_temp.check((select count(*) from public.notifications where type = 'fixture_request_received' and data->>'fixture_request_id' = r13::text and user_id = v_opp_tm13) = 1,
    'G27 an ordinary (non-planner) fixture request still notifies the team''s staff exactly as before');
  -- U14 is the OPPOSING team of a Burnley fixture on another date: the planner sees it and will not double-book.
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_o14, v_u14, 'Home', 'SPG Ashby', v_day + 5, 'Booked', 'club_created');
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day + 5, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u14, 'target_team_id', v_o14, 'venue_preference', 'home')));
  perform pg_temp.check((v_r->'results'->0->>'outcome') = 'blocked' and (v_r->'results'->0->>'reason') like 'Already playing%',
    'G28 a team that is the opponent side of a fixture that day cannot be sent');
  perform pg_temp.act_postgres();
end $$;

rollback;
