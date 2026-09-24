-- GUARDIANS & PLAYERS (CA-M11.1) -- THE CLUB'S ADMINISTRATION OF PLAYERS AND GUARDIANS, PROVED WHERE IT IS ENFORCED.
--
-- The phone's Guardians & Players screens consume server decisions and cannot widen them. This suite proves
-- the boundaries those screens (and the website's six pages) depend on:
--
--   GP-A  the gate: a Club Admin without family.relationship.approve gets nothing from the approval queue or
--         the guardian directory; one with it gets the rows, and the directory carries the email
--   GP-B  cross-club: another club's Club Admin reads nothing, decides nothing, moves nothing, asks nothing
--   GP-C  the second factor: decisions the catalogue declares R are accepted with a recent authenticator; the
--         refusal WITHOUT one is a documented gap (the operations do not yet call require_recent_aal2) and is
--         pinned as such so the day it is closed is loud, not silent
--   GP-D  a move needs team.roster.manage on BOTH sides; the one operation, one transaction, one event
--   GP-E  the staff projection carries no date of birth, no gender value and no login id; the club cannot read
--         players.playing_pathway at all, and may only ask a guardian for it
--   GP-F  a duplicate review is resolved by the club alone, never a team-scoped holder
--   GP-G  a player asking to join is placed on one of this club's own sides, once; already resolved is an answer
--   GP-H  a replacement guardian invitation is the club's to issue, and returns a token
--   GP-I  a call-up onto this club's side is raised by the club and decided by the source side's club, never a
--         team-scoped holder; a dispensation walks its stages and the requester never approves their own
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

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gp-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Gp', p_label, 'gp-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.session(p_user uuid, p_aal text default 'aal1', p_recent boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), p_aal::auth.aal_level);
  if p_recent then
    insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v, 'totp', now(), now());
  end if;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('GP ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gp-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'gp-' || v_tag, 'active') returning id into v_club;
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

create or replace function pg_temp.child(p_first text, p_years int, p_team uuid) returns uuid language plpgsql as $$
declare v uuid; v_m uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values (p_first, 'Gpchild', (current_date - (p_years || ' years')::interval)::date, 'MALE') returning id into v;
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED') returning id into v_m;
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

-- A clean-boot database has an empty season register; the age-grade reads below need one covering today.
insert into public.seasons (name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture)
select 'GP Suite Season', current_date - 100, current_date + 100, current_date - 110, 'union', extract(year from current_date - 100)::int, false
where internal.resolve_season_for_date('union', current_date) is null
  and not exists (select 1 from public.seasons where rugby_code = 'union' and season_year_start = extract(year from current_date - 100)::int);

do $$
declare
  v_club uuid; v_club_b uuid; v_t1 uuid; v_t2 uuid; v_tb uuid;
  v_ca uuid; v_ca2 uuid; v_ca_b uuid; v_tm uuid; v_parent uuid; v_parent2 uuid; v_req1 uuid; v_req2 uuid; v_req3 uuid; v_adult uuid; v_adult2 uuid;
  v_ca_s1 uuid; v_ca_s2 uuid; v_ca2_s uuid; v_ca_b_s uuid; v_tm_s uuid; v_parent_s uuid;
  v_c1 uuid; v_c2 uuid; v_ap1 uuid; v_ap2 uuid;
  v_g_parent_c1 uuid; v_g_parent2_c1 uuid; v_g_parent_c2 uuid;
  v_req1_id uuid; v_req2_id uuid; v_review uuid; v_jr1 uuid; v_jr2 uuid; v_c2_place uuid; v_fixture uuid;
  v_state text; v_state2 text; v_n bigint; v_m bigint; v_text text; v_bool boolean; v_uuid uuid; v_season uuid; v_disp uuid; v_callup uuid; v_tm_membership uuid;
  r record;
begin
  -- =====================================================================================
  -- SEED. Club A with two sides; Club B with one. A Club Admin (two sessions: one aal1, one recently
  -- verified); a second Club Admin with family.relationship.approve WITHHELD at the club; Club B's
  -- admin; a Team Manager on A's U12 only; two parents; three applicants; two adult players.
  -- =====================================================================================
  v_club := pg_temp.club('Alpha');
  v_club_b := pg_temp.club('Beta');
  v_t1 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t2 := pg_temp.team(v_club, 'u13', 'U13', 'Under 13 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');

  v_ca := pg_temp.person('Admin');
  v_ca2 := pg_temp.person('Withheld');
  v_ca_b := pg_temp.person('BetaAdmin');
  v_tm := pg_temp.person('Manager');
  v_parent := pg_temp.person('Parent');
  v_parent2 := pg_temp.person('SecondParent');
  v_req1 := pg_temp.person('ApplicantOne');
  v_req2 := pg_temp.person('ApplicantTwo');
  v_req3 := pg_temp.person('ApplicantThree');
  v_adult := pg_temp.person('AdultPlayer');
  v_adult2 := pg_temp.person('AdultPlayerTwo');

  perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  perform pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  perform pg_temp.member(v_club_b, v_ca_b, 'CLUB_ADMIN');
  v_tm_membership := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_tm_membership, v_t1, 'manager');
  perform pg_temp.member(v_club, v_parent, 'BASIC_USER');
  perform pg_temp.member(v_club, v_parent2, 'BASIC_USER');

  -- The withheld admin: a CLUB-level deny on the one key the section is gated on, as a Site Admin or another
  -- Club Admin would record it. Inserted here directly so this suite depends on no other operation's R rule.
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, reason, granted_by, granted_level, status)
  values (v_ca2, 'family.relationship.approve', 'club', v_club, null, 'deny', 'CA-M11.1 suite', v_ca, 'CLUB', 'active');

  v_ca_s1 := pg_temp.session(v_ca, 'aal1', false);
  v_ca_s2 := pg_temp.session(v_ca, 'aal2', true);
  v_ca2_s := pg_temp.session(v_ca2, 'aal2', true);
  v_ca_b_s := pg_temp.session(v_ca_b, 'aal2', true);
  v_tm_s := pg_temp.session(v_tm, 'aal2', true);
  v_parent_s := pg_temp.session(v_parent, 'aal2', true);

  v_c1 := pg_temp.child('Childone', 11, v_t1);
  v_c2 := pg_temp.child('Childtwo', 11, v_t1);
  select id into v_c2_place from public.player_team_memberships where player_id = v_c2 and team_id = v_t1;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values (v_parent, v_c1, 'parent', 'active', 'ACTIVE', 'CLUB_CREATED') returning id into v_g_parent_c1;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values (v_parent2, v_c1, 'parent', 'active', 'ACTIVE', 'CLUB_CREATED') returning id into v_g_parent2_c1;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values (v_parent, v_c2, 'parent', 'active', 'ACTIVE', 'CLUB_CREATED') returning id into v_g_parent_c2;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Adult', 'Gpplayer', (current_date - interval '30 years')::date, 'MALE', v_adult) returning id into v_ap1;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Adulttwo', 'Gpplayer', (current_date - interval '31 years')::date, 'MALE', v_adult2) returning id into v_ap2;

  -- Two first-child requests matched to the child already on U12, from two different applicants.
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id)
  values ('FIRST_CHILD', 'PENDING', v_req1, v_req1, v_club, 'union', 'Childone', 'Gpchild', (select date_of_birth from public.players where id = v_c1), v_c1) returning id into v_req1_id;
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id)
  values ('FIRST_CHILD', 'PENDING', v_req2, v_req2, v_club, 'union', 'Childone', 'Gpchild', (select date_of_birth from public.players where id = v_c1), v_c1) returning id into v_req2_id;

  -- A possible duplicate: a third applicant submitted the same child.
  insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
  values (v_t1, 'Childone', 'Gpchild', (select date_of_birth from public.players where id = v_c1), 'MALE', v_c1, v_req3, v_req3) returning id into v_review;

  -- Two adults asking to join Club A.
  insert into public.player_club_join_requests (player_id, club_id, requested_by, resolved_category, status) values (v_ap1, v_club, v_adult, 'Adult Men''s Rugby', 'pending') returning id into v_jr1;
  insert into public.player_club_join_requests (player_id, club_id, requested_by, resolved_category, status) values (v_ap2, v_club, v_adult2, 'Adult Men''s Rugby', 'pending') returning id into v_jr2;

  -- A fixture for U13 next week, so U13 can ask to borrow a U12 player.
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values (v_t2, current_date + 7, 'Home', 'GP Opposition', 'Planned') returning id into v_fixture;
  v_season := internal.resolve_season_for_date('union', current_date);

  perform pg_temp.check(v_req1_id is not null and v_review is not null and v_jr1 is not null and v_fixture is not null and v_season is not null,
    'GP-0 seeded: two clubs, three sides, two children with guardians, two link requests, a duplicate review, two join requests, a fixture, a season');

  -- =====================================================================================
  -- GP-A. The gate is the key, not the role.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select count(*) into v_n from public.my_capabilities('club', v_club) c
   where c.allowed and c.capability_key in ('family.relationship.approve','family.relationship.remove','family.duplicate.resolve','team.join_request.review','team.roster.manage',
                                            'fixture.callup.request','fixture.callup.approve','fixture.dispensation.request','fixture.dispensation.approve_club','player.pathway.request','player.profile.view');
  perform pg_temp.check(v_n = 11, format('GP-A1 the Club Admin holds all eleven keys the section probes at club scope (%s)', v_n));
  select count(*) into v_n from public.guardian_link_requests_for_approval(v_club);
  select count(*) into v_m from public.get_team_guardian_directory(v_t1) d where d.guardian_email is not null;
  perform pg_temp.check(v_n = 2 and v_m = 3, format('GP-A2 with the key: both link requests (%s) and the directory rows carry the guardian email (%s)', v_n, v_m));
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_ca2, v_ca2_s);
  select bool_or(c.allowed) into v_bool from public.my_capabilities('club', v_club) c where c.capability_key = 'family.relationship.approve';
  select count(*) into v_n from public.guardian_link_requests_for_approval(v_club);
  select count(*) into v_m from public.get_team_guardian_directory(v_t1);
  v_state := pg_temp.try(format('select public.send_replacement_guardian_invitation(%L, %L, %L)', v_c1, v_t1, 'gp-replacement@ovalball.test'));
  perform pg_temp.check(coalesce(v_bool, false) = false and v_n = 0 and v_m = 0 and v_state = '42501',
    format('GP-A3 a Club Admin without family.relationship.approve: the probe says no (%s), the queue is empty (%s), the directory is empty (%s), a replacement invitation is refused (%s)', v_bool, v_n, v_m, v_state));
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- GP-B. Another club's Club Admin.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca_b, v_ca_b_s);
  select count(*) into v_n from public.guardian_link_requests_for_approval(v_club);
  select count(*) into v_m from public.get_team_guardian_directory(v_t1);
  perform pg_temp.check(v_n = 0 and v_m = 0, format('GP-B1 cross-club: the queue (%s) and the directory (%s) are empty', v_n, v_m));
  v_state := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req1_id));
  v_state2 := pg_temp.try(format('select * from public.remove_guardian_relationship(%L, %L)', v_g_parent2_c1, 'cross-club'));
  perform pg_temp.check(v_state = '42501' and v_state2 = '42501', format('GP-B2 cross-club: approving a link (%s) and removing a guardian (%s) are refused', v_state, v_state2));
  v_state := pg_temp.try(format('select public.resolve_player_duplicate_review_as_existing(%L)', v_review));
  -- One of Club A's own sides is named, so it is the authority that refuses (the operation validates the side first).
  v_state2 := pg_temp.try(format('select public.approve_player_club_join_request(%L, %L)', v_jr2, v_t1));
  perform pg_temp.check(v_state = '42501' and v_state2 = '42501', format('GP-B3 cross-club: resolving a duplicate (%s) and placing a join request onto the other club''s side (%s) are refused', v_state, v_state2));
  v_state := pg_temp.try(format('select public.move_player_team_membership(%L, %L, %L)', v_c2_place, v_tb, 'cross-club'));
  v_state2 := pg_temp.try(format('select public.request_player_playing_pathway(%L)', v_c1));
  select count(*) into v_n from public.player_staff_view where id in (v_c1, v_c2);
  perform pg_temp.check(v_state = '42501' and v_state2 = '42501' and v_n = 0, format('GP-B4 cross-club: a move (%s), asking for a gender (%s) and the staff projection (%s rows) give nothing', v_state, v_state2, v_n));
  v_state := pg_temp.try(format('select public.request_player_call_up(%L, %L, %L, %L, %L)', v_fixture, v_c1, v_t1, v_t2, 'RFU age-grade continuum'));
  perform pg_temp.check(v_state = '42501', format('GP-B5 cross-club: a call-up onto another club''s side is refused (%s)', v_state));
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- GP-C. The second factor. The catalogue declares these R; the operations do not yet enforce it.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s1);
  v_bool := internal.recent_aal2(10);
  v_state := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req1_id));
  perform pg_temp.check(coalesce(v_bool, false) = false and v_state = 'OK',
    format('GP-C1 DOCUMENTED GAP (CA-M11.1, no migration): approve_guardian_link_request is ACCEPTED at aal1 with no recent code (%s) -- the catalogue declares R but the operation does not call require_recent_aal2; the phone''s step-up path is ready for the day it does; update this pin then', v_state));
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_bool := internal.recent_aal2(10);
  v_state := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req2_id));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.guardians where guardian_user_id = v_req2 and player_id = v_c1 and state = 'ACTIVE';
  select count(*) into v_m from public.security_events where event_type = 'guardian.link_approved' and player_id = v_c1 and actor_user_id = v_ca;
  perform pg_temp.check(coalesce(v_bool, false) and v_state = 'OK' and v_n = 1 and v_m >= 1,
    format('GP-C2 with a recent second factor the approval lands (%s): the relationship is ACTIVE (%s) and guardian.link_approved is recorded (%s)', v_state, v_n, v_m));

  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select * from public.remove_guardian_relationship(%L, %L)', v_g_parent2_c1, ''));
  select orphaned into v_bool from public.remove_guardian_relationship(v_g_parent2_c1, 'CA-M11.1 suite: second parent');
  perform pg_temp.act_postgres();
  select state into v_text from public.guardians where id = v_g_parent2_c1;
  perform pg_temp.check(v_state = '22023' and v_bool = false and v_text = 'REVOKED',
    format('GP-C3 removal needs a reason (%s); with one it lands, REVOKED (%s), and with other guardians left it is not orphaned (%s)', v_state, v_text, v_bool));

  perform pg_temp.act('authenticated', v_ca, v_ca_s1);
  select orphaned into v_bool from public.remove_guardian_relationship(v_g_parent_c2, 'CA-M11.1 suite: only parent');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool = true, format('GP-C4 DOCUMENTED GAP: remove_guardian_relationship is accepted at aal1 too; removing the only guardian reports orphaned (%s) so the screen can raise GUARDIAN REQUIRED', v_bool));

  -- =====================================================================================
  -- GP-H (first, while the child still has a guardian to ask). The club may ask for a gender; never read it.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select public.request_player_playing_pathway(v_c1) into v_n;
  select count(*) into v_m from public.players where id = v_c1;
  perform pg_temp.act_postgres();
  select count(*) into v_state from public.notifications where user_id = v_parent and type = 'player_information_requested' and (data->>'player_id')::uuid = v_c1;
  perform pg_temp.check(v_n = 3 and v_m = 0 and v_state::bigint >= 1,
    format('GP-H1 the club asks every active guardian (%s notified, %s to the parent) and cannot read the players row at all (%s rows)', v_n, v_state, v_m));

  -- =====================================================================================
  -- GP-E. The staff projection.
  -- =====================================================================================
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'player_staff_view' and column_name in ('date_of_birth', 'playing_pathway', 'user_id');
  perform pg_temp.check(v_n = 0, 'GP-E1 player_staff_view carries no date_of_birth, playing_pathway or user_id column');
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select count(*), bool_and(has_date_of_birth) and bool_and(has_playing_pathway) and bool_and(not is_adult) into v_n, v_bool from public.player_staff_view where id in (v_c1, v_c2);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 2 and v_bool, format('GP-E2 the club reads its two children through the projection (%s rows): flags only, minors, never the values', v_n));

  -- =====================================================================================
  -- GP-I. Call-ups and dispensations (before the move, while the child is still on U12).
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select public.request_player_call_up(v_fixture, v_c1, v_t1, v_t2, 'RFU age-grade continuum') into v_callup;
  perform pg_temp.act_postgres();
  select status into v_text from public.fixture_player_call_up where id = v_callup;
  perform pg_temp.check(v_callup is not null and v_text in ('requested', 'awaiting_eligibility'), format('GP-I1 the club raises a call-up onto its own side; the canonical rule sets its status (%s)', v_text));
  perform pg_temp.act('authenticated', v_tm, v_tm_s);
  v_state := pg_temp.try(format('select public.decide_player_call_up(%L, %L, %L)', v_callup, 'reject', 'team manager'));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('GP-I2 a Team Manager on the source side cannot decide it: fixture.callup.approve is club-scoped only (%s)', v_state));
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select public.decide_player_call_up(%L, %L, %L)', v_callup, 'reject', 'CA-M11.1 suite'));
  perform pg_temp.act_postgres();
  select status into v_text from public.fixture_player_call_up where id = v_callup;
  perform pg_temp.check(v_state = 'OK' and v_text = 'rejected', format('GP-I3 the source side''s club decides it (%s -> %s)', v_state, v_text));

  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select public.request_player_dispensation(v_c1, v_t1, v_t2, v_season, 'GOVERNING-BODY CONFIRMATION REQUIRED') into v_disp;
  v_state := pg_temp.try(format('select public.decide_player_dispensation(%L, %L, %L)', v_disp, 'source_team', true));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_disp is not null and v_state = '42501', format('GP-I4 the requester of a dispensation cannot approve their own (%s)', v_state));
  perform pg_temp.act('authenticated', v_ca2, v_ca2_s);
  v_state := pg_temp.try(format('select public.decide_player_dispensation(%L, %L, %L)', v_disp, 'source_team', true));
  v_state2 := pg_temp.try(format('select public.decide_player_dispensation(%L, %L, %L)', v_disp, 'club', true));
  v_text := pg_temp.try(format('select public.decide_player_dispensation(%L, %L, %L, %L)', v_disp, 'governing_body', true, ''));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and v_state2 = 'OK' and v_text <> 'OK', format('GP-I5 another Club Admin walks the stages in order: source team (%s), club (%s); the governing-body stage refuses an empty reference (%s)', v_state, v_state2, v_text));
  perform pg_temp.act('authenticated', v_ca2, v_ca2_s);
  v_state := pg_temp.try(format('select public.decide_player_dispensation(%L, %L, %L, %L)', v_disp, 'governing_body', true, 'RFU/GP/001'));
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state2 := pg_temp.try(format('select public.revoke_player_dispensation(%L, %L)', v_disp, 'CA-M11.1 suite: revoked'));
  perform pg_temp.act_postgres();
  select status, governing_body_reference into v_text, v_state from public.player_team_dispensation where id = v_disp;
  perform pg_temp.check(v_state2 = 'OK' and v_text = 'revoked' and v_state = 'RFU/GP/001', format('GP-I6 the governing-body reference is recorded (%s) and the club may revoke an approved dispensation (%s)', v_state, v_text));

  -- =====================================================================================
  -- GP-D. A move needs authority over BOTH sides.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm, v_tm_s);
  select bool_or(c.allowed) into v_bool from public.my_capabilities('team', v_club, v_t1) c where c.capability_key = 'team.roster.manage';
  v_state := pg_temp.try(format('select public.move_player_team_membership(%L, %L, %L)', v_c2_place, v_t2, 'team manager move'));
  perform pg_temp.act_postgres();
  perform pg_temp.check(coalesce(v_bool, false) and v_state = '42501', format('GP-D1 a Team Manager who manages the source side (%s) but not the target is refused (%s)', v_bool, v_state));
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select public.move_player_team_membership(%L, %L, %L)', v_c2_place, v_t2, 'CA-M11.1 suite: moved'));
  v_state2 := pg_temp.try(format('select public.move_player_team_membership(%L, %L, %L)', v_c2_place, v_t2, 'again'));
  perform pg_temp.act_postgres();
  select state into v_text from public.player_team_memberships where id = v_c2_place;
  select count(*) into v_n from public.player_team_memberships where player_id = v_c2 and team_id = v_t2 and state = 'ACTIVE' and source = 'TEAM_MOVE';
  select count(*) into v_m from public.security_events where event_type = 'player_team.moved' and player_id = v_c2;
  perform pg_temp.check(v_state = 'OK' and v_text = 'ENDED' and v_n = 1 and v_m = 1 and v_state2 = '23514',
    format('GP-D2 the club moves the place in one transaction (%s): old ENDED (%s), new ACTIVE by TEAM_MOVE (%s), one player_team.moved event (%s); an ended place cannot be moved again (%s)', v_state, v_text, v_n, v_m, v_state2));

  -- =====================================================================================
  -- GP-F. A duplicate review is the club's alone.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm, v_tm_s);
  select count(*) into v_n from public.player_duplicate_reviews where id = v_review;
  v_state := pg_temp.try(format('select public.resolve_player_duplicate_review_as_existing(%L)', v_review));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0 and v_state = '42501', format('GP-F1 a team-scoped holder neither sees (%s rows) nor resolves (%s) a duplicate review', v_n, v_state));
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select public.resolve_player_duplicate_review_as_existing(%L)', v_review));
  v_state2 := pg_temp.try(format('select public.resolve_player_duplicate_review_as_existing(%L)', v_review));
  perform pg_temp.act_postgres();
  select status into v_text from public.player_duplicate_reviews where id = v_review;
  select count(*) into v_n from public.guardians where guardian_user_id = v_req3 and player_id = v_c1;
  perform pg_temp.check(v_state = 'OK' and v_text = 'linked_existing' and v_n = 1 and v_state2 = '23514',
    format('GP-F2 the club resolves it as the same child (%s -> %s), linking the applicant (%s); it is terminal (%s)', v_state, v_text, v_n, v_state2));

  -- =====================================================================================
  -- GP-G. Players asking to join.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select public.approve_player_club_join_request(%L, %L)', v_jr1, v_tb));
  v_state2 := pg_temp.try(format('select public.approve_player_club_join_request(%L, %L)', v_jr1, v_t1));
  v_text := pg_temp.try(format('select public.approve_player_club_join_request(%L, %L)', v_jr1, v_t1));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_team_memberships where player_id = v_ap1 and team_id = v_t1 and state = 'ACTIVE' and source = 'PLAYER_JOIN_REQUEST';
  perform pg_temp.check(v_state = '23514' and v_state2 = 'OK' and v_n = 1 and v_text = 'P0001',
    format('GP-G1 another club''s side is refused (%s); one of this club''s sides places the player (%s, %s place); a second decision finds it already resolved (%s)', v_state, v_state2, v_n, v_text));
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  v_state := pg_temp.try(format('select public.decline_player_club_join_request(%L, %L)', v_jr2, 'our squads are full this season'));
  perform pg_temp.act_postgres();
  select status, decline_reason into v_text, v_state2 from public.player_club_join_requests where id = v_jr2;
  perform pg_temp.check(v_state = 'OK' and v_text = 'declined' and v_state2 = 'our squads are full this season', format('GP-G2 a decline lands with the reason the player will read (%s, %s)', v_text, v_state2));

  -- =====================================================================================
  -- GP-H2. A replacement invitation returns a token bound to the player.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_ca_s2);
  select token into v_text from public.send_replacement_guardian_invitation(v_c1, v_t1, 'gp-replacement@ovalball.test');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.guardian_invitations where replacement_for_player_id = v_c1 and invited_email = 'gp-replacement@ovalball.test';
  perform pg_temp.check(v_text is not null and v_n = 1, format('GP-H2 the club issues a replacement invitation bound to the player and receives the token to pass on (%s row)', v_n));
end $$;

rollback;
