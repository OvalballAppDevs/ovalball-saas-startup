-- =====================================================================================================
-- THE AGE DISPENSATION WORKFLOW (20270742000000) -- the owner's brief of 2026-10-05, test for test.
--
-- A child who does not fit a team's age grade stays refused. The one exception is a persisted request that
-- the club's Safeguarding Officer or a Club Admin decides -- once -- for ONE player, ONE team, ONE season.
-- Nothing else, by any route, places them.
--
--   A. THE VERDICT       correct age needs nothing; under-age and over-age are refused; adult sides ask the
--                        governing body's question
--   B. AUTHORITY         Team Managers and Team Admins ask and never decide; a Club Admin and the
--                        Safeguarding Officer decide; a Club Admin's decision reaches every officer and an
--                        officer's reaches the Club Admins; the first valid decision wins and a second is
--                        refused and changes nothing; a decline says why
--   C. WHAT IT COVERS    a declined, withdrawn or expired request places nobody; an approval is for this
--                        player, this team, this club, this season and is never re-pointed
--   D. NO OTHER ROUTE    direct database writes, every placing RPC and Site Admin master control all meet
--                        the same guard
--   E. JOINING           the guardian prerequisite still holds; the team neither sees nor acts on a request
--                        until everything it waits on is done; a declined dispensation closes the place
--   F. ATTENTION         what is waiting for a decision disappears for everybody once it is decided
--   G. SECURITY          no self-authorisation by another endpoint; an under-18 onto an adult side is the
--                        officer's alone with the governing body's reference; no leak of a child's details;
--                        immutable, attributable history; one live request; revocation
--
-- Self-seeding with uniquely tagged people, clubs and teams, wrapped in begin/rollback. The Safeguarding
-- Officer is a disposable one, nominated by the suite's Club Admin and confirmed by the suite's Site Admin
-- -- never a persistent review identity.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create temp table secrets (k text primary key, token text) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.token(p_k text) returns text language sql as $$ select token from secrets where k = p_k $$;
-- A date of birth squarely inside an age grade this season, from the canonical resolver.
create or replace function pg_temp.dob(p_age text) returns date language sql as $$
  select internal.date_of_birth_in_age_grade('union', p_age) $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','adw-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'Adw',p_label,'adw-'||v::text||'@ovalball.test',p_dob,'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims','', true);
end $$;

-- Runs one statement as a person IN THE BROWSER'S ROLE: OK, or the SQLSTATE and the sentence they would read.
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;
create or replace function pg_temp.state_as(p_subject uuid, p_sql text) returns text language sql as $$
  select split_part(pg_temp.say_as(p_subject, p_sql), ':', 1) $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;
create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;

