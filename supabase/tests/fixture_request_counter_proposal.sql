-- =====================================================================================================
-- FIXTURE REQUEST COUNTER-PROPOSAL (CA-M11.5) -- counter_fixture_request / accept_fixture_request
--
-- Self-seeding, self-contained. Two clubs, two teams, a real fixture_requests row, and the full
-- negotiation state machine: counter, counter-again, accept-of-counter, stale-proposal protection,
-- authority (own side cannot accept its own counter; unrelated club cannot touch it), and the scope
-- boundaries (a scheduling-group target and an existing-fixture-confirmation request cannot be countered).
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','frc-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email) values (v,'FRC',p_label,'frc-'||v::text||'@ovalball.test');
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir_a uuid; v_club_a uuid; v_team_a uuid;
  v_dir_b uuid; v_club_b uuid; v_team_b uuid;
  v_dir_c uuid; v_club_c uuid;
  v_ca_a uuid; v_ca_b uuid; v_ca_c uuid; v_stranger uuid;
  v_group uuid; v_req uuid;
  v_result text;
  v_status text; v_cdate date; v_ctime time; v_last_proposer uuid; v_updated_at timestamptz;
  v_fixture uuid;
begin
  -- ---------------------------------------------------------------------------------------------
  -- Setup: two clubs each with one U12 team, a third unrelated club, a Club Admin of each, a stranger.
  -- ---------------------------------------------------------------------------------------------
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRC A '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','frc-a-'||v_tag)
  returning id into v_dir_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'frc-a-'||v_tag,'active') returning id into v_club_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a,'Under 12 Boys','frc-a-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_a;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRC B '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','frc-b-'||v_tag)
  returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'frc-b-'||v_tag,'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b,'Under 12 Boys','frc-b-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_b;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRC C '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','frc-c-'||v_tag)
  returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c,'frc-c-'||v_tag,'active') returning id into v_club_c;

  v_ca_a := pg_temp.person('ClubAdminA');
  v_ca_b := pg_temp.person('ClubAdminB');
  v_ca_c := pg_temp.person('ClubAdminC');
  v_stranger := pg_temp.person('Stranger');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_a,v_ca_a,'CLUB_ADMIN','active');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_b,v_ca_b,'CLUB_ADMIN','active');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_c,v_ca_c,'CLUB_ADMIN','active');

  -- ---------------------------------------------------------------------------------------------
  -- A. Real request: A -> B, Saturday, 10:00.
  -- ---------------------------------------------------------------------------------------------
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, game_type, created_by)
  values (v_club_a, 'FRC B RUFC', v_club_b, date '2027-03-06', 'Friendly', v_ca_a)
  returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, preferred_kickoff_time, status, created_by)
  values (v_group, v_team_a, v_team_b, 'home', time '10:00', 'sent', v_ca_a)
  returning id into v_req;

  -- ---------------------------------------------------------------------------------------------
  -- B. AUTHORITY: an unrelated club and a stranger cannot counter.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca_c, format('select public.counter_fixture_request(%L,%L,%L,''away'',null)', v_req, date '2027-03-06', time '11:00'));
  perform pg_temp.check(v_result = '42501', 'B1: an unrelated club cannot counter this request');
  v_result := pg_temp.try_as(v_stranger, format('select public.counter_fixture_request(%L,%L,%L,''away'',null)', v_req, date '2027-03-06', time '11:00'));
  perform pg_temp.check(v_result = '42501', 'B2: a stranger cannot counter this request');

  -- The requesting side (A) cannot counter their OWN standing proposal -- it is not their turn.
  v_result := pg_temp.try_as(v_ca_a, format('select public.counter_fixture_request(%L,%L,%L,''away'',null)', v_req, date '2027-03-06', time '11:00'));
  perform pg_temp.check(v_result = '42501', 'B3: the requesting club cannot counter its own standing proposal -- it is the target''s turn');

  -- ---------------------------------------------------------------------------------------------
  -- C. B counters: 11:00 instead of 10:00.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca_b, format('select public.counter_fixture_request(%L,%L,%L,''away'',%L)', v_req, date '2027-03-06', time '11:00', 'Can''t do 10 o''clock'));
  perform pg_temp.check(v_result = 'OK', 'C1: the target club (B) CAN counter the standing proposal');

  select status, countered_date, countered_kickoff_time, last_proposed_by_team_id into v_status, v_cdate, v_ctime, v_last_proposer from public.fixture_requests where id = v_req;
  perform pg_temp.check(v_status = 'counter_proposed', 'C2: status moves to counter_proposed');
  perform pg_temp.check(v_cdate = date '2027-03-06' and v_ctime = time '11:00', 'C3: the standing proposal reflects B''s counter exactly');
  perform pg_temp.check(v_last_proposer = v_team_b, 'C4: last_proposed_by_team_id is now B -- it is A''s turn next');

  -- Original proposal untouched (Section 20: never destroyed).
  perform pg_temp.check((select preferred_kickoff_time from public.fixture_requests where id = v_req) = time '10:00', 'C5: the ORIGINAL preferred_kickoff_time is untouched by the counter');
  perform pg_temp.check((select proposed_date from public.fixture_request_groups where id = v_group) = date '2027-03-06', 'C6: the original proposed_date on the group is untouched');

  -- ---------------------------------------------------------------------------------------------
  -- D. NOW B cannot accept/counter their own standing counter -- it is A's turn.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca_b, format('select public.accept_fixture_request(%L)', v_req));
  perform pg_temp.check(v_result = '42501', 'D1: B cannot accept their own standing counter-proposal');
  v_result := pg_temp.try_as(v_ca_b, format('select public.counter_fixture_request(%L,%L,%L,''away'',null)', v_req, date '2027-03-06', time '12:00'));
  perform pg_temp.check(v_result = '42501', 'D2: B cannot counter their own standing counter-proposal either');

  -- ---------------------------------------------------------------------------------------------
  -- E. STALE PROPOSAL PROTECTION (Section 63): A holds a stale updated_at from BEFORE B's counter
  -- and tries to accept against it -- refused, never silently accepting the new terms.
  -- ---------------------------------------------------------------------------------------------
  select (updated_at - interval '1 hour') into v_updated_at from public.fixture_requests where id = v_req;
  v_result := pg_temp.try_as(v_ca_a, format('select public.accept_fixture_request(%L, null, %L)', v_req, v_updated_at));
  perform pg_temp.check(v_result = '40001', 'E1: accepting against a stale expected_updated_at is refused (40001)');
  perform pg_temp.check((select status from public.fixture_requests where id = v_req) = 'counter_proposed', 'E2: the stale attempt changed nothing -- still counter_proposed');

  -- ---------------------------------------------------------------------------------------------
  -- F. A counters BACK: a second round (Sat 3 Mar 2027 instead -- a different Saturday entirely).
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca_a, format('select public.counter_fixture_request(%L,%L,%L,''home'',null)', v_req, date '2027-03-13', time '10:30'));
  perform pg_temp.check(v_result = 'OK', 'F1: A can counter B''s counter -- a genuine back-and-forth');
  select last_proposed_by_team_id into v_last_proposer from public.fixture_requests where id = v_req;
  perform pg_temp.check(v_last_proposer = v_team_a, 'F2: last_proposed_by_team_id flips back to A -- now B''s turn');

  -- A cannot accept their own second-round counter either.
  v_result := pg_temp.try_as(v_ca_a, format('select public.accept_fixture_request(%L)', v_req));
  perform pg_temp.check(v_result = '42501', 'F3: A cannot accept their own second-round counter');

