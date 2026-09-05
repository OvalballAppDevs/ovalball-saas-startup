-- FINAL VERIFICATION CLOSURE Section 5: the "expire" half of "revoke/
-- expire approval before final approval" -- a call-up whose linked
-- eligibility record is still pending when its season ends must never
-- be able to proceed, even though nothing actively re-decides it. The
-- real, pre-existing internal.expire_due_dispensations() cron
-- mechanism (unchanged by this feature) is exercised directly, not
-- simulated.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_expire_lifecycle.sql

\set ON_ERROR_STOP off
\pset pager off
begin;
insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0090', 'Expire Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'expire-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0090', '9d000000-0000-0000-0000-0000000d0090', 'expire-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000900090', '9d000000-0000-0000-0000-0000000c0090', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000f90', '9d000000-0000-0000-0000-0000000c0090', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'et-sc', true),
  ('9d000000-0000-0000-0000-000000000f91', '9d000000-0000-0000-0000-0000000c0090', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'et-mens2', true);
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-000000000f92', 'Expire', 'Player17', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-000000000f92', '9d000000-0000-0000-0000-000000000f90', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-000000000f93', '9d000000-0000-0000-0000-000000000f91', current_date, 'Home', 'Expire Test Opponent', 'Booked');
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-000000000f94', 'Expire Test Season', current_date - 400, current_date - 1, current_date - 410, 'union', 2192, true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.request_player_call_up('9d000000-0000-0000-0000-000000000f93', '9d000000-0000-0000-0000-000000000f92', '9d000000-0000-0000-0000-000000000f90', '9d000000-0000-0000-0000-000000000f91', 'RFU Regulation 15');
reset role;

-- Force this dispensation onto the already-ended test season, as the
-- table owner (bypassing player_team_dispensation's SELECT-only RLS,
-- which a plain client UPDATE would otherwise silently match zero rows
-- against) -- setup only, not part of the invariant under test.
update public.player_team_dispensation set season_id = '9d000000-0000-0000-0000-000000000f94'
where id = (select eligibility_requirement_id from public.fixture_player_call_up where fixture_id = '9d000000-0000-0000-0000-000000000f93');

select internal.expire_due_dispensations();

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_call_up_id uuid;
  v_disp_id uuid;
  v_status text;
begin
  select id, eligibility_requirement_id into v_call_up_id, v_disp_id from public.fixture_player_call_up where fixture_id = '9d000000-0000-0000-0000-000000000f93';

  select status into v_status from public.player_team_dispensation where id = v_disp_id;
  if v_status = 'expired' then
    raise notice 'PASS 1: the real expire_due_dispensations() cron mechanism expires a still-pending linked dispensation once its season ends';
  else
    raise notice 'FAIL 1: dispensation status=%', v_status;
  end if;

  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'awaiting_eligibility' then
    raise notice 'PASS 2: the linked call-up remains safely blocked (awaiting_eligibility) after its eligibility expires -- it can never incorrectly proceed';
  else
    raise notice 'FAIL 2: call-up status=%', v_status;
  end if;

  begin
    perform public.decide_player_call_up(v_call_up_id, 'approve');
    raise notice 'FAIL 3: a call-up was approved despite its linked eligibility having expired';
  exception when others then
    raise notice 'PASS 3: approving a call-up whose eligibility expired is still hard-blocked (%)', sqlerrm;
  end;
end $$;
reset role;
rollback;