-- The workflow's own entry points, as the person.
create or replace function pg_temp.ask(p_subject uuid, p_player uuid, p_team uuid, p_source uuid default null) returns uuid language plpgsql as $$
begin
  return (pg_temp.json_as(p_subject, format('select to_jsonb(public.request_dispensation(%L, %L, %L, %L))',
                                           p_player, p_team, 'Adw suite: a reason the club will read', p_source)) #>> '{}')::uuid;
end $$;
create or replace function pg_temp.decide(p_subject uuid, p_id uuid, p_approve boolean, p_note text default null, p_ref text default null)
returns text language sql as $$
  select pg_temp.say_as(p_subject, format('select public.decide_dispensation(%L, %L, %L, %L)', p_id, p_approve, p_note, p_ref)) $$;

-- A placement as the database owner would write it: the strongest caller there is.
create or replace function pg_temp.place_directly(p_player uuid, p_team uuid) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    insert into public.player_team_memberships (player_id, team_id, status, state, source)
    values (p_player, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  return v_state || coalesce(': ' || v_msg, '');
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_name, 'adw-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.child(p_parent uuid, p_first text, p_dob date, p_pathway text default 'MALE', p_user uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values (p_first, 'Adwchild', p_dob, true, p_pathway, p_user) returning id into v;
  if p_parent is not null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (p_parent, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  end if;
  return v;
end $$;

create or replace function pg_temp.told(p_user uuid, p_type text, p_dispensation uuid) returns bigint language sql as $$
  select count(*) from public.notifications n
   where n.user_id = p_user and n.type = p_type and n.data ->> 'dispensation_id' = p_dispensation::text $$;

create or replace function pg_temp.place(p_player uuid, p_team uuid) returns public.player_team_memberships language sql as $$
  select * from public.player_team_memberships where player_id = p_player and team_id = p_team order by created_at desc limit 1 $$;

-- =====================================================================================================
-- SEED. Club A runs Under 11 Mixed, Under 12/13/14 Boys, Under 12 Girls and Men's 1st; club B an Under 12 Boys.
-- =====================================================================================================
do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_dir uuid; v_club uuid; v_fdir uuid; v_far uuid; v_ms uuid; v_res jsonb; v record;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Adw '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','adw-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'adw-'||v_tag,'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Adw Far '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','adw-far-'||v_tag) returning id into v_fdir;
  insert into public.clubs (directory_id, slug, status) values (v_fdir,'adw-far-'||v_tag,'active') returning id into v_far;
  perform pg_temp.put('club', v_club); perform pg_temp.put('far', v_far);
  perform pg_temp.put('season', internal.resolve_season_for_date('union', current_date));

  perform pg_temp.put('t11', pg_temp.team(v_club, 'Under 11 Mixed', 'youth', 'U11', 'mixed'));
  perform pg_temp.put('t12', pg_temp.team(v_club, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('t13', pg_temp.team(v_club, 'Under 13 Boys', 'youth', 'U13', 'boys'));
  perform pg_temp.put('t14', pg_temp.team(v_club, 'Under 14 Boys', 'youth', 'U14', 'boys'));
  perform pg_temp.put('g12', pg_temp.team(v_club, 'Under 12 Girls', 'youth', 'U12', 'girls'));
  perform pg_temp.put('men', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));
  perform pg_temp.put('tb12', pg_temp.team(v_far, 'Under 12 Boys', 'youth', 'U12', 'boys'));

  -- Staff. Two Club Admins; the Under 12s' Team Manager and Team Admin; the Under 13s' coach; a Fixtures
  -- Secretary; an ordinary member; another club's admin; a stranger; a Site Admin; the officer-to-be.
  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  perform pg_temp.put('ca2', pg_temp.person('Secondadmin'));
  perform pg_temp.put('tm', pg_temp.person('Teammanager'));
  perform pg_temp.put('ta', pg_temp.person('Teamadmin'));
  perform pg_temp.put('co13', pg_temp.person('Coach'));
  perform pg_temp.put('fs', pg_temp.person('Fixtures'));
  perform pg_temp.put('mb', pg_temp.person('Member'));
  perform pg_temp.put('farca', pg_temp.person('Faradmin'));
  perform pg_temp.put('str', pg_temp.person('Stranger'));
  perform pg_temp.put('sa', pg_temp.person('Siteadmin'));
  perform pg_temp.put('so', pg_temp.person('Officer'));
  perform pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN');
  perform pg_temp.member(v_club, pg_temp.id('ca2'), 'CLUB_ADMIN');
  perform pg_temp.member(v_club, pg_temp.id('fs'), 'FIXTURE_SECRETARY');
  perform pg_temp.member(v_club, pg_temp.id('mb'));
  perform pg_temp.member(v_club, pg_temp.id('so'));
  perform pg_temp.member(v_far, pg_temp.id('farca'), 'CLUB_ADMIN');
  v_ms := pg_temp.member(v_club, pg_temp.id('tm'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('t12'), 'LEGACY_BACKFILL', 'adw seed');
  v_ms := pg_temp.member(v_club, pg_temp.id('ta'));
  perform internal.grant_role(v_ms, 'COACH', pg_temp.id('t12'), 'LEGACY_BACKFILL', 'adw seed');
  perform internal.grant_role(v_ms, 'TEAM_ADMINISTRATION', pg_temp.id('t12'), 'LEGACY_BACKFILL', 'adw seed');
  v_ms := pg_temp.member(v_club, pg_temp.id('co13'));
  perform internal.grant_role(v_ms, 'COACH', pg_temp.id('t13'), 'LEGACY_BACKFILL', 'adw seed');
  insert into public.site_admins (user_id, status, profile_key) values (pg_temp.id('sa'), 'active', 'SITE_FULL')
  on conflict (user_id) do update set status = 'active', profile_key = 'SITE_FULL';

  -- The officer: nominated by the Club Admin, confirmed by Ovalball, exactly as a real one is.
  v_res := pg_temp.json_as(pg_temp.id('ca'), format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''adw suite officer'')',
                                                   v_club, pg_temp.id('so')));
  perform pg_temp.json_as(pg_temp.id('sa'), format('select to_jsonb(public.confirm_safeguarding_officer(%L,''adw suite: confirming the officer''))',
                                                  v_res ->> 'assignment_id'));

  -- Families. Pat: Yan (a year young for U12) and Olly (a year old for it). Kit: a U11 boy with his own
  -- login, Kim's son. Gil and Hal: children who are nobody's player yet, Gina's. Finn: in the U12 grade.
  -- Tess: 17. Sid: 16. Gwen: a U12 girl. Cal: the son of a Club Admin who is also his parent.
  perform pg_temp.put('pat', pg_temp.person('Pat'));
  perform pg_temp.put('kim', pg_temp.person('Kim'));
  perform pg_temp.put('gina', pg_temp.person('Gina'));
  perform pg_temp.put('kit_user', pg_temp.person('Kit', pg_temp.dob('U11')));
  perform pg_temp.member(v_club, pg_temp.id('pat'));
  perform pg_temp.put('yan', pg_temp.child(pg_temp.id('pat'), 'Yan', pg_temp.dob('U11')));
  perform pg_temp.put('olly', pg_temp.child(pg_temp.id('pat'), 'Olly', pg_temp.dob('U13')));
  perform pg_temp.put('kit', pg_temp.child(pg_temp.id('kim'), 'Kit', pg_temp.dob('U11'), 'MALE', pg_temp.id('kit_user')));
  perform pg_temp.put('gil', pg_temp.child(pg_temp.id('gina'), 'Gil', pg_temp.dob('U11')));
  perform pg_temp.put('hal', pg_temp.child(pg_temp.id('gina'), 'Hal', pg_temp.dob('U11')));
  perform pg_temp.put('finn', pg_temp.child(null, 'Finn', pg_temp.dob('U12')));
  perform pg_temp.put('tess', pg_temp.child(null, 'Tess', (current_date - interval '17 years 4 months')::date));
  perform pg_temp.put('sid', pg_temp.child(null, 'Sid', (current_date - interval '16 years 2 months')::date));
  perform pg_temp.put('gwen', pg_temp.child(null, 'Gwen', pg_temp.dob('U12'), 'FEMALE'));
  perform pg_temp.put('cal', pg_temp.child(pg_temp.id('ca'), 'Cal', pg_temp.dob('U11')));
  -- Everybody the club can already see holds a place it can see, in their own grade (a 17-year-old is U18).
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values
    (pg_temp.id('yan'), pg_temp.id('t11'), 'active', 'ACTIVE', 'CLUB_CREATED'),
    (pg_temp.id('olly'), pg_temp.id('t13'), 'active', 'ACTIVE', 'CLUB_CREATED'),
    (pg_temp.id('kit'), pg_temp.id('t11'), 'active', 'ACTIVE', 'CLUB_CREATED'),
    (pg_temp.id('cal'), pg_temp.id('t11'), 'active', 'ACTIVE', 'CLUB_CREATED'),
    (pg_temp.id('finn'), pg_temp.id('t12'), 'active', 'ACTIVE', 'CLUB_CREATED'),
    (pg_temp.id('gwen'), pg_temp.id('g12'), 'active', 'ACTIVE', 'CLUB_CREATED');
  -- Tess and Sid are asked about for the adult side; they are at the club through a pending join request.
  insert into public.player_club_join_requests (player_id, club_id, requested_by, resolved_category, status) values
    (pg_temp.id('tess'), v_club, pg_temp.id('ca'), 'Adult Men''s Rugby', 'pending'),
    (pg_temp.id('sid'), v_club, pg_temp.id('ca'), 'Adult Men''s Rugby', 'pending');

  -- The Under 12s' team code, issued the canonical way by their Team Manager.
  perform pg_temp.as_(pg_temp.id('tm'));
  select * into v from public.issue_invitation('TEAM_JOIN_CODE', null, pg_temp.id('t12'), null, null, null, null, '{}'::jsonb, 50);
  insert into secrets values ('t12', v.token);
  perform pg_temp.off();
end $$;

do $$
begin
  perform pg_temp.check(pg_temp.id('season') is not null
      and (select canonical_age_group from internal.resolve_player_age_grade('union', pg_temp.id('season'), pg_temp.dob('U11'))) = 'U11'
      and (select canonical_age_group from internal.resolve_player_age_grade('union', pg_temp.id('season'), pg_temp.dob('U12'))) = 'U12'
      and (select canonical_age_group from internal.resolve_player_age_grade('union', pg_temp.id('season'), pg_temp.dob('U13'))) = 'U13',
    'DW0 the suite''s dates of birth are what the canonical resolver says they are this season (U11, U12, U13)');
  perform pg_temp.check(internal.is_active_safeguarding_officer(pg_temp.id('so'), pg_temp.id('club'))
      and not internal.is_active_safeguarding_officer(pg_temp.id('ca'), pg_temp.id('club')),
    'DW0b the disposable officer is confirmed, and a Club Admin is not an officer');
end $$;

-- =====================================================================================================
-- A. THE VERDICT
-- =====================================================================================================
do $$
declare v text;
begin
  -- correct-age child requires no dispensation
  perform pg_temp.check((select verdict from internal.placement_age_verdict(pg_temp.id('t12'), pg_temp.dob('U12'))) = 'FITS'
      and (select count(*) from public.player_team_memberships where player_id = pg_temp.id('finn') and team_id = pg_temp.id('t12') and state = 'ACTIVE') = 1,
    'DW1 a child in the team''s own age grade fits, and is placed with no dispensation at all');
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.request_dispensation(%L,%L,''not needed'')', pg_temp.id('finn'), pg_temp.id('t12')));
  perform pg_temp.check(v like '23514%already fits%No dispensation is needed%',
    'DW1b and a dispensation cannot even be asked for: ' || v);

  -- under-age mismatch
  perform pg_temp.check((select verdict from internal.placement_age_verdict(pg_temp.id('t12'), pg_temp.dob('U11'))) = 'TOO_YOUNG',
    'DW2 a child a year young for the grade is TOO_YOUNG');
  v := pg_temp.place_directly(pg_temp.id('yan'), pg_temp.id('t12'));
  perform pg_temp.check(v like '23514%outside the age grade%approved dispensation for this team and season%',
    'DW2b and cannot be placed on it: ' || v);

  -- over-age mismatch
  perform pg_temp.check((select verdict from internal.placement_age_verdict(pg_temp.id('t12'), pg_temp.dob('U13'))) = 'TOO_OLD',
    'DW3 a child a year old for the grade is TOO_OLD');
  v := pg_temp.place_directly(pg_temp.id('olly'), pg_temp.id('t12'));
  perform pg_temp.check(v like '23514%outside the age grade%', 'DW3b and cannot be placed on it either: ' || v);

  -- adult sides ask the governing body's question, from the canonical rule
  perform pg_temp.check((select verdict || '/' || adult_requirement from internal.placement_age_verdict(pg_temp.id('men'),
                           (select date_of_birth from public.players where id = pg_temp.id('tess')))) = 'UNDER_18/external_approval_required'
      and (select verdict || '/' || adult_requirement from internal.placement_age_verdict(pg_temp.id('men'),
                           (select date_of_birth from public.players where id = pg_temp.id('sid')))) = 'UNDER_18/not_permitted',
    'DW3c an adult side: a 17-year-old needs the governing body''s approval, a 16-year-old is not permitted at all (RFU 15.7)');
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.request_dispensation(%L,%L,''adult rugby'')', pg_temp.id('sid'), pg_temp.id('men')));
  perform pg_temp.check(v like '23514%Regulation 15.7%17th birthday%',
    'DW3d and a dispensation cannot be asked for where the governing body does not permit one: ' || v);
end $$;

-- =====================================================================================================
-- B. AUTHORITY
-- =====================================================================================================
do $$
declare v_tm_req uuid; v_ta_req uuid; v text; d public.player_team_dispensation;
begin
  -- Team Manager can request but cannot approve
  v_tm_req := pg_temp.put('req_yan', pg_temp.ask(pg_temp.id('tm'), pg_temp.id('yan'), pg_temp.id('t12'), pg_temp.id('t11')));
  select * into d from public.player_team_dispensation where id = v_tm_req;
  perform pg_temp.check(d.status = 'requested' and d.requested_as = 'TEAM_STAFF' and d.requested_by = pg_temp.id('tm')
      and d.club_id = pg_temp.id('club') and d.season_id = pg_temp.id('season') and d.age_verdict = 'TOO_YOUNG'
      and d.player_age_group = 'U11' and d.team_age_group = 'U12' and d.player_date_of_birth = pg_temp.dob('U11')
      and d.reason is not null and d.created_at is not null and d.decided_at is null,
    'DW4 a Team Manager can request one, and it records the child, club, team, season, date of birth, both grades, requester, reason and time');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tm'), format('select public.decide_dispensation(%L, true)', v_tm_req)) = '42501',
    'DW4b and cannot approve their own');

  -- Team Admin can request but cannot approve
  v_ta_req := pg_temp.put('req_olly', pg_temp.ask(pg_temp.id('ta'), pg_temp.id('olly'), pg_temp.id('t12'), pg_temp.id('t13')));
  perform pg_temp.check(v_ta_req is not null
      and pg_temp.state_as(pg_temp.id('ta'), format('select public.decide_dispensation(%L, true)', v_ta_req)) = '42501'
      and pg_temp.state_as(pg_temp.id('ta'), format('select public.decide_dispensation(%L, true)', v_tm_req)) = '42501'
      and pg_temp.state_as(pg_temp.id('tm'), format('select public.decide_dispensation(%L, false, ''no'')', v_ta_req)) = '42501',
    'DW5 a Team Admin can request one and cannot approve it -- nor anybody else''s, and nor can the Team Manager');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('co13'), format('select public.decide_dispensation(%L, true)', v_ta_req)) = '42501'
      and pg_temp.state_as(pg_temp.id('fs'), format('select public.decide_dispensation(%L, true)', v_ta_req)) = '42501',
    'DW5b nor can a coach, or the Fixtures Secretary who may ask for one');

  -- both deciders are told, and it waits for them
  perform pg_temp.check(pg_temp.told(pg_temp.id('so'), 'safeguarding_dispensation_requested', v_tm_req) = 1
      and pg_temp.told(pg_temp.id('ca'), 'safeguarding_dispensation_requested', v_tm_req) = 1
      and pg_temp.told(pg_temp.id('ca2'), 'safeguarding_dispensation_requested', v_tm_req) = 1
      and pg_temp.told(pg_temp.id('tm'), 'safeguarding_dispensation_requested', v_tm_req) = 0
      and (select title from public.notifications where user_id = pg_temp.id('so') and type = 'safeguarding_dispensation_requested'
             and data ->> 'dispensation_id' = v_tm_req::text) = 'Dispensation requested for Yan Adwchild',
    'DW5c the Safeguarding Officer and every Club Admin receive "Dispensation requested for <child>"; the person who asked does not');
  perform pg_temp.check(pg_temp.told(pg_temp.id('pat'), 'safeguarding_guardian_dispensation', v_tm_req) = 1
      and (select body from public.notifications where user_id = pg_temp.id('pat') and type = 'safeguarding_guardian_dispensation'
             and data ->> 'dispensation_id' = v_tm_req::text) like '%Nothing changes unless%approves it.',
    'DW5d the child''s parent is told it was asked for, and that asking is not a grant');

  -- Club Admin can approve
  v := pg_temp.decide(pg_temp.id('ca2'), v_tm_req, true, 'Plays well above his age');
  select * into d from public.player_team_dispensation where id = v_tm_req;
  perform pg_temp.check(v = 'OK' and d.status = 'approved' and d.decided_by = pg_temp.id('ca2') and d.decided_as = 'CLUB_ADMIN'
      and d.decided_at is not null and d.decision_note = 'Plays well above his age',
    'DW6 a Club Admin can approve, and the decision records who, when, as what and why (' || v || ')');

  -- Safeguarding Officer can approve
  v := pg_temp.decide(pg_temp.id('so'), v_ta_req, true);
  select * into d from public.player_team_dispensation where id = v_ta_req;
  perform pg_temp.check(v = 'OK' and d.status = 'approved' and d.decided_by = pg_temp.id('so') and d.decided_as = 'SAFEGUARDING_OFFICER',
    'DW7 the Safeguarding Officer can approve (' || v || ')');

  -- Club Admin decision notifies Safeguarding
  perform pg_temp.check(
    (select count(*) from public.notifications n
      where n.user_id = pg_temp.id('so') and n.type = 'safeguarding_dispensation_decided' and n.data ->> 'dispensation_id' = v_tm_req::text
        and n.title = 'Dispensation approved for Yan Adwchild by Adw Secondadmin'
        and n.body like 'Adw Secondadmin (Club Admin) approved the dispensation for Yan Adwchild to play for Under 12 Boys on % at %') = 1,
    'DW8 a Club Admin''s decision reaches the Safeguarding Officer: the child, the team, the decision, who and when');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('so'), format('select public.dispensation_record(%L)', v_tm_req)) #>> '{decided_by,name}' = 'Adw Secondadmin',
    'DW8b with a route to the immutable record: the notice carries its id, and the officer can open it');

  -- Safeguarding decision is visible to Club Admin
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca'), 'safeguarding_dispensation_decided', v_ta_req) = 1
      and pg_temp.json_as(pg_temp.id('ca'), format('select public.dispensation_record(%L)', v_ta_req)) ->> 'decided_as' = 'SAFEGUARDING_OFFICER'
      and exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('ca'), format('select public.dispensation_register(%L)', pg_temp.id('club')))) r
                   where r ->> 'id' = v_ta_req::text and r ->> 'status' = 'approved'),
    'DW9 the officer''s decision is told to the Club Admins and visible to them, on the record and in the club''s register');

  -- first valid decision wins
  v := pg_temp.decide(pg_temp.id('so'), v_tm_req, false, 'I would have said no');
  select * into d from public.player_team_dispensation where id = v_tm_req;
  perform pg_temp.check(v like '23514%already been approved%' and d.status = 'approved' and d.decided_by = pg_temp.id('ca2'),
    'DW10 the first valid decision wins: the officer cannot overturn the Club Admin''s approval (' || v || ')');

  -- second decision is rejected / a no-op, safely
  v := pg_temp.decide(pg_temp.id('ca'), v_tm_req, true, 'again');
  perform pg_temp.check(v like '23514%' and (select row(status, decided_by, decided_at, decision_note)::text from public.player_team_dispensation where id = v_tm_req)
                                       = row(d.status, d.decided_by, d.decided_at, d.decision_note)::text,
    'DW11 a second decision is refused and changes nothing on the record (' || v || ')');
  v := null;
  begin
    update public.player_team_dispensation set decided_by = pg_temp.id('ca') where id = v_tm_req;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.check(v like '%decision is final%',
    'DW11b and not even the database owner can rewrite a decision: ' || coalesce(v, 'no error'));
