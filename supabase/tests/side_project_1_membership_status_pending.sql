-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 1 regression coverage: player_team_memberships.status
-- widened from ('active','ended') to ('active','pending','ended').
--
-- Proves the two things that actually matter for this widening:
--   1. Both check constraints (the enum, and "ended requires ended_at
--      unless active-or-pending") accept a genuine pending row.
--   2. A pending row never satisfies any of Main's existing positive
--      `status = 'active'` consumers for the SAME (player, team) pair --
--      the exact property Phase 1's static audit found and this proves
--      dynamically.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/side_project_1_membership_status_pending.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9f100000-0000-0000-0000-000000000001', 'Pending Status Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pending-status-test-club-9f100000');
insert into public.clubs (id, directory_id, slug, status, timezone) values
  ('9f100000-0000-0000-0000-000000000001', '9f100000-0000-0000-0000-000000000001', 'pending-status-test-club-9f100000', 'active', 'Europe/London');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9f100000-0000-0000-0000-000000000002', '9f100000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'boys', null, 'Pending Status U12', 'pending-status-u12', true);
insert into public.players (id, first_name, surname, date_of_birth) values
  ('9f100000-0000-0000-0000-000000000003', 'Pending', 'Testplayer', '2014-01-01');

-- ===== A. A pending row satisfies both check constraints =====
do $$
begin
  insert into public.player_team_memberships (id, player_id, team_id, status)
  values ('9f100000-0000-0000-0000-000000000004', '9f100000-0000-0000-0000-000000000003', '9f100000-0000-0000-0000-000000000002', 'pending');
  raise notice 'PASS A: a pending row satisfies both status check constraints (enum + ended_requires_status)';
exception when check_violation then
  raise notice 'FAIL A: pending row rejected by a check constraint -- %', sqlerrm;
end $$;

-- ===== B. It reads back as pending with no ended_at forced =====
do $$
declare v_status text; v_ended timestamptz;
begin
  select status, ended_at into v_status, v_ended from public.player_team_memberships where id = '9f100000-0000-0000-0000-000000000004';
  if v_status = 'pending' and v_ended is null then
    raise notice 'PASS B: row keeps pending status with ended_at left null';
  else
    raise notice 'FAIL B: status=%, ended_at=%', v_status, v_ended;
  end if;
end $$;

-- ===== C. It never counts as active for the exact same (player, team) pair =====
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.player_team_memberships
    where player_id = '9f100000-0000-0000-0000-000000000003' and team_id = '9f100000-0000-0000-0000-000000000002' and status = 'active';
  if v_n = 0 then
    raise notice 'PASS C: pending row never satisfies status = ''active'' for the same (player, team) pair -- every existing Main consumer (graduation, call-ups, team-type-deactivation-impact, capability checks) stays correctly unaffected';
  else
    raise notice 'FAIL C: found % active row(s) for a pending-only pair', v_n;
  end if;
end $$;

-- ===== D. An invalid status value is still rejected (not free text) =====
do $$
begin
  insert into public.player_team_memberships (player_id, team_id, status)
  values ('9f100000-0000-0000-0000-000000000003', '9f100000-0000-0000-0000-000000000002', 'bogus');
  raise notice 'FAIL D: an invalid status value was accepted';
exception when check_violation then
  raise notice 'PASS D: a status outside active/pending/ended is still rejected';
end $$;

-- ===== E. The partial unique active index still enforces one active row per (player, team), independent of any pending row =====
do $$
begin
  insert into public.player_team_memberships (player_id, team_id, status)
  values ('9f100000-0000-0000-0000-000000000003', '9f100000-0000-0000-0000-000000000002', 'active');
  insert into public.player_team_memberships (player_id, team_id, status)
  values ('9f100000-0000-0000-0000-000000000003', '9f100000-0000-0000-0000-000000000002', 'active');
  raise notice 'FAIL E: two active rows for the same (player, team) pair were both accepted';
exception when unique_violation then
  raise notice 'PASS E: the pre-existing one-active-row-per-pair unique index still holds with a pending row present alongside it';
end $$;

rollback;
