-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 2 regression coverage: the self-service Add-a-Child ->
-- pending-membership-approval lifecycle, duplicate detection, and the
-- Guardian consent fail-closed rule.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/side_project_1_player_guardian_foundation.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9f200000-0000-0000-0000-000000000001', 'Add Child Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'add-child-test-club-9f200000');
insert into public.clubs (id, directory_id, slug, status, timezone) values
  ('9f200000-0000-0000-0000-000000000001', '9f200000-0000-0000-0000-000000000001', 'add-child-test-club-9f200000', 'active', 'Europe/London');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9f200000-0000-0000-0000-000000000002', '9f200000-0000-0000-0000-000000000001', 'union', 'youth', 'U9', 'boys', null, 'Add Child U9', 'add-child-u9', true);
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9f200000-0000-0000-0000-000000000003', '9f200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.addchild.guardian1@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.addchild.guardian2@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.addchild.unrelated@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
on conflict (id) do nothing;

insert into public.profiles (id, first_name, surname, email) values
  ('00000000-0000-0000-0000-000000000091', 'Guardian', 'One', 'test.addchild.guardian1@ovalball.local'),
  ('00000000-0000-0000-0000-000000000092', 'Guardian', 'Two', 'test.addchild.guardian2@ovalball.local'),
  ('00000000-0000-0000-0000-000000000093', 'Unrelated', 'Person', 'test.addchild.unrelated@ovalball.local')
on conflict (id) do nothing;

-- ===== A. Self-service Add-a-Child resolves the correct age grade and
-- routes to exactly one matching PENDING team (never active outright) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000091","role":"authenticated"}';

do $$
declare v_result record;
begin
  select * into v_result from public.add_child_for_guardian('Regress', 'Childone', '2018-01-01', '9f200000-0000-0000-0000-000000000001', 'union');
  if v_result.result = 'created_pending_team' and v_result.age_grade = 'U9' and v_result.team_id = '9f200000-0000-0000-0000-000000000002' then
    raise notice 'PASS A: add_child_for_guardian resolved U9 and created a pending membership on the single matching team';
  else
    raise notice 'FAIL A: result=%, age_grade=%, team_id=%', v_result.result, v_result.age_grade, v_result.team_id;
  end if;
end $$;

do $$
declare v_status text;
begin
  select ptm.status into v_status
  from public.player_team_memberships ptm join public.players p on p.id = ptm.player_id
  where p.first_name = 'Regress' and p.surname = 'Childone';
  if v_status = 'pending' then
    raise notice 'PASS B: the created membership is genuinely pending, not active';
  else
    raise notice 'FAIL B: status=%', v_status;
  end if;
end $$;

-- ===== C. A second, different guardian submitting the SAME name+DOB at
-- the SAME club is routed to duplicate review, never silently linked or
-- silently duplicated =====
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000092","role":"authenticated"}';

do $$
declare v_result record;
declare v_review_count int;
begin
  select * into v_result from public.add_child_for_guardian('Regress', 'Childone', '2018-01-01', '9f200000-0000-0000-0000-000000000001', 'union');
  select count(*) into v_review_count from public.player_duplicate_reviews where submitted_first_name = 'Regress' and submitted_surname = 'Childone' and requesting_guardian_user_id = '00000000-0000-0000-0000-000000000092';
  if v_result.result = 'under_review' and v_review_count = 1 then
    raise notice 'PASS C: a genuine name+DOB match from a different guardian is routed to duplicate review, never auto-linked or auto-duplicated';
  else
    raise notice 'FAIL C: result=%, review_count=%', v_result.result, v_review_count;
  end if;
end $$;

-- ===== D. Approval is capability-gated: an unrelated authenticated user
-- with no roster-management capability at this club cannot approve --
-- captured as postgres (RLS-agnostic) first so the test isolates the
-- RPC's own authorization check rather than the SELECT policy's row
-- visibility (an unrelated user can't even see the row via RLS either,
-- which is itself a correct, stronger-than-required outcome, but not
-- what this specific assertion is checking).
reset role;
reset request.jwt.claims;
do $$
declare v_membership_id uuid;
begin
  select ptm.id into v_membership_id
  from public.player_team_memberships ptm join public.players p on p.id = ptm.player_id
  where p.first_name = 'Regress' and p.surname = 'Childone';
  perform set_config('side_project_1_test.membership_id', v_membership_id::text, false);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000093","role":"authenticated"}';

do $$
declare v_membership_id uuid := current_setting('side_project_1_test.membership_id')::uuid;
begin
  perform public.approve_pending_team_membership(v_membership_id);
  raise notice 'FAIL D: an unauthorized user was able to approve a pending membership';
exception when others then
  if sqlstate = '42501' then
    raise notice 'PASS D: an unrelated user with no roster-management capability is correctly rejected';
  else
    raise notice 'FAIL D: unexpected error -- %', sqlerrm;
  end if;
end $$;

-- ===== E. The real Club Admin CAN approve, and the requesting guardian
-- (and only them) receives the confirmation notification =====
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare v_membership_id uuid;
declare v_status text;
begin
  select ptm.id into v_membership_id
  from public.player_team_memberships ptm join public.players p on p.id = ptm.player_id
  where p.first_name = 'Regress' and p.surname = 'Childone';
  perform public.approve_pending_team_membership(v_membership_id);
  select status into v_status from public.player_team_memberships where id = v_membership_id;
  if v_status = 'active' then
    raise notice 'PASS E: the authorized Club Admin approves and the membership becomes genuinely active';
  else
    raise notice 'FAIL E: status=%', v_status;
  end if;
end $$;

reset role;
reset request.jwt.claims;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000091' and type = 'add_child_approved';
  if v_n = 1 then
    raise notice 'PASS F: exactly one confirmation notification was delivered to the requesting guardian';
  else
    raise notice 'FAIL F: found % notification(s)', v_n;
  end if;
end $$;

-- ===== G. Guardian consent fail-closed: a player with zero active
-- guardians resolves every permission to false =====
do $$
declare v_orphan_player uuid;
declare v_effective boolean;
begin
  insert into public.players (first_name, surname, date_of_birth) values ('Orphan', 'Testplayer', '2018-01-01') returning id into v_orphan_player;
  v_effective := internal.guardian_permission_effective(v_orphan_player, 'view_team_conversation');
  if v_effective is false then
    raise notice 'PASS G: a player with zero active guardians fails closed (every permission resolves to false)';
  else
    raise notice 'FAIL G: effective=%', v_effective;
  end if;
end $$;

rollback;