end $$;

-- decline requires a reason
do $$
declare v_req uuid; v1 text; v2 text; v3 text; d public.player_team_dispensation;
begin
  v_req := pg_temp.put('req_finn13', pg_temp.ask(pg_temp.id('ca'), pg_temp.id('finn'), pg_temp.id('t13'), pg_temp.id('t12')));
  v1 := pg_temp.decide(pg_temp.id('ca2'), v_req, false);
  v2 := pg_temp.decide(pg_temp.id('ca2'), v_req, false, '   ');
  v3 := pg_temp.decide(pg_temp.id('ca2'), v_req, false, 'The Under 13s are full this season');
  select * into d from public.player_team_dispensation where id = v_req;
  perform pg_temp.check(v1 like '22023%Say why%' and v2 like '22023%' and v3 = 'OK'
      and d.status = 'rejected' and d.decision_note = 'The Under 13s are full this season',
    'DW12 a decline needs a reason -- none and blank are refused -- and records it (' || v1 || ')');
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca'), 'safeguarding_guardian_dispensation', v_req) = 1
      and (select body from public.notifications where user_id = pg_temp.id('ca') and type = 'safeguarding_guardian_dispensation'
             and data ->> 'dispensation_id' = v_req::text and title like 'Dispensation declined%') like '%Reason: The Under 13s are full this season',
    'DW12b and the person who asked is told the reason');
