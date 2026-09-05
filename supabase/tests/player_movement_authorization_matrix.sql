-- FINAL VERIFICATION CLOSURE Section 3: the full authorization matrix,
-- tested by DIRECTLY calling the RPCs as each real, distinct identity
-- (never by inspecting what a UI would show/hide). Reuses real,
-- pre-existing auth.users rows (their OTHER real-world club roles
-- elsewhere are irrelevant -- this test gives each one a fresh,
-- isolated membership scoped ONLY to this test club) so every FK to
-- auth.users(id) is satisfied without inventing new user rows.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_authorization_matrix.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0080', 'Auth Matrix Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'auth-matrix-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0080', '9d000000-0000-0000-0000-0000000d0080', 'auth-matrix-test-club-9d000000', 'active');

-- 002 = Club Admin of this isolated test club (their REAL role at
-- Burnley is irrelevant here -- this is a fresh membership at a
-- brand-new club_id). 004/005/006 get ONLY a BASIC_USER club
-- membership plus one specific team_permissions row each -- genuinely
-- team-only identities, holding no club-wide role at this club at all.
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000800001', '9d000000-0000-0000-0000-0000000c0080', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000800002', '9d000000-0000-0000-0000-0000000c0080', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-000000800003', '9d000000-0000-0000-0000-0000000c0080', '00000000-0000-0000-0000-000000000005', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-000000800004', '9d000000-0000-0000-0000-0000000c0080', '00000000-0000-0000-0000-000000000006', 'BASIC_USER', 'active');

insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000e001', '9d000000-0000-0000-0000-0000000c0080', 'union', 'youth', 'U14', 'boys', null, 'U14 A', 'amt-u14a', true),
  ('9d000000-0000-0000-0000-00000000e002', '9d000000-0000-0000-0000-0000000c0080', 'union', 'youth', 'U14', 'boys', 'B', 'U14 B', 'amt-u14b', true),
  ('9d000000-0000-0000-0000-00000000e003', '9d000000-0000-0000-0000-0000000c0080', 'union', 'youth', 'U16', 'boys', null, 'U16', 'amt-u16', true);

-- 004 = target-team (U14 B) admin only. 005 = source-team (U14 A)
-- admin only. 006 = an UNRELATED team (U16) admin -- no relationship
-- to either the source or target team at all.
insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ('9d000000-0000-0000-0000-000000800002', '9d000000-0000-0000-0000-00000000e002', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000800003', '9d000000-0000-0000-0000-00000000e001', 'team_admin', '00000000-0000-0000-0000-000000000005'),
  ('9d000000-0000-0000-0000-000000800004', '9d000000-0000-0000-0000-00000000e003', 'team_admin', '00000000-0000-0000-0000-000000000006');

insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-00000000e010', 'Auth', 'MatrixPlayer', (current_date - interval '14 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-00000000e010', '9d000000-0000-0000-0000-00000000e001', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000e020', '9d000000-0000-0000-0000-00000000e002', current_date, 'Home', 'Auth Matrix Opponent', 'Booked');

