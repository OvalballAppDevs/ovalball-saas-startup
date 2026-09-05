-- Parent/Guardian/Player Safeguarding + Attendance Foundation --
-- security regression suite. Entirely self-contained synthetic fixtures
-- (fresh generated identities, never a hardcoded fork-local ID) --
-- transactional/self-cleaning, never touches real club data.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/parent_player_foundation_security.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Parent/Guardian/Player Safeguarding + Attendance Foundation security suite ==='

begin;
create temporary table t_ppf_state (k text primary key, v text) on commit drop;
grant all on t_ppf_state to authenticated, service_role, anon;

do $$
declare
  v_dir uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_team_u12 uuid := gen_random_uuid();
  v_team_u16 uuid := gen_random_uuid();
  v_staff_u12 uuid := gen_random_uuid();
  v_staff_u16 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_guardian_1 uuid := gen_random_uuid();
  v_guardian_2 uuid := gen_random_uuid();
  v_guardian_3_lone uuid := gen_random_uuid();
  v_player16_user uuid := gen_random_uuid();
  v_player12_user uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
  v_membership_staff_u12 uuid;
  v_membership_staff_u16 uuid;
  v_player_shared uuid := gen_random_uuid();
  v_player_lone uuid := gen_random_uuid();
  v_player_16 uuid := gen_random_uuid();
  v_player_12 uuid := gen_random_uuid();
  v_guardian_rel_g1_shared uuid := gen_random_uuid();
  v_guardian_rel_g2_shared uuid := gen_random_uuid();
  v_guardian_rel_g3_lone uuid := gen_random_uuid();
  v_guardian_rel_g1_p16 uuid := gen_random_uuid();
  v_fixture_id uuid := gen_random_uuid();
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (v_dir, 'PPF Security Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ppf-sec-test-' || v_dir::text);
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club, v_dir, 'ppf-sec-test-' || v_club::text, 'active');

  -- U12 (youth) + a second team (U16) for cross-team isolation tests.
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active, canonical_team_type_id) values
    (v_team_u12, v_club, 'union', 'youth', 'U12', 'boys', 'PPF Test U12', 'ppf-test-u12-' || v_team_u12::text, true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null)),
    (v_team_u16, v_club, 'union', 'youth', 'U16', 'boys', 'PPF Test U16', 'ppf-test-u16-' || v_team_u16::text, true, internal.resolve_canonical_team_type('youth', 'U16', 'boys', null));

  -- Users: staff_u12 (Coach on U12), staff_u16 (Coach on U16, no U12
  -- authority), admin (Club Admin), guardian_1/guardian_2 (two guardians
  -- of the same U12 player, for aggregation tests), guardian_3_lone (a
  -- lone guardian of a second U12 player, for orphan tests), player16
  -- (a 16yo player with own login), player12 (a 12yo player with own
  -- login, no self-service rights possible).
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_staff_u12, 'ppfsec-staffu12-' || v_staff_u12::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_staff_u16, 'ppfsec-staffu16-' || v_staff_u16::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin, 'ppfsec-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_1, 'ppfsec-g1-' || v_guardian_1::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_2, 'ppfsec-g2-' || v_guardian_2::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_3_lone, 'ppfsec-g3lone-' || v_guardian_3_lone::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_player16_user, 'ppfsec-player16-' || v_player16_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_player12_user, 'ppfsec-player12-' || v_player12_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated, 'ppfsec-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.club_memberships (id, user_id, club_id, role, status) values
    (gen_random_uuid(), v_staff_u12, v_club, 'BASIC_USER', 'active'),
    (gen_random_uuid(), v_staff_u16, v_club, 'BASIC_USER', 'active'),
    (gen_random_uuid(), v_admin, v_club, 'CLUB_ADMIN', 'active');
  -- Fetch each membership id explicitly (a multi-row INSERT can't
  -- RETURNING INTO a single scalar) so team_permissions can reference
  -- the correct membership per user.
  select id into v_membership_staff_u12 from public.club_memberships where club_id = v_club and user_id = v_staff_u12;
  select id into v_membership_staff_u16 from public.club_memberships where club_id = v_club and user_id = v_staff_u16;
  insert into public.team_permissions (id, membership_id, team_id, permission) values
    (gen_random_uuid(), v_membership_staff_u12, v_team_u12, 'coach'),
    (gen_random_uuid(), v_membership_staff_u16, v_team_u16, 'coach');

  -- Players. player_shared has TWO guardians (aggregation test).
  -- player_lone has ONE guardian (orphan test after removal). player16/
  -- player12 are self-linked.
  insert into public.players (id, first_name, surname, date_of_birth, user_id) values
    (v_player_shared, 'SharedChild', 'Test', '2014-06-01', null),
    (v_player_lone, 'LoneChild', 'Test', '2014-06-01', null),
    (v_player_16, 'Sixteen', 'Test', (current_date - interval '16 years' - interval '2 months')::date, v_player16_user),
    (v_player_12, 'Twelve', 'Test', '2014-06-01', v_player12_user);

  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status) values
    (v_guardian_rel_g1_shared, v_guardian_1, v_player_shared, 'guardian', 'active'),
    (v_guardian_rel_g2_shared, v_guardian_2, v_player_shared, 'guardian', 'active'),
    (v_guardian_rel_g3_lone, v_guardian_3_lone, v_player_lone, 'guardian', 'active'),
    (v_guardian_rel_g1_p16, v_guardian_1, v_player_16, 'guardian', 'active'); -- Guardian1 is also Player16's guardian

  insert into public.player_team_memberships (id, player_id, team_id, status) values
    (gen_random_uuid(), v_player_shared, v_team_u12, 'active'),
    (gen_random_uuid(), v_player_lone, v_team_u12, 'active'),
    (gen_random_uuid(), v_player_16, v_team_u12, 'active'),
    (gen_random_uuid(), v_player_12, v_team_u12, 'active');

  -- One real fixture owned by U12, for attendance tests.
  insert into public.fixtures (id, owning_team_id, kickoff_date, status, home_away, raw_opposition_text) values
    (v_fixture_id, v_team_u12, current_date + 14, 'Booked', 'Home', 'PPF Test Opposition');

  insert into t_ppf_state values
    ('club', v_club::text), ('team_u12', v_team_u12::text), ('team_u16', v_team_u16::text),
    ('staff_u12', v_staff_u12::text), ('staff_u16', v_staff_u16::text), ('admin', v_admin::text),
    ('guardian_1', v_guardian_1::text), ('guardian_2', v_guardian_2::text), ('guardian_3_lone', v_guardian_3_lone::text),
    ('player16_user', v_player16_user::text), ('player12_user', v_player12_user::text), ('unrelated', v_unrelated::text),
    ('player_shared', v_player_shared::text), ('player_lone', v_player_lone::text), ('player_16', v_player_16::text), ('player_12', v_player_12::text),
    ('guardian_rel_g3_lone', v_guardian_rel_g3_lone::text), ('guardian_rel_g1_shared', v_guardian_rel_g1_shared::text),
    ('fixture_id', v_fixture_id::text);
