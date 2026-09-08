-- An adult registers themselves, asks a club to accept them, and one authorised
-- person resolves it.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_udir uuid; v_uclub uuid; v_ldir uuid; v_lclub uuid;
  v_adult uuid := gen_random_uuid();
  v_adult2 uuid := gen_random_uuid();
  v_clubmgr uuid := gen_random_uuid();
  v_teammgr uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_clubmgr_m uuid; v_teammgr_m uuid;
  v_1st uuid; v_2nd uuid; v_womens uuid; v_open uuid;
  v_player uuid; v_player2 uuid; v_req uuid; v_req2 uuid;
  v_dob_adult date := (current_date - interval '25 years')::date;
  v_dob_minor date := (current_date - interval '14 years')::date;
  r record; a record; v_n int;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_adult,'adult1@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_adult2,'adult2@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_clubmgr,'clubmgr@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_teammgr,'teammgr@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_outsider,'outsider@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_adult,'Owen','Adults','adult1@ovalball-test.invalid'),
  (v_adult2,'Nia','Adults','adult2@ovalball-test.invalid'),
  (v_clubmgr,'Cara','Clubmanager','clubmgr@ovalball-test.invalid'),
  (v_teammgr,'Tom','Teammanager','teammgr@ovalball-test.invalid'),
  (v_outsider,'Olly','Outsider','outsider@ovalball-test.invalid');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Adult Union RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','adu-'||substr(gen_random_uuid()::text,1,8))
returning id into v_udir;
insert into public.clubs (directory_id, slug, status) values (v_udir,'adu-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_uclub;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Adult League ARLFC','T','T','league','United Kingdom','England',true,'unverified','site_admin_manual','adl-'||substr(gen_random_uuid()::text,1,8))
returning id into v_ldir;
insert into public.clubs (directory_id, slug, status) values (v_ldir,'adl-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_lclub;

insert into public.club_memberships (user_id, club_id, role, status) values (v_clubmgr, v_uclub,'CLUB_ADMIN','active') returning id into v_clubmgr_m;
insert into public.club_memberships (user_id, club_id, role, status) values (v_teammgr, v_uclub,'BASIC_USER','active') returning id into v_teammgr_m;
insert into public.club_memberships (user_id, club_id, role, status) values (v_outsider, v_lclub,'CLUB_ADMIN','active');

insert into public.teams (club_id, rugby_code, category, gender, squad_designation)
values (v_uclub,'union','senior','mens','1st') returning id into v_1st;
insert into public.teams (club_id, rugby_code, category, gender, squad_designation)
values (v_uclub,'union','senior','mens','2nd') returning id into v_2nd;
insert into public.teams (club_id, rugby_code, category, gender, squad_designation)
values (v_uclub,'union','senior','womens','1st') returning id into v_womens;
insert into public.teams (club_id, rugby_code, category, gender)
values (v_lclub,'league','senior','mens') returning id into v_open;

-- Tom manages the 2nd XV specifically, and nothing else.
insert into public.team_permissions (membership_id, team_id, permission, created_by)
values (v_teammgr_m, v_2nd, 'team_admin', v_clubmgr);

-- AND he holds team.roster.manage on that team, by explicit grant.
--
-- This is deliberate, and it is the crux of how team-level approval works.
-- internal.has_team_role_capability records a standing decision that team staff
-- hold NO roster write capability by default -- team.roster.manage is named in
-- its comment as one of the keys deliberately withheld. This pass does not
-- reverse that decision by handing the capability to every team staffer
-- everywhere. It uses the mechanism the capability engine already provides for
-- exactly this: a scoped grant to one person on one team.
--
-- So the join-request functions are capability-driven, never role-name driven,
-- and a team manager can resolve a request the moment somebody with the
-- authority to say so grants it -- which is what the engine is for.
insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, granted_by, reason)
values (v_teammgr, 'team.roster.manage', 'team', v_uclub, v_2nd, 'grant', v_clubmgr,
        'Team manager resolves join requests for their own squad.');

-- =========================================================================
-- A. AN ADULT CREATES THEIR OWN PLAYER
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_adult,'role','authenticated')::text, true);

v_player := public.create_own_player_profile('owen', 'mcdonald', v_dob_adult, 'MALE');
select * into r from public.players where id = v_player;
if r.user_id = v_adult then
  raise notice 'PASS 1 (A): an adult created their own player, linked to their own account';
else raise notice 'FAIL 1 (A): player.user_id is %', r.user_id; end if;

if r.first_name = 'Owen' and r.surname = 'McDonald' then
  raise notice 'PASS 2 (A): the same server-side name normaliser ran -- "owen mcdonald" is "Owen McDonald"';