end $$;

-- =====================================================================================================
-- C. WHAT A REQUEST COVERS
-- =====================================================================================================
do $$
declare v text; v_req uuid; v_past uuid; d public.player_team_dispensation; v_next uuid;
begin
  -- declined request cannot activate placement
  v := pg_temp.place_directly(pg_temp.id('finn'), pg_temp.id('t13'));
  perform pg_temp.check(v like '23514%outside the age grade%'
      and internal.approved_dispensation_id(pg_temp.id('finn'), pg_temp.id('t13'), pg_temp.id('season')) is null,
    'DW13 a declined request places nobody: ' || v);

  -- withdrawn request cannot activate placement (and cannot be decided)
  v_req := pg_temp.ask(pg_temp.id('ca'), pg_temp.id('olly'), pg_temp.id('t14'), pg_temp.id('t13'));
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tm'), format('select public.withdraw_dispensation(%L)', v_req)) = '42501'
      and pg_temp.state_as(pg_temp.id('ca'), format('select public.withdraw_dispensation(%L, ''changed our mind'')', v_req)) = 'OK',
    'DW14 only the person who asked (or the child''s parent) withdraws a request');
  select * into d from public.player_team_dispensation where id = v_req;
  v := pg_temp.decide(pg_temp.id('so'), v_req, true);
  perform pg_temp.check(d.status = 'withdrawn' and d.withdrawn_by = pg_temp.id('ca') and v like '23514%already been withdrawn%'
      and pg_temp.place_directly(pg_temp.id('olly'), pg_temp.id('t14')) like '23514%',
    'DW14b a withdrawn request cannot be approved afterwards, and places nobody (' || v || ')');
  perform pg_temp.check(pg_temp.told(pg_temp.id('pat'), 'safeguarding_guardian_dispensation', v_req) = 2,
    'DW14c the parent is told it was asked for, and that it was withdrawn');
  v_req := pg_temp.ask(pg_temp.id('ca'), pg_temp.id('yan'), pg_temp.id('t13'), pg_temp.id('t11'));
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('pat'), format('select public.withdraw_dispensation(%L)', v_req)) = 'OK',
    'DW14d the child''s parent may withdraw a request somebody else made about their child');

  -- expired request cannot activate placement (and cannot be decided once its season is over)
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture)
  -- A regression-fixture season that is already over (the register's year bounds keep it in 2000-2200 and
  -- unique per code, so it takes a year nothing real uses; is_regression_fixture keeps it out of every answer
  -- about "the current season").
  values ('Adw past season', current_date - 400, current_date - 40, true, 'union',
          (select greatest(2150, coalesce(max(s.season_year_start), 2149) + 1) from public.seasons s
            where s.rugby_code = 'union' and s.season_year_start >= 2150),
          'adw-past-'||substr(gen_random_uuid()::text,1,6), true)
  returning id into v_past;
  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, status, requested_by, eligibility_rule_reference)
  values (pg_temp.id('olly'), pg_temp.id('t13'), pg_temp.id('t14'), v_past, 'requested', pg_temp.id('ca'), 'Adw suite: a request its season outlived')
  returning id into v_req;
  v := pg_temp.decide(pg_temp.id('so'), v_req, true, null, 'RFU-ADW-1');
  perform pg_temp.check(v like '23514%season has ended%',
    'DW15 a request whose season is over can no longer be decided, even before the nightly sweep (' || v || ')');
  perform internal.expire_due_dispensations();
  select * into d from public.player_team_dispensation where id = v_req;
  perform pg_temp.check(d.status = 'expired' and d.expired_at is not null
      and pg_temp.decide(pg_temp.id('so'), v_req, true, null, 'RFU-ADW-1') like '23514%'
      and internal.approved_dispensation_id(pg_temp.id('olly'), pg_temp.id('t14'), v_past) is null
      and pg_temp.place_directly(pg_temp.id('olly'), pg_temp.id('t14')) like '23514%',
    'DW15b the sweep expires it; an expired request is never approved and places nobody');
  perform pg_temp.check(pg_temp.told(pg_temp.id('pat'), 'safeguarding_guardian_dispensation', v_req) = 1,
    'DW15c and the family is told it expired');

  -- approval only applies to the specified player / team / club / season
  v_req := pg_temp.id('req_yan');
  select s.id into v_next from public.seasons s
   where s.rugby_code = 'union' and not s.is_regression_fixture and s.id <> pg_temp.id('season') order by s.starts_on desc limit 1;
  perform pg_temp.check(internal.approved_dispensation_id(pg_temp.id('yan'), pg_temp.id('t12'), pg_temp.id('season')) = v_req
      and internal.approved_dispensation_id(pg_temp.id('yan'), pg_temp.id('t13'), pg_temp.id('season')) is null
      and internal.approved_dispensation_id(pg_temp.id('yan'), pg_temp.id('tb12'), pg_temp.id('season')) is null
      and internal.approved_dispensation_id(pg_temp.id('kit'), pg_temp.id('t12'), pg_temp.id('season')) is null
      and (v_next is null or internal.approved_dispensation_id(pg_temp.id('yan'), pg_temp.id('t12'), v_next) is null),
    'DW16 an approval answers for this player, this team, this club and this season -- and nothing else');
  perform pg_temp.check(pg_temp.place_directly(pg_temp.id('yan'), pg_temp.id('t12')) = 'OK'
      and pg_temp.place_directly(pg_temp.id('yan'), pg_temp.id('t13')) like '23514%'
      and pg_temp.place_directly(pg_temp.id('yan'), pg_temp.id('tb12')) like '23514%'
      and pg_temp.place_directly(pg_temp.id('kit'), pg_temp.id('t12')) like '23514%',
    'DW16b so Yan can now be placed on the Under 12s -- and still not on the Under 13s, another club''s Under 12s, nor can Kit');
  perform pg_temp.check((select verdict from internal.placement_age_verdict(pg_temp.id('t12'), pg_temp.dob('U11'))) = 'TOO_YOUNG'
      and (select date_of_birth from public.players where id = pg_temp.id('yan')) = pg_temp.dob('U11'),
    'DW16c and nothing about the child changed: their age grade and date of birth are exactly what they were');

  -- changing team requires another dispensation
  v := null;
  begin
    update public.player_team_dispensation set target_team_id = pg_temp.id('t13') where id = v_req;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.check(v like 'What a dispensation was asked for never changes%',
    'DW17 an approval cannot be re-pointed at another team: ' || coalesce(v, 'no error'));
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.move_player_team_membership(%L, %L, ''moving up'')',
                                              (pg_temp.place(pg_temp.id('yan'), pg_temp.id('t12'))).id, pg_temp.id('t14')));
  perform pg_temp.check(v like '23514%outside the age grade%',
    'DW17b and moving the child on to another team needs that team''s own dispensation: ' || v);

  -- changing season requires another dispensation
  v := null;
  begin
    update public.player_team_dispensation set season_id = coalesce(v_next, v_past) where id = v_req;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.check(v like 'What a dispensation was asked for never changes%'
      and (select status from internal.team_age_grade_status(pg_temp.id('t12'), pg_temp.id('yan'),
             (select coalesce(s.pre_season_starts_on, s.starts_on) + 1 from public.seasons s where s.id = coalesce(v_next, v_past)))) is distinct from 'DISPENSATION_APPROVED',
    'DW18 an approval cannot be carried into another season, and next season does not read it as approved');
