-- Manual verification: the shared-team-fixture-capacity trigger
-- (internal.enforce_shared_team_fixture_capacity, most recently
-- redeclared in 20260924800000) correctly detects a conflict across
-- TWO DIFFERENT Mini-Rugby Groups that happen to share one common
-- member team, not just within a single group's own fixtures. This
-- was flagged in the Season Handover report as "not independently
-- tested" -- schema-wise nothing prevents a team belonging to two
-- active groups at once (scheduling_group_members has no such
-- uniqueness constraint), so this genuinely needed a live check rather
-- than an assumption.
--
-- Scenario: Group A = {U6, U7}, Group B = {U7, U8} -- U7 is the shared
-- team. Group A books a fixture (via U6) on day D. Group B then tries
-- to book a fixture (via U9) on the SAME day D -- this must be
-- rejected, because U7's shared membership means Group B's capacity
-- check must see Group A's fixture as a genuine same-day conflict.
--
-- Transaction-scoped: creates real fixtures, simpler to prove and roll
-- back than to hand-clean every side effect (mirror fixtures,
-- conversations) afterward.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/overlapping_scheduling_groups.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d000d', 'Overlapping Groups Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'overlapping-groups-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c000d', '9d000000-0000-0000-0000-0000000d000d', 'overlapping-groups-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-00000060000d', '9d000000-0000-0000-0000-0000000c000d', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000f0a1', '9d000000-0000-0000-0000-0000000c000d', 'union', 'youth', 'U6', 'U6', 'og-u6', true),
  ('9d000000-0000-0000-0000-00000000f0a2', '9d000000-0000-0000-0000-0000000c000d', 'union', 'youth', 'U7', 'U7', 'og-u7', true),
  ('9d000000-0000-0000-0000-00000000f0a3', '9d000000-0000-0000-0000-0000000c000d', 'union', 'youth', 'U8', 'U8', 'og-u8', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_season_id uuid := internal.resolve_season_for_date('union', current_date);
  v_group_a uuid;
  v_group_b uuid;
begin
  v_group_a := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c000d', array['9d000000-0000-0000-0000-00000000f0a1','9d000000-0000-0000-0000-00000000f0a2']::uuid[], v_season_id);
  v_group_b := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c000d', array['9d000000-0000-0000-0000-00000000f0a2','9d000000-0000-0000-0000-00000000f0a3']::uuid[], v_season_id);

  -- Group A books via U7 on day D.
  insert into public.fixtures (owning_team_id, owning_scheduling_group_id, kickoff_date, home_away, raw_opposition_text, status)
  values ('9d000000-0000-0000-0000-00000000f0a1', v_group_a, current_date + 60, 'Home', 'Overlap Test Opponent A', 'Booked');
  raise notice 'PASS 1: Group A''s own fixture (via U7) books successfully';

  -- Group B tries to book via U9 on the SAME day D -- must be rejected
  -- because U8 is a member of BOTH groups.
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, kickoff_date, home_away, raw_opposition_text, status)
    values ('9d000000-0000-0000-0000-00000000f0a3', v_group_b, current_date + 60, 'Home', 'Overlap Test Opponent B', 'Booked');
    raise notice 'FAIL 2: Group B booked a same-day fixture despite sharing U7 with Group A, which already has one that day';
  exception when others then
    raise notice 'PASS 2: Group B''s same-day fixture is correctly rejected via its shared U7 membership with Group A (%)', sqlerrm;
  end;

  -- Sanity check: Group B booking on a DIFFERENT day is unaffected.
  insert into public.fixtures (owning_team_id, owning_scheduling_group_id, kickoff_date, home_away, raw_opposition_text, status)
  values ('9d000000-0000-0000-0000-00000000f0a3', v_group_b, current_date + 61, 'Home', 'Overlap Test Opponent C', 'Booked');
  raise notice 'PASS 3: Group B can still book normally on a different day -- the conflict is genuinely date-scoped, not a blanket block';
end $$;

reset role;
rollback;