-- A1/A2: the REQUESTING (target) team admin can request, but cannot
-- approve their own incoming request purely as its requester -- they
-- hold no independent SOURCE-team authority.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
begin
  begin
    select public.request_player_call_up('9d000000-0000-0000-0000-00000000e020', '9d000000-0000-0000-0000-00000000e010', '9d000000-0000-0000-0000-00000000e001', '9d000000-0000-0000-0000-00000000e002', 'test') into v_call_up_id;
    raise notice 'PASS A1: the requesting (target) team''s own admin, with no club-wide role, can request a call-up for their own team';
  exception when others then
    raise notice 'FAIL A1: %', sqlerrm;
  end;

  begin
    perform public.decide_player_call_up((select id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e002' limit 1), 'approve');
    raise notice 'FAIL A2: the requesting team admin approved their own incoming request despite holding no source-team authority';
  exception when others then
    raise notice 'PASS A2: the requesting team admin cannot approve their own request -- they hold no independent source-team authority (%)', sqlerrm;
  end;
end $$;
reset role;

-- A3: the SOURCE team's own admin (an entirely different, unrelated
-- account to the requester) can approve it for real.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
begin
  select id into v_call_up_id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e002' limit 1;
  perform public.decide_player_call_up(v_call_up_id, 'approve');
  if (select status from public.fixture_player_call_up where id = v_call_up_id) = 'approved' then
    raise notice 'PASS A3: the SOURCE team''s own admin (a distinct account, holding no club-wide role) can approve for real';
  else
    raise notice 'FAIL A3: call-up not approved';
  end if;
end $$;
reset role;

-- A4: an admin of a THIRD, completely unrelated team cannot see or
-- act on this call-up at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
  v_visible integer;
begin
  select id into v_call_up_id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e002' limit 1;
  select count(*) into v_visible from public.fixture_player_call_up where id = v_call_up_id;
  if v_visible = 0 then
    raise notice 'PASS A4a: an unrelated team''s admin cannot even see this call-up';
  else
    raise notice 'FAIL A4a: unrelated team admin saw the row';
  end if;

  begin
    perform public.decide_player_call_up(v_call_up_id, 'reject');
    raise notice 'FAIL A4b: an unrelated team admin was able to decide a call-up with no relationship to either side';
  exception when others then
    raise notice 'PASS A4b: an unrelated team admin cannot decide it either (%)', sqlerrm;
  end;
end $$;
reset role;

-- A5: Club Admin CAN decide any call-up at this club, by explicit
-- design (approve_fixture_callups is deliberately granted at club
-- scope to CLUB_ADMIN, mirroring the pre-existing can_manage_club_
-- fixtures convention this whole capability model reuses) -- this is
-- the capability model explicitly permitting it, not an accidental
-- side effect of the CLUB_ADMIN role name.
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000e021', '9d000000-0000-0000-0000-00000000e002', current_date + 3, 'Home', 'Auth Matrix Opponent 2', 'Booked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
select public.request_player_call_up('9d000000-0000-0000-0000-00000000e021', '9d000000-0000-0000-0000-00000000e010', '9d000000-0000-0000-0000-00000000e001', '9d000000-0000-0000-0000-00000000e002', 'test');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
begin
  select id into v_call_up_id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e002' and status = 'requested' order by created_at desc limit 1;
  perform public.decide_player_call_up(v_call_up_id, 'approve');
  if (select status from public.fixture_player_call_up where id = v_call_up_id) = 'approved' then
    raise notice 'PASS A5: Club Admin can decide a call-up club-wide, by the capability model''s explicit club-scope grant';
  else
    raise notice 'FAIL A5: Club Admin could not approve';
  end if;
end $$;
reset role;

-- B1/B2: cross-age dispensation -- the target team admin can initiate,
-- but cannot grant the club or governing-body stage.
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000e030', '9d000000-0000-0000-0000-0000000c0080', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'amt-sc', true),
  ('9d000000-0000-0000-0000-00000000e031', '9d000000-0000-0000-0000-0000000c0080', 'union', 'senior', null, 'mens', '1st', 'Men''s 1st', 'amt-mens1', true);
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000800005', '9d000000-0000-0000-0000-0000000c0080', '00000000-0000-0000-0000-000000000009', 'BASIC_USER', 'active')
on conflict (id) do nothing;
insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ('9d000000-0000-0000-0000-000000800005', '9d000000-0000-0000-0000-00000000e031', 'team_admin', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-00000000e032', 'Auth', 'MatrixColt', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-00000000e032', '9d000000-0000-0000-0000-00000000e030', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000e033', '9d000000-0000-0000-0000-00000000e031', current_date, 'Home', 'Auth Matrix Adult Opponent', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
  v_disp_id uuid;
begin
  select public.request_player_call_up('9d000000-0000-0000-0000-00000000e033', '9d000000-0000-0000-0000-00000000e032', '9d000000-0000-0000-0000-00000000e030', '9d000000-0000-0000-0000-00000000e031', 'RFU Regulation 15') into v_call_up_id;
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up where id = v_call_up_id;
  if v_disp_id is not null then
    raise notice 'PASS B1: a plain team admin (no club-wide role) CAN initiate a cross-age request that requires eligibility approval';
  else
    raise notice 'FAIL B1: no linked dispensation created';
  end if;

  -- B4: cannot fabricate approval through the ordinary call-up
  -- endpoint, regardless of who calls it.
  begin
    perform public.decide_player_call_up(v_call_up_id, 'approve');
    raise notice 'FAIL B4: a team admin approved a call-up still awaiting eligibility via the ordinary decide endpoint';
  exception when others then
    raise notice 'PASS B4a: the ordinary call-up endpoint cannot be used to bypass eligibility, even attempted by the requester (%)', sqlerrm;
  end;

  -- B2: this same team admin cannot grant the source-team stage for a
  -- team they don't manage, nor the club/governing-body stages at all.
  -- Nested in its OWN exception scope -- an exception attached to the
  -- OUTER block would roll back to that block's own entry savepoint,
  -- silently undoing B1's already-successful insert above it.
  begin
    perform public.decide_player_dispensation(v_disp_id, 'source_team', true, null, null);
    raise notice 'FAIL B2a: a team admin with no relationship to the SOURCE team approved its source-team stage';
  exception when others then
    raise notice 'PASS B2a: this team admin (only authorized on the TARGET team) cannot approve the SOURCE team''s own stage (%)', sqlerrm;
  end;
end $$;
reset role;

-- The real source team (Senior Colts) admin approves stage 1 for real
-- -- reusing user 006's existing (unrelated-team) membership at this
-- club, now ALSO given team_admin on Senior Colts specifically, then
-- the SAME non-club-admin team identity is proven unable to reach the
-- club/governing-body stages.
insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ('9d000000-0000-0000-0000-000000800004', '9d000000-0000-0000-0000-00000000e030', 'team_admin', '00000000-0000-0000-0000-000000000002')
on conflict do nothing;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
declare
  v_disp_id uuid;
begin
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e031' limit 1;
  perform public.decide_player_dispensation(v_disp_id, 'source_team', true, null, null);
  if (select status from public.player_team_dispensation where id = v_disp_id) = 'source_team_approved' then
    raise notice 'PASS B2b: the real Senior Colts (source team) admin correctly CAN approve the source-team stage';
  else
    raise notice 'FAIL B2b: source-team stage not approved';
  end if;

  begin
    perform public.decide_player_dispensation(v_disp_id, 'club', true, null, null);
    raise notice 'FAIL B2c: a plain team admin (not Club Admin) approved the CLUB stage of a dispensation';
  exception when others then
    raise notice 'PASS B2c: a plain team admin, even the correct source-team one, cannot approve the CLUB stage -- Club Admin only (%)', sqlerrm;
  end;
end $$;
reset role;

-- B3: Club Admin CAN manage/record the club and governing-body stages.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_disp_id uuid;
begin
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up where target_team_id = '9d000000-0000-0000-0000-00000000e031' limit 1;
  perform public.decide_player_dispensation(v_disp_id, 'club', true, null, null);
  perform public.decide_player_dispensation(v_disp_id, 'governing_body', true, 'RFU-DISP-AUTHMATRIX', null);
  if (select status from public.player_team_dispensation where id = v_disp_id) = 'approved' then
    raise notice 'PASS B3: Club Admin can record both the club and governing-body stages';
  else
    raise notice 'FAIL B3: dispensation not fully approved';
  end if;
end $$;
reset role;

-- B5: a genuinely unrelated club's admin has zero access to any of this.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_visible_calls integer;
  v_visible_disps integer;
begin
  select count(*) into v_visible_calls from public.fixture_player_call_up where target_team_id in ('9d000000-0000-0000-0000-00000000e002', '9d000000-0000-0000-0000-00000000e031');
  select count(*) into v_visible_disps from public.player_team_dispensation where target_team_id = '9d000000-0000-0000-0000-00000000e031';
  if v_visible_calls = 0 and v_visible_disps = 0 then
    raise notice 'PASS B5: an unrelated club''s admin has zero visibility into any call-up or dispensation record from this test club';
  else
    raise notice 'FAIL B5: visible calls=% disps=%', v_visible_calls, v_visible_disps;
  end if;
end $$;
reset role;

rollback;