end $$;

-- =====================================================================================================
-- D. NO OTHER ROUTE
-- =====================================================================================================
do $$
declare v text; v_pending uuid; v_n int;
begin
  perform pg_temp.check(pg_temp.place_directly(pg_temp.id('olly'), pg_temp.id('t11')) like '23514%',
    'DW19 a direct write by the database owner meets the guard');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('ca'), format(
      'insert into public.player_team_memberships (player_id, team_id, status, state) values (%L, %L, ''active'', ''ACTIVE'')',
      pg_temp.id('olly'), pg_temp.id('t11'))) = '42501',
    'DW19b nobody signed in can write a team place directly at all');
  insert into public.player_team_memberships (player_id, team_id, status, state, source)
  values (pg_temp.id('olly'), pg_temp.id('t11'), 'pending', 'PENDING', 'CLUB_CREATED') returning id into v_pending;
  v := null;
  begin
    update public.player_team_memberships set state = 'ACTIVE', status = 'active' where id = v_pending;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.check(v like '%outside the age grade%', 'DW19c a waiting place cannot be switched on underneath the guard');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.approve_pending_team_membership(%L)', v_pending)) like '23514%'
      and pg_temp.say_as(pg_temp.id('ca'), format('select public.move_player_team_membership(%L, %L)',
                                                 (pg_temp.place(pg_temp.id('finn'), pg_temp.id('t12'))).id, pg_temp.id('t11'))) like '23514%',
    'DW19d a Club Admin approving a waiting place, or moving one, meets the same guard');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('sa'), format('select public.site_set_player_team_membership(%L, %L, ''add'', ''adw suite: master control placing a child outside their age grade'')',
                                                              pg_temp.id('olly'), pg_temp.id('t11'))) like '23514%outside the age grade%',
    'DW19e and so does Site Admin master control');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.approve_player_club_join_request(%L, %L)',
      (select id from public.player_club_join_requests where player_id = pg_temp.id('tess') and status = 'pending' limit 1), pg_temp.id('t12'))) like '23514%',
    'DW19f and so does approving somebody''s request to join the club');
  -- Only the season engines write the two sources the guard leaves to them, and both are governing-body gated.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal') and p.prosrc ~* 'insert into public\.player_team_memberships'
     and p.prosrc ~ '''(SEASON_HANDOVER|GRADUATION)'''
     and n.nspname || '.' || p.proname not in ('internal.apply_season_handover_core', 'public.place_graduating_player');
  perform pg_temp.check(v_n = 0 and exists (select 1 from pg_trigger where tgname = 'player_membership_season_grade_guard' and tgenabled = 'O'),
    'DW19g the guard is a live trigger, and only the season handover and graduation engines write the sources it leaves to them');
end $$;

-- =====================================================================================================
-- E. JOINING
-- =====================================================================================================
-- The guardian prerequisite still works: Kit (U11, his own login) asks with the Under 12s' code while a
-- dispensation the club asked for is pending. The team hears of it only when BOTH are done.
do $$
declare v_req uuid; v_res jsonb; m public.player_team_memberships; v text;
begin
  v_req := pg_temp.put('req_kit', pg_temp.ask(pg_temp.id('ca'), pg_temp.id('kit'), pg_temp.id('t12'), pg_temp.id('t11')));
  v_res := pg_temp.json_as(pg_temp.id('kit_user'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('t12'), '{"for":"SELF"}'));
  m := pg_temp.place(pg_temp.id('kit'), pg_temp.id('t12'));
  perform pg_temp.check(v_res ->> 'outcome' = 'TEAM_PLACE_PENDING' and m.state = 'PENDING' and m.guardian_confirmation = 'AWAITING'
      and m.dispensation_id = v_req and (v_res ->> 'awaiting_dispensation')::boolean,
    'DW20 a child''s own request joins the pending dispensation and still waits for their parent');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id in (pg_temp.id('tm'), pg_temp.id('ta'))
                                       and type = 'team_place_requested' and data ->> 'membership_id' = m.id::text),
    'DW20b the team is told nothing yet');
  v := pg_temp.decide(pg_temp.id('so'), v_req, true);
  perform pg_temp.check(v = 'OK'
      and (pg_temp.place(pg_temp.id('kit'), pg_temp.id('t12'))).state = 'PENDING'
      and not exists (select 1 from public.notifications where user_id = pg_temp.id('tm') and type = 'team_place_requested'
                       and data ->> 'membership_id' = m.id::text)
      and pg_temp.say_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', m.id)) like '23514%',
    'DW20c an approved dispensation does not skip the parent: the place still waits, and the team still cannot act');
  v := pg_temp.state_as(pg_temp.id('kim'), format('select public.confirm_team_place_request(%L)', m.id));
  perform pg_temp.check(v = 'OK'
      and exists (select 1 from public.notifications where user_id = pg_temp.id('tm') and type = 'team_place_requested'
                   and data ->> 'membership_id' = m.id::text),
    'DW20d once the parent confirms, the team is told');
  v := pg_temp.state_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', m.id));
  perform pg_temp.check(v = 'OK' and (pg_temp.place(pg_temp.id('kit'), pg_temp.id('t12'))).state = 'ACTIVE',
    'DW20e and only then can the team place him');
end $$;

-- Team staff neither see nor act on a request before its prerequisites are complete: Gina asks with the
-- Under 12s' code for Gil, who is a year young, and asks for a dispensation in the same breath.
do $$
declare v_res jsonb; m public.player_team_memberships; v_req uuid; v_tpr jsonb; v text;
begin
  v_res := pg_temp.json_as(pg_temp.id('gina'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('t12'),
             jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('gil'), 'dispensation_reason', 'His brother plays in this team')));
  m := pg_temp.place(pg_temp.id('gil'), pg_temp.id('t12'));
  v_req := m.dispensation_id;
  perform pg_temp.check(v_res ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v_res ->> 'awaiting_dispensation')::boolean and v_req is not null
      and (select requested_as || '/' || status from public.player_team_dispensation where id = v_req) = 'GUARDIAN/requested',
    'DW21 a parent can ask for the place and the dispensation together; the place waits on it');
  v_tpr := pg_temp.json_as(pg_temp.id('tm'), format('select public.team_place_requests(%L)', pg_temp.id('t12')));
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(coalesce(v_tpr -> 'requests', '[]')) r where r ->> 'membership_id' = m.id::text)
      and coalesce((v_tpr ->> 'awaiting_dispensation')::int, 0) >= 1
      and pg_temp.count_as(pg_temp.id('tm'), format('select count(*) from public.team_people(%L) where row_id = %L', pg_temp.id('t12'), m.id)) = 0
      and pg_temp.count_as(pg_temp.id('tm'), format('select count(*) from public.player_team_memberships where id = %L', m.id)) = 0,
    'DW21b the team''s staff do not see it: not among their requests (only counted as waiting), not in their people, not in the table');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('tm'), format('select public.dispensation_record(%L)', v_req)) is null
      and pg_temp.say_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', m.id)) like '23514%waits for a dispensation decision%'
      and not exists (select 1 from public.notifications where user_id = pg_temp.id('tm') and type = 'team_place_requested'
                       and data ->> 'membership_id' = m.id::text),
    'DW21c nor read the child''s dispensation, nor approve the place, nor were they told');
  v := pg_temp.decide(pg_temp.id('ca'), v_req, true);
  perform pg_temp.check(v = 'OK'
      and exists (select 1 from public.notifications where user_id = pg_temp.id('tm') and type = 'team_place_requested'
                   and data ->> 'membership_id' = m.id::text)
      and exists (select 1 from jsonb_array_elements(coalesce(pg_temp.json_as(pg_temp.id('tm'), format('select public.team_place_requests(%L)', pg_temp.id('t12'))) -> 'requests', '[]')) r
                   where r ->> 'membership_id' = m.id::text)
      and pg_temp.json_as(pg_temp.id('tm'), format('select public.dispensation_record(%L)', v_req)) ->> 'status' = 'approved',
    'DW21d once it is approved the team is told, sees the request and can read the approval');
  v := pg_temp.state_as(pg_temp.id('tm'), format('select public.approve_pending_team_membership(%L)', m.id));
  perform pg_temp.check(v = 'OK' and (pg_temp.place(pg_temp.id('gil'), pg_temp.id('t12'))).state = 'ACTIVE',
    'DW21e and places him');

  -- the same request, declined: the place can never go ahead, and the parent is told why
  v_res := pg_temp.json_as(pg_temp.id('gina'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('t12'),
             jsonb_build_object('for', 'CHILD', 'player_id', pg_temp.id('hal'), 'dispensation_reason', 'He wants to play with Gil')));
  m := pg_temp.place(pg_temp.id('hal'), pg_temp.id('t12'));
  v := pg_temp.decide(pg_temp.id('so'), m.dispensation_id, false, 'Not this season');
  perform pg_temp.check(v = 'OK'
      and (pg_temp.place(pg_temp.id('hal'), pg_temp.id('t12'))).state <> 'PENDING'
      and (pg_temp.place(pg_temp.id('hal'), pg_temp.id('t12'))).state <> 'ACTIVE'
      and pg_temp.place_directly(pg_temp.id('hal'), pg_temp.id('t12')) like '23514%'
      and pg_temp.told(pg_temp.id('gina'), 'safeguarding_guardian_dispensation', m.dispensation_id) >= 1,
    'DW21f a declined dispensation closes the place that waited on it, places nobody, and the parent is told');
  perform pg_temp.check((select count(*) from public.notifications where user_id = pg_temp.id('gina')
                           and data ->> 'dispensation_id' = m.dispensation_id::text) = 1,
    'DW21g once: one decision is one notice to the parent, not a second one for the place it closed');
