-- A coach can tell the squad about training -- and only the right people hear.
--
-- THE RULES
--
-- Training communication is a training-management act, so it resolves through
-- internal.can_manage_training. A guardian or player never satisfies that,
-- however legitimately they can open the session.
--
-- Audiences are CATEGORIES resolved server-side from the canonical register.
-- The browser sends a word; nothing in the call names a recipient. And who a
-- child may be contacted THROUGH is not decided here at all: it delegates to
-- internal.notifiable_users_for_players, the same function fixtures use, so
-- the two event kinds cannot drift apart on safeguarding.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid; v_session uuid;
  v_kid uuid; v_teen uuid; v_adult uuid;
  v_n int; v_blocked boolean; v_outcome text; v_players int; v_recips int;
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'tcm-admin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_coach,'tcm-coach@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_parent,'tcm-parent@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger,'tcm-stranger@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'Tcm','Admin','tcm-admin@ovalball-test.invalid'),
  (v_coach,'Tcm','Coach','tcm-coach@ovalball-test.invalid'),
  (v_parent,'Tcm','Parent','tcm-parent@ovalball-test.invalid'),
  (v_stranger,'Tcm','Stranger','tcm-stranger@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TCM RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tcm-'||v_slug) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'tcm-'||v_slug,'active') returning id into v_club;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club,'union','youth','U12','boys','Under 12 Boys','tcm-u12-'||v_slug,false) returning id into v_team;

-- The coach: a club member with a team_permissions row, which is what makes
-- them staff. No club role beyond BASIC_USER.
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
select id, v_team, 'team_admin' from public.club_memberships where user_id = v_coach and club_id = v_club;

-- Three players covering the three safeguarding bands.
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tcm','Child', (current_date - interval '11 years')::date, 'MALE') returning id into v_kid;
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tcm','Teen', (current_date - interval '17 years')::date, 'MALE') returning id into v_teen;
insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
values ('Tcm','Adult', (current_date - interval '25 years')::date, 'MALE', v_stranger) returning id into v_adult;

insert into public.player_team_memberships (player_id, team_id, status)
values (v_kid, v_team, 'active'), (v_teen, v_team, 'active'), (v_adult, v_team, 'active');
insert into public.guardians (guardian_user_id, player_id, status) values (v_parent, v_kid, 'active');

insert into public.training_sessions (club_id, team_id, session_date, start_time)
values (v_club, v_team, current_date + 3, '18:00') returning id into v_session;

-- ============ A. AUTHORITY ============

perform set_config('role','authenticated',true);

perform set_config('request.jwt.claims', json_build_object('sub', v_parent,'role','authenticated')::text, true);
begin
  perform public.send_training_communication(v_session, 'MESSAGE_TEAM', 'hello');
  raise notice 'FAIL 1 (A): a guardian sent a staff training communication';
exception when others then
  raise notice 'PASS 1 (A): a guardian is refused -- seeing the session is not authority to broadcast about it';
end;

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger,'role','authenticated')::text, true);
begin
  perform public.send_training_communication(v_session, 'MESSAGE_TEAM', 'hello');
  raise notice 'FAIL 2 (A): an adult PLAYER on the team sent a staff communication';
exception when others then
  raise notice 'PASS 2 (A): a player on the team is refused -- being in the squad is not running it';
end;

-- ============ B. AUDIENCES DERIVE FROM THE CANONICAL REGISTER ============

perform set_config('role','postgres',true);
-- One canonical response, written the way the product writes it.
insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
values (v_session, v_kid, 'ATTENDING', v_parent, 'guardian');

select count(*) into v_n from internal.training_audience_players(v_session, 'MESSAGE_TEAM');
if v_n = 3 then
  raise notice 'PASS 3 (B): the whole-group audience is every active member of the team';
else
  raise notice 'FAIL 3 (B): whole-group audience returned % players, expected 3', v_n;
end if;

