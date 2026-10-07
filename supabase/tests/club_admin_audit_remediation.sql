-- CLUB ADMIN AUDIT REMEDIATION (20270762000000) -- the Codex independent audit's security findings, proved as the
-- people they are about, against the real functions. Wrapped in a transaction and rolled back.
--   R-H2   an unaccepted safeguarding contact card cannot be edited from another club; its own club still can
--   R-H3   direct messaging needs positive adult evidence: unknown age is never adult; DOB-less adults keep it
--   R-H4   a guardian messages only their own child's team staff
--   R-H1   fixture requests change state only through guarded operations
--   R-H5   pitch placement is pitch-allocation authority, independent of fixture edit
--   R-M4   an individual answer to a Club Day fixture refreshes the one live summary; no per-fixture notice
--   R-M5   a club cannot decline its own standing proposal inside a Club Day
--   R-M6   the Club Day shows the effective (suggested) kick-off
--   R-M9   a retried Club Day batch returns its complete original outcome, including teams not sent
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -v ON_ERROR_STOP=0 < supabase/tests/club_admin_audit_remediation.sql

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.person(p_label text, p_adult_dob boolean default true) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','car-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Car',p_label,'car-'||v::text||'@ovalball.test', case when p_adult_dob then (current_date - interval '40 years')::date end)
  on conflict (id) do update set surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  update public.profiles set date_of_birth = case when p_adult_dob then (current_date - interval '40 years')::date end where id = v;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CAR '||p_label||' RUFC '||v_tag,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','car-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'car-'||v_tag,'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text,1,8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  select p_club, 'CAR '||p_key, 'car-'||p_key||'-'||v_tag, c.category, c.age_group, c.gender, 'union', c.id, true
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

-- A child (with or without a DOB) on a team, with a guardian.
create or replace function pg_temp.child(p_team uuid, p_guardian uuid, p_age int default 12) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Kid','Car', (current_date - make_interval(years => p_age, months => 6))::date, 'MALE', true) returning id into v;
  insert into public.player_team_memberships (player_id, team_id, status) values (v, p_team, 'active');
  if p_guardian is not null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (p_guardian, v, 'parent', 'active', 'ACTIVE', 'CLUB_CREATED');
  end if;
  return v;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if; end $$;

