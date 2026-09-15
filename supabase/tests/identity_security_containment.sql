-- IDENTITY & AUTHORIZATION SECURITY CONTAINMENT (Phase 0).
--
-- Every check here is a DIRECT attack or a legitimate path, run as the real
-- database role a caller would have (anon, authenticated with a JWT subject,
-- service_role) -- never "the button is hidden". Written to fail against the
-- implementation Phase 1 found, and to pass once 20270312000000 is applied.
--
--   C. Players cannot be created or altered directly (anon, members, staff).
--   D. Nobody can change their own account status; only a Site Admin with
--      user-access authority can, through set_account_status.
--   E. admin_fixture_overview reveals nothing to anonymous or unrelated callers.
--   F. A club's GoCardless merchant token is never returned to a browser role.
--   G. A player-login invitation binds only the invited, verified email.
--   H. Family: staff cannot write guardians or memberships directly; an invite
--      for one child cannot be used for another; nobody approves their own
--      guardian request; a club member cannot read the club's family graph.
--   I. Revoked authority does not come back through a lesser path; a club admin
--      cannot move, unsuspend or revive a membership row; the session version
--      cannot be set ahead of the server's.
--   K. Legacy RPCs are not anonymously executable; accepting a fixture request
--      does not reveal whether a request exists to someone without authority.
--   M. Overdue result reconciliation runs from the scheduler, not from pages.
--   N. The suspended-member list is Site Admin only.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

-- Act as a caller. p_role is anon | authenticated | service_role.
create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Functions created by postgres carry no PUBLIC EXECUTE since the Slice 1
-- perimeter; these session helpers are called after switching role.
grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_site_full uuid := gen_random_uuid();
  v_site_access uuid := gen_random_uuid();
  v_site_ro uuid := gen_random_uuid();
  v_site_revoked uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_parent2 uuid := gen_random_uuid();
  v_other_parent uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
  v_invitee uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_revoked_admin uuid := gen_random_uuid();
  v_revoked_admin2 uuid := gen_random_uuid();
  v_dir_a uuid; v_dir_b uuid;
  v_club_a uuid; v_club_b uuid;
  v_team_a uuid; v_team_b uuid;
  v_ms uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_fixture uuid;
  v_prog uuid; v_payer uuid;
  v_ginv uuid; v_ginv_replace uuid;
  v_pinv_token text; v_pinv2_token text;
  v_req uuid; v_req2 uuid;
  v_join uuid;
  v_inv_token text;
  v_sainv_token text;
  v_season uuid;
  v_count integer;
  v_text text;
  v_bool boolean;
  v_err text;
  v_err2 text;