end $$;

-- G. B ACCEPTS the current (second-round) standing proposal -- exactly one canonical fixture, using the
-- CURRENT standing values (13 March, 10:30), never the original (6 March, 10:00) or the first counter
-- (6 March, 11:00). A separate do-block so the earlier one's declared-but-unused v_fixture is not an issue.

-- Run acceptance as B, outside the DO block's implicit role so pg_temp.try_as's SET/RESET applies cleanly.
do $$
declare
  v_req uuid;
  v_ca_b uuid;
  v_fixture uuid;
  v_kickoff_date date;
  v_kickoff_time time;
begin
  select id into v_req from public.fixture_requests where status = 'counter_proposed' order by created_at desc limit 1;
  select user_id into v_ca_b from public.club_memberships cm
    join public.teams t on t.club_id = cm.club_id
    where t.id = (select target_team_id from public.fixture_requests where id = v_req) and cm.role = 'CLUB_ADMIN' limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_ca_b,'role','authenticated')::text, true);
  v_fixture := public.accept_fixture_request(v_req);
  perform set_config('request.jwt.claims','', true);

  perform pg_temp.check(v_fixture is not null, 'G1: acceptance creates a fixture');
  select kickoff_date, kickoff_time into v_kickoff_date, v_kickoff_time from public.fixtures where id = v_fixture;
  perform pg_temp.check(v_kickoff_date = date '2027-03-13' and v_kickoff_time = time '10:30', 'G2: the fixture uses the CURRENT standing (second-round) proposal, not the original or the first counter');
  perform pg_temp.check((select status from public.fixture_requests where id = v_req) = 'accepted', 'G3: the request itself is now accepted');

  perform pg_temp.check(
    (select count(*) from public.fixtures f where f.owning_team_id = (select requesting_team_id from public.fixture_requests where id = v_req) and f.kickoff_date = date '2027-03-13') = 1,
    'G4: exactly one fixture exists -- no duplicate from the multi-round negotiation'
  );