else raise notice 'FAIL 2 (A): stored as % %', r.first_name, r.surname; end if;

-- Coming back through any route finds the same player, never a second one.
if public.create_own_player_profile('owen', 'mcdonald', v_dob_adult, 'MALE') = v_player then
  raise notice 'PASS 3 (A): registering again returns the same player -- no duplicate on refresh or re-login';
else raise notice 'FAIL 3 (A): a second player was created'; end if;

select count(*) into v_n from public.players where user_id = v_adult;
if v_n = 1 then raise notice 'PASS 4 (A): exactly one player exists for this account';
else raise notice 'FAIL 4 (A): % players', v_n; end if;

-- =========================================================================
-- B. THE ADULT CATEGORY IS NOT A SQUAD
-- =========================================================================

select * into a from public.resolve_adult_category('union', 'MALE');
if a.resolution = 'ADULT_CATEGORY' and a.canonical_team_type_id is null and a.identity_count = 3 then
  raise notice 'PASS 5 (B): Union adult men resolves to a CATEGORY, not to a numbered squad';
else raise notice 'FAIL 5 (B): % / % / %', a.resolution, a.display_label, a.identity_count; end if;

select * into a from public.resolve_adult_category('union', 'FEMALE');
if a.resolution = 'ADULT_CATEGORY' and a.display_label = 'Adult Women''s Rugby' then
  raise notice 'PASS 6 (B): Union adult women resolves to Adult Women''s Rugby, never Women''s 1st by default';
else raise notice 'FAIL 6 (B): % / %', a.resolution, a.display_label; end if;

select * into a from public.resolve_adult_category('league', 'MALE');
if a.resolution = 'ADULT_TEAM' and a.display_label = 'Men''s Open Age' then
  raise notice 'PASS 7 (B): League adult men resolves to the real identity, Men''s Open Age';
else raise notice 'FAIL 7 (B): % / %', a.resolution, a.display_label; end if;

select * into a from public.resolve_adult_category('league', 'FEMALE');
if a.display_label = 'Women''s Open Age' then
  raise notice 'PASS 8 (B): League adult women resolves to Women''s Open Age';
else raise notice 'FAIL 8 (B): %', a.display_label; end if;

-- Code isolation: neither code's answer ever names the other's identity.
if (select display_label from public.resolve_adult_category('union','MALE')) not like '%Open Age%'
   and (select display_label from public.resolve_adult_category('league','MALE')) not like '%1st%' then
  raise notice 'PASS 9 (B): neither code borrows the other''s adult terminology';
else raise notice 'FAIL 9 (B): cross-code adult terminology leaked'; end if;

-- =========================================================================
-- C. ONE REQUEST
-- =========================================================================

v_req := public.request_to_join_club(v_player, v_uclub);
select count(*) into v_n from public.player_club_join_requests where player_id = v_player and club_id = v_uclub;
if v_n = 1 then raise notice 'PASS 10 (C): asking to join creates exactly one request';
else raise notice 'FAIL 10 (C): % requests', v_n; end if;

if public.request_to_join_club(v_player, v_uclub) = v_req then
  raise notice 'PASS 11 (C): asking twice returns the same request -- a double submit is harmless';
else raise notice 'FAIL 11 (C): a second request was created'; end if;

select resolved_category into r from public.player_club_join_requests where id = v_req;
if (select resolved_category from public.player_club_join_requests where id = v_req) = 'Adult Men''s Rugby' then
  raise notice 'PASS 12 (C): the club sees the same category the player was shown';
else raise notice 'FAIL 12 (C): recorded as %', (select resolved_category from public.player_club_join_requests where id = v_req); end if;

-- =========================================================================
-- D. WHO MAY RESOLVE IT
-- =========================================================================

-- The applicant cannot approve themselves, whatever else is true.
begin
  perform public.approve_player_club_join_request(v_req, v_1st);
  raise notice 'FAIL 13 (D): a player approved their own join request';
exception when others then
  raise notice 'PASS 13 (D): a player cannot approve their own join request';
end;

-- A club admin at ANOTHER club is not an approver here.
perform set_config('request.jwt.claims', json_build_object('sub', v_outsider,'role','authenticated')::text, true);
begin
  perform public.approve_player_club_join_request(v_req, v_1st);
  raise notice 'FAIL 14 (D): a manager from an unrelated club approved the request';
exception when others then
  raise notice 'PASS 14 (D): a manager from an unrelated club is refused';
end;