end $$;

-- ============================================================
-- 1. Guardian invitation: cross-team tamper rejected, cross-club rejected.
-- ============================================================
do $$
declare v_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'staff_u12'), 'role', 'authenticated')::text, true);

  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id)
  values ((select v::uuid from t_ppf_state where k = 'club'), (select v::uuid from t_ppf_state where k = 'team_u12'), 'newparent@ovalball.test', auth.uid())
  returning id into v_id;
  raise notice 'PASS: U12 coach can invite a Guardian to their own team';

  begin
    insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id)
    values ((select v::uuid from t_ppf_state where k = 'club'), (select v::uuid from t_ppf_state where k = 'team_u16'), 'newparent2@ovalball.test', auth.uid()); -- U16, not their team
    raise notice 'FAIL: U12 coach was able to invite a Guardian to U16 (unrelated team)';
  exception when others then
    raise notice 'PASS: U12 coach blocked from inviting a Guardian to an unrelated team (U16)';
  end;
end $$;

-- ============================================================
-- 2. Duplicate player detection: never reveals the match.
-- ============================================================
do $$
declare v_inv_id uuid; v_result text; v_player_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'staff_u12'), 'role', 'authenticated')::text, true);
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, status, accepted_by, accepted_at)
  values ((select v::uuid from t_ppf_state where k = 'club'), (select v::uuid from t_ppf_state where k = 'team_u12'), 'dupparent@ovalball.test', auth.uid(), 'accepted', (select v::uuid from t_ppf_state where k = 'unrelated'), now())
  returning id into v_inv_id;

  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'unrelated'), 'role', 'authenticated')::text, true); -- accepted this invitation
  select result, player_id into v_result, v_player_id from public.create_player_for_guardian(v_inv_id, 'SharedChild', 'Test', '2014-06-01');
  if v_result = 'under_review' and v_player_id is null then
    raise notice 'PASS: duplicate-matching submission returns under_review with no player_id leaked';
  else
    raise notice 'FAIL: duplicate submission result=% player_id=%', v_result, v_player_id;
  end if;

  -- Confirm the submitting Parent themselves CANNOT see the duplicate
  -- review row (never expose the match to them) before switching to a
  -- legitimately-authorized identity to confirm it exists.
  if exists (select 1 from public.player_duplicate_reviews where guardian_invitation_id = v_inv_id) then
    raise notice 'FAIL: the submitting Parent can see their own duplicate-review row (should be invisible to them)';
  else
    raise notice 'PASS: the submitting Parent cannot see the duplicate-review row (staff-only)';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'staff_u12'), 'role', 'authenticated')::text, true); -- U12 coach, legitimately authorized
  if exists (select 1 from public.player_duplicate_reviews where guardian_invitation_id = v_inv_id and matched_player_id = (select v::uuid from t_ppf_state where k = 'player_shared')) then
    raise notice 'PASS: authorized team staff can see the duplicate review row, referencing the real matched player';
  else
    raise notice 'FAIL: no duplicate review row visible to authorized staff';
  end if;