select count(*) into v_n from internal.training_audience_players(v_session, 'MESSAGE_ATTENDEES');
if v_n = 1 then
  raise notice 'PASS 4 (B): the attending audience is exactly those who answered ATTENDING';
else
  raise notice 'FAIL 4 (B): attending audience returned %, expected 1', v_n;
end if;

select count(*) into v_n from internal.training_audience_players(v_session, 'ATTENDANCE_REMINDER');
if v_n = 2 then
  raise notice 'PASS 5 (B): the reminder audience is exactly those with NO canonical response';
else
  raise notice 'FAIL 5 (B): reminder audience returned %, expected 2', v_n;
end if;

-- The reconciliation that matters: change an answer, and the audiences move
-- with it, because there is no second table to synchronise.
insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
values (v_session, v_teen, 'ATTENDING', v_parent, 'staff');
select count(*) into v_n from internal.training_audience_players(v_session, 'ATTENDANCE_REMINDER');
if v_n = 1 then
  raise notice 'PASS 6 (B): answering removes a player from the reminder audience with nothing synchronised';
else
  raise notice 'FAIL 6 (B): reminder audience is % after a new response, expected 1', v_n;
end if;

-- ============ C. SAFEGUARDING ============
--
-- The under-16 is reachable only through their guardian; the 17-year-old has
-- no recorded consent and no account, so nobody; the adult is reachable on
-- their own account. The child's OWN user id must never appear.

select count(*) into v_n from internal.training_audience_recipients(v_session, 'MESSAGE_TEAM');
if v_n = 2 then
  raise notice 'PASS 7 (C): three players resolve to two notifiable adults -- a guardian and the adult player';
else
  raise notice 'FAIL 7 (C): whole-group recipients = %, expected 2', v_n;
end if;

if not exists (
  select 1 from internal.training_audience_recipients(v_session, 'MESSAGE_TEAM') r
  join public.players p on p.user_id = r.user_id
  where internal.player_effective_age(p.id) < 16
) then
  raise notice 'PASS 8 (C): no under-16 is contacted directly, whatever account they hold';
else
  raise notice 'FAIL 8 (C): an under-16 was resolved as a direct recipient';
end if;

-- ============ D. THE SEND ============

perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_coach,'role','authenticated')::text, true);

select outcome, player_count, recipient_count into v_outcome, v_players, v_recips
from public.send_training_communication(v_session, 'MESSAGE_TEAM', 'Training moves to Pitch 2 tonight.');
if v_outcome = 'SENT' and v_players = 3 and v_recips = 2 then
  raise notice 'PASS 9 (D): the coach sent to 3 players resolving to 2 recipients';
else
  raise notice 'FAIL 9 (D): outcome=% players=% recipients=%', v_outcome, v_players, v_recips;
end if;

-- Sending the same thing again immediately is a mistake, not an instruction.
select outcome into v_outcome from public.send_training_communication(v_session, 'MESSAGE_TEAM', 'again');
if v_outcome = 'RATE_LIMITED' then
  raise notice 'PASS 10 (D): an immediate repeat is rate limited rather than sent twice';
else
  raise notice 'FAIL 10 (D): a repeat returned %', v_outcome;
end if;

perform set_config('role','postgres',true);

select count(*) into v_n from public.notifications
where data->>'training_session_id' = v_session::text and type = 'training_staff_message';
if v_n = 2 then
  raise notice 'PASS 11 (D): exactly one notification per resolved recipient, through the one notifications table';
else
  raise notice 'FAIL 11 (D): % notifications delivered, expected 2', v_n;
end if;

-- ============ E. NO SECOND STORE ============

if not exists (
  select 1 from information_schema.tables
  where table_schema = 'public'
    and table_name in ('training_message_recipients','training_participant_status','training_register_cache')
) then
  raise notice 'PASS 12 (E): no cached recipient or register table exists -- audiences are derived, never copied';
else
  raise notice 'FAIL 12 (E): a copied recipient/register table has appeared';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
