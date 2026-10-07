-- SEASON PLANNER: THE CLUB DAY (20270760000000)
--   P1-P4   the read model: canonical matching, a truthful "no matching team", clashes for one day and one week
--   P5-P9   sending: per-team outcomes, re-checked conflicts, acknowledgement, one canonical request each, notifications
--   P10-P12 replay and duplicates never double up
--   P13-P17 authority: club-scope planner only -- not team staff, not another club, not a member
--   P18-P22 the lifecycle reaches the board: accepted -> fixture (both sides), declined shows, the reverse leg
--   P23-P25 dates and opponents that cannot be planned

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','spc-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Spc',p_label,'spc-'||v::text||'@ovalball.test',(current_date - interval '40 years')::date)
  on conflict (id) do update set surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.club(p_label text, p_status text default 'active') returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SPC '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','spc-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'spc-'||v_tag,p_status) returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club,'Under '||substr(p_age,2)||' Boys','spc-'||lower(p_age)||'-'||v_tag,'youth',p_age,'boys','union',true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club,p_user,p_role,'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text) returns void language plpgsql as $$
begin
  insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership,p_team,p_role_key);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

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
  v_home uuid; v_opp uuid; v_third uuid; v_far uuid; v_ghost uuid;
  v_u9 uuid; v_u10 uuid; v_u11 uuid; v_u12 uuid;
  v_o9 uuid; v_o10 uuid; v_o12 uuid; v_t12 uuid;
  v_ca uuid; v_tm uuid; v_mb uuid; v_far_ca uuid; v_opp_tm9 uuid; v_opp_tm12 uuid; v_opp_ca uuid; v_m uuid;
  v_season uuid; v_day date; v_return date;
  v_j jsonb; v_r jsonb; v_batch uuid := gen_random_uuid(); v_req uuid; v_fixture uuid; v_n int; v_txt text;
  v_u9_req uuid; v_u12_req uuid;