end $$;

-- ============================================================
-- 3. Multi-guardian consent aggregation.
-- ============================================================
do $$
declare v_effective boolean; v_player_shared uuid := (select v::uuid from t_ppf_state where k = 'player_shared');
begin
  -- Neither guardian has decided yet -> effectively denied.
  select internal.guardian_permission_effective(v_player_shared, 'send_team_messages') into v_effective;
  if v_effective = false then raise notice 'PASS: no decision from either guardian -> effective DENY'; else raise notice 'FAIL: expected deny with no decisions'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true);
  perform public.set_guardian_player_permission(v_player_shared, 'send_team_messages', true);

  reset role;
  select internal.guardian_permission_effective(v_player_shared, 'send_team_messages') into v_effective;
  if v_effective = false then raise notice 'PASS: one of two guardians granted -> still effective DENY (ALL must grant)'; else raise notice 'FAIL: expected deny with only 1/2 granted'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_2'), 'role', 'authenticated')::text, true);
  perform public.set_guardian_player_permission(v_player_shared, 'send_team_messages', true);

  reset role;
  select internal.guardian_permission_effective(v_player_shared, 'send_team_messages') into v_effective;
  if v_effective = true then raise notice 'PASS: both guardians granted -> effective ALLOW'; else raise notice 'FAIL: expected allow with 2/2 granted'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true); -- Guardian1 revokes
  perform public.set_guardian_player_permission(v_player_shared, 'send_team_messages', false);

  reset role;
  select internal.guardian_permission_effective(v_player_shared, 'send_team_messages') into v_effective;
  if v_effective = false then raise notice 'PASS: single guardian revocation immediately flips effective ALLOW back to DENY'; else raise notice 'FAIL: revocation did not take effect'; end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_2'), 'role', 'authenticated')::text, true); -- Guardian2, NOT of LoneChild
  begin
    perform public.set_guardian_player_permission((select v::uuid from t_ppf_state where k = 'player_lone'), 'view_fixtures', true);
    raise notice 'FAIL: an unrelated guardian was able to set consent for a player they do not guard';
  exception when others then
    raise notice 'PASS: unrelated guardian blocked from setting consent for LoneChild';
  end;
end $$;

