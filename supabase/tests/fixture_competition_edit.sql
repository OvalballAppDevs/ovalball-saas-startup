-- Manual verification for update_fixture_competition (20260901000000):
-- owning-club-only authorization, rugby-code match enforcement, inactive-
-- edition rejection, Site Admin override, and clearing back to "no
-- competition set". NOT a migration -- run AFTER permission_matrix.sql and
-- partner_clubs_and_messaging.sql (reuses Leigh RUFC, 0011, as the
-- unrelated-club negative case) and site_admin_management.sql (reuses the
-- 'full' Site Admin, user 0001).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- rugby_code is required by the seasons table (20260924930000) and
  -- must now be supplied even though this row backs both a union AND a
  -- league competition_edition below (each edition carries its own
  -- independent rugby_code column) -- an explicit season_year_start
  -- sentinel avoids colliding with the real Rugby Union 25/26 season's
  -- own (rugby_code, season_year_start) under the new uniqueness
  -- constraint, since this row's dates would otherwise auto-derive the
  -- same year.
  insert into public.seasons (id, name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('d0000000-0000-0000-0000-000000000001', '2025/26 Test Season', '2025-09-01', '2026-06-01', 'union', 2197, true)
  on conflict (id) do nothing;

  insert into public.competitions (id, name, normalized_key, slug, rugby_code)
  values
    ('d0000000-0000-0000-0000-000000000002', 'Union Youth Cup Test', 'union-youth-cup-test', 'union-youth-cup-test', 'union'),
    ('d0000000-0000-0000-0000-000000000004', 'League Youth Cup Test', 'league-youth-cup-test', 'league-youth-cup-test', 'league'),
    ('d0000000-0000-0000-0000-000000000009', 'Union Inactive Test', 'union-inactive-test', 'union-inactive-test', 'union')
  on conflict (id) do nothing;

  -- competition_editions has a unique (competition_id, season_id) --
  -- the inactive-edition scenario needs its own competition row, not a
  -- second edition of the same one for the same season.
  insert into public.competition_editions (id, competition_id, season_id, rugby_code, active)
  values
    ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'union', true),
    ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'league', true),
    ('d0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000001', 'union', false)
  on conflict (id) do nothing;

  -- Burnley U12 A (owning) vs Rossendale U12 A (opponent), both 'union'.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('d0000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Owning club (Burnley) Club Admin sets a matching-code competition.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_now uuid;
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003');
  select competition_edition_id into v_now from public.fixtures where id = 'd0000000-0000-0000-0000-000000000007';
  if v_now = 'd0000000-0000-0000-0000-000000000003' then
    raise notice 'PASS 1: Burnley Club Admin (owning club) set the fixture''s competition';
  else
    raise notice 'FAIL 1: competition_edition_id is % after the call', v_now;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. Rugby-code mismatch rejected (fixture is 'union', edition is 'league').
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000005');
  raise notice 'FAIL 2: a mismatched-code competition was accepted';
exception when others then
  raise notice 'PASS 2: a mismatched rugby-code competition is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Inactive competition edition rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000006');
  raise notice 'FAIL 3: an inactive competition edition was accepted';
exception when others then
  raise notice 'PASS 3: an inactive competition edition is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Unrelated club (Leigh) cannot set the competition.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 4: an unrelated club set the competition';
exception when others then
  raise notice 'PASS 4: an unrelated club cannot set the competition (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Opponent club (Rossendale) cannot set the competition -- deliberately
--    narrower than pitch allocation: this is the owning club's call.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 5: the opponent club set the competition';
exception when others then
  raise notice 'PASS 5: the opponent club cannot set the competition (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Site Admin can set the competition regardless of club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003');
  raise notice 'PASS 6: Site Admin can set the competition for any fixture';
exception when others then
  raise notice 'FAIL 6: Site Admin was blocked (%)', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Owning club can clear the competition back to null.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_now uuid;
begin
  perform public.update_fixture_competition('d0000000-0000-0000-0000-000000000007', null);
  select competition_edition_id into v_now from public.fixtures where id = 'd0000000-0000-0000-0000-000000000007';
  if v_now is null then
    raise notice 'PASS 7: competition cleared back to null';
  else
    raise notice 'FAIL 7: competition_edition_id is still %', v_now;
  end if;
end $$;
commit;

do $$
begin
  delete from public.fixture_messages where fixture_id = 'd0000000-0000-0000-0000-000000000007';
  delete from public.fixtures where id = 'd0000000-0000-0000-0000-000000000007';
  delete from public.competition_editions where id in ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000006');
  delete from public.competitions where id in ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000009');
  delete from public.seasons where id = 'd0000000-0000-0000-0000-000000000001';
exception when others then null;
end $$;
