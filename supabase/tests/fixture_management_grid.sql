-- Manual verification for the Site Admin Fixture Management redesign
-- (20260905000000_site_admin_fixture_management.sql): structured opposition
-- editing, the deliberate home/away swap, and the narrow manage_fixture_
-- support capability. NOT a migration -- run AFTER permission_matrix.sql
-- (reuses its seeded Burnley/Rossendale teams and Site Admins).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_management_grid.sql

\set ON_ERROR_STOP off
\pset pager off

-- A second Site Admin, deliberately WITHOUT manage_fixture_support, to
-- prove that specific capability is genuinely narrow (test 3) -- and one
-- WITH it (test 1 onward). A dedicated throwaway club (never Burnley/
-- Rossendale directly) for the new opponent team in test 5, so this
-- file's identity choices can never collide with any other test file's
-- own Burnley/Rossendale age/gender/squad claims.
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('95500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.fixturesupport.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('95500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.plain.fixtureadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values
    ('95500000-0000-0000-0000-000000000001', 'Test', 'FixtureSupportAdmin', 'test.fixturesupport.admin@ovalball.local'),
    ('95500000-0000-0000-0000-000000000002', 'Test', 'PlainFixtureAdmin', 'test.plain.fixtureadmin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('95500000-0000-0000-0000-00000000000d', 'Fixture Grid Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fixture-grid-test-rufc-95500000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values ('95500000-0000-0000-0000-00000000000c', '95500000-0000-0000-0000-00000000000d', 'fixture-grid-test-rufc-95500000', 'active')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role)
  values
    ('95500000-0000-0000-0000-000000000001', 'active', 'full'),
    ('95500000-0000-0000-0000-000000000002', 'active', 'full')
  on conflict (user_id) do nothing;

  -- A real head-to-head fixture between the two seeded permission_matrix
  -- teams to exercise editing against (Burnley U12 A home vs Rossendale U12 A away).
  insert into public.fixtures (id, owning_team_id, home_away, opponent_team_id, raw_opposition_text, kickoff_date, kickoff_time, status, home_score, away_score, result_status, source)
  values ('95500000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000001', 'Home', '30000000-0000-0000-0000-000000000003', 'Rossendale RUFC', current_date + 14, '14:00', 'Completed', 24, 12, 'final', 'site_admin_manual')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Grant: a Full Site Admin can grant manage_fixture_support.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_capability boolean;
begin
  perform public.set_site_admin_fixture_support_capability('95500000-0000-0000-0000-000000000001', true);
  select manage_fixture_support into v_capability from public.site_admins where user_id = '95500000-0000-0000-0000-000000000001';
  if v_capability then
    raise notice 'PASS 1: a Full Site Admin can grant manage_fixture_support to another Site Admin';
  else
    raise notice 'FAIL 1: capability was not set after a successful grant call';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2/3. A Site Admin WITHOUT manage_fixture_support cannot POST as
--    Ovalball support -- this is the genuinely new action this
--    capability gates (reading fixture_messages for admin oversight
--    purposes is unrelated pre-existing Message Management scope, not
--    narrowed by this migration -- see the migration's own comment).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95500000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.send_fixture_support_message('95500000-0000-0000-0000-000000000010', 'Test message');
  raise notice 'FAIL 3: a Site Admin without manage_fixture_support unexpectedly posted a support message';
exception when insufficient_privilege then
  raise notice 'PASS 3: a Site Admin without manage_fixture_support cannot post a fixture support message';
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. A Site Admin WITH the capability CAN post, and the message is
--    visibly flagged is_site_admin_message -- never indistinguishable
--    from either club's own messages.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95500000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_message_id uuid;
  v_flagged boolean;
begin
  select public.send_fixture_support_message('95500000-0000-0000-0000-000000000010', 'Hi, Ovalball support here to help with this fixture.') into v_message_id;
  select is_site_admin_message into v_flagged from public.fixture_messages where id = v_message_id;
  if v_flagged then
    raise notice 'PASS 4: a Site Admin with manage_fixture_support can post, and the message is visibly flagged is_site_admin_message';
  else
    raise notice 'FAIL 4: message posted but not flagged as Site Admin support';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Structured opposition editing: resolve the opponent to a real
--    activated team (Rossendale U13, a different team than currently set).
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('95500000-0000-0000-0000-000000000020', '95500000-0000-0000-0000-00000000000c', 'union', 'youth', 'U12', 'boys', null, 'Fixture Grid Test RUFC U12', 'fixture-grid-test-u12')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_opponent_team_id uuid;
begin
  perform public.update_fixture_opposition('95500000-0000-0000-0000-000000000010', '95500000-0000-0000-0000-000000000020', null, 'Rossendale RUFC U12 B');
  select opponent_team_id into v_opponent_team_id from public.fixtures where id = '95500000-0000-0000-0000-000000000010';
  if v_opponent_team_id = '95500000-0000-0000-0000-000000000020' then
    raise notice 'PASS 5: structured opposition editing resolves opponent_team_id to the real selected team, not a free-text name';
  else
    raise notice 'FAIL 5: expected opponent_team_id=95500000-...-020, got %', v_opponent_team_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. An unresolved/free-text-only opposition (no team, no directory) is
--    rejected -- an opponent is always required, matching the closed
--    Club Directory requirement.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_opposition('95500000-0000-0000-0000-000000000010', null, null, '');
  raise notice 'FAIL 6: an empty opposition was unexpectedly accepted';
exception when others then
  raise notice 'PASS 6: an empty opposition is rejected -- an opponent description is always required';
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Home/away swap: flips ONLY home_away (never owning/opponent
--    team_id -- that pairing is the two teams IN the fixture, not which
--    is home) together with home_score/away_score, so the generated
--    home_team_id/away_team_id columns genuinely invert and the result
--    orientation never goes backwards. Reconciliation fix: the prior
--    implementation swapped owning/opponent team_id AND home_away
--    together, which is a mathematical no-op on home_team_id/
--    away_team_id (verified: {owning:A, home_away:Home} -> home=A;
--    "swapped" {owning:B, home_away:Away} -> home = opponent = A again)
--    and silently transferred edit authority to the other club with zero
--    visible change. This test previously asserted that no-op as if it
--    were correct -- it now asserts the real, user-visible swap.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_before public.fixtures;
  v_after public.fixtures;
begin
  select * into v_before from public.fixtures where id = '95500000-0000-0000-0000-000000000010';
  perform public.swap_fixture_home_away('95500000-0000-0000-0000-000000000010');
  select * into v_after from public.fixtures where id = '95500000-0000-0000-0000-000000000010';

  if v_after.owning_team_id = v_before.owning_team_id
     and v_after.opponent_team_id = v_before.opponent_team_id
     and v_after.home_away = 'Away'
     and v_after.home_team_id = v_before.away_team_id
     and v_after.away_team_id = v_before.home_team_id
     and v_after.home_score = v_before.away_score
     and v_after.away_score = v_before.home_score then
    raise notice 'PASS 7: swap_fixture_home_away flips home_away (never owning/opponent team_id) together with home_score/away_score -- home_team_id/away_team_id genuinely invert, result orientation stays correct';
  else
    raise notice 'FAIL 7: owning % -> %, opponent % -> %, home_away % -> %, home_team_id % -> %, away_team_id % -> %, scores %-% -> %-%',
      v_before.owning_team_id, v_after.owning_team_id, v_before.opponent_team_id, v_after.opponent_team_id,
      v_before.home_away, v_after.home_away, v_before.home_team_id, v_after.home_team_id, v_before.away_team_id, v_after.away_team_id,
      v_before.home_score, v_before.away_score, v_after.home_score, v_after.away_score;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7b. Neither side of admin_fixture_overview ever reports "unresolved"
--     after a swap when the opponent is a genuinely resolved team --
--     the live "Unresolved Club Name" bug this reconciliation pass fixed.
--     admin_fixture_overview's home/away_club_resolved previously checked
--     ONLY opponent_directory_id (a directory-only, unclaimed identity)
--     with no fallback to a real resolved opponent_team_id.
-- ------------------------------------------------------------
do $$
declare
  v_row public.admin_fixture_overview;
begin
  select * into v_row from public.admin_fixture_overview where id = '95500000-0000-0000-0000-000000000010';
  if v_row.home_club_resolved and v_row.away_club_resolved
     and v_row.home_club_name not ilike 'unresolved%' and v_row.away_club_name not ilike 'unresolved%' then
    raise notice 'PASS 7b: both sides remain fully resolved (never "Unresolved Club Name") after swap, for a fixture whose opponent is a real resolved team';
  else
    raise notice 'FAIL 7b: home_resolved=%, away_resolved=%, home_name=%, away_name=%',
      v_row.home_club_resolved, v_row.away_club_resolved, v_row.home_club_name, v_row.away_club_name;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. The conversation survives the swap and the opposition edit --
--    same fixture_id throughout, never a second conversation.
-- ------------------------------------------------------------
do $$
declare
  v_message_count integer;
begin
  select count(*) into v_message_count from public.fixture_messages where fixture_id = '95500000-0000-0000-0000-000000000010';
  if v_message_count >= 1 then
    raise notice 'PASS 8: the fixture conversation (from test 4) survives both the opposition edit and the home/away swap -- same fixture_id throughout, no second conversation created';
  else
    raise notice 'FAIL 8: expected the earlier support message to still be attached, found % messages', v_message_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. Every edit above was audited (fixture_id, actor, before/after).
-- ------------------------------------------------------------
do $$
declare
  v_audit_count integer;
begin
  select count(*) into v_audit_count from public.audit_log where table_name = 'fixtures' and record_id = '95500000-0000-0000-0000-000000000010' and action = 'update';
  if v_audit_count >= 2 then
    raise notice 'PASS 9: both the opposition edit and the home/away swap were recorded in audit_log (% entries)', v_audit_count;
  else
    raise notice 'FAIL 9: expected at least 2 audit_log entries for this fixture, found %', v_audit_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. An ordinary Club Admin (not Site Admin) cannot grant the fixture
--     support capability.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.set_site_admin_fixture_support_capability('95500000-0000-0000-0000-000000000002', true);
  raise notice 'FAIL 10: an ordinary Club Admin unexpectedly granted a Site Admin capability';
exception when others then
  raise notice 'PASS 10: an ordinary Club Admin cannot grant manage_fixture_support -- Full Site Admin only';
end $$;
rollback;

-- ------------------------------------------------------------
-- 11-13. update_fixture_owning_team (Reconciliation complaint 7's "change
--    home team" operation, distinct from swap and from opposition
--    editing). Uses ITS OWN dedicated fixture (95500000-...-000000011),
--    never the shared 95500000-...-000000010 row above, since tests 7's
--    swap already mutated that row's owning_team_id away from Burnley --
--    reusing it here would make this section's own assumptions wrong.
-- ------------------------------------------------------------
-- opponent_team_id is deliberately left unresolved (raw text only) so
-- enforce_fixture_age_eligibility has nothing to check here -- this
-- section is testing update_fixture_owning_team's OWN same-club rule,
-- not age eligibility (already covered elsewhere), and Burnley's only
-- other seeded team (U13 A) is a genuinely different age group to the
-- U12 A opponent used in the rest of this file.
do $$
begin
  insert into public.fixtures (id, owning_team_id, home_away, opponent_team_id, raw_opposition_text, kickoff_date, status, source)
  values ('95500000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'Home', null, 'Rossendale RUFC (unresolved)', current_date + 15, 'Planned', 'site_admin_manual')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95500000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_owning_team_id uuid;
begin
  perform public.update_fixture_owning_team('95500000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002');
  select owning_team_id into v_owning_team_id from public.fixtures where id = '95500000-0000-0000-0000-000000000011';
  if v_owning_team_id = '30000000-0000-0000-0000-000000000002' then
    raise notice 'PASS 11: update_fixture_owning_team correctly reassigns the fixture to another of the same club''s active teams';
  else
    raise notice 'FAIL 11: expected owning_team_id 30000000-...-002, got %', v_owning_team_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 12. update_fixture_owning_team refuses to reassign across clubs --
--     that would silently transfer the fixture's controlling club, not
--     correct a mistaken team pick. (30000000-...-003 is Rossendale's.)
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95500000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_owning_team('95500000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 12: unexpectedly reassigned the owning side to a different club''s team';
exception when others then
  raise notice 'PASS 12: update_fixture_owning_team refuses to reassign the owning side to a different club''s team (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. The successful reassignment in test 11 was audited.
-- ------------------------------------------------------------
do $$
declare
  v_audit_count integer;
begin
  select count(*) into v_audit_count from public.audit_log where table_name = 'fixtures' and record_id = '95500000-0000-0000-0000-000000000011' and action = 'update';
  if v_audit_count >= 1 then
    raise notice 'PASS 13: the owning-team reassignment is recorded in audit_log';
  else
    raise notice 'FAIL 13: expected an audit_log entry referencing the owning-team change, found none';
  end if;
end $$;