-- ============================================================
-- 4. Orphaned minor: fail closed, staff cannot self-attach a replacement.
-- ============================================================
do $$
declare v_orphaned boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'admin'), 'role', 'authenticated')::text, true); -- Club Admin
  select orphaned into v_orphaned from public.remove_guardian_relationship((select v::uuid from t_ppf_state where k = 'guardian_rel_g3_lone'), 'Test: orphan scenario');
  if v_orphaned then raise notice 'PASS: removing LoneChild''s only guardian correctly reports orphaned=true'; else raise notice 'FAIL: expected orphaned=true'; end if;

  reset role;
  if internal.guardian_permission_effective((select v::uuid from t_ppf_state where k = 'player_lone'), 'view_fixtures') = false then
    raise notice 'PASS: orphaned player has zero active guardians -> every consent-gated permission fails closed automatically';
  else
    raise notice 'FAIL: orphaned player should be fully denied';
  end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'staff_u12'), 'role', 'authenticated')::text, true); -- U12 Coach (team staff, NOT Club Admin)
  begin
    perform public.remove_guardian_relationship((select v::uuid from t_ppf_state where k = 'guardian_rel_g1_shared'), 'Team staff attempting removal');
    raise notice 'FAIL: Team staff (Coach) was able to remove a Guardian relationship';
  exception when others then
    raise notice 'PASS: Team staff (Coach) blocked from removing a Guardian relationship -- Club Admin only';
  end;
end $$;

-- ============================================================
-- 5. Attendance: direct tampering, self-service age gates.
-- ============================================================
do $$
begin
  -- Guardian1 responds for SharedChild (legitimately theirs, on U12, fixture belongs to U12).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true);
  perform public.respond_to_attendance((select v::uuid from t_ppf_state where k = 'fixture_id'), (select v::uuid from t_ppf_state where k = 'player_shared'), 'ATTENDING');
  if exists (select 1 from public.player_fixture_attendance where fixture_id = (select v::uuid from t_ppf_state where k = 'fixture_id') and player_id = (select v::uuid from t_ppf_state where k = 'player_shared') and status = 'ATTENDING') then
    raise notice 'PASS: Guardian1 can respond to attendance for their own child';
  else
    raise notice 'FAIL: legitimate guardian attendance response did not persist';
  end if;

  -- Guardian1 tries to respond for a DIFFERENT, unrelated player (Twelve) -- must fail.
  begin
    perform public.respond_to_attendance((select v::uuid from t_ppf_state where k = 'fixture_id'), (select v::uuid from t_ppf_state where k = 'player_12'), 'ATTENDING');
    raise notice 'FAIL: Guardian1 was able to respond to attendance for an unrelated player';
  exception when others then
    raise notice 'PASS: Guardian1 blocked from responding for an unrelated player (Twelve) -- direct player_id substitution rejected';
  end;
end $$;

do $$
declare v_fake_fixture uuid := gen_random_uuid();
begin
  -- Fabricated fixture_id -- must fail.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true);
  begin
    perform public.respond_to_attendance(v_fake_fixture, (select v::uuid from t_ppf_state where k = 'player_shared'), 'ATTENDING');
    raise notice 'FAIL: attendance accepted for a fixture_id that does not exist';
  exception when others then
    raise notice 'PASS: fabricated fixture_id rejected';
  end;
end $$;

do $$
begin
  -- Player12 (under 16): self-attendance must be blocked unconditionally,
  -- even though no permission row exists at all.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'player12_user'), 'role', 'authenticated')::text, true);
  begin
    perform public.respond_to_attendance((select v::uuid from t_ppf_state where k = 'fixture_id'), (select v::uuid from t_ppf_state where k = 'player_12'), 'ATTENDING');
    raise notice 'FAIL: a 12-year-old player was able to self-respond to attendance';
  exception when others then
    raise notice 'PASS: under-16 player blocked from self-attendance (platform invariant, no consent row can override)';
  end;
end $$;

