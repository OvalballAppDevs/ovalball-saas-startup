-- The people who are going to the tournament can see the tournament.
--
-- WHAT WAS WRONG
--
-- `internal.tournament_visible_row` already carried two generous, correct-sounding branches: "anybody
-- with an active role at a club that entered a team", and "a player in an entered team, or the adult
-- responsible for one". Both read `tournament_team_entries` -- a source that has only ever held THE
-- HOST CLUB'S OWN teams. So the rule described every participating club and the data described one.
-- A visiting club's coach, team manager, member, parent and player saw nothing at all, which also
-- meant the tournament could never reach their Calendar.
--
-- 20270606 points both branches at `tournament_participants`, the one canonical table of sides since
-- 20270605, and consults the `tournament.tournament.view` capability that already existed and had
-- never been read anywhere. No new permission was invented and none was withdrawn.
--
-- WHY THIS SUITE EXISTS PERMANENTLY
--
-- A visibility rule fails in two opposite directions and only one of them is noticed. Too narrow and
-- somebody complains; too wide and nobody does. So every assertion here has a matching negative: for
-- each person who gains sight of a tournament, somebody comparable at an UNRELATED club is proved not
-- to. It also pins the thing that makes this safe to widen at all -- that seeing a tournament is not
-- managing one.
--
-- WHICH ASSERTIONS ACTUALLY DISCRIMINATE
--
-- The suite was run against the PRE-20270606 rule to check it is capable of failing. Assertions 4, 6,
-- 7, 8, 23 and 25 failed there and pass now; they are the ones carrying the correction. Assertions 3
-- and 5 passed under both, because a visiting club's ADMINISTRATOR and TEAM MANAGER already reached
-- the tournament through the older management branches (`tournament.tournament.manage` at club scope
-- and `calendar.event.manage` at team scope respectively) -- a coach holds neither, which is exactly
-- why the coach was the person who could not see his own side's festival. Those two are kept as
-- regression cover rather than as proof of the change.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tv-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tv', p_label, 'tv-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

-- A club WITH an Ovalball account. Returns the clubs.id; the directory id is read back where needed.
create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TV ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tv-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tv-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'tv-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

-- A team ROLE, not merely a membership: a TEAM-scope capability is refused to somebody with no active
-- role assignment for that team, and team_permissions is the write path that syncs into one.
create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text default 'COACH') returns void language plpgsql as $$
begin
  insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership, p_team, p_role_key);
end $$;

create or replace function pg_temp.player(p_team uuid, p_label text, p_user uuid default null, p_dob date default null,
                                          p_dispensation boolean default false) returns uuid language plpgsql as $$
declare v uuid; v_code text; v_age text;
begin
  -- With no date of birth given, the player is born inside the team's own age grade this season, which
  -- is what the age-grade placement guard checks.
  select rugby_code, age_group into v_code, v_age from public.teams where id = p_team;
  -- The pathway is stated, never assumed from the team: a player with none cannot join a boys' side,
  -- and Ovalball refuses to infer one.
  insert into public.players (first_name, surname, date_of_birth, user_id, playing_pathway)
  values ('Tv', p_label, coalesce(p_dob, internal.date_of_birth_in_age_grade(v_code, v_age)), p_user, 'MALE') returning id into v;
  -- A deliberate mismatch (an adult in a youth side) stands on an approved dispensation fixture.
  if p_dispensation then
    insert into public.player_team_dispensation (player_id, target_team_id, season_id, eligibility_rule_reference, status, governing_body_reference)
    values (v, p_team, internal.resolve_season_for_date(v_code, current_date), 'Suite fixture', 'approved', 'SUITE-FIXTURE');
  end if;
  insert into public.player_team_memberships (player_id, team_id, status) values (v, p_team, 'active');
  return v;
end $$;

create or replace function pg_temp.guardian_of(p_player uuid, p_user uuid) returns void language plpgsql as $$
begin
  insert into public.guardians (guardian_user_id, player_id, status, state) values (p_user, p_player, 'active', 'ACTIVE');
end $$;

-- SEES IT THE WAY THE APP DOES. Not the helper in isolation: the session is switched to that person
-- under the `authenticated` role, so RLS on public.tournaments is what actually answers.
create or replace function pg_temp.sees(p_user uuid, p_tournament uuid) returns boolean language plpgsql as $$
declare v int;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v from public.tournaments where id = p_tournament;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v = 1;
end $$;

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

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_guest uuid; v_other uuid;
  v_host_dir uuid; v_guest_dir uuid; v_other_dir uuid;
  v_unclaimed_dir uuid;
  v_host_u12 uuid; v_guest_u12 uuid; v_guest_u14 uuid; v_other_u12 uuid;
  v_host_ca uuid; v_host_mb uuid;
  v_guest_ca uuid; v_guest_mb uuid; v_guest_co uuid; v_mem_guest_co uuid;
  v_guest_tm uuid; v_mem_guest_tm uuid;
  v_guest_guardian uuid; v_guest_adult uuid;
  v_other_co uuid; v_mem_other_co uuid; v_other_guardian uuid;
  v_guest_child uuid; v_other_child uuid;
  v_outsider uuid;
  v_tournament uuid; v_public uuid; v_elsewhere uuid;
  v_guest_side uuid;
  v_n int;
  v_state text;