begin
  -- -----------------------------------------------------------------
  -- SEED
  -- -----------------------------------------------------------------
  foreach v_person in array array[v_site_full, v_site_access, v_site_ro, v_site_revoked, v_club_admin, v_coach, v_member,
    v_parent, v_parent2, v_other_parent, v_suspended, v_unrelated, v_invitee, v_stranger, v_revoked_admin, v_revoked_admin2] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isc-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Isc', 'Tester', 'isc-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;
  update public.profiles set account_status = 'suspended' where id = v_suspended;

  insert into public.site_admins (user_id, status, admin_role) values
    (v_site_full, 'active', 'full'), (v_site_access, 'active', 'user_access'), (v_site_ro, 'active', 'read_only');
  insert into public.site_admins (user_id, status, admin_role, manage_competitions, manage_permissions) values (v_site_revoked, 'active', 'full', true, true);
  update public.site_admins set status = 'revoked', revoked_at = now() where user_id = v_site_revoked;

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('ISC Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'isc-' || v_tag)
    returning id into v_season;
  end if;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('ISC Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'isc-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('ISC Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'isc-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'isc-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'isc-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'isc-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 'isc-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_club_admin, 'CLUB_ADMIN', 'active'), (v_club_a, v_member, 'BASIC_USER', 'active'),
    (v_club_a, v_suspended, 'BASIC_USER', 'active'), (v_club_b, v_unrelated, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_coach, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team_a, 'coach');
  -- Two formerly-powerful people whose Club Admin membership was revoked.
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_revoked_admin, 'CLUB_ADMIN', 'revoked') returning id into v_ms;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms, v_team_a, 'team_admin');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_revoked_admin2, 'CLUB_ADMIN', 'revoked');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Isc', 'Child One', current_date - interval '11 years', 'MALE') returning id into v_p1;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Isc', 'Child Two', current_date - interval '11 years', 'MALE') returning id into v_p2;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Isc', 'Child Three', current_date - interval '11 years', 'MALE') returning id into v_p3;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Isc', 'Child Four', current_date - interval '11 years', 'MALE') returning id into v_p4;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_p1, v_team_a, 'active'), (v_p2, v_team_a, 'active'), (v_p4, v_team_a, 'active'), (v_p3, v_team_b, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values
    (v_parent, v_p1, 'guardian', 'active'), (v_other_parent, v_p2, 'guardian', 'active');

  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes)
  values (v_team_a, 'Home', 'ISC Private Opponent ' || v_tag, current_date + 20, '10:30', 'Booked', 'club_created', 'isc private note') returning id into v_fixture;

  insert into public.club_subscription_programmes (club_id, created_by) values (v_club_a, v_club_admin) returning id into v_prog;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, created_by)
  values (v_p1, v_prog, v_parent, 'guardian', v_parent) returning id into v_payer;
  insert into public.gocardless_merchant_connections (club_id, gc_organisation_id, access_token, scope, connected_by)
  values (v_club_a, 'OR-ISC-' || v_tag, 'isc-merchant-secret-' || v_tag, 'read_write', v_club_admin);

  -- An accepted team guardian invitation (no named child) for parent2, and a
  -- replacement invitation naming Child Four, also accepted by parent2.
  insert into public.guardian_invitations (club_id, team_id, invited_email, status, accepted_by, accepted_at, invited_by_user_id)
  values (v_club_a, v_team_a, 'isc-' || v_parent2::text || '@ovalball.test', 'accepted', v_parent2, now(), v_club_admin) returning id into v_ginv;
  insert into public.guardian_invitations (club_id, team_id, invited_email, status, accepted_by, accepted_at, invited_by_user_id, replacement_for_player_id)
  values (v_club_a, v_team_a, 'isc-' || v_parent2::text || '@ovalball.test', 'accepted', v_parent2, now(), v_club_admin, v_p4) returning id into v_ginv_replace;

  insert into public.player_account_invitations (player_id, invited_email, invited_by)
  values (v_p1, 'isc-' || v_invitee::text || '@ovalball.test', v_parent) returning token into v_pinv_token;
  insert into public.player_account_invitations (player_id, invited_email, invited_by, expires_at)
  values (v_p2, 'isc-' || v_stranger::text || '@ovalball.test', v_other_parent, now() - interval '1 day') returning token into v_pinv2_token;

  -- parent proposes parent2 as an additional guardian of Child One.
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, team_id, target_player_id)
  values ('ADDITIONAL_GUARDIAN', 'PENDING', v_parent, v_parent2, v_club_a, v_team_a, v_p1) returning id into v_req;
  -- parent proposes someone with no account yet.
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, invited_email, club_id, team_id, target_player_id)
  values ('ADDITIONAL_GUARDIAN', 'PENDING', v_parent, 'isc-noaccount-' || v_tag || '@ovalball.test', v_club_a, v_team_a, v_p1) returning id into v_req2;

  insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values (v_club_a, v_revoked_admin, 'Parent / Guardian') returning id into v_join;
  insert into public.invitations (club_id, invited_email, created_by) values (v_club_a, 'isc-' || v_revoked_admin2::text || '@ovalball.test', v_club_admin) returning token into v_inv_token;
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by) values ('isc-' || v_site_revoked::text || '@ovalball.test', 'read_only', v_site_full) returning token into v_sainv_token;

  -- -----------------------------------------------------------------
  -- C. PLAYERS CANNOT BE CREATED OR ALTERED DIRECTLY
  -- -----------------------------------------------------------------
  select count(*) into v_count from public.players;
  begin
    perform pg_temp.act('anon');
    insert into public.players (first_name, surname) values ('Anon', 'Injected ' || v_tag);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select count(*) from public.players where surname = 'Injected ' || v_tag) = 0 then
    raise notice 'PASS C1: an anonymous caller cannot create a player record';
  else
    raise notice 'FAIL C1: an anonymous caller created a player record';
  end if;

  begin
    perform pg_temp.act('authenticated', v_member);
    insert into public.players (first_name, surname) values ('Member', 'Injected ' || v_tag);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select count(*) from public.players where first_name = 'Member' and surname = 'Injected ' || v_tag) = 0 then
    raise notice 'PASS C2: a signed-in club member cannot create a player record directly';
  else
    raise notice 'FAIL C2: a signed-in member created a player record directly';
  end if;

  begin
    perform pg_temp.act('authenticated', v_coach);
    insert into public.players (first_name, surname) values ('Coach', 'Injected ' || v_tag);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select count(*) from public.players where first_name = 'Coach' and surname = 'Injected ' || v_tag) = 0 then
    raise notice 'PASS C3: team staff cannot create a player record directly';
  else
    raise notice 'FAIL C3: team staff created a player record directly';
  end if;

  begin
    perform pg_temp.act('authenticated', v_coach);
    update public.players set date_of_birth = date '1990-01-01', user_id = v_coach where id = v_p1;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select date_of_birth <> date '1990-01-01' and user_id is null from public.players where id = v_p1) then
    raise notice 'PASS C4: team staff cannot change a child''s date of birth or login link directly';
  else
    raise notice 'FAIL C4: team staff changed a child''s protected identity fields';
    update public.players set date_of_birth = current_date - interval '11 years', user_id = null where id = v_p1;
  end if;

  begin
    perform pg_temp.act('authenticated', v_parent2);
    select t.result into v_text from public.create_player_for_guardian(v_ginv, 'Legit', 'New Child ' || v_tag, (current_date - interval '11 years')::date, 'MALE') t;
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_text := 'error: ' || v_err;
  end;
  if v_text = 'created' then
    raise notice 'PASS C5: a parent with an accepted team invitation still adds their own child through the canonical path';
  else
    raise notice 'FAIL C5: the legitimate guardian-invitation path no longer creates a child (%)', v_text;
  end if;

  -- -----------------------------------------------------------------
  -- D. ACCOUNT STATUS IS NOT SELF-SERVICE
  -- -----------------------------------------------------------------
  begin
    perform pg_temp.act('authenticated', v_suspended);
    update public.profiles set account_status = 'active' where id = v_suspended;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select account_status from public.profiles where id = v_suspended) = 'suspended' then
    raise notice 'PASS D1: a suspended user cannot reactivate their own account';
  else
    raise notice 'FAIL D1: a suspended user reactivated their own account';
    update public.profiles set account_status = 'suspended' where id = v_suspended;
  end if;

  begin
    perform pg_temp.act('authenticated', v_member);
    update public.profiles set email = 'redirected-' || v_tag || '@example.com' where id = v_member;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select email from public.profiles where id = v_member) not like 'redirected-%' then
    raise notice 'PASS D2: a user cannot rewrite the email address Ovalball sends their mail to';
  else
    raise notice 'FAIL D2: a user rewrote their profile email directly';
  end if;

  begin
    perform pg_temp.act('authenticated', v_member);
    update public.profiles set first_name = 'Renamed' where id = v_member;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select first_name from public.profiles where id = v_member) = 'Renamed' then
    raise notice 'PASS D3: a user can still correct their own name';
  else
    raise notice 'FAIL D3: a user can no longer edit their own name';
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_site_ro);
    perform public.set_account_status(v_member, 'suspended');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = returned_sqlstate;
  end;
  if (select account_status from public.profiles where id = v_member) = 'active' and v_err is not null then
    raise notice 'PASS D4: a read-only Site Admin cannot suspend an account';
  else
    raise notice 'FAIL D4: a read-only Site Admin changed an account status (err %)', v_err;
    update public.profiles set account_status = 'active' where id = v_member;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    perform public.set_account_status(v_member, 'suspended');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = returned_sqlstate;
  end;
  if (select account_status from public.profiles where id = v_member) = 'active' and v_err is not null then
    raise notice 'PASS D5: a Club Admin cannot suspend a platform account';
  else
    raise notice 'FAIL D5: a Club Admin changed a platform account status (err %)', v_err;
    update public.profiles set account_status = 'active' where id = v_member;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_site_full);
    perform public.set_account_status(v_member, 'suspended');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  v_text := (select account_status from public.profiles where id = v_member);
  begin
    perform pg_temp.act('authenticated', v_site_access);
    perform public.set_account_status(v_member, 'active');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err2 = message_text;
  end;
  if v_text = 'suspended' and (select account_status from public.profiles where id = v_member) = 'active' then
    raise notice 'PASS D6: a Full Site Admin can suspend, and a user-access Site Admin can reactivate, through set_account_status';
  else
    raise notice 'FAIL D6: the canonical account-status administration does not work (% / % / %)', v_text, v_err, v_err2;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_site_full);
    perform public.set_account_status(v_site_full, 'suspended');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = returned_sqlstate;
  end;
  if (select account_status from public.profiles where id = v_site_full) = 'active' then
    raise notice 'PASS D7: a Site Admin cannot suspend their own account';
  else
    raise notice 'FAIL D7: a Site Admin suspended themselves';
    update public.profiles set account_status = 'active' where id = v_site_full;
  end if;

  -- -----------------------------------------------------------------
  -- E. THE FIXTURE OVERVIEW IS NOT PUBLIC
  -- -----------------------------------------------------------------
  v_count := -1;
  begin
    perform pg_temp.act('anon');
    select count(*) into v_count from public.admin_fixture_overview where id = v_fixture;
    perform pg_temp.act_postgres();
  exception when others then v_count := 0;
  end;
  if v_count = 0 then
    raise notice 'PASS E1: an anonymous caller cannot read a club''s private fixture overview';
  else
    raise notice 'FAIL E1: an anonymous caller read % private fixture overview row(s)', v_count;
  end if;

  v_count := -1;
  begin
    perform pg_temp.act('authenticated', v_unrelated);
    select count(*) into v_count from public.admin_fixture_overview where id = v_fixture;
    perform pg_temp.act_postgres();
  exception when others then v_count := 0;
  end;
  if v_count = 0 then
    raise notice 'PASS E2: another club''s admin cannot read this club''s fixture overview';
  else
    raise notice 'FAIL E2: another club''s admin read this club''s fixture overview';
  end if;

  v_count := -1;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    select count(*) into v_count from public.admin_fixture_overview where id = v_fixture;
    perform pg_temp.act_postgres();
  exception when others then v_count := -2;
  end;
  if v_count = 1 then
    raise notice 'PASS E3: the club''s own admin still reads their fixture overview';
  else
    raise notice 'FAIL E3: the club''s own admin lost their fixture overview (%)', v_count;
  end if;

  -- -----------------------------------------------------------------
  -- F. THE MERCHANT TOKEN NEVER REACHES A BROWSER ROLE
  -- -----------------------------------------------------------------
  v_text := null;
  begin
    perform pg_temp.act('authenticated', v_parent);
    execute 'select access_token from public.get_gocardless_token_for_payer_subscription($1)' into v_text using v_payer;
    perform pg_temp.act_postgres();
  exception when others then v_text := null;
  end;
  if v_text is null then
    raise notice 'PASS F1: a paying parent cannot obtain the club''s merchant token';
  else
    raise notice 'FAIL F1: a paying parent obtained the club''s merchant token';
  end if;

  v_text := null;
  begin
    perform pg_temp.act('authenticated', v_parent);
    execute 'select access_token from public.get_gocardless_token_for_payer_subscription($1, $2)' into v_text using v_payer, v_parent;
    perform pg_temp.act_postgres();
  exception when others then v_text := null;
  end;
  if v_text is null then
    raise notice 'PASS F2: naming themselves as the actor does not let a parent obtain the token either';
  else
    raise notice 'FAIL F2: a parent obtained the token by naming themselves as the actor';
  end if;

  v_text := null;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    execute 'select access_token from public.get_gocardless_token_for_club_admin_action($1, $2)' into v_text using v_club_a, v_club_admin;
    perform pg_temp.act_postgres();
  exception when others then v_text := null;
  end;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    execute 'select access_token from public.get_gocardless_token_for_club_admin_action($1)' into v_text using v_club_a;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if v_text is null then
    raise notice 'PASS F3: even a Club Admin''s browser session cannot read the merchant token';
  else
    raise notice 'FAIL F3: a Club Admin''s browser session read the merchant token';
  end if;

  v_text := null;
  begin
    perform pg_temp.act('anon');
    execute 'select access_token from public.get_gocardless_token_for_payer_subscription($1, $2)' into v_text using v_payer, v_parent;
    perform pg_temp.act_postgres();
  exception when others then v_text := null;
  end;
  if v_text is null then
    raise notice 'PASS F4: an anonymous caller cannot obtain the merchant token';
  else
    raise notice 'FAIL F4: an anonymous caller obtained the merchant token';
  end if;

  v_text := null; v_err := null;
  begin
    perform pg_temp.act('service_role');
    execute 'select access_token from public.get_gocardless_token_for_payer_subscription($1, $2)' into v_text using v_payer, v_parent;
    execute 'select access_token from public.get_gocardless_token_for_payer_subscription($1, $2)' into v_err using v_payer, v_member;
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err2 = message_text;
  end;
  if v_text = 'isc-merchant-secret-' || v_tag and v_err is null then
    raise notice 'PASS F5: the trusted server path gets the token only for the payer who owns the subscription';
  else
    raise notice 'FAIL F5: the server payer path is wrong (payer %, other %, err %)', v_text is not null, v_err is not null, v_err2;
  end if;

  v_text := null; v_err := null; v_err2 := null;
  begin
    perform pg_temp.act('service_role');
    execute 'select access_token from public.get_gocardless_token_for_club_admin_action($1, $2)' into v_text using v_club_a, v_club_admin;
    execute 'select access_token from public.get_gocardless_token_for_club_admin_action($1, $2)' into v_err using v_club_a, v_member;
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err2 = message_text;
  end;
  if v_text = 'isc-merchant-secret-' || v_tag and v_err is null then
    raise notice 'PASS F6: the trusted server path gets the token only for someone with payment-action authority at that club';
  else
    raise notice 'FAIL F6: the server club-admin path is wrong (admin %, member %, err %)', v_text is not null, v_err is not null, v_err2;
  end if;

  -- -----------------------------------------------------------------
  -- G. A PLAYER LOGIN INVITATION BINDS ONLY ITS RECIPIENT
  -- -----------------------------------------------------------------
  begin
    perform pg_temp.act('authenticated', v_stranger);
    perform public.accept_player_account_invitation(v_pinv_token);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select user_id is null from public.players where id = v_p1) then
    raise notice 'PASS G1: holding a child''s login link does not let the wrong account become that child';
  else
    raise notice 'FAIL G1: a different account became the child''s login with the link alone';
    update public.players set user_id = null where id = v_p1;
    update public.player_account_invitations set status = 'pending', accepted_by = null, accepted_at = null where token = v_pinv_token;
  end if;

  begin
    perform pg_temp.act('authenticated', v_invitee);
    perform public.accept_player_account_invitation(v_pinv_token);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if (select user_id from public.players where id = v_p1) = v_invitee then
    raise notice 'PASS G2: the invited, verified email still becomes the child''s login';
  else
    raise notice 'FAIL G2: the invited recipient could not accept (%)', v_err;
  end if;

  begin
    perform pg_temp.act('authenticated', v_invitee);
    perform public.accept_player_account_invitation(v_pinv_token);
    perform pg_temp.act_postgres();
    raise notice 'FAIL G3: a used invitation was accepted again';
  exception when others then
    raise notice 'PASS G3: a used invitation cannot be accepted again';
  end;

  begin
    perform pg_temp.act('authenticated', v_stranger);
    perform public.accept_player_account_invitation(v_pinv2_token);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select user_id is null from public.players where id = v_p2) then
    raise notice 'PASS G4: an expired invitation cannot be accepted, even by its recipient';
  else
    raise notice 'FAIL G4: an expired invitation was accepted';
  end if;

  -- -----------------------------------------------------------------
  -- H. FAMILY RELATIONSHIPS
  -- -----------------------------------------------------------------
  begin
    perform pg_temp.act('authenticated', v_coach);
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_coach, v_p2, 'guardian', 'active');
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if not exists (select 1 from public.guardians where guardian_user_id = v_coach) then
    raise notice 'PASS H1: team staff cannot make themselves a child''s guardian directly';
  else
    raise notice 'FAIL H1: team staff made themselves a child''s guardian';
  end if;

  begin
    perform pg_temp.act('authenticated', v_coach);
    update public.guardians set status = 'revoked' where player_id = v_p2 and guardian_user_id = v_other_parent;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select status from public.guardians where player_id = v_p2 and guardian_user_id = v_other_parent) = 'active' then
    raise notice 'PASS H2: team staff cannot remove a child''s real guardian directly';
  else
    raise notice 'FAIL H2: team staff removed a child''s guardian directly';
    update public.guardians set status = 'active' where player_id = v_p2 and guardian_user_id = v_other_parent;
  end if;

  begin
    perform pg_temp.act('authenticated', v_coach);
    insert into public.player_team_memberships (player_id, team_id, status) values (v_p3, v_team_a, 'active');
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if not exists (select 1 from public.player_team_memberships where player_id = v_p3 and team_id = v_team_a) then
    raise notice 'PASS H3: team staff cannot attach another club''s child to their team directly';
  else
    raise notice 'FAIL H3: team staff attached another club''s child to their team';
  end if;

  begin
    perform pg_temp.act('authenticated', v_parent2);
    perform public.link_guardian_to_existing_player(v_ginv, v_p2);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  begin
    perform pg_temp.act('authenticated', v_parent2);
    perform public.link_guardian_to_existing_player(v_ginv_replace, v_p2);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if not exists (select 1 from public.guardians where guardian_user_id = v_parent2 and player_id = v_p2) then
    raise notice 'PASS H4: a guardian invitation cannot be used to become guardian of a different child on the team';
  else
    raise notice 'FAIL H4: an invitation was redirected to another child';
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_parent2);
    perform public.link_guardian_to_existing_player(v_ginv_replace, v_p4);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if exists (select 1 from public.guardians where guardian_user_id = v_parent2 and player_id = v_p4 and status = 'active') then
    raise notice 'PASS H5: a replacement invitation still links the child it names';
  else
    raise notice 'FAIL H5: the legitimate replacement link failed (%)', v_err;
  end if;

  begin
    perform pg_temp.act('authenticated', v_parent);
    perform public.approve_guardian_link_request(v_req);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select status from public.guardian_link_requests where id = v_req) = 'PENDING'
     and not exists (select 1 from public.guardians where guardian_user_id = v_parent2 and player_id = v_p1 and state <> 'PENDING_APPROVAL') then
    raise notice 'PASS H6: a guardian cannot approve their own request to add another guardian';
  else
    raise notice 'FAIL H6: a guardian approved their own additional-guardian request';
  end if;

  v_err := null;
  begin
    -- The added adult accepts first (Slice 2, R11).
    perform pg_temp.act('authenticated', v_parent2);
    perform public.respond_to_additional_guardian_request(v_req, 'ACCEPT');
    perform pg_temp.act_postgres();
    perform pg_temp.act('authenticated', v_club_admin);
    perform public.approve_guardian_link_request(v_req);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if exists (select 1 from public.guardians where guardian_user_id = v_parent2 and player_id = v_p1 and status = 'active') then
    raise notice 'PASS H7: the club''s admin can approve an additional guardian who has an account';
  else
    raise notice 'FAIL H7: the club could not approve a legitimate additional guardian (%)', v_err;
  end if;

  begin
    perform pg_temp.act('authenticated', v_club_admin);
    perform public.approve_guardian_link_request(v_req2);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select status from public.guardian_link_requests where id = v_req2) = 'PENDING' then
    raise notice 'PASS H8: a request for someone without an account is never approved onto the requester instead';
  else
    raise notice 'FAIL H8: a request for someone without an account was approved';
  end if;

  v_bool := false;
  begin
    perform pg_temp.act('authenticated', v_member);
    perform * from public.team_people(v_team_a);
    perform pg_temp.act_postgres();
    v_bool := true;
  exception when others then null;
  end;
  if not v_bool then
    raise notice 'PASS H9: an ordinary club member cannot read a team''s children and guardians';
  else
    raise notice 'FAIL H9: an ordinary club member read a team''s children and guardians';
  end if;

  v_bool := false;
  begin
    perform pg_temp.act('authenticated', v_parent);
    perform * from public.team_people(v_team_a);
    perform pg_temp.act_postgres();
    v_bool := true;
  exception when others then null;
  end;
  if not v_bool then
    raise notice 'PASS H10: a parent cannot read the rest of the team''s families';
  else
    raise notice 'FAIL H10: a parent read the rest of the team''s families';
  end if;

  v_count := 0;
  begin
    perform pg_temp.act('authenticated', v_coach);
    select count(*) into v_count from public.team_people(v_team_a);
    perform pg_temp.act_postgres();
  exception when others then v_count := -1;
  end;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    select count(*) into v_err from public.team_people(v_team_a);
    perform pg_temp.act_postgres();
  exception when others then v_err := '-1';
  end;
  if v_count > 0 and v_err::integer > 0 then
    raise notice 'PASS H11: the team''s own coach and the club''s admin still see the team''s people';
  else
    raise notice 'FAIL H11: team staff or the club admin lost the team''s people (% / %)', v_count, v_err;
  end if;

  -- -----------------------------------------------------------------
  -- I. REVOKED AUTHORITY, MEMBERSHIP ROWS, SESSION VERSION
  -- -----------------------------------------------------------------
  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    perform public.approve_club_join_request(v_join);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if (select role || '|' || status from public.club_memberships where club_id = v_club_a and user_id = v_revoked_admin and state in ('PENDING', 'ACTIVE', 'SUSPENDED')) = 'BASIC_USER|active'
     and not exists (select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id where cm.user_id = v_revoked_admin) then
    raise notice 'PASS I1: approving a join request for a revoked admin makes them a member, not an admin with old team authority';
  else
    raise notice 'FAIL I1: a revoked admin came back through a join request with old authority (% / err %)',
      (select role || '|' || status from public.club_memberships where club_id = v_club_a and user_id = v_revoked_admin and state in ('PENDING', 'ACTIVE', 'SUSPENDED')), v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_revoked_admin2);
    perform public.accept_invitation(v_inv_token);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if (select role || '|' || status from public.club_memberships where club_id = v_club_a and user_id = v_revoked_admin2 and state in ('PENDING', 'ACTIVE', 'SUSPENDED')) = 'BASIC_USER|active' then
    raise notice 'PASS I2: accepting a member invitation after revocation does not restore Club Admin';
  else
    raise notice 'FAIL I2: a revoked Club Admin was restored by a member invitation (% / err %)',
      (select role || '|' || status from public.club_memberships where club_id = v_club_a and user_id = v_revoked_admin2 and state in ('PENDING', 'ACTIVE', 'SUSPENDED')), v_err;
  end if;

  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_site_revoked);
    perform public.accept_site_admin_invitation(v_sainv_token);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if (select status = 'active' and admin_role = 'read_only' and not manage_competitions and not manage_permissions and revoked_at is null
      from public.site_admins where user_id = v_site_revoked) then
    raise notice 'PASS I3: a re-invited Site Admin starts from the new profile, without the capability flags they held before';
  else
    raise notice 'FAIL I3: a re-invited Site Admin kept old capability flags (err %)', v_err;
  end if;

  begin
    perform pg_temp.act('authenticated', v_club_admin);
    update public.club_memberships set user_id = v_unrelated where club_id = v_club_a and user_id = v_member;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if exists (select 1 from public.club_memberships where club_id = v_club_a and user_id = v_member) then
    raise notice 'PASS I4: a Club Admin cannot hand a membership row to a different person';
  else
    raise notice 'FAIL I4: a Club Admin moved a membership to another person';
    update public.club_memberships set user_id = v_member where club_id = v_club_a and user_id = v_unrelated;
  end if;

  update public.club_memberships set authority_suspended = true, authority_suspended_at = now() where club_id = v_club_a and user_id = v_club_admin;
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    update public.club_memberships set authority_suspended = false where club_id = v_club_a and user_id = v_club_admin;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select authority_suspended from public.club_memberships where club_id = v_club_a and user_id = v_club_admin) then
    raise notice 'PASS I5: a club officer cannot lift their own authority suspension';
  else
    raise notice 'FAIL I5: a club officer lifted their own authority suspension';
  end if;
  update public.club_memberships set authority_suspended = false, authority_suspended_at = null where club_id = v_club_a and user_id = v_club_admin;

  begin
    perform pg_temp.act('authenticated', v_club_admin);
    perform public.set_primary_club_role((select id from public.club_memberships where club_id = v_club_a and user_id = v_member and state = 'ACTIVE'), 'FIXTURE_SECRETARY');
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  if (select role from public.club_memberships where club_id = v_club_a and user_id = v_member) = 'FIXTURE_SECRETARY' then
    raise notice 'PASS I6: a Club Admin can still change a member''s club role';
  else
    raise notice 'FAIL I6: a Club Admin can no longer change a member''s club role';
  end if;

  update public.club_memberships set status = 'revoked' where club_id = v_club_a and user_id = v_suspended;
  -- A removed membership is history (Slice 2): nobody switches it back on by
  -- editing the row, not a Club Admin and not a Site Admin. Re-admission by a
  -- Full Site Admin is a new membership row.
  begin
    perform pg_temp.act('authenticated', v_club_admin);
    update public.club_memberships set status = 'active' where club_id = v_club_a and user_id = v_suspended;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  v_text := (select status from public.club_memberships where club_id = v_club_a and user_id = v_suspended and state = 'REVOKED');
  begin
    perform pg_temp.act('authenticated', v_site_access);
    update public.club_memberships set status = 'active' where club_id = v_club_a and user_id = v_suspended;
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  v_err := null;
  begin
    perform pg_temp.act('authenticated', v_site_full);
    perform public.grant_club_membership(v_club_a, v_suspended, 'ISC re-admission');
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if v_text = 'revoked'
     and not exists (select 1 from public.club_memberships where club_id = v_club_a and user_id = v_suspended and state = 'REVOKED' and status <> 'revoked')
     and (select count(*) from public.club_memberships where club_id = v_club_a and user_id = v_suspended and state = 'REVOKED') = 1 then
    raise notice 'PASS I8: nobody revives a revoked membership by editing the row, and re-admission never reopens the old row (re-admission: %)',
      coalesce(v_err, (select state from public.club_memberships where club_id = v_club_a and user_id = v_suspended and state <> 'REVOKED'));
  else
    raise notice 'FAIL I8: revoked membership revival is wrong (club admin left it %, rows %)', v_text,
      (select string_agg(state, ',') from public.club_memberships where club_id = v_club_a and user_id = v_suspended);
  end if;

  begin
    perform pg_temp.act('authenticated', v_member);
    perform public.record_session_version(999);
    perform pg_temp.act_postgres();
  exception when others then null;
  end;
  v_count := coalesce((select version from public.user_session_versions where user_id = v_member), 0);
  v_bool := false;
  if to_regprocedure('internal.auth_session_version()') is not null then
    execute 'select $1 <= internal.auth_session_version()' into v_bool using v_count;
  end if;
  if v_bool then
    raise notice 'PASS I7: a session cannot set its version ahead of the server''s current version';
  else
    raise notice 'FAIL I7: a session set its version to % (ahead of the server)', (select version from public.user_session_versions where user_id = v_member);
  end if;

  -- -----------------------------------------------------------------
  -- K. LEGACY RPCS
  -- -----------------------------------------------------------------
  select not has_function_privilege('anon', 'public.accept_fixture_request(uuid, uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.create_competition(text, text, text, boolean, uuid[])', 'EXECUTE')
     and not has_function_privilege('anon', 'public.publish_import_row(uuid)', 'EXECUTE')
  into v_bool;
  if v_bool then
    raise notice 'PASS K1: accept_fixture_request, create_competition and publish_import_row are not anonymously executable';
  else
    raise notice 'FAIL K1: a legacy fixture/competition RPC is still anonymously executable';
  end if;

  v_err := null; v_err2 := null;
  begin
    perform pg_temp.act('authenticated', v_unrelated);
    perform public.accept_fixture_request(gen_random_uuid(), null);
    perform pg_temp.act_postgres();
  exception when others then get stacked diagnostics v_err = message_text;
  end;
  if v_err is not null and v_err not ilike '%not found%' then
    raise notice 'PASS K2: accepting an unknown fixture request does not reveal whether the request exists';
  else
    raise notice 'FAIL K2: accept_fixture_request distinguishes a missing request (%)', v_err;
  end if;

  -- -----------------------------------------------------------------
  -- M. RESULT RECONCILIATION RUNS FROM THE SCHEDULER
  -- -----------------------------------------------------------------
  if not has_function_privilege('authenticated', 'public.reconcile_overdue_fixture_results()', 'EXECUTE')
     and not has_function_privilege('anon', 'public.reconcile_overdue_fixture_results()', 'EXECUTE') then
    raise notice 'PASS M1: reconciliation is not callable from a browser session';
  else
    raise notice 'FAIL M1: reconciliation is callable from a browser session';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'PASS M2: pg_cron is not installed in this database, so no schedule is expected here';
  elsif exists (select 1 from cron.job where jobname = 'reconcile-overdue-fixture-results') then
    raise notice 'PASS M2: overdue fixture results are reconciled by a scheduled job';
  else
    raise notice 'FAIL M2: nothing schedules overdue fixture result reconciliation';
  end if;

  -- -----------------------------------------------------------------
  -- N. SUSPENDED MEMBER LIST
  -- -----------------------------------------------------------------
  update public.club_memberships set authority_suspended = true, authority_suspended_at = now() where club_id = v_club_a and user_id = v_coach;
  v_count := -1;
  begin
    perform pg_temp.act('anon');
    select count(*) into v_count from public.list_suspended_club_memberships(v_club_a);
    perform pg_temp.act_postgres();
  exception when others then v_count := 0;
  end;
  v_bool := v_count = 0;
  v_count := -1;
  begin
    perform pg_temp.act('authenticated', v_unrelated);
    select count(*) into v_count from public.list_suspended_club_memberships(v_club_a);
    perform pg_temp.act_postgres();
  exception when others then v_count := 0;
  end;
  if v_bool and v_count = 0 then
    raise notice 'PASS N1: anonymous callers and other clubs cannot list a club''s suspended members';
  else
    raise notice 'FAIL N1: a club''s suspended members were listed to an outsider';
  end if;
  v_count := -1;
  begin
    perform pg_temp.act('authenticated', v_site_full);
    select count(*) into v_count from public.list_suspended_club_memberships(v_club_a);
    perform pg_temp.act_postgres();
  exception when others then v_count := -2;
  end;
  if v_count = 1 then
    raise notice 'PASS N2: a Site Admin still lists the club''s suspended members';
  else
    raise notice 'FAIL N2: a Site Admin can no longer list suspended members (%)', v_count;
  end if;
end $$;

rollback;