end $$;

-- ---------------------------------------------------------------------------------------------
-- H. HISTORY (Section 20/59): the negotiation survives acceptance and is readable in order.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_req uuid;
  v_ca_a uuid;
  v_row_count int;
begin
  select id into v_req from public.fixture_requests where status = 'accepted' order by decided_at desc limit 1;
  select cm.user_id into v_ca_a from public.club_memberships cm
    join public.teams t on t.club_id = cm.club_id
    where t.id = (select requesting_team_id from public.fixture_requests where id = v_req) and cm.role = 'CLUB_ADMIN' limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_ca_a,'role','authenticated')::text, true);
  select count(*) into v_row_count from public.fixture_request_history(v_req);
  perform set_config('request.jwt.claims','', true);

  perform pg_temp.check(v_row_count >= 4, 'H1: the history has at least one entry per state transition (insert, 2 counters, accept)');
end $$;

do $$
declare
  v_req uuid;
  v_stranger uuid;
  v_result text;
begin
  select id into v_req from public.fixture_requests where status = 'accepted' order by decided_at desc limit 1;
  v_stranger := pg_temp.person('HistoryStranger');
  v_result := pg_temp.try_as(v_stranger, format('select count(*) from public.fixture_request_history(%L)', v_req));
  perform pg_temp.check(v_result = '42501', 'H2: an unrelated stranger cannot read the negotiation history');
end $$;

-- ---------------------------------------------------------------------------------------------
-- I. SCOPE BOUNDARIES: a counter is refused for the two paths this pass deliberately does not extend.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir_a uuid; v_club_a uuid; v_team_a uuid;
  v_ca_a uuid;
  v_group uuid; v_req_group_target uuid; v_req_existing uuid;
  v_sched_group uuid;
  v_fixture uuid;
  v_result text;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRC I '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','frc-i-'||v_tag)
  returning id into v_dir_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'frc-i-'||v_tag,'active') returning id into v_club_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a,'Under 12 Boys','frc-i-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_a;
  v_ca_a := pg_temp.person('ScopeBoundaryOwner');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_a,v_ca_a,'CLUB_ADMIN','active');

  -- I1: a request targeting a scheduling group (target_team_id null) cannot be countered.
  insert into public.scheduling_groups (club_id, display_tag, season_id, created_by)
  values (v_club_a, 'FRC I Mini Group', (select id from public.seasons where '2027-04-03' between starts_on and ends_on limit 1), v_ca_a) returning id into v_sched_group;
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, proposed_date, game_type, created_by)
  values (v_club_a, 'Some opponent', date '2027-04-03', 'Friendly', v_ca_a) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by)
  values (v_group, v_team_a, v_sched_group, 'home', 'sent', v_ca_a) returning id into v_req_group_target;
  v_result := pg_temp.try_as(v_ca_a, format('select public.counter_fixture_request(%L,%L,null,''away'',null)', v_req_group_target, date '2027-04-10'));
  perform pg_temp.check(v_result <> 'OK', 'I1: a scheduling-group-targeted request cannot be countered (out of this pass''s scope)');

  -- I2: an existing-fixture-confirmation request cannot be countered.
  insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, created_by, updated_by)
  values (v_team_a, date '2027-04-17', time '10:00', 'Home', 'Booked', 'TBC opponent', v_ca_a, v_ca_a) returning id into v_fixture;
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, proposed_date, game_type, created_by)
  values (v_club_a, 'Confirm which team', date '2027-04-17', 'Friendly', v_ca_a) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, existing_fixture_id, venue_preference, status, created_by)
  values (v_group, v_team_a, v_team_a, v_fixture, 'home', 'sent', v_ca_a) returning id into v_req_existing;
  v_result := pg_temp.try_as(v_ca_a, format('select public.counter_fixture_request(%L,%L,null,''away'',null)', v_req_existing, date '2027-04-24'));
  perform pg_temp.check(v_result <> 'OK', 'I2: an existing-fixture-confirmation request cannot be countered');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