do $$
begin
  -- Player16: consent OFF by default -> self-attendance denied.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'player16_user'), 'role', 'authenticated')::text, true);
  begin
    perform public.respond_to_attendance((select v::uuid from t_ppf_state where k = 'fixture_id'), (select v::uuid from t_ppf_state where k = 'player_16'), 'ATTENDING');
    raise notice 'FAIL: 16-year-old self-attendance succeeded without Guardian consent';
  exception when others then
    raise notice 'PASS: 16-year-old blocked from self-attendance while approve_own_attendance consent is unset (deny-by-default)';
  end;

  -- Guardian1 (Player16's own guardian) grants approve_own_attendance.
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true);
  perform public.set_guardian_player_permission((select v::uuid from t_ppf_state where k = 'player_16'), 'approve_own_attendance', true);

  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'player16_user'), 'role', 'authenticated')::text, true);
  perform public.respond_to_attendance((select v::uuid from t_ppf_state where k = 'fixture_id'), (select v::uuid from t_ppf_state where k = 'player_16'), 'UNSURE');
  if exists (select 1 from public.player_fixture_attendance where player_id = (select v::uuid from t_ppf_state where k = 'player_16') and status = 'UNSURE' and response_source = 'player') then
    raise notice 'PASS: 16-year-old self-attendance succeeds once Guardian consent is granted';
  else
    raise notice 'FAIL: consented 16-year-old self-attendance did not persist';
  end if;
end $$;

-- ============================================================
-- 6. Team Community: read/send separation, minor consent gating, staff isolation.
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'admin'), 'role', 'authenticated')::text, true); -- Club Admin
  insert into public.team_conversations (team_id, active, enabled_by, enabled_at)
  values ((select v::uuid from t_ppf_state where k = 'team_u12'), true, auth.uid(), now())
  on conflict (team_id) do update set active = true;
  raise notice 'PASS: Club Admin can enable Team Community for U12 (team.community.manage)';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'staff_u16'), 'role', 'authenticated')::text, true); -- U16 coach, NOT U12 staff
  begin
    insert into public.team_conversations (team_id, active, enabled_by, enabled_at)
    values ((select v::uuid from t_ppf_state where k = 'team_u12'), true, auth.uid(), now())
    on conflict (team_id) do update set active = true;
    raise notice 'FAIL: U16 coach was able to manage U12''s Team Community setting';
  exception when others then
    raise notice 'PASS: U16 coach blocked from managing an unrelated team''s (U12) Community setting';
  end;
end $$;

do $$
declare v_can_view boolean; v_can_send boolean;
begin
  -- Player12 (Twelve): no consent granted -> cannot read or send.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'player12_user'), 'role', 'authenticated')::text, true);
  select internal.can_view_team_conversation((select v::uuid from t_ppf_state where k = 'team_u12')) into v_can_view;
  select internal.can_send_team_conversation((select v::uuid from t_ppf_state where k = 'team_u12')) into v_can_send;
  if v_can_view = false and v_can_send = false then
    raise notice 'PASS: U12 minor with no Guardian consent cannot read or send Team Community (deny by default)';
  else
    raise notice 'FAIL: expected deny-by-default, got view=% send=%', v_can_view, v_can_send;
  end if;
end $$;

do $$
declare v_can_view boolean; v_can_send boolean;
begin
  -- Grant view only for Player16 (via Guardian1) and confirm send stays denied.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'guardian_1'), 'role', 'authenticated')::text, true);
  perform public.set_guardian_player_permission((select v::uuid from t_ppf_state where k = 'player_16'), 'view_team_conversation', true);

  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'player16_user'), 'role', 'authenticated')::text, true);
  select internal.can_view_team_conversation((select v::uuid from t_ppf_state where k = 'team_u12')) into v_can_view;
  select internal.can_send_team_conversation((select v::uuid from t_ppf_state where k = 'team_u12')) into v_can_send;
  if v_can_view = true and v_can_send = false then
    raise notice 'PASS: view_team_conversation granted alone allows read but NOT send (read and send are independent)';
  else
    raise notice 'FAIL: expected view=true send=false, got view=% send=%', v_can_view, v_can_send;
  end if;
end $$;

do $$
declare v_can_view boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from t_ppf_state where k = 'unrelated'), 'role', 'authenticated')::text, true); -- genuinely unrelated user
  select internal.can_view_team_conversation((select v::uuid from t_ppf_state where k = 'team_u12')) into v_can_view;
  if v_can_view = false then
    raise notice 'PASS: a genuinely unrelated user cannot read Team Community for U12';
  else
    raise notice 'FAIL: unrelated user was granted Team Community read access';
  end if;
end $$;

reset role;
rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