end $$;

-- =====================================================================================================
-- F. ATTENTION: what waits for a decision disappears for everybody once it is decided
-- =====================================================================================================
do $$
declare v_req uuid; v_so jsonb; v_ca jsonb; v text;
begin
  v_req := pg_temp.ask(pg_temp.id('tm'), pg_temp.id('cal'), pg_temp.id('t12'), pg_temp.id('t11'));
  v_so := pg_temp.json_as(pg_temp.id('so'), 'select public.dispensation_decisions_waiting()');
  v_ca := pg_temp.json_as(pg_temp.id('ca2'), 'select public.dispensation_decisions_waiting()');
  perform pg_temp.check((select count(*) from jsonb_array_elements(v_so) r where r ->> 'id' = v_req::text and r ->> 'decides_as' = 'SAFEGUARDING_OFFICER') = 1
      and (select count(*) from jsonb_array_elements(v_ca) r where r ->> 'id' = v_req::text and r ->> 'decides_as' = 'CLUB_ADMIN') = 1
      and (select count(*) from jsonb_array_elements(pg_temp.json_as(pg_temp.id('tm'), 'select public.dispensation_decisions_waiting()'))) = 0,
    'DW22 a pending request waits once for the officer and once for each Club Admin who may decide it -- never for team staff');
  -- Cal's own parent is a Club Admin: they are not offered their own child's decision.
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('ca'), 'select public.dispensation_decisions_waiting()')) r
                                    where r ->> 'id' = v_req::text)
      and pg_temp.state_as(pg_temp.id('ca'), format('select public.decide_dispensation(%L, true)', v_req)) = '42501',
    'DW22b a Club Admin who is the child''s parent is not offered the decision, and cannot make it');
  v := pg_temp.decide(pg_temp.id('ca2'), v_req, true);
  perform pg_temp.check(v = 'OK'
      and (select count(*) from jsonb_array_elements(pg_temp.json_as(pg_temp.id('so'), 'select public.dispensation_decisions_waiting()')) r where r ->> 'id' = v_req::text) = 0
      and (select count(*) from jsonb_array_elements(pg_temp.json_as(pg_temp.id('ca2'), 'select public.dispensation_decisions_waiting()')) r where r ->> 'id' = v_req::text) = 0
      and pg_temp.json_as(pg_temp.id('so'), format('select public.dispensation_record(%L)', v_req)) #>> '{viewer,decides_as}' is null,
    'DW22c once decided it waits for nobody, and the record offers nobody a decision');
  perform pg_temp.check(pg_temp.told(pg_temp.id('so'), 'safeguarding_dispensation_decided', v_req) = 1
      and pg_temp.told(pg_temp.id('so'), 'safeguarding_dispensation_requested', v_req) = 1,
    'DW22d what the officer was asked to decide is now told to them as decided -- one notice of each, nothing new to act on');
end $$;

-- =====================================================================================================
-- A2. NO DATE OF BIRTH: FAIL CLOSED FOR A NEW PLACE, FLAG AN EXISTING ONE
-- Whether a child fits an age-grade side, or a player is old enough for an adult one, cannot be established
-- without a date of birth -- and an unknown answer is not a yes. A new place is refused with the remedy named;
-- a place already held is left as it is and reported as needing the date of birth.
-- =====================================================================================================
do $$
declare v_nia uuid; v_ned uuid; v_old uuid; v text; v2 text; v_status text;
begin
  v_nia := pg_temp.child(pg_temp.id('pat'), 'Nia', null);
  v := pg_temp.place_directly(v_nia, pg_temp.id('t12'));
  perform pg_temp.check(v like '23514%Nia has no date of birth recorded%Record their date of birth first.%'
      and not exists (select 1 from public.player_team_memberships where player_id = v_nia and state = 'ACTIVE'),
    'DD1 a child with no date of birth cannot be placed on an age-grade side by anybody -- the database refuses and names the remedy (' || v || ')');

  v_ned := pg_temp.child(null, 'Ned', null);
  v2 := pg_temp.place_directly(v_ned, pg_temp.id('men'));
  perform pg_temp.check(v2 like '23514%Ned has no date of birth recorded%',
    'DD2 nor on an adult side: being 18 cannot be established without one either (' || v2 || ')');

  update public.players set date_of_birth = pg_temp.dob('U12') where id = v_nia;
  perform pg_temp.check(pg_temp.place_directly(v_nia, pg_temp.id('t12')) = 'OK',
    'DD3 once the date of birth is recorded, the same place is made -- the refusal was about the missing fact, not the child');

  -- A place that already exists keeps working: prohibit new, flag existing.
  v_old := pg_temp.child(pg_temp.id('pat'), 'Ora', pg_temp.dob('U12'));
  perform pg_temp.check(pg_temp.place_directly(v_old, pg_temp.id('t12')) = 'OK', 'DD4 setup: a child placed in the grade');
  update public.players set date_of_birth = null where id = v_old;
  update public.player_team_memberships set updated_at = now() where player_id = v_old and team_id = pg_temp.id('t12');
  select s.status into v_status from internal.team_age_grade_status(pg_temp.id('t12'), v_old) s;
  perform pg_temp.check(exists (select 1 from public.player_team_memberships where player_id = v_old and team_id = pg_temp.id('t12') and state = 'ACTIVE')
      and v_status = 'AGE_EVIDENCE_REQUIRED',
    'DD4 a place already held when the date of birth goes missing stays, and the team''s age-grade list asks for it (' || coalesce(v_status, 'null') || ')');
end $$;