-- The team manager holds authority over the 2nd XV only.
perform set_config('request.jwt.claims', json_build_object('sub', v_teammgr,'role','authenticated')::text, true);
begin
  perform public.approve_player_club_join_request(v_req, v_1st);
  raise notice 'FAIL 15 (D): a 2nd XV manager placed a player into the 1st XV';
exception when others then
  raise notice 'PASS 15 (D): a team manager can only place into the team they manage';
end;

-- =========================================================================
-- E. FIRST AUTHORISED APPROVER WINS
-- =========================================================================

perform public.approve_player_club_join_request(v_req, v_2nd);

select status, placed_team_id into r from public.player_club_join_requests where id = v_req;
if (select status from public.player_club_join_requests where id = v_req) = 'approved' then
  raise notice 'PASS 16 (E): the team manager resolved the request';
else raise notice 'FAIL 16 (E): status is %', (select status from public.player_club_join_requests where id = v_req); end if;

select count(*) into v_n from public.player_team_memberships where player_id = v_player and status = 'active';
if v_n = 1 then raise notice 'PASS 17 (E): exactly one membership was created';
else raise notice 'FAIL 17 (E): % memberships', v_n; end if;

-- The club manager now clicks Approve from a page loaded before that happened.
perform set_config('request.jwt.claims', json_build_object('sub', v_clubmgr,'role','authenticated')::text, true);
begin
  perform public.approve_player_club_join_request(v_req, v_1st);
  raise notice 'FAIL 18 (E): a second approval was accepted';
exception when others then
  raise notice 'PASS 18 (E): the second approver is told it is already resolved';
end;

select count(*) into v_n from public.player_team_memberships where player_id = v_player and status = 'active';
if v_n = 1 then raise notice 'PASS 19 (E): the stale approval created no second membership';
else raise notice 'FAIL 19 (E): % memberships after the race', v_n; end if;

if (select placed_team_id from public.player_club_join_requests where id = v_req) = v_2nd then
  raise notice 'PASS 20 (E): the first resolution stands -- the outcome did not change';
else raise notice 'FAIL 20 (E): placed team changed'; end if;

-- =========================================================================
-- F. THE COMPATIBILITY GUARD STILL HAS THE FINAL WORD
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_adult2,'role','authenticated')::text, true);
v_player2 := public.create_own_player_profile('nia', 'de silva', v_dob_adult, 'FEMALE');
v_req2 := public.request_to_join_club(v_player2, v_uclub);

perform set_config('request.jwt.claims', json_build_object('sub', v_clubmgr,'role','authenticated')::text, true);
begin
  -- A club manager trying to place a woman into the men's 1st XV. Approval is
  -- not a way round the guard.
  perform public.approve_player_club_join_request(v_req2, v_1st);
  raise notice 'FAIL 21 (F): approval placed a player into the wrong pathway';
exception when others then
  raise notice 'PASS 21 (F): approval cannot bypass the membership compatibility guard';
end;

if (select status from public.player_club_join_requests where id = v_req2) = 'pending' then
  raise notice 'PASS 22 (F): the refused approval left the request open';
else raise notice 'FAIL 22 (F): request status is %', (select status from public.player_club_join_requests where id = v_req2); end if;

perform public.approve_player_club_join_request(v_req2, v_womens);
if (select status from public.player_club_join_requests where id = v_req2) = 'approved' then
  raise notice 'PASS 23 (F): the legitimate placement is accepted';
else raise notice 'FAIL 23 (F): legitimate placement refused'; end if;

-- =========================================================================
-- G. A PENDING PLAYER IS NOT A MEMBER
-- =========================================================================

declare v_p3 uuid; v_req3 uuid; v_fix uuid; v_season uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult,'role','authenticated')::text, true);
  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture order by starts_on desc limit 1;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Pending','Applicant', v_dob_adult, 'MALE', true) returning id into v_p3;
  update public.players set user_id = null where id = v_p3;

  insert into public.fixtures (owning_team_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id)
  values (v_1st, 'Someone RFC', current_date + 7, '15:00', 'Home', 'Booked', v_season)
  returning id into v_fix;

  -- respond_to_attendance requires an ACTIVE membership on a team in the
  -- fixture. A pending applicant has none, so availability is closed to them.
  begin
    perform public.respond_to_attendance(v_fix, v_p3, 'ATTENDING');
    raise notice 'FAIL 24 (G): a player with no active membership set availability';
  exception when others then
    raise notice 'PASS 24 (G): a pending applicant cannot set availability for the team''s fixture';
  end;
end;

-- =========================================================================
-- H. SELF AVAILABILITY, AND ONLY FOR YOURSELF
-- =========================================================================