begin

v_host  := pg_temp.club('Host');
v_guest := pg_temp.club('Guest');
v_other := pg_temp.club('Other');
select directory_id into v_host_dir  from public.clubs where id = v_host;
select directory_id into v_guest_dir from public.clubs where id = v_guest;
select directory_id into v_other_dir from public.clubs where id = v_other;

-- A directory club with NO Ovalball account: it can be a side, and it has nobody to show anything to.
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TV Unclaimed RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual',
        'tv-unclaimed-' || substr(gen_random_uuid()::text, 1, 8))
returning id into v_unclaimed_dir;

v_host_u12  := pg_temp.team(v_host,  'U12');
v_guest_u12 := pg_temp.team(v_guest, 'U12');
v_guest_u14 := pg_temp.team(v_guest, 'U14');
v_other_u12 := pg_temp.team(v_other, 'U12');

v_host_ca := pg_temp.person('HostCA', v_adult); perform pg_temp.member(v_host, v_host_ca, 'CLUB_ADMIN');
v_host_mb := pg_temp.person('HostMB', v_adult); perform pg_temp.member(v_host, v_host_mb, 'BASIC_USER');

v_guest_ca := pg_temp.person('GuestCA', v_adult); perform pg_temp.member(v_guest, v_guest_ca, 'CLUB_ADMIN');
v_guest_mb := pg_temp.person('GuestMB', v_adult); perform pg_temp.member(v_guest, v_guest_mb, 'BASIC_USER');
v_guest_co := pg_temp.person('GuestCO', v_adult); v_mem_guest_co := pg_temp.member(v_guest, v_guest_co, 'BASIC_USER');
perform pg_temp.team_role(v_mem_guest_co, v_guest_u12, 'COACH');
v_guest_tm := pg_temp.person('GuestTM', v_adult); v_mem_guest_tm := pg_temp.member(v_guest, v_guest_tm, 'BASIC_USER');
perform pg_temp.team_role(v_mem_guest_tm, v_guest_u12, 'TEAM_MANAGER');

v_other_co := pg_temp.person('OtherCO', v_adult); v_mem_other_co := pg_temp.member(v_other, v_other_co, 'BASIC_USER');
perform pg_temp.team_role(v_mem_other_co, v_other_u12, 'COACH');

-- A guardian deliberately holds NO club membership: that is the ordinary case, and it is the one the
-- club_memberships branch cannot reach.
v_guest_guardian := pg_temp.person('GuestParent', v_adult);
v_other_guardian := pg_temp.person('OtherParent', v_adult);
v_outsider       := pg_temp.person('Outsider', v_adult);

v_guest_child := pg_temp.player(v_guest_u12, 'GuestChild');
perform pg_temp.guardian_of(v_guest_child, v_guest_guardian);
v_other_child := pg_temp.player(v_other_u12, 'OtherChild');
perform pg_temp.guardian_of(v_other_child, v_other_guardian);

-- An adult player who IS the user: no guardian, no club role, just a player in an entered side.
-- The entered side is U12, so the adult's place there stands on an approved dispensation fixture.
v_guest_adult := pg_temp.person('GuestAdultPlayer', v_adult);
perform pg_temp.player(v_guest_u12, 'GuestAdult', v_guest_adult, v_adult, true);

-- A PRIVATE tournament. Everything below is proved against a tournament that is not publicly
-- discoverable, so no pass can be explained away by public visibility.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_host, v_host_dir, 'union', current_date + 14, current_date + 14, 'confirmed', 'TV Private Festival',
        gen_random_uuid(), 'round_robin', 'private')
returning id into v_tournament;

insert into public.tournament_age_groups (tournament_id, age_group) values (v_tournament, 'U12');

insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_tournament, v_host_dir, v_host, v_host_u12, 'U12', 'added');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_tournament, v_guest_dir, v_guest, v_guest_u12, 'U12', 'added')
returning id into v_guest_side;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, squad_label, status)
values (v_tournament, v_unclaimed_dir, null, null, 'U12', 'A', 'external_recorded');

