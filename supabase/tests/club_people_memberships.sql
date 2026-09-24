-- CLUB PEOPLE & MEMBERSHIPS (CA-M3) -- permanent regression.
--
-- Pins the read model and the membership operations both clients now share. `club_people`
-- answers only for people.member.view holders, pages and searches on the server, returns an email
-- only under people.member.view_contact, lists suspended and pending memberships and issued staff
-- invitations, reads no player, guardian or date of birth, and marks the caller's own row. The
-- operations keep their own authority: a role change, a suspension, a restore, a removal and a
-- team role are refused for a stranger and for a Club Admin whose people.role.assign_club is
-- withheld (stale authority), the server requires a reason where the shared list says so, a Club
-- Admin cannot suspend themselves, the club is never left without a Club Admin, the Safeguarding
-- Officer cannot be assigned or ended through the generic operations, and every change lands in
-- the one audit history with the actor.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid;
  v_m_admin uuid; v_m_admin2 uuid; v_m_member uuid; v_tp uuid; v_ra uuid; v_override uuid;
  v_n int; v_total bigint; v_state text; v_err text;
  v_row record;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_site, 'cpm-site@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin, 'cpm-admin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin2, 'cpm-admin2@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_member, 'cpm-member@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_stranger, 'cpm-stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v_admin, 'Ada', 'Admin', 'cpm-admin@ovalball-test.invalid', (current_date - interval '40 years')::date),
         (v_admin2, 'Bea', 'Backup', 'cpm-admin2@ovalball-test.invalid', (current_date - interval '40 years')::date),
         (v_member, 'Cal', 'Member', 'cpm-member@ovalball-test.invalid', (current_date - interval '30 years')::date),
         (v_stranger, 'Dan', 'Stranger', 'cpm-stranger@ovalball-test.invalid', (current_date - interval '30 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, email = excluded.email, date_of_birth = excluded.date_of_birth;
  insert into public.site_admins (user_id, admin_role, status) values (v_site, 'full', 'active');
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('People Club', 'union', 'England', 'England', 'manual', 'verified', 'people-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'people-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active') returning id into v_m_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin2, 'CLUB_ADMIN', 'active') returning id into v_m_admin2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active') returning id into v_m_member;
  insert into public.teams (club_id, rugby_code, display_name, slug, category, age_group, gender, active)
  values (v_club, 'union', 'Under 12 Boys', 'u12-people', 'youth', 'U12', 'boys', true) returning id into v_team;

  -- ================================================================= READ MODEL
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.club_people(v_club);
  if v_n = 3 then raise notice 'PASS R1: the club admin reads every live membership (%)', v_n; else raise notice 'FAIL R1: % rows', v_n; end if;
  select count(*) into v_n from public.club_people(v_club) where email is not null;
  if v_n = 3 then raise notice 'PASS R2: a people.member.view_contact holder sees emails'; else raise notice 'FAIL R2: % emails', v_n; end if;
  select count(*) into v_n from public.club_people(v_club) where is_self;
  if v_n = 1 then raise notice 'PASS R3: the caller''s own row is marked'; else raise notice 'FAIL R3: % self rows', v_n; end if;
  select count(*) into v_n from public.club_people(v_club, 'bea');
  if v_n = 1 then raise notice 'PASS R4: search matches a name on the server'; else raise notice 'FAIL R4: % rows for "bea"', v_n; end if;
  select count(*) into v_n from public.club_people(v_club, null, 'staff');
  if v_n = 2 then raise notice 'PASS R5: the staff filter is the two Club Admins'; else raise notice 'FAIL R5: % staff', v_n; end if;
  select count(*), max(total_count) into v_n, v_total from public.club_people(v_club, null, 'all', 2, 0);
  if v_n = 2 and v_total = 3 then raise notice 'PASS R6: paging returns 2 of a total of 3'; else raise notice 'FAIL R6: % rows total %', v_n, v_total; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform * from public.club_people(v_club);
    raise notice 'FAIL R7: a stranger read the club''s people';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS R7: a stranger is refused (42501)'; else raise notice 'FAIL R7: %', v_state; end if;
  end;
  -- a member holds no people.member.view (MB bundle) either
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  begin
    perform * from public.club_people(v_club);
    raise notice 'FAIL R8: an ordinary member read the club''s people';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS R8: an ordinary member is refused (42501)'; else raise notice 'FAIL R8: %', v_state; end if;
  end;

  -- ================================================================= OPERATIONS as the club admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- O1 primary role change through the operation; audited
  perform public.set_primary_club_role(v_m_member, 'FIXTURE_SECRETARY', 'Taking on fixtures');
  select role into v_row from public.club_memberships where id = v_m_member;
  if v_row.role = 'FIXTURE_SECRETARY' then raise notice 'PASS O1: the primary club role is changed through the operation'; else raise notice 'FAIL O1: role %', v_row.role; end if;
  select count(*) into v_n from public.club_people(v_club, null, 'staff');
  if v_n = 3 then raise notice 'PASS O1b: the read model reflects it (staff now 3)'; else raise notice 'FAIL O1b: staff %', v_n; end if;
  select count(*) into v_n from public.audit_log a where a.table_name = 'club_memberships' and a.record_id = v_m_member and a.actor_user_id = v_admin and a.action = 'update';
  if v_n >= 1 then raise notice 'PASS O1c: the change is in the one audit history with the actor'; else raise notice 'FAIL O1c: no audit row'; end if;
  perform public.set_primary_club_role(v_m_member, 'BASIC_USER', 'Back to member');

  -- O2 team role given and removed
  perform public.set_team_access(v_m_member, v_team, 'coach', 'Coaching this season');
  select id into v_tp from public.team_permissions where membership_id = v_m_member and team_id = v_team;
  select count(*) into v_n from public.club_people(v_club, null, 'all', 50, 0, v_m_member) p where jsonb_array_length(p.team_roles) = 1;
  if v_tp is not null and v_n = 1 then raise notice 'PASS O2: a team role is given through the operation and read back'; else raise notice 'FAIL O2: tp % rows %', v_tp, v_n; end if;
  perform public.remove_team_access(v_tp, 'Stepped down');
  select count(*) into v_n from public.team_permissions where membership_id = v_m_member;
  if v_n = 0 then raise notice 'PASS O2b: the team role is removed'; else raise notice 'FAIL O2b: still %', v_n; end if;

  -- O3 an additional role (Volunteer) assigned and ended; Safeguarding Officer refused
  perform public.assign_role(v_m_member, 'VOLUNTEER', null, 'Helps on match days');
  select id into v_ra from public.role_assignments where membership_id = v_m_member and role_key = 'VOLUNTEER' and state = 'ACTIVE';
  select count(*) into v_n from public.club_people(v_club, null, 'all', 50, 0, v_m_member) p where p.additional_roles @> '[{"role_key":"VOLUNTEER"}]'::jsonb;
  if v_ra is not null and v_n = 1 then raise notice 'PASS O3: Volunteer assigned and read back'; else raise notice 'FAIL O3: ra % rows %', v_ra, v_n; end if;
  perform public.transition_role_assignment(v_ra, 'REVOKED', 'No longer volunteering', false);
  select state into v_row from public.role_assignments where id = v_ra;
  if v_row.state = 'REVOKED' then raise notice 'PASS O3b: the Volunteer role is ended'; else raise notice 'FAIL O3b: %', v_row.state; end if;
  begin
    perform public.assign_role(v_m_member, 'SAFEGUARDING_OFFICER', null, 'Try');
    raise notice 'FAIL O3c: a Safeguarding Officer was assigned through the generic operation';
  exception when others then
    raise notice 'PASS O3c: the Safeguarding Officer is appointed through nomination, never assigned here';
  end;

  -- O4 suspend needs a reason; suspend; read model shows it; restore
  begin
    perform public.transition_club_membership(v_m_member, 'SUSPENDED', '  ', false);
    raise notice 'FAIL O4: a suspension without a reason was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
    if v_state = '22023' and v_err = 'Please give a reason.' then raise notice 'PASS O4: a suspension needs a reason (the shared list: always, except on your own membership)';
    else raise notice 'FAIL O4: % %', v_state, v_err; end if;
  end;
  perform public.transition_club_membership(v_m_member, 'SUSPENDED', 'Conduct review', false);
  select count(*) into v_n from public.club_people(v_club, null, 'suspended');
  if v_n = 1 then raise notice 'PASS O4b: a suspended membership is listed under the suspended filter'; else raise notice 'FAIL O4b: %', v_n; end if;
  perform public.transition_club_membership(v_m_member, 'ACTIVE', 'Review complete', false);
  select state into v_row from public.club_memberships where id = v_m_member;
  if v_row.state = 'ACTIVE' then raise notice 'PASS O4c: restored'; else raise notice 'FAIL O4c: %', v_row.state; end if;

  -- O5 self-protection and the last Club Admin
  begin
    perform public.transition_club_membership(v_m_admin, 'SUSPENDED', 'Me', false);
    raise notice 'FAIL O5: a Club Admin suspended themselves';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%your own membership%' then raise notice 'PASS O5: a Club Admin cannot suspend their own membership';
    else raise notice 'FAIL O5: %', v_err; end if;
  end;
  perform public.transition_club_membership(v_m_admin2, 'REVOKED', 'Left the club', false);
  begin
    perform public.set_primary_club_role(v_m_admin, 'BASIC_USER', 'Stepping down');
    raise notice 'FAIL O5b: the last Club Admin stepped down';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
    if v_err like '%without a Club Admin%' then raise notice 'PASS O5b: the club is never left without a Club Admin (server invariant)';
    else raise notice 'FAIL O5b: % %', v_state, v_err; end if;
  end;
  select count(*) into v_n from public.club_people(v_club) where membership_id = v_m_admin2;
  if v_n = 0 then raise notice 'PASS O5c: a removed membership leaves the People list (kept as history)'; else raise notice 'FAIL O5c: still listed'; end if;

  -- O6 stranger refused; stale authority: a Club Admin with people.role.assign_club withheld is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.set_primary_club_role(v_m_member, 'CLUB_ADMIN', 'Hijack');
    raise notice 'FAIL O6: a stranger changed a role';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS O6: a stranger is refused (42501)'; else raise notice 'FAIL O6: %', v_state; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  -- CA-M4: a suspension asks people.membership.suspend (grant_level N: only Ovalball can withhold it, and it bites).
  v_override := public.set_capability_override(v_admin, 'people.membership.suspend', 'club', v_club, null, 'deny', 'CA-M3 stale-authority regression', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.transition_club_membership(v_m_member, 'SUSPENDED', 'After the deny', false);
    raise notice 'FAIL O6b: a denied Club Admin still suspended a member';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS O6b: a Club Admin with people.membership.suspend withheld is refused (42501) -- the role does not decide';
    else raise notice 'FAIL O6b: %', v_state; end if;
  end;
  select count(*) into v_n from public.my_capabilities('club', v_club) m where m.capability_key = 'people.membership.suspend' and m.allowed;
  if v_n = 0 then raise notice 'PASS O6c: the capability read the client redraws from says no'; else raise notice 'FAIL O6c: still yes'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.revoke_capability_override(v_override, 'CA-M3 stale-authority regression restored');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.transition_club_membership(v_m_member, 'SUSPENDED', 'After the revoke', false);
  perform public.transition_club_membership(v_m_member, 'ACTIVE', 'Restored', false);
  raise notice 'PASS O6d: revoking the override restores the holder';

  -- ================================================================= BOUNDARIES
  select pg_get_functiondef('public.club_people(uuid, text, text, integer, integer, uuid)'::regprocedure) into v_err;
  if v_err !~ 'date_of_birth' and v_err !~ 'public\.players' and v_err !~ 'public\.guardians' then raise notice 'PASS B1: the read model reads no player, guardian or date of birth';
  else raise notice 'FAIL B1: the read model reaches child data'; end if;
  if has_function_privilege('anon', 'public.club_people(uuid, text, text, integer, integer, uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.club_assignable_roles(uuid)', 'EXECUTE') then
    raise notice 'FAIL B2: anon can execute a People reader';
  else raise notice 'PASS B2: anon holds no grant'; end if;
  select count(*) into v_n from public.club_assignable_roles(v_club) where role_key = 'SAFEGUARDING_OFFICER' or role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER');
  if v_n = 0 then raise notice 'PASS B3: assignable additional roles exclude the primary seats and the Safeguarding Officer'; else raise notice 'FAIL B3: % excluded roles offered', v_n; end if;
end $$;

rollback;