declare v_fix2 uuid; v_season2 uuid;
begin
  select id into v_season2 from public.seasons where rugby_code='union' and not is_regression_fixture order by starts_on desc limit 1;
  insert into public.fixtures (owning_team_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id)
  values (v_2nd, 'Another RFC', current_date + 14, '15:00', 'Home', 'Booked', v_season2)
  returning id into v_fix2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adult,'role','authenticated')::text, true);
  perform public.respond_to_attendance(v_fix2, v_player, 'ATTENDING');
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_fix2 and player_id = v_player;
  if v_n = 1 then raise notice 'PASS 25 (H): an approved adult player set their own availability';
  else raise notice 'FAIL 25 (H): % attendance rows', v_n; end if;

  if (select response_source from public.player_fixture_attendance where fixture_id = v_fix2 and player_id = v_player) = 'player' then
    raise notice 'PASS 26 (H): the response is recorded as the player''s own, not a guardian''s or staff''s';
  else raise notice 'FAIL 26 (H): source is %', (select response_source from public.player_fixture_attendance where fixture_id = v_fix2 and player_id = v_player); end if;

  -- Idempotent: saying it twice, then changing your mind.
  perform public.respond_to_attendance(v_fix2, v_player, 'ATTENDING');
  perform public.respond_to_attendance(v_fix2, v_player, 'CANNOT_ATTEND');
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_fix2 and player_id = v_player;
  if v_n = 1 and (select status from public.player_fixture_attendance where fixture_id = v_fix2 and player_id = v_player) = 'CANNOT_ATTEND' then
    raise notice 'PASS 27 (H): repeated and changed answers update one record rather than piling up';
  else raise notice 'FAIL 27 (H): % rows', v_n; end if;

  -- Another player's availability is not theirs to set.
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult2,'role','authenticated')::text, true);
  begin
    perform public.respond_to_attendance(v_fix2, v_player, 'ATTENDING');
    raise notice 'FAIL 28 (H): one player set another player''s availability';
  exception when others then
    raise notice 'PASS 28 (H): a player cannot answer for another player';
  end;
end;

-- =========================================================================
-- I. PROFILE COMPLETENESS GATES ALLOCATION, NOT AUTHENTICATION
-- =========================================================================

declare v_bare uuid := gen_random_uuid(); v_bare_player uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_bare,'bare@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_bare,'Bare','Account','bare@ovalball-test.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', v_bare,'role','authenticated')::text, true);

  select * into r from public.my_player_context();
  if r.state = 'NO_PLAYER' then
    raise notice 'PASS 29 (I): an authenticated account is not a player until the person says so';
  else raise notice 'FAIL 29 (I): state is %', r.state; end if;

  begin
    perform public.create_own_player_profile('Bare','Account', null, 'MALE');
    raise notice 'FAIL 30 (I): a player was created with no date of birth';
  exception when others then
    raise notice 'PASS 30 (I): no date of birth means no player profile, never a guess';
  end;

  begin
    perform public.create_own_player_profile('Bare','Account', v_dob_adult, null);
    raise notice 'FAIL 31 (I): a player was created with no recorded gender';
  exception when others then
    raise notice 'PASS 31 (I): no gender means no player profile, and none is inferred';
  end;
end;

-- =========================================================================
-- J. 16-17 SAFEGUARDING IS NOT WIDENED BY ANY OF THIS
-- =========================================================================

declare v_minor_u uuid := gen_random_uuid(); v_minor uuid; v_fix3 uuid; v_season3 uuid; v_u14 uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_minor_u,'minor@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values (v_minor_u,'Minor','Player','minor@ovalball-test.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', v_minor_u,'role','authenticated')::text, true);

  v_minor := public.create_own_player_profile('Minor','Player', v_dob_minor, 'MALE');

  insert into public.teams (club_id, rugby_code, category, age_group, gender)
  values (v_uclub,'union','youth','U14','boys') returning id into v_u14;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_minor, v_u14, 'active');

  select id into v_season3 from public.seasons where rugby_code='union' and not is_regression_fixture order by starts_on desc limit 1;
  insert into public.fixtures (owning_team_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id)
  values (v_u14, 'Youth RFC', current_date + 21, '11:00', 'Home', 'Booked', v_season3)
  returning id into v_fix3;

  -- Having an account and a player row does NOT grant self-service to a 14
  -- year old. The existing age rules are untouched by adult self-registration.
  begin
    perform public.respond_to_attendance(v_fix3, v_minor, 'ATTENDING');
    raise notice 'FAIL 32 (J): a 14-year-old set their own availability';
  exception when others then
    raise notice 'PASS 32 (J): a player under 16 still cannot answer for themselves';
  end;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
