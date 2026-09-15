-- FAMILY RELATIONSHIP AND TEAM PLACE STATE MACHINES
-- (Identity/Auth Slice 2, Phase 2 N.1, M.3).
--
--   A. Additional guardian: PENDING_APPROVAL on request (confers nothing),
--      the added adult accepts, the club approves the same row.
--   B. Declined by the added adult, rejected by the club, withdrawn by the
--      requester: the relationship is DECLINED and terminal.
--   C. Remove (self without a reason, club with one), hold and lift (Full
--      Site Admin, with reasons, hidden from the guardian), no resurrection,
--      re-linking is a new row, one open relationship per pair, nobody is
--      their own guardian, no browser write.
--   D. Team places: approve, decline (DECLINED), archive, restore (a new
--      place), no ENDED -> ACTIVE, move (one step, both clubs' authority,
--      one event), end reasons hidden.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
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

-- Runs one statement as the current role; returns OK or the SQLSTATE.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_full uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_parent1 uuid := gen_random_uuid();
  v_parent2 uuid := gen_random_uuid();
  v_parent3 uuid := gen_random_uuid();
  v_parent4 uuid := gen_random_uuid();
  v_parent5 uuid := gen_random_uuid();
  v_adult_player uuid := gen_random_uuid();
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid; v_team uuid; v_team2 uuid; v_team_b uuid;
  v_player uuid; v_player2 uuid; v_player3 uuid; v_own_player uuid;
  v_g1 uuid; v_g2 uuid; v_g2b uuid;
  v_req uuid; v_req3 uuid; v_req4 uuid; v_req5 uuid; v_req_again uuid;
  v_ptm uuid; v_ptm_pending uuid; v_ptm_pending2 uuid; v_ptm_new uuid; v_ptm_moved uuid;
  v_r record;
  v_text text;
  v_count integer;