-- A SECOND private tournament that none of these people is in, hosted by the unrelated club. Sight of
-- one tournament must not be sight of tournaments in general.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_other, v_other_dir, 'union', current_date + 21, current_date + 21, 'confirmed', 'TV Elsewhere Festival',
        gen_random_uuid(), 'round_robin', 'private')
returning id into v_elsewhere;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_elsewhere, 'U12');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_elsewhere, v_other_dir, v_other, v_other_u12, 'U12', 'added');

-- ============ A. The host keeps everything it had ============
--
-- The two branches being corrected used to read a host-only source. Widening their source must not
-- cost the host a single viewer, so the host's people are asserted first.

perform pg_temp.check(pg_temp.sees(v_host_ca, v_tournament),
  '1 (A): the host club administrator sees the tournament it is running');
perform pg_temp.check(pg_temp.sees(v_host_mb, v_tournament),
  '2 (A): an ordinary member of the host club still sees it -- the club_memberships branch survived the change of source');

-- ============ B. A participating club's own people ============

perform pg_temp.check(pg_temp.sees(v_guest_ca, v_tournament),
  '3 (B): the administrator of a VISITING club sees the tournament its side is entered in');
perform pg_temp.check(pg_temp.sees(v_guest_co, v_tournament),
  '4 (B): the COACH of the entered team sees it -- the headline defect, by tournament.tournament.view at team scope');
perform pg_temp.check(pg_temp.sees(v_guest_tm, v_tournament),
  '5 (B): the TEAM MANAGER of the entered team sees it');
perform pg_temp.check(pg_temp.sees(v_guest_mb, v_tournament),
  '6 (B): an ORDINARY MEMBER of the visiting club sees it -- the club_memberships branch, now true of every side and not just the host''s');

-- ============ C. The family of a player in an entered side ============

perform pg_temp.check(pg_temp.sees(v_guest_guardian, v_tournament),
  '7 (C): the guardian of a child in the entered team sees it, holding no club membership at all');
perform pg_temp.check(pg_temp.sees(v_guest_adult, v_tournament),
  '8 (C): an adult player in the entered team sees it as themselves');

-- ============ D. The matching negatives ============
--
-- Each of these is the same KIND of person as a pass above, at a club that is not in the tournament.

perform pg_temp.check(not pg_temp.sees(v_other_co, v_tournament),
  '9 (D): a coach at an unrelated club does NOT see it');
perform pg_temp.check(not pg_temp.sees(v_other_guardian, v_tournament),
  '10 (D): a parent at an unrelated club does NOT see it');
perform pg_temp.check(not pg_temp.sees(v_outsider, v_tournament),
  '11 (D): a signed-in person with no club, team or child does NOT see a private tournament');

perform pg_temp.check(not pg_temp.sees(v_guest_co, v_elsewhere),
  '12 (D): seeing ONE tournament is not seeing tournaments -- the guest coach cannot see a festival his side is not in');
perform pg_temp.check(not pg_temp.sees(v_guest_guardian, v_elsewhere),
  '13 (D): nor can the guest guardian');

-- ============ E. Scoped to the ENTERED team, not the whole club's teams ============
--
-- A coach whose authority is at U14 must not inherit sight of a U12 festival through his club; he will
-- have it only if his club holds a club-scope capability of its own. So the probe is a person whose
-- ONLY authority is the team that is not entered, with no club membership to fall back on.

declare
  v_u14_only uuid; v_mem_u14 uuid; v_u14_guardian uuid; v_u14_child uuid;
begin
  v_u14_guardian := pg_temp.person('GuestU14Parent', v_adult);
  v_u14_child := pg_temp.player(v_guest_u14, 'GuestU14Child');
  perform pg_temp.guardian_of(v_u14_child, v_u14_guardian);
  perform pg_temp.check(not pg_temp.sees(v_u14_guardian, v_tournament),
    '14 (E): the guardian of a child in the club''s U14 side -- a side NOT entered -- does not see the U12 festival');
end;

-- ============ F. An unclaimed directory club has nobody to show it to ============

select count(*) into v_n
from public.tournament_participants tp
where tp.tournament_id = v_tournament and tp.club_directory_id = v_unclaimed_dir and tp.club_id is null and tp.team_id is null;
perform pg_temp.check(v_n = 1,
  '15 (F): a club that is not on Ovalball is a side, carrying no club_id and no team_id');

select count(*) into v_n from public.clubs where directory_id = v_unclaimed_dir;
perform pg_temp.check(v_n = 0,
  '16 (F): and it has no Ovalball club, so no membership, capability or family join can match on it');

-- ============ G. SEEING IS NOT MANAGING ============
--
-- The point of the whole change. Everybody who gained sight above must still be refused every write.

v_state := pg_temp.try_as(v_guest_co,
  format('select public.add_tournament_participant_team(%L::uuid, %L::uuid, null, null, null, %L)',
         v_tournament, v_other_dir, 'U12'));