-- =====================================================================================================
-- A3. UNION GIRLS PLAY IN DUAL BANDS (RFU Regulation 15.6)
-- The guard asks the canonical allocation rule (public.resolve_normal_operational_identity) what a player's
-- normal side is, so a U13 girl's own team -- Girls U14 -- needs no dispensation, while the band above it,
-- the band below it and a boy of the same age still do. It used to compare single years and refused her.
-- =====================================================================================================
do $$
declare v_g14 uuid; v_g12 uuid; v_g16 uuid; v_b14 uuid; v_lia uuid; v_mo uuid; v text; v_status text;
begin
  v_g14 := pg_temp.team(pg_temp.id('club'), 'Under 14 Girls', 'youth', 'U14', 'girls');
  v_g12 := pg_temp.id('g12');
  v_g16 := pg_temp.team(pg_temp.id('club'), 'Under 16 Girls', 'youth', 'U16', 'girls');
  v_b14 := pg_temp.id('t14');
  v_lia := pg_temp.child(pg_temp.id('pat'), 'Lia', pg_temp.dob('U13'), 'FEMALE');
  v_mo := pg_temp.child(pg_temp.id('pat'), 'Mo', pg_temp.dob('U13'), 'MALE');

  perform pg_temp.check((select verdict from internal.placement_age_verdict(v_g14, pg_temp.dob('U13'), current_date, null, 'FEMALE')) = 'FITS'
      and pg_temp.place_directly(v_lia, v_g14) = 'OK',
    'DG1 a U13 girl fits Girls U14 -- her normal side under the dual bands -- and is placed with no dispensation');
  select s.status into v_status from internal.team_age_grade_status(v_g14, v_lia) s;
  perform pg_temp.check(v_status = 'ELIGIBLE',
    'DG2 and the team''s age-grade list agrees she belongs there (' || coalesce(v_status, 'null') || ')');
  perform pg_temp.check((select verdict from internal.placement_age_verdict(v_g12, pg_temp.dob('U13'), current_date, null, 'FEMALE')) = 'TOO_OLD'
      and (select verdict from internal.placement_age_verdict(v_g16, pg_temp.dob('U13'), current_date, null, 'FEMALE')) = 'TOO_YOUNG'
      and pg_temp.place_directly(v_lia, v_g16) like '23514%',
    'DG3 the bands either side of hers still need a dispensation: Girls U12 is too young a side, Girls U16 too old');
  v := pg_temp.place_directly(v_mo, v_b14);
  perform pg_temp.check((select verdict from internal.placement_age_verdict(v_b14, pg_temp.dob('U13'), current_date, null, 'MALE')) = 'TOO_YOUNG'
      and v like '23514%',
    'DG4 a U13 boy has no dual band: Under 14 Boys is a year up for him and needs a dispensation (' || v || ')');
end $$;