begin
  foreach v_person in array array[v_full, v_admin, v_admin_b, v_parent1, v_parent2, v_parent3, v_parent4, v_parent5, v_adult_player] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'frs-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Frs', 'Tester', 'frs-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRS Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'frs-a-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FRS Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'frs-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'frs-a-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'frs-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'frs-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
  values (v_club, 'Under 12 Boys B', 'frs-u12b-' || v_tag, 'youth', 'U12', 'boys', 'B', 'union', true) returning id into v_team2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 'frs-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Frs', 'Child', (current_date - interval '11 years 6 months')::date, 'MALE') returning id into v_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Frs', 'Pending', (current_date - interval '11 years 6 months')::date, 'MALE') returning id into v_player2;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Frs', 'Declined', (current_date - interval '11 years 6 months')::date, 'MALE') returning id into v_player3;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Frs', 'Adult', (current_date - interval '25 years')::date, 'MALE', v_adult_player) returning id into v_own_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active') returning id into v_ptm;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player2, v_team, 'pending') returning id into v_ptm_pending;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player3, v_team, 'pending') returning id into v_ptm_pending2;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_parent1, v_player, 'parent', 'active') returning id into v_g1;

  -- ===============================================================
  -- A. An additional guardian: requested, accepted, approved
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent1);
  select * into v_r from public.request_additional_guardian(v_player, 'frs-' || v_parent2::text || '@ovalball.test');
  perform pg_temp.act_postgres();
  v_req := v_r.request_id;
  select id into v_g2 from public.guardians where guardian_user_id = v_parent2 and player_id = v_player;
  perform pg_temp.check(v_g2 is not null
    and (select state || '|' || status || '|' || source || '|' || (source_request_id = v_req)::text from public.guardians where id = v_g2) = 'PENDING_APPROVAL|pending|ADDITIONAL_GUARDIAN_REQUEST|true'
    and (select relationship_id from public.guardian_link_requests where id = v_req) = v_g2,
    'A1: the request opens a PENDING_APPROVAL relationship, linked both ways');

  perform pg_temp.act('authenticated', v_parent2);
  select count(*) into v_count from public.players where id = v_player;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_count = 0 and not internal.is_active_player_guardian(v_player) is true,
    'A2: awaiting approval confers nothing: the adult cannot read the child (FR-1)');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'guardian.link_requested' and actor_user_id = v_parent1 and player_id = v_player),
    'A3: guardian.link_requested is recorded, attributed to the requester');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.approve_guardian_link_request(%L)', v_req));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514' and (select state from public.guardians where id = v_g2) = 'PENDING_APPROVAL',
    'A4: the club cannot approve before the added adult accepts (R11) (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent2);
  perform public.respond_to_additional_guardian_request(v_req, 'ACCEPT');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select subject_response from public.guardian_link_requests where id = v_req) = 'ACCEPTED'
    and (select state from public.guardians where id = v_g2) = 'PENDING_APPROVAL',
    'A5: accepting records the answer and still grants nothing');

  perform pg_temp.act('authenticated', v_admin);
  perform public.approve_guardian_link_request(v_req);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state || '|' || status || '|' || (approved_by = v_admin)::text from public.guardians where id = v_g2) = 'ACTIVE|active|true'
    and (select count(*) from public.guardians where guardian_user_id = v_parent2 and player_id = v_player) = 1,
    'A6: approval activates the SAME relationship and records who approved');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'guardian.link_approved' and actor_user_id = v_admin and subject_user_id = v_parent2)
    and exists (select 1 from public.security_events where event_type = 'guardian.linked' and actor_user_id = v_admin and subject_user_id = v_parent2 and player_id = v_player),
    'A7: guardian.link_approved and guardian.linked carry the approving Club Admin');

  -- ===============================================================
  -- B. Requests that do not become relationships
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent1);
  select request_id into v_req3 from public.request_additional_guardian(v_player, 'frs-' || v_parent3::text || '@ovalball.test');
  select request_id into v_req4 from public.request_additional_guardian(v_player, 'frs-' || v_parent4::text || '@ovalball.test');
  select request_id into v_req5 from public.request_additional_guardian(v_player, 'frs-' || v_parent5::text || '@ovalball.test');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_parent3);
  perform public.respond_to_additional_guardian_request(v_req3, 'DECLINE');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.guardians where guardian_user_id = v_parent3 and player_id = v_player) = 'DECLINED'
    and (select status || '|' || subject_response from public.guardian_link_requests where id = v_req3) = 'REJECTED|DECLINED',
    'B1: the added adult declining declines the relationship and ends the request');

  perform pg_temp.act('authenticated', v_admin);
  perform public.reject_guardian_link_request(v_req4, 'Not verified');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.guardians where guardian_user_id = v_parent4 and player_id = v_player) = 'DECLINED',
    'B2: the club rejecting declines the relationship');

  perform pg_temp.act('authenticated', v_parent1);
  perform public.cancel_guardian_link_request(v_req5);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.guardians where guardian_user_id = v_parent5 and player_id = v_player) = 'DECLINED',
    'B3: the requester withdrawing declines the relationship');

  v_text := pg_temp.try(format('update public.guardians set state = ''ACTIVE'' where guardian_user_id = %L and player_id = %L', v_parent3, v_player));
  perform pg_temp.check(v_text = '23514', 'B4: a declined relationship is terminal, even for a backend write (' || v_text || ')');

  -- An unanswered request expires (no scheduler yet runs this).
  perform pg_temp.act('authenticated', v_parent1);
  perform public.request_additional_guardian(v_player, 'frs-' || v_admin_b::text || '@ovalball.test');
  perform pg_temp.act_postgres();
  v_text := pg_temp.try(format('update public.guardians set state = ''EXPIRED'' where guardian_user_id = %L and player_id = %L and state = ''PENDING_APPROVAL''', v_admin_b, v_player));
  perform pg_temp.check(v_text = 'OK' and (select state || '|' || status from public.guardians where guardian_user_id = v_admin_b and player_id = v_player) = 'EXPIRED|expired',
    'B5: a relationship awaiting approval can expire (' || v_text || ')');
  v_text := pg_temp.try(format('update public.guardians set state = ''ACTIVE'' where guardian_user_id = %L and player_id = %L', v_admin_b, v_player));
  perform pg_temp.check(v_text = '23514', 'B6: an expired relationship is terminal (' || v_text || ')');
  v_text := pg_temp.try(format('update public.guardians set state = ''EXPIRED'' where id = %L', v_g1));
  perform pg_temp.check(v_text = '23514', 'B7: only a relationship awaiting approval can expire, never an ACTIVE one (' || v_text || ')');

  -- ===============================================================
  -- C. Removal, hold, no resurrection
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_guardian_relationship(%L, ''REVOKED'', null)', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C1: a club removal needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_guardian_relationship(%L, ''SUSPENDED'', ''concern'')', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C2: a Club Admin cannot put a relationship on hold (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_guardian_relationship(%L, ''SUSPENDED'', null)', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C3: a hold needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  perform public.transition_guardian_relationship(v_g2, 'SUSPENDED', 'Safeguarding referral received');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state || '|' || status || '|' || suspension_reason from public.guardians where id = v_g2) = 'SUSPENDED|suspended|Safeguarding referral received',
    'C4: a Full Site Admin puts the relationship on hold; the legacy status is no longer active');

  perform pg_temp.act('authenticated', v_parent2);
  select count(*) into v_count from public.players where id = v_player;
  v_text := pg_temp.try(format('select suspension_reason from public.guardians where id = %L', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_count = 0, 'C5: on hold, the guardian cannot read the child');
  perform pg_temp.check(v_text = '42501', 'C6: the guardian cannot read why the relationship is on hold (' || v_text || ')');
  perform pg_temp.check(exists (select 1 from public.security_events where event_type = 'guardian.suspended' and actor_user_id = v_full and subject_user_id = v_parent2),
    'C7: guardian.suspended is recorded');

  perform pg_temp.act('authenticated', v_full);
  perform public.transition_guardian_relationship(v_g2, 'ACTIVE', 'Referral closed, no further action');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.guardians where id = v_g2) = 'ACTIVE'
    and exists (select 1 from public.security_events where event_type = 'guardian.restored' and actor_user_id = v_full and subject_user_id = v_parent2),
    'C8: lifting the hold restores the relationship and records guardian.restored');

  perform pg_temp.act('authenticated', v_parent2);
  v_text := pg_temp.try(format('select public.transition_guardian_relationship(%L, ''REVOKED'', null)', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state || '|' || revocation_reason || '|' || (revoked_by = v_parent2)::text from public.guardians where id = v_g2) = 'REVOKED|Removed by the guardian|true',
    'C9: a guardian can remove themselves without a reason');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.transition_guardian_relationship(%L, ''ACTIVE'', ''undo'')', v_g2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'C10: a removed relationship is never switched back on (' || v_text || ')');
  v_text := pg_temp.try(format('update public.guardians set status = ''active'' where id = %L', v_g2));
  perform pg_temp.check(v_text = '23514', 'C11: not by a backend status write either (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent1);
  select request_id into v_req_again from public.request_additional_guardian(v_player, 'frs-' || v_parent2::text || '@ovalball.test');
  perform pg_temp.act_postgres();
  select id into v_g2b from public.guardians where guardian_user_id = v_parent2 and player_id = v_player and state = 'PENDING_APPROVAL';
  perform pg_temp.check(v_g2b is not null and v_g2b <> v_g2 and (select state from public.guardians where id = v_g2) = 'REVOKED',
    'C12: linking again after removal is a new relationship beside the old one (FR-2)');

  v_text := pg_temp.try(format('insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state) values (%L, %L, ''guardian'', ''active'', ''ACTIVE'')', v_parent2, v_player));
  perform pg_temp.check(v_text = '23505', 'C13: at most one open relationship per adult and child (' || v_text || ')');

  v_text := pg_temp.try(format('insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (%L, %L, ''guardian'', ''active'')', v_adult_player, v_own_player));
  perform pg_temp.check(v_text = '23514', 'C14: nobody is their own guardian (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select * from public.remove_guardian_relationship(%L, ''Court order received'')', v_g1));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and (select state || '|' || revocation_reason from public.guardians where id = v_g1) = 'REVOKED|Court order received'
    and exists (select 1 from public.security_events where event_type = 'guardian.unlinked' and actor_user_id = v_admin and subject_user_id = v_parent1 and reason = 'Court order received'),
    'C15: the club''s removal path revokes with its reason and records guardian.unlinked');

  perform pg_temp.act('authenticated', v_parent1);
  v_text := pg_temp.try(format('update public.guardians set state = ''ACTIVE'' where id = %L', v_g1));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C16: no browser write to guardians (' || v_text || ')');

  -- ===============================================================
  -- D. Team places
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  perform public.approve_pending_team_membership(v_ptm_pending);
  perform public.reject_pending_team_membership(v_ptm_pending2, 'Team full');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state || '|' || status || '|' || (approved_by = v_admin)::text from public.player_team_memberships where id = v_ptm_pending) = 'ACTIVE|active|true'
    and exists (select 1 from public.security_events where event_type = 'player_team.added' and actor_user_id = v_admin and player_id = v_player2),
    'D1: approving a team request activates it, records the approver and player_team.added');
  perform pg_temp.check((select state || '|' || status || '|' || end_reason from public.player_team_memberships where id = v_ptm_pending2) = 'DECLINED|declined|Team full',
    'D2: declining a team request is DECLINED, not ENDED');

  perform pg_temp.act('authenticated', v_admin);
  perform public.archive_player_team_membership(v_ptm_pending);
  perform public.restore_player_team_membership(v_ptm_pending);
  perform pg_temp.act_postgres();
  select id into v_ptm_new from public.player_team_memberships where player_id = v_player2 and team_id = v_team and state = 'ACTIVE';
  perform pg_temp.check((select state from public.player_team_memberships where id = v_ptm_pending) = 'ENDED'
    and v_ptm_new is not null and v_ptm_new <> v_ptm_pending
    and (select source from public.player_team_memberships where id = v_ptm_new) = 'TEAM_READMISSION',
    'D3: archive ends the place; restore adds a new place and leaves the ended one as history');

  v_text := pg_temp.try(format('update public.player_team_memberships set status = ''active'' where id = %L', v_ptm_pending));
  perform pg_temp.check(v_text = '23514', 'D4: an ended place is never switched back on (' || v_text || ')');

  select count(*) into v_count from public.security_events where player_id = v_player;
  perform pg_temp.act('authenticated', v_admin);
  v_ptm_moved := public.move_player_team_membership(v_ptm, v_team2, 'Squad rebalanced');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state || '|' || end_reason from public.player_team_memberships where id = v_ptm) = 'ENDED|Squad rebalanced'
    and (select state || '|' || source || '|' || team_id::text from public.player_team_memberships where id = v_ptm_moved) = 'ACTIVE|TEAM_MOVE|' || v_team2::text,
    'D5: a move ends one place and opens another in one step');
  perform pg_temp.check((select count(*) from public.security_events where player_id = v_player) = v_count + 1
    and exists (select 1 from public.security_events where event_type = 'player_team.moved' and actor_user_id = v_admin and player_id = v_player
                and metadata ->> 'to_team_id' = v_team2::text),
    'D6: a move is exactly one player_team.moved event');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.move_player_team_membership(%L, %L, null)', v_ptm_moved, v_team_b));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501' and (select state from public.player_team_memberships where id = v_ptm_moved) = 'ACTIVE',
    'D7: moving into another club''s team needs that club''s authority too (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin_b);
  v_text := pg_temp.try(format('select public.move_player_team_membership(%L, %L, null)', v_ptm_moved, v_team_b));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D8: and the source club''s (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent1);
  v_text := pg_temp.try(format('select end_reason from public.player_team_memberships where id = %L', v_ptm));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D9: the browser cannot read a team place''s end reason (' || v_text || ')');

  raise notice 'Family relationship and team place state machine complete.';
end $$;

rollback;