create or replace function pg_temp.act(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated','aal','aal1')::text, true);
  perform set_config('role','authenticated', true);
end $$;
create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;
create or replace function pg_temp.bool_as(p_subject uuid, p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin perform pg_temp.act(p_subject); execute p_sql into v; perform pg_temp.act_postgres(); return v; end $$;

grant execute on function pg_temp.check(boolean, text) to public;
grant execute on function pg_temp.act(uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_a uuid; v_b uuid; v_far uuid;
  v_a13 uuid; v_a14 uuid; v_b13 uuid; v_b14 uuid;
  v_ca_a uuid; v_ca_b uuid; v_off_b uuid; v_coach_a13 uuid; v_coach_a14 uuid; v_coach_b13 uuid; v_fs_a uuid;
  v_parent uuid; v_parent2 uuid; v_parent_multi uuid; v_alloc uuid; v_editor uuid; v_nobody uuid;
  v_unknown_player uuid; v_bare uuid; v_kid uuid; v_m uuid;
  v_card uuid; v_req uuid; v_group uuid; v_fixture uuid; v_pitch uuid; v_pitch2 uuid; v_venue uuid;
  v_state text; v_txt text; v_n int; v_r jsonb; v_j jsonb; v_day date := current_date + 21;
  v_season uuid; r13 uuid; r14 uuid;
begin
  v_a := pg_temp.club('Ashby'); v_b := pg_temp.club('Burnley'); v_far := pg_temp.club('Far');
  v_a13 := pg_temp.team(v_a,'u13'); v_a14 := pg_temp.team(v_a,'u14');
  v_b13 := pg_temp.team(v_b,'u13'); v_b14 := pg_temp.team(v_b,'u14');

  v_ca_a := pg_temp.person('CA-A', false); perform pg_temp.member(v_a, v_ca_a, 'CLUB_ADMIN');
  v_fs_a := pg_temp.person('FS-A', false); perform pg_temp.member(v_a, v_fs_a, 'FIXTURE_SECRETARY');
  v_ca_b := pg_temp.person('CA-B', false); perform pg_temp.member(v_b, v_ca_b, 'CLUB_ADMIN');
  v_coach_a13 := pg_temp.person('COACH-A13', false); v_m := pg_temp.member(v_a, v_coach_a13); perform pg_temp.team_role(v_m, v_a13, 'COACH');
  v_coach_a14 := pg_temp.person('COACH-A14', false); v_m := pg_temp.member(v_a, v_coach_a14); perform pg_temp.team_role(v_m, v_a14, 'COACH');
  v_coach_b13 := pg_temp.person('COACH-B13', false); v_m := pg_temp.member(v_b, v_coach_b13); perform pg_temp.team_role(v_m, v_b13, 'COACH');

  -- ================================================================================================================
  -- R-H2  SAFEGUARDING CONTACT CARD
  -- ================================================================================================================
  v_off_b := pg_temp.person('OFF-B'); v_m := pg_temp.member(v_b, v_off_b);
  insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, confirmation_state, granted_at)
  values (v_off_b, v_b, v_m, 'SAFEGUARDING_OFFICER', 'ACTIVE', 'SAFEGUARDING_APPOINTMENT', 'CONFIRMED', now());
  -- An ACTIVE officer at club B (the SO bundle carries the self contact-edit key).
  insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, user_id, status, activated_at, created_by)
  values (v_b, 'primary', 'Officer B', 'off-b-'||v_tag||'@ovalball.test', v_off_b, 'active', now(), v_ca_b);
  insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, user_id, status, created_by)
  values (v_a, 'deputy', 'Unaccepted Contact', 'unaccepted-'||v_tag||'@ovalball.test', null, 'invite_sent', v_ca_a)
  returning id into v_card;
  perform pg_temp.check(pg_temp.bool_as(v_off_b, 'select internal.can(''safeguarding.officer.contact_edit'', ''self'', null, null, null)'),
    'R-H2a precondition: the attacker is an officer at another club holding the self contact-edit key');
  perform pg_temp.act(v_off_b);
  v_state := pg_temp.try(format('select public.update_safeguarding_officer_contact(%L, ''Hijacked'', ''attacker@evil.test'')', v_card));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H2b an officer from ANOTHER club cannot edit an unaccepted (user_id NULL) card (%s)', v_state));
  perform pg_temp.check((select contact_name = 'Unaccepted Contact' and contact_email = 'unaccepted-'||v_tag||'@ovalball.test'
                           from public.club_safeguarding_officers where id = v_card),
    'R-H2c the card is unchanged');
  perform pg_temp.act(v_ca_a);
  v_state := pg_temp.try(format('select public.update_safeguarding_officer_contact(%L, ''Corrected Name'', ''corrected-%s@ovalball.test'')', v_card, v_tag));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select contact_name from public.club_safeguarding_officers where id = v_card) = 'Corrected Name',
    format('R-H2d the card''s own Club Admin still corrects it (%s)', v_state));

  -- ================================================================================================================
  -- R-H3  UNKNOWN AGE IS NEVER ADULT
  -- ================================================================================================================
  -- A player of unknown age, linked to an account with no DOB.
  v_unknown_player := pg_temp.person('UNKNOWN', false); perform pg_temp.member(v_a, v_unknown_player);
  insert into public.players (first_name, surname, date_of_birth, user_id, active) values ('Unk','Car', null, v_unknown_player, true);
  -- A bare self-registered account: no DOB, no player, no guardian, no staff role.
  v_bare := pg_temp.person('BARE', false); perform pg_temp.member(v_a, v_bare);
  -- A parent with no DOB, and a known minor with a login.
  v_parent := pg_temp.person('PARENT', false); perform pg_temp.member(v_a, v_parent);
  v_kid := pg_temp.child(v_a13, v_parent);
  perform pg_temp.check(not internal.is_adult_messaging_user(v_unknown_player), 'R-H3a a player of UNKNOWN age is not an adult');
  perform pg_temp.check(not internal.is_adult_messaging_user(v_bare), 'R-H3b a bare self-registered account with no DOB is not an adult');
  perform pg_temp.check(internal.is_adult_messaging_user(v_parent), 'R-H3c a guardian with no DOB is still an adult (DOB is not required of adults)');
  perform pg_temp.check(internal.is_adult_messaging_user(v_coach_a13), 'R-H3d team staff with no DOB are still adults');
  perform pg_temp.check(internal.is_adult_messaging_user(v_ca_a), 'R-H3e a Club Admin with no DOB is still an adult');
  update public.profiles set date_of_birth = (current_date - interval '30 years')::date where id = v_bare;
  perform pg_temp.check(internal.is_adult_messaging_user(v_bare), 'R-H3f the same bare account with a recorded adult DOB is an adult');
  update public.profiles set date_of_birth = (current_date - interval '15 years')::date where id = v_bare;
  perform pg_temp.check(not internal.is_adult_messaging_user(v_bare), 'R-H3g a recorded under-18 DOB is never an adult');
  perform pg_temp.check(not pg_temp.bool_as(v_coach_a13, format('select internal.may_direct_message(%L)', v_unknown_player)),
    'R-H3h a coach cannot direct-message a player of unknown age');
  perform pg_temp.check(not pg_temp.bool_as(v_unknown_player, format('select internal.may_direct_message(%L)', v_coach_a13)),
    'R-H3i ...nor can that player message the coach');

  -- ================================================================================================================
  -- R-H4  A GUARDIAN MESSAGES ONLY THEIR OWN CHILD'S TEAM STAFF
  -- ================================================================================================================
  v_parent2 := pg_temp.person('PARENT2', false); perform pg_temp.member(v_a, v_parent2);
  perform pg_temp.child(v_a14, v_parent2, 13);
  perform pg_temp.check(pg_temp.bool_as(v_parent, format('select internal.may_direct_message(%L)', v_coach_a13)),
    'R-H4a a parent may message their own child''s team coach');
  perform pg_temp.check(pg_temp.bool_as(v_coach_a13, format('select internal.may_direct_message(%L)', v_parent)),
    'R-H4b ...and that coach may message the parent');
  perform pg_temp.check(not pg_temp.bool_as(v_parent, format('select internal.may_direct_message(%L)', v_coach_a14)),
    'R-H4c a parent may NOT message another team''s coach in the same club');
  perform pg_temp.check(not pg_temp.bool_as(v_parent, format('select internal.may_direct_message(%L)', v_parent2)),
    'R-H4d a parent may NOT message another guardian');
  perform pg_temp.check(not pg_temp.bool_as(v_parent, format('select internal.may_direct_message(%L)', v_coach_b13)),
    'R-H4e a parent may NOT message the opposition''s coach');
  -- An older conversation does not keep a guardian's access once it is outside their children's teams.
  insert into public.direct_conversations (user_a, user_b, created_by) values (least(v_parent, v_coach_a14), greatest(v_parent, v_coach_a14), v_coach_a14);
  perform pg_temp.check(not pg_temp.bool_as(v_parent, format('select internal.may_direct_message(%L)', v_coach_a14)),
    'R-H4f an existing conversation does not reopen messaging outside the guardian''s children''s teams');
  -- Several children: exactly the union of their teams.
  v_parent_multi := pg_temp.person('MULTI', false); perform pg_temp.member(v_a, v_parent_multi);
  perform pg_temp.child(v_a13, v_parent_multi); perform pg_temp.child(v_b14, v_parent_multi, 13);
  perform pg_temp.check(pg_temp.bool_as(v_parent_multi, format('select internal.may_direct_message(%L)', v_coach_a13))
                        and not pg_temp.bool_as(v_parent_multi, format('select internal.may_direct_message(%L)', v_coach_a14))
                        and not pg_temp.bool_as(v_parent_multi, format('select internal.may_direct_message(%L)', v_coach_b13)),
    'R-H4g a parent of several children reaches exactly their children''s teams'' staff and no one else');
  perform pg_temp.check(pg_temp.bool_as(v_coach_a13, format('select internal.may_direct_message(%L)', v_coach_a14)),
    'R-H4h staff-to-staff in the same club is unchanged');

  -- ================================================================================================================
  -- R-H1  FIXTURE REQUEST STATE ONLY THROUGH GUARDED OPERATIONS
  -- ================================================================================================================
  select id into v_season from public.seasons where rugby_code='union' and not is_regression_fixture
    and v_day between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  perform pg_temp.act(v_ca_a);
  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
  values (v_a, v_b, 'Burnley', v_day, v_ca_a) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group, v_a13, v_b13, 'home', 'sent', v_ca_a) returning id into v_req;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_req is not null, 'R-H1a a requester still creates an ordinary request directly');

  perform pg_temp.act(v_ca_a);
  v_state := pg_temp.try(format('insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, decided_by, created_by) values (%L,%L,%L,''home'',''accepted'',%L,%L)',
                                v_group, v_a14, v_b14, v_ca_b, v_ca_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H1b a request cannot be CREATED already accepted / decided by someone else (%s)', v_state));

  perform pg_temp.act(v_ca_b);
  v_state := pg_temp.try(format('update public.fixture_requests set status = ''accepted'', decided_by = %L where id = %L', v_ca_a, v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501' and (select status from public.fixture_requests where id = v_req) = 'sent',
    format('R-H1c the table itself is not writable: no forged acceptance or attribution (%s)', v_state));

  perform pg_temp.act(v_ca_a);
  v_state := pg_temp.try(format('select public.decline_fixture_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H1d the requester cannot decline as if it were the recipient (%s)', v_state));

  perform pg_temp.act(v_ca_b);
  v_state := pg_temp.try(format('select public.withdraw_fixture_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H1e the recipient cannot withdraw (cancel) the requester''s request (%s)', v_state));

  perform pg_temp.act(pg_temp.person('STRANGER'));
  v_state := pg_temp.try(format('select public.decline_fixture_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H1f a stranger cannot decline it (%s)', v_state));

  perform pg_temp.act(v_ca_b);
  v_state := pg_temp.try(format('select public.decline_fixture_request(%L, ''Cup match that day'')', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select status = 'declined' and decided_by = v_ca_b and response_note = 'Cup match that day'
                                              from public.fixture_requests where id = v_req),
    format('R-H1g the recipient declines; the server records who and the note (%s)', v_state));
  perform pg_temp.act(v_ca_b);
  v_state := pg_temp.try(format('select public.decline_fixture_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '22023', format('R-H1h a decided request cannot be answered again (%s)', v_state));

  -- Withdraw by the requester, and a counter answered only in turn.
  perform pg_temp.act(v_ca_a);
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group, v_a14, v_b14, 'home', 'sent', v_ca_a) returning id into r14;
  perform pg_temp.act_postgres();
  perform pg_temp.act(v_ca_b);
  perform public.counter_fixture_request(r14, v_day + 1, '10:30'::time, 'home', 'Saturday instead', null);
  v_state := pg_temp.try(format('select public.decline_fixture_request(%L)', r14));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H1i the side that made the standing counter cannot decline it (%s)', v_state));
  perform pg_temp.act(v_ca_a);
  v_state := pg_temp.try(format('select public.withdraw_fixture_request(%L)', r14));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select status from public.fixture_requests where id = r14) = 'cancelled',
    format('R-H1j the requester withdraws its own open request (%s)', v_state));

  -- ================================================================================================================
  -- R-H5  PITCH ALLOCATION IS ITS OWN AUTHORITY
  -- ================================================================================================================
  insert into public.venues (club_id, name, slug) values (v_a, 'CAR Ground '||v_tag, 'car-ground-'||v_tag) returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_a, v_venue, 'Pitch 1', true) returning id into v_pitch;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_a, v_venue, 'Pitch 2', true) returning id into v_pitch2;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_id)
  values (v_a13, 'Home', 'Somebody RFC', v_day, '10:00', 'Booked', 'club_created', v_venue) returning id into v_fixture;
  -- An allocation volunteer: manage pitches, no fixture edit.
  v_alloc := pg_temp.person('ALLOC'); perform pg_temp.member(v_a, v_alloc);
  perform pg_temp.act(v_ca_a);
  perform public.set_capability_override(v_alloc, 'venue.pitch_allocation.manage', 'club', v_a, null, 'grant', 'car suite');
  perform public.set_capability_override(v_alloc, 'venue.pitch_allocation.view', 'club', v_a, null, 'grant', 'car suite');
  perform pg_temp.act_postgres();
  -- A fixture editor whose allocation authority is withheld.
  v_editor := pg_temp.person('EDITOR'); perform pg_temp.member(v_a, v_editor, 'FIXTURE_SECRETARY');
  perform pg_temp.act(v_ca_a);
  perform public.set_capability_override(v_editor, 'venue.pitch_allocation.manage', 'club', v_a, null, 'deny', 'car suite');
  perform pg_temp.act_postgres();
  v_nobody := pg_temp.person('NOBODY'); perform pg_temp.member(v_a, v_nobody);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_alloc, 'role', 'authenticated')::text, true);
  perform pg_temp.check(not internal.can_edit_fixture_schedule(v_fixture), 'R-H5a precondition: the allocator has no fixture edit');
  perform pg_temp.act_postgres();
  perform pg_temp.act(v_alloc);
  v_state := pg_temp.try(format('select public.allocate_fixture_pitch(%L, %L)', v_fixture, v_pitch));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select pitch_id from public.fixtures where id = v_fixture) = v_pitch,
    format('R-H5b manage pitch + no fixture edit => the placement lands (%s)', v_state));
  perform pg_temp.act(v_alloc);
  v_state := pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fixture, jsonb_build_object('pitch_id', v_pitch2)));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select pitch_id from public.fixtures where id = v_fixture) = v_pitch2,
    format('R-H5c ...and through the Arena''s placement writer (%s)', v_state));
  perform pg_temp.act(v_alloc);
  v_state := pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fixture, jsonb_build_object('catering_required', true)));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H5d allocation authority does not reach non-placement fixture details (%s)', v_state));
  perform pg_temp.act(v_alloc);
  v_state := pg_temp.try(format('select public.update_fixture_schedule(%L, %L, ''14:00''::time, %L, %L, null, ''PITCH_ALLOCATION'')', v_fixture, v_day, v_venue, v_pitch2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H5e a kick-off move remains a fixture edit (%s)', v_state));

  perform pg_temp.act(v_editor);
  v_state := pg_temp.try(format('select public.allocate_fixture_pitch(%L, %L)', v_fixture, v_pitch));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501' and (select pitch_id from public.fixtures where id = v_fixture) = v_pitch2,
    format('R-H5f fixture edit + allocation withheld => the board''s allocation is refused (%s)', v_state));
  perform pg_temp.act(v_nobody);
  v_state := pg_temp.try(format('select public.allocate_fixture_pitch(%L, %L)', v_fixture, v_pitch));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H5g neither => refused (%s)', v_state));
  perform pg_temp.act(v_ca_a);
  v_state := pg_temp.try(format('select public.allocate_fixture_pitch(%L, %L)', v_fixture, v_pitch));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select pitch_id from public.fixtures where id = v_fixture) = v_pitch,
    format('R-H5h the Club Admin allocates (%s)', v_state));
  perform pg_temp.act(v_ca_b);
  v_state := pg_temp.try(format('select public.allocate_fixture_pitch(%L, %L)', v_fixture, v_pitch2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('R-H5i another club''s admin cannot place on this club''s ground (%s)', v_state));

  -- ================================================================================================================
  -- R-M4/M5/M6/M9  CLUB DAY
  -- ================================================================================================================
  if v_season is null then
    raise notice 'SKIP R-M: no canonical union season covers the test date';
  else
    -- A third home team whose opponent has no compatible side: a Not Sent outcome in the batch.
    perform pg_temp.act(v_ca_a);
    v_j := jsonb_build_array(
      jsonb_build_object('requesting_team_id', v_a13, 'target_team_id', v_b13, 'venue_preference', 'home', 'note', 'Pitch 2?'),
      jsonb_build_object('requesting_team_id', v_a14, 'target_team_id', v_b14, 'venue_preference', 'away'),
      jsonb_build_object('requesting_team_id', v_a14, 'target_team_id', v_b13, 'venue_preference', 'away'));
    v_txt := gen_random_uuid()::text;
    v_r := public.planner_send_club_day(v_a, v_b, v_day + 7, v_txt::uuid, v_j);
    perform pg_temp.act_postgres();
    v_group := (v_r->>'group_id')::uuid;
    select id into r13 from public.fixture_requests where group_id = v_group and requesting_team_id = v_a13;
    select id into r14 from public.fixture_requests where group_id = v_group and requesting_team_id = v_a14;
    v_n := (select count(*) from jsonb_array_elements(v_r->'results') x where x->>'outcome' <> 'sent');

    -- M9: the same batch again returns the complete original outcome, refused items included.
    perform pg_temp.act(v_ca_a);
    v_j := public.planner_send_club_day(v_a, v_b, v_day + 7, v_txt::uuid, v_j);
    perform pg_temp.act_postgres();
    perform pg_temp.check((v_j->>'replay')::boolean and jsonb_array_length(v_j->'results') = jsonb_array_length(v_r->'results')
                          and (select count(*) from jsonb_array_elements(v_j->'results') x where x->>'outcome' <> 'sent') = v_n and v_n >= 1
                          and (select count(*) from public.fixture_requests where group_id = v_group) = 2,
      format('R-M9 a retried batch returns every original outcome (%s refused kept) and creates nothing', v_n));

    -- M4: an INDIVIDUAL decline (the request screen) refreshes the one summary; no per-fixture decline notice.
    perform pg_temp.act(v_ca_b);
    perform public.decline_fixture_request(r13, 'Cup match');
    perform pg_temp.act_postgres();
    perform pg_temp.check((select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text and user_id = v_ca_a) = 1
                          and (select count(*) from public.notifications where type = 'fixture_request_declined' and data->>'fixture_request_id' = r13::text) = 0,
      'R-M4a an individual decline refreshes the Club Day summary, with no per-fixture decline notice');

    -- M5: Burnley counters U14, then tries to decline its own counter through the Club Day.
    perform pg_temp.act(v_ca_b);
    perform public.counter_fixture_request(r14, v_day + 8, '11:15'::time, 'either', 'Saturday?', null);
    v_j := public.planner_respond_club_day(v_group, 'decline', array[r14], null);
    perform pg_temp.act_postgres();
    perform pg_temp.check((v_j->'results'->0->>'outcome') = 'not_actionable' and (select status from public.fixture_requests where id = r14) = 'counter_proposed',
      format('R-M5 a club cannot decline its own standing proposal inside a Club Day (%s)', v_j->'results'->0->>'outcome'));

    -- M6: the Club Day shows the suggested kick-off.
    perform pg_temp.act(v_ca_a);
    v_j := public.planner_club_day_detail(v_group);
    perform pg_temp.act_postgres();
    perform pg_temp.check((select f->>'kickoff' from jsonb_array_elements(v_j->'fixtures') f where (f->>'request_id')::uuid = r14) like '11:15%',
      'R-M6 the Club Day shows the effective (suggested) kick-off');

    -- M4b: the PLANNING club accepts Burnley's counter itself -- no "Burnley responded" summary is invented for that.
    v_n := (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text);
    perform pg_temp.act(v_ca_a);
    perform public.accept_fixture_request(r14);
    perform pg_temp.act_postgres();
    perform pg_temp.check((select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text) = v_n
                          and (select count(*) from public.notifications where type = 'club_day_responded' and data->>'group_id' = v_group::text and user_id = v_ca_a and read_at is null) = 1,
      'R-M4b the planning club answering a counter adds no summary; exactly ONE live summary remains');
  end if;
end $$;

rollback;