-- =====================================================================================================
-- G. SECURITY
-- =====================================================================================================
do $$
declare v_req uuid; v text; v2 text; v3 text; v4 text; v_rec jsonb;
begin
  -- no self-authorisation through another endpoint
  v_req := pg_temp.ask(pg_temp.id('ca'), pg_temp.id('tess'), pg_temp.id('men'));
  perform pg_temp.put('req_tess', v_req);
  perform pg_temp.check((select safeguarding_only and requires_governing_body and age_verdict = 'UNDER_18'
                           from public.player_team_dispensation where id = v_req),
    'DS1 a 17-year-old onto an adult side is the Safeguarding Officer''s decision, and needs the governing body''s approval');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('ca2'), format('select public.decide_dispensation(%L, true, null, ''RFU-1'')', v_req)) = '42501'
      and pg_temp.json_as(pg_temp.id('ca2'), format('select public.dispensation_record(%L)', v_req)) #>> '{viewer,decides_as}' is null
      and pg_temp.told(pg_temp.id('ca2'), 'safeguarding_dispensation_requested', v_req) = 0
      and pg_temp.told(pg_temp.id('so'), 'safeguarding_dispensation_requested', v_req) = 1,
    'DS1b a Club Admin is neither offered nor able to make it; the officer alone is asked');
  v := pg_temp.decide(pg_temp.id('so'), v_req, true);
  perform pg_temp.check(v like '22023%governing body%',
    'DS1c the officer cannot approve it without recording the governing body''s reference (' || v || ')');
  v := pg_temp.decide(pg_temp.id('so'), v_req, true, 'Assessed and approved', 'RFU/CB/2026/0042');
  v2 := pg_temp.place_directly(pg_temp.id('tess'), pg_temp.id('men'));
  perform pg_temp.check(v = 'OK' and v2 = 'OK'
      and (select governing_body_reference from public.player_team_dispensation where id = v_req) = 'RFU/CB/2026/0042',
    'DS1d with it she is approved and can be placed on the adult side (' || v || ', ' || v2 || ')');

  -- the requester cannot authorise through the reference endpoint either
  v_req := pg_temp.ask(pg_temp.id('ca'), pg_temp.id('olly'), pg_temp.id('t14'), pg_temp.id('t13'));
  v := pg_temp.decide(pg_temp.id('ca2'), v_req, true);
  v2 := pg_temp.state_as(pg_temp.id('ca'), format('select public.record_dispensation_reference(%L, ''SELF-1'')', v_req));
  v3 := pg_temp.state_as(pg_temp.id('ca2'), format('select public.record_dispensation_reference(%L, ''RFU-OK-1'')', v_req));
  v4 := pg_temp.state_as(pg_temp.id('ca2'), format('select public.record_dispensation_reference(%L, ''RFU-OK-2'')', v_req));
  perform pg_temp.check(v = 'OK' and v2 = '42501' and v3 = 'OK' and v4 = '23514',
    'DS2 the person who asked cannot record the governing body''s reference on it; a decider can, once (' || concat_ws(', ', v, v2, v3, v4) || ')');

  -- revocation: anyone who could decide may revoke, the requester included; team staff may not
  v := pg_temp.state_as(pg_temp.id('tm'), format('select public.revoke_player_dispensation(%L, ''no'')', v_req));
  v2 := pg_temp.state_as(pg_temp.id('ca'), format('select public.revoke_player_dispensation(%L, '' '')', v_req));
  v3 := pg_temp.state_as(pg_temp.id('ca'), format('select public.revoke_player_dispensation(%L, ''Moved house'')', v_req));
  v4 := pg_temp.place_directly(pg_temp.id('olly'), pg_temp.id('t14'));
  perform pg_temp.check(v = '42501' and v2 = '22023' and v3 = 'OK' and v4 like '23514%'
      and (select status from public.player_team_dispensation where id = v_req) = 'revoked'
      and pg_temp.told(pg_temp.id('so'), 'safeguarding_dispensation_revoked', v_req) = 1,
    'DS3 a revocation needs a reason, is not team staff''s to make -- the Club Admin who asked may -- stops any later placement and tells the officer (' || concat_ws(', ', v, v2, v3) || ')');
  -- one live request; re-asking after a decline is allowed
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ta'), format('select public.request_dispensation(%L,%L,''again'',%L)',
                                                              pg_temp.id('kit'), pg_temp.id('t12'), pg_temp.id('t11'))) like '23505%already approved%'
      and pg_temp.ask(pg_temp.id('ca'), pg_temp.id('finn'), pg_temp.id('t13'), pg_temp.id('t12')) is not null,
    'DS4 one live request per player, team and season; after a decline it may be asked for again');

  -- a place already made under an approval is not ended by revoking it: the revocation stops the next one,
  -- and the team's age-grade view shows the player outside the grade again
  v := pg_temp.state_as(pg_temp.id('so'), format('select public.revoke_player_dispensation(%L, ''Reassessed'')', pg_temp.id('req_yan')));
  perform pg_temp.check(v = 'OK'
      and (pg_temp.place(pg_temp.id('yan'), pg_temp.id('t12'))).state = 'ACTIVE'
      and (select status from internal.team_age_grade_status(pg_temp.id('t12'), pg_temp.id('yan'))) = 'OUTSIDE_AGE_GRADE',
    'DS3b revoking leaves the place already made, and the team is shown the player outside the grade');

  -- the pathway is a separate rule, and an age-only approval never waives it
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm'), format('select public.request_dispensation(%L,%L,''she is good'',%L)',
                                                              pg_temp.id('gwen'), pg_temp.id('t12'), pg_temp.id('g12'))) like '23514%other playing pathway%',
    'DS5 team staff cannot turn a pathway question into a dispensation: that is a governing-body matter');
  insert into public.player_team_dispensation (player_id, target_team_id, season_id, status, requested_by, requested_as, reason,
                                               decided_by, decided_at, decided_as, eligibility_rule_reference, requires_governing_body, covers_pathway)
  values (pg_temp.id('gwen'), pg_temp.id('t12'), pg_temp.id('season'), 'approved', pg_temp.id('tm'), 'TEAM_STAFF', 'age only',
          pg_temp.id('ca2'), now(), 'CLUB_ADMIN', 'Adw suite: an age-only approval', false, false);
  v := pg_temp.place_directly(pg_temp.id('gwen'), pg_temp.id('t12'));
  perform pg_temp.check(v like '23514%other playing pathway%',
    'DS5b an approval that covers only the age grade never waives the pathway rule: ' || v);

  -- no leak of a child's details
  v_req := pg_temp.id('req_yan');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('str'), format('select public.dispensation_record(%L)', v_req)) is null
      and pg_temp.json_as(pg_temp.id('farca'), format('select public.dispensation_record(%L)', v_req)) is null
      and pg_temp.json_as(pg_temp.id('mb'), format('select public.dispensation_record(%L)', v_req)) is null
      and pg_temp.json_as(pg_temp.id('str'), format('select public.dispensation_record(%L)', gen_random_uuid())) is null,
    'DS6 a stranger, another club''s admin and an ordinary member read nothing -- the same nothing as an id that does not exist');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tm'), format('select public.dispensation_register(%L)', pg_temp.id('club'))) = '42501'
      and pg_temp.state_as(pg_temp.id('farca'), format('select public.dispensation_register(%L)', pg_temp.id('club'))) = '42501'
      and pg_temp.json_as(pg_temp.id('str'), 'select public.my_dispensations()') = '[]'::jsonb
      and pg_temp.json_as(pg_temp.id('str'), format('select public.dispensation_options(%L, %L)', pg_temp.id('yan'), pg_temp.id('t12'))) is null
      and jsonb_array_length(pg_temp.json_as(pg_temp.id('fs'), format('select public.dispensation_register(%L)', pg_temp.id('club')))) > 0
      and jsonb_array_length(pg_temp.json_as(pg_temp.id('so'), format('select public.dispensation_register(%L)', pg_temp.id('club')))) > 0,
    'DS6b the club''s register is for its officer, its Club Admins and its Fixtures Secretary -- never team staff or another club -- and a stranger learns nothing about a child');
  v_rec := pg_temp.json_as(pg_temp.id('ta'), format('select public.dispensation_record(%L)', v_req));
  perform pg_temp.check(v_rec is not null and v_rec #>> '{player,date_of_birth}' is null and v_rec ->> 'reason' is null
      and v_rec ->> 'decision_note' is null
      and pg_temp.state_as(pg_temp.id('ta'), format('select player_date_of_birth from public.player_team_dispensation where id = %L', v_req)) = '42501'
      and pg_temp.state_as(pg_temp.id('ta'), format('select reason from public.player_team_dispensation where id = %L', v_req)) = '42501',
    'DS6c the team''s staff read the decision, never the child''s date of birth, the reason or the note -- not even from the table');
  v_rec := pg_temp.json_as(pg_temp.id('pat'), format('select public.dispensation_record(%L)', v_req));
  perform pg_temp.check((v_rec #>> '{player,date_of_birth}')::date = pg_temp.dob('U11') and v_rec ->> 'decision_note' = 'Plays well above his age'
      and (v_rec #>> '{viewer,is_family}')::boolean
      and exists (select 1 from jsonb_array_elements(pg_temp.json_as(pg_temp.id('pat'), 'select public.my_dispensations()')) r where r ->> 'id' = v_req::text),
    'DS6d the child''s parent reads all of it, among their own dispensations');

  -- history is immutable and attributable
  v := null;
  begin
    delete from public.player_team_dispensation where id = v_req;
  exception when others then v := sqlerrm;
  end;
  perform pg_temp.check(v like 'A dispensation is a permanent record%',
    'DS7 a dispensation is never deleted: ' || coalesce(v, 'no error'));
  perform pg_temp.check(
    (select count(distinct event_type) from public.security_events
      where (metadata ->> 'dispensation_id') in (pg_temp.id('req_yan')::text, pg_temp.id('req_finn13')::text, pg_temp.id('req_tess')::text)
        and event_type in ('dispensation.requested', 'dispensation.approved', 'dispensation.declined')) = 3
    and exists (select 1 from public.security_events where event_type = 'dispensation.approved'
                 and metadata ->> 'dispensation_id' = pg_temp.id('req_yan')::text and actor_user_id = pg_temp.id('ca2')),
    'DS7b every transition is a security event naming who did it');
  perform pg_temp.check(
    exists (select 1 from public.audit_log where table_name = 'player_team_dispensation' and record_id = v_req)
    and not exists (select 1 from public.audit_log where table_name = 'player_team_dispensation' and record_id = v_req
                     and (after ->> 'player_date_of_birth') = pg_temp.dob('U11')::text),
    'DS7c and every change is in the audit log, with the child''s date of birth masked');
end $$;

-- =====================================================================================================
-- H. A DECISION NEEDS A RECENT AUTHENTICATOR CODE
-- Deciding, revoking and recording the governing body's reference are catalogued R (recent authenticator),
-- like suspending a member, and enforced the same way -- internal.require_recent_aal2. A real browser session
-- that has not entered a code in the last ten minutes is asked for one, and nothing is decided; with one, the
-- same decision goes through. (The harness's sessionless claims above stand for service code and pass by
-- design of internal.recent_aal2, so this block uses real session rows.)
-- =====================================================================================================
create or replace function pg_temp.say_in_session(p_subject uuid, p_session uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_subject, 'role', 'authenticated', 'session_id', p_session, 'aal', 'aal2')::text, true);
  set local role authenticated;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;

do $$
declare v_rex uuid; v_req uuid; v_sess uuid := gen_random_uuid(); v_sess2 uuid := gen_random_uuid(); v text; v2 text; d public.player_team_dispensation;
begin
  v_rex := pg_temp.child(pg_temp.id('pat'), 'Rex', pg_temp.dob('U11'));
  v_req := pg_temp.ask(pg_temp.id('pat'), v_rex, pg_temp.id('t12'));
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_sess, pg_temp.id('so'), now(), now(), 'aal2');

  v := pg_temp.say_in_session(pg_temp.id('so'), v_sess, format('select public.decide_dispensation(%L, true, null, null)', v_req));
  select * into d from public.player_team_dispensation where id = v_req;
  perform pg_temp.check(v like '42501%Enter a code from your authenticator%' and d.status = 'requested',
    'DH1 the officer, in a session with no recent code, is asked for one and nothing is decided (' || v || ')');

  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at)
  values (gen_random_uuid(), v_sess, 'totp', now() - interval '1 minute', now() - interval '1 minute');
  v := pg_temp.say_in_session(pg_temp.id('so'), v_sess, format('select public.decide_dispensation(%L, true, null, null)', v_req));
  select * into d from public.player_team_dispensation where id = v_req;
  perform pg_temp.check(v = 'OK' and d.status = 'approved',
    'DH2 with a code entered a minute ago, the same decision is made (' || v || ')');

  update auth.mfa_amr_claims set updated_at = now() - interval '2 hours' where session_id = v_sess;
  v2 := pg_temp.say_in_session(pg_temp.id('so'), v_sess, format('select public.revoke_player_dispensation(%L, %L)', v_req, 'Suite: revoke without a code'));
  select * into d from public.player_team_dispensation where id = v_req;
  perform pg_temp.check(v2 like '42501%Enter a code from your authenticator%' and d.status = 'approved',
    'DH3 revoking asks again once the code has gone stale, and the approval stands (' || v2 || ')');

  -- The parent who asked, in a session of their own with no code: told it is not their decision.
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_sess2, pg_temp.id('pat'), now(), now(), 'aal1');
  v2 := pg_temp.say_in_session(pg_temp.id('pat'), v_sess2, format('select public.decide_dispensation(%L, true, null, null)', v_req));
  perform pg_temp.check(v2 like '42501%another person at the club decides it%',
    'DH4 somebody who may not decide is told so -- never sent to fetch a code for a decision that is not theirs (' || v2 || ')');
end $$;

rollback;