begin
  v_home := pg_temp.club('Home'); v_opp := pg_temp.club('Burnley'); v_third := pg_temp.club('Warwick');
  v_far := pg_temp.club('Far'); v_ghost := pg_temp.club('Ghost', 'deactivated');
  v_u9 := pg_temp.team(v_home,'U13'); v_u10 := pg_temp.team(v_home,'U14'); v_u11 := pg_temp.team(v_home,'U15'); v_u12 := pg_temp.team(v_home,'U16');
  v_o9 := pg_temp.team(v_opp,'U13'); v_o10 := pg_temp.team(v_opp,'U14'); v_o12 := pg_temp.team(v_opp,'U16');
  v_t12 := pg_temp.team(v_third,'U16');

  v_ca := pg_temp.person('CA'); perform pg_temp.member(v_home, v_ca, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TM'); v_m := pg_temp.member(v_home, v_tm); perform pg_temp.team_role(v_m, v_u9, 'TEAM_MANAGER');
  v_mb := pg_temp.person('MB'); perform pg_temp.member(v_home, v_mb);
  v_far_ca := pg_temp.person('FARCA'); perform pg_temp.member(v_far, v_far_ca, 'CLUB_ADMIN');
  v_opp_ca := pg_temp.person('OPPCA'); perform pg_temp.member(v_opp, v_opp_ca, 'CLUB_ADMIN');
  v_opp_tm9 := pg_temp.person('OPPTM9'); v_m := pg_temp.member(v_opp, v_opp_tm9); perform pg_temp.team_role(v_m, v_o9, 'TEAM_MANAGER');
  v_opp_tm12 := pg_temp.person('OPPTM12'); v_m := pg_temp.member(v_opp, v_opp_tm12); perform pg_temp.team_role(v_m, v_o12, 'TEAM_MANAGER');

  -- A union season covering the next year (the canonical register is the only source of a season).
  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date + 20 between coalesce(pre_season_starts_on, starts_on) and ends_on
    and current_date + 80 between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('SPC Union '||v_tag, current_date-30, current_date+300, 'union',
            (select greatest(2100, coalesce(max(s.season_year_start),2099)+1) from public.seasons s where s.season_year_start >= 2100),
            'spc-'||v_tag) returning id into v_season;
  end if;
  v_day := current_date + 20;
  v_return := current_date + 62;

  -- U14 already plays somebody external that day; U16 already has a pending request with Warwick that day.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_u10, 'Away', 'Solihull RFC', v_day, 'Booked', 'club_created');
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by)
  values (v_home, 'Warwick', v_third, v_day, v_ca) returning id into v_txt;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_txt::uuid, v_u12, v_t12, 'home', 'sent', v_ca);

  -- ===== READ MODEL =====
  perform pg_temp.act(v_ca);
  v_j := public.planner_club_day(v_home, v_opp, v_day);
  perform pg_temp.check(jsonb_array_length(v_j->'teams') = 4 and (v_j->'season'->>'id') is not null,
    'P1 the planner lists the club''s four active teams and the canonical season for the date');
  perform pg_temp.check(
    (select (t->'compatible'->0->>'team_id')::uuid from jsonb_array_elements(v_j->'teams') t where (t->>'team_id')::uuid = v_u9) = v_o9,
    'P2 U13 is matched to the opponent''s U13 by canonical eligibility');
  perform pg_temp.check(
    (select jsonb_array_length(t->'compatible') from jsonb_array_elements(v_j->'teams') t where (t->>'team_id')::uuid = v_u11) = 0,
    'P3 U15 has no compatible opponent team -- nothing is invented');
  perform pg_temp.check(
    (select bool_or(w->>'kind' = 'fixture' and w->>'opponent' like '%Solihull%')
       from jsonb_array_elements(v_j->'teams') t, jsonb_array_elements(t->'week') w where (t->>'team_id')::uuid = v_u10)
    and (select bool_or(w->>'kind' = 'request_out')
       from jsonb_array_elements(v_j->'teams') t, jsonb_array_elements(t->'week') w where (t->>'team_id')::uuid = v_u12),
    'P4 the existing fixture (U14) and the pending request (U16) are both visible for that week');

  -- ===== SEND =====
  v_r := public.planner_send_club_day(v_home, v_opp, v_day, v_batch, jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u9, 'target_team_id', v_o9, 'venue_preference', 'home'),
    jsonb_build_object('requesting_team_id', v_u10, 'target_team_id', v_o10, 'venue_preference', 'away'),
    jsonb_build_object('requesting_team_id', v_u12, 'target_team_id', v_o12, 'venue_preference', 'home'),
    jsonb_build_object('requesting_team_id', v_u11, 'target_team_id', v_o12, 'venue_preference', 'away')));
  perform pg_temp.check(
    (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u9) = 'sent'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u10) = 'blocked'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u12) = 'needs_acknowledgement'
    and (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u11) = 'failed',
    'P5 per-team outcomes: U13 sent, U14 blocked by its fixture, U16 needs acknowledgement, U15 cannot play their U16');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.fixture_requests r join public.fixture_request_groups g on g.id = r.group_id
   where g.planner_batch_id = v_batch;
  perform pg_temp.check(v_n = 1, format('P6 exactly one canonical request exists for the batch (%s)', v_n));
  select r.id into v_u9_req from public.fixture_requests r join public.fixture_request_groups g on g.id = r.group_id
   where g.planner_batch_id = v_batch;
  perform pg_temp.check(
    (select r.status = 'sent' and r.venue_preference = 'home' and g.source = 'season_planner' and g.opponent_club_id = v_opp
       from public.fixture_requests r join public.fixture_request_groups g on g.id = r.group_id where r.id = v_u9_req),
    'P7 it is an ordinary sent fixture request, Home, to the opponent club, marked as planned');
  -- 20270761000000: a planned club day is announced ONCE to the receiving club's club-scope schedulers.
  perform pg_temp.check(
    (select count(*) from public.notifications where user_id = v_opp_tm9 and type in ('fixture_request_received', 'club_day_request_received')) = 0
    and (select count(*) from public.notifications where user_id = v_opp_ca and type = 'club_day_request_received'
           and data->>'group_id' = (select id::text from public.fixture_request_groups where planner_batch_id = v_batch)) = 1,
    'P8 the opponent team manager gets nothing per team; the opponent Club Admin gets one Club Day notice');
  perform pg_temp.check(
    (select count(*) from public.notifications where user_id = v_opp_tm12 and type = 'fixture_request_received') = 0,
    'P9 nobody is notified about requests that were not sent');
  -- The opponent's U14 has no staff at all: its club's Club Admin is told instead of nobody.
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day + 7, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u10, 'target_team_id', v_o10, 'venue_preference', 'home')));
  perform pg_temp.act_postgres();
  perform pg_temp.check((v_r->'results'->0->>'outcome') = 'sent'
    and (select count(*) from public.notifications where user_id = v_opp_ca and type = 'club_day_request_received'
           and data->>'group_id' = v_r->>'group_id') = 1,
    'P9b a club day for a team with no staff still reaches the opposing club''s Club Admin, once');
  perform pg_temp.check(
    (select count(*) from public.notifications where user_id = v_opp_ca and type = 'fixture_request_received'
       and data->>'fixture_request_id' = v_u9_req::text) = 0,
    'P9c a staffed team''s request still goes to its own staff only (the club admin is not copied in)');

  -- ===== REPLAY / DUPLICATES =====
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day, v_batch, jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u9, 'target_team_id', v_o9, 'venue_preference', 'home')));
  perform pg_temp.act_postgres();
  perform pg_temp.check((v_r->>'replay')::boolean
    and (select count(*) from public.fixture_requests r join public.fixture_request_groups g on g.id = r.group_id
          where g.opponent_club_id = v_opp and r.requesting_team_id = v_u9) = 1,
    'P10 the same batch sent twice (a double tap, a retry) returns the first result and creates nothing');
  perform pg_temp.act(v_ca);
  v_r := public.planner_send_club_day(v_home, v_opp, v_day, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u9, 'target_team_id', v_o9, 'venue_preference', 'away'),
    jsonb_build_object('requesting_team_id', v_u12, 'target_team_id', v_o12, 'venue_preference', 'away', 'acknowledge_pending', true)));
  perform pg_temp.check(
    (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u9) = 'blocked',
    'P11 a second planner (new batch) cannot open a second U13 request for the same day');
  perform pg_temp.check(
    (select x->>'outcome' from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u12) = 'sent',
    'P12 U16 goes once the other pending request is deliberately acknowledged');
  select (x->>'request_id')::uuid into v_u12_req from jsonb_array_elements(v_r->'results') x where (x->>'requesting_team_id')::uuid = v_u12;

  -- ===== AUTHORITY =====
  perform pg_temp.act(v_tm);
  v_txt := pg_temp.try(format('select public.planner_club_day(%L, %L, %L)', v_home, v_opp, v_day));
  perform pg_temp.check(v_txt = '42501', format('P13 a team manager (team scope) cannot open the planner (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.planner_send_club_day(%L, %L, %L, %L, %L::jsonb)', v_home, v_opp, v_day, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('requesting_team_id', v_u9, 'target_team_id', v_o9, 'venue_preference', 'home'))));
  perform pg_temp.check(v_txt = '42501', format('P14 nor mass-send, even for their own team (%s)', v_txt));
  perform pg_temp.act(v_far_ca);
  v_txt := pg_temp.try(format('select * from public.planner_season_board(%L, %L)', v_home, v_season));
  perform pg_temp.check(v_txt = '42501', format('P15 another club''s admin cannot read this club''s board (%s)', v_txt));
  perform pg_temp.act(v_mb);
  v_txt := pg_temp.try(format('select public.planner_club_day(%L, %L, %L)', v_home, v_opp, v_day));
  perform pg_temp.check(v_txt = '42501', format('P16 nor can an ordinary member (%s)', v_txt));
  perform pg_temp.act(v_ca);
  v_txt := pg_temp.try(format('select public.planner_send_club_day(%L, %L, %L, %L, %L::jsonb)', v_home, v_opp, v_day, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('requesting_team_id', v_t12, 'target_team_id', v_o12, 'venue_preference', 'home'))));
  perform pg_temp.check(v_txt = 'OK' and not exists (select 1 from public.fixture_requests where requesting_team_id = v_t12 and target_team_id = v_o12),
    'P17 a team from another club smuggled into the batch is refused (no request created)');

  -- ===== LIFECYCLE ON THE BOARD =====
  perform pg_temp.act(v_opp_tm9);
  v_fixture := public.accept_fixture_request(v_u9_req);
  perform pg_temp.act(v_ca);
  perform pg_temp.check(exists (select 1 from public.planner_season_board(v_home, v_season) b
                                where b.team_id = v_u9 and b.kind = 'fixture' and b.ref_id = v_fixture and b.the_date = v_day),
    'P18 the accepted request appears on the board as the canonical fixture');
  perform pg_temp.check(exists (select 1 from public.planner_season_board(v_home, v_season) b
                                join public.fixture_request_groups g on g.id = b.group_id
                                where b.ref_id = v_fixture and g.planner_batch_id = v_batch and b.planned),
    'P18b and keeps its planned club day, so the day still reads as one');
  perform pg_temp.act(v_opp_ca);
  perform pg_temp.check(exists (select 1 from public.planner_season_board(v_opp, v_season) b
                                where b.team_id = v_o9 and b.kind = 'fixture' and b.the_date = v_day and b.home_away = 'Away'),
    'P19 and on the OPPONENT''s board too, from their side, Away -- the opposing team of an accepted request is busy');
  perform pg_temp.act(v_opp_tm12);
  perform public.decline_fixture_request(v_u12_req);
  perform pg_temp.act(v_ca);
  perform pg_temp.check(exists (select 1 from public.planner_season_board(v_home, v_season) b
                                where b.team_id = v_u12 and b.kind = 'request_out' and b.status = 'declined' and b.ref_id = v_u12_req),
    'P20 the declined request is shown as declined');
  v_j := public.planner_club_day(v_home, v_opp, v_return);
  perform pg_temp.check(
    (select bool_or(w->>'kind' = 'fixture' and (w->>'date')::date = v_day and w->>'home_away' = 'Home')
       from jsonb_array_elements(v_j->'teams') t, jsonb_array_elements(t->'with_opponent') w where (t->>'team_id')::uuid = v_u9),
    'P21 planning the return, the first meeting is known (U13 at Home) so the reverse can invert it');
  v_r := public.planner_send_club_day(v_home, v_opp, v_return, gen_random_uuid(), jsonb_build_array(
    jsonb_build_object('requesting_team_id', v_u9, 'target_team_id', v_o9, 'venue_preference', 'away')));
  perform pg_temp.check((v_r->'results'->0->>'outcome') = 'sent',
    'P22 the return leg for U13 (Away) is sent as its own request');

  -- ===== WHAT CANNOT BE PLANNED =====
  v_txt := pg_temp.try(format('select public.planner_club_day(%L, %L, %L)', v_home, v_ghost, v_day));
  perform pg_temp.check(v_txt = 'P0002', format('P23 a club that is not on Ovalball cannot be matched or asked (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.planner_send_club_day(%L, %L, %L, %L, %L::jsonb)', v_home, v_opp, current_date - 3, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('requesting_team_id', v_u11, 'target_team_id', v_o12, 'venue_preference', 'home'))));
  perform pg_temp.check(v_txt = '22023', format('P24 a date that has passed is refused (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.planner_send_club_day(%L, %L, %L, null, %L::jsonb)', v_home, v_opp, v_day,
    jsonb_build_array(jsonb_build_object('requesting_team_id', v_u11, 'target_team_id', v_o12, 'venue_preference', 'home'))));
  perform pg_temp.check(v_txt = '22023', format('P25 a send without a batch id (no replay protection) is refused (%s)', v_txt));
  perform pg_temp.act_postgres();
end $$;

rollback;