perform pg_temp.check(v_state = '42501',
  format('17 (G): the participating coach who can now SEE the tournament cannot add a side to it (got %s)', v_state));

v_state := pg_temp.try_as(v_guest_guardian,
  format('select public.add_tournament_participant_team(%L::uuid, %L::uuid, null, null, null, %L)',
         v_tournament, v_other_dir, 'U12'));
perform pg_temp.check(v_state = '42501',
  format('18 (G): nor can the guardian (got %s)', v_state));

v_state := pg_temp.try_as(v_guest_co,
  format('update public.tournaments set name = ''Renamed by a viewer'' where id = %L::uuid', v_tournament));
select count(*) into v_n from public.tournaments where id = v_tournament and name = 'TV Private Festival';
perform pg_temp.check(v_n = 1,
  '19 (G): a viewer''s direct UPDATE of the tournament changes nothing -- read policy widened, write policy did not');

v_state := pg_temp.try_as(v_guest_co, format('delete from public.tournament_participants where id = %L::uuid', v_guest_side));
select count(*) into v_n from public.tournament_participants where id = v_guest_side;
perform pg_temp.check(v_n = 1,
  '20 (G): nor can a viewer delete a side, including their own club''s');

-- ============ H. Public discovery is untouched ============

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_other, v_other_dir, 'union', current_date + 28, current_date + 28, 'confirmed', 'TV Public Festival',
        gen_random_uuid(), 'round_robin', 'public')
returning id into v_public;

perform pg_temp.check(pg_temp.sees(v_outsider, v_public),
  '21 (H): a public tournament is still visible to any signed-in person');
perform pg_temp.check(not pg_temp.sees(v_outsider, v_tournament),
  '22 (H): and the private one beside it still is not -- the two are decided separately');

-- ============ I. The rule reads the canonical table, permanently ============
--
-- Asserted structurally as well as behaviourally, because a future edit that reinstated the host-only
-- source would turn the visitors' passes above into failures somewhere far away from this suite.

-- THE RULE IS NOW TWO FUNCTIONS, SO THE SOURCE TEST FOLLOWS IT RATHER THAN BEING DROPPED.
--
-- `internal.tournament_visible_row` answers "may this person see that this tournament exists";
-- `internal.tournament_participant_viewer` answers "does this person BELONG to it". The participant
-- branches live in the second, because Results needs that question on its own -- a publicly listed
-- festival may keep its scores inside it, and the public-discovery branch of the first would hand
-- those scores to anybody signed in.
--
-- WHAT WAS BEING PROTECTED IS UNCHANGED and is asserted ACROSS BOTH, which is strictly stronger than
-- the single-function test it replaces: the host-only table must appear in neither, and the canonical
-- sides table and the view capability must be reached from the ladder that visibility actually uses.
-- Assertion 25b pins the delegation itself, so moving a branch out and forgetting to call it fails
-- here rather than silently narrowing who can see a tournament.

perform pg_temp.check(
  position('tournament_team_entries' in
    (select coalesce(string_agg(pg_get_functiondef(oid), E'\n'), '') from pg_proc
     where proname in ('tournament_visible_row', 'tournament_participant_viewer')
       and pronamespace = 'internal'::regnamespace)) = 0,
  '23 (I): neither visibility function reads the host-only tournament_team_entries');

perform pg_temp.check(
  position('tournament_participants' in
    (select coalesce(string_agg(pg_get_functiondef(oid), E'\n'), '') from pg_proc
     where proname in ('tournament_visible_row', 'tournament_participant_viewer')
       and pronamespace = 'internal'::regnamespace)) > 0,
  '24 (I): they read tournament_participants, the one canonical table of sides');

perform pg_temp.check(
  position('tournament.tournament.view' in
    (select coalesce(string_agg(pg_get_functiondef(oid), E'\n'), '') from pg_proc
     where proname in ('tournament_visible_row', 'tournament_participant_viewer')
       and pronamespace = 'internal'::regnamespace)) > 0,
  '25 (I): and they consult the tournament.tournament.view capability that already existed');

perform pg_temp.check(
  position('tournament_participant_viewer' in
    (select pg_get_functiondef(oid) from pg_proc
     where proname = 'tournament_visible_row' and pronamespace = 'internal'::regnamespace)) > 0,
  '25b (I): and tournament_visible_row reaches them by CALLING the one participant authority, rather than carrying a second copy of it');

select count(*) into v_n from public.bundle_capabilities
where capability_key = 'tournament.tournament.view' and bundle_key in ('CO', 'TM') and scope_type = 'team';
perform pg_temp.check(v_n = 2,
  '26 (I): that capability is held at TEAM scope by coach and team manager -- no new grant was needed');

end $$;

rollback;
