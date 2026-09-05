-- LOCAL PLAYGROUND ONLY -- deliberately NOT part of run_regression.sh's
-- FILES array (adding these teams alongside the other 55 test files' own
-- Burnley/Rossendale team fixtures is exactly what produced the 28-row
-- duplicate-riddled active roster the product owner flagged as unusable
-- for manual review). This file gives a clean, realistic team roster for
-- manual product review without running the rest of the regression suite.
--
-- To get a clean, login-able local playground:
--   npx supabase db reset --local
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/core_seasons_bootstrap.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/playground_teams.sql
--
-- That's the real Burnley/Rossendale clubs, their real test-login accounts
-- (test.burnley.admin@ovalball.local etc, magic link via Mailpit at
-- localhost:54324), permission_matrix.sql's own 2 Burnley teams (U12 A,
-- U13 A) and 1 Rossendale team (U12 A), plus this file's additional
-- realistic-roster teams and a couple of real competition editions -- and
-- nothing else. Running the FULL regression suite afterward remains
-- necessary to actually verify correctness, and will add many more
-- narrowly-scoped test teams/seasons back on top of this -- that's
-- expected there, just not desired for a manual review session.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug) values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U6',  'mixed', null, 'Burnley RUFC U6',          'burnley-u6'),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U7',  'mixed', null, 'Burnley RUFC U7',          'burnley-u7'),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U8',  'mixed', null, 'Burnley RUFC U8',          'burnley-u8'),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U9',  'mixed', null, 'Burnley RUFC U9',          'burnley-u9'),
    ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U10', 'mixed', null, 'Burnley RUFC U10',         'burnley-u10'),
    ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U11', 'mixed', null, 'Burnley RUFC U11',         'burnley-u11'),
    ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', null,    'B',  'Burnley RUFC U12 B',       'burnley-u12-b'),
    ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U14', 'boys',  null, 'Burnley RUFC U14',         'burnley-u14'),
    ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U13', 'girls', null, 'Burnley RUFC Girls U13',   'burnley-girls-u13'),
    ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'union', 'colts', 'JuniorColts', null, null, 'Burnley RUFC Junior Colts', 'burnley-junior-colts'),
    ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'union', 'colts', 'SeniorColts', null, null, 'Burnley RUFC Senior Colts', 'burnley-senior-colts'),
    ('40000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mens',   '1st', 'Burnley RUFC Men''s 1st Team',   'burnley-mens-1st'),
    ('40000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'mens',   '2nd', 'Burnley RUFC Men''s 2nd Team',   'burnley-mens-2nd'),
    ('40000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001', 'union', 'senior', null, 'womens', '1st', 'Burnley RUFC Women''s 1st Team', 'burnley-womens-1st')
  -- `on conflict (id)` alone only guards the primary key -- teams also has
  -- a business-uniqueness constraint on (club_id, identity_key), which
  -- permission_matrix.sql's OWN team fixtures can independently collide
  -- with (it has grown extra Burnley/Rossendale team fixtures since this
  -- comment block above was written, e.g. a Burnley U8 mixed row -- the
  -- exact identity this file also wants). `on conflict do nothing` with no
  -- target catches a violation on ANY unique constraint on the table, so
  -- this insert stays a safe no-op either way, without having to keep this
  -- file's team list hand-synced against every other script's fixtures.
  on conflict do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug) values
    ('40000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U8',  'mixed', null, 'Rossendale RUFC U8',          'rossendale-u8'),
    ('40000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U10', 'mixed', null, 'Rossendale RUFC U10',         'rossendale-u10'),
    ('40000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U14', 'boys',  null, 'Rossendale RUFC U14',         'rossendale-u14'),
    ('40000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000002', 'union', 'colts', 'JuniorColts', null, null, 'Rossendale RUFC Junior Colts', 'rossendale-junior-colts'),
    ('40000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000002', 'union', 'senior', null, 'mens',   '1st', 'Rossendale RUFC Men''s 1st Team',   'rossendale-mens-1st'),
    ('40000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000002', 'union', 'senior', null, 'womens', '1st', 'Rossendale RUFC Women''s 1st Team', 'rossendale-womens-1st')
  on conflict do nothing;

  -- Two realistic competitions with editions in the current and next
  -- canonical (non-test-flagged) Union test seasons, so the Calendar's
  -- Competition dropdown has real options to demonstrate against.
  insert into public.competitions (id, name, slug, normalized_key, rugby_code, level, is_national) values
    ('40000000-0000-0000-0000-0000000000c1', 'Lancashire Cup', 'lancashire-cup', 'union:lancashire cup', 'union', 'county', false),
    ('40000000-0000-0000-0000-0000000000c2', 'North West Youth League', 'north-west-youth-league', 'union:north west youth league', 'union', 'regional', false)
  on conflict (id) do nothing;

  insert into public.competition_editions (id, competition_id, season_id, rugby_code) values
    ('40000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-0000000000c1', '98000000-0000-0000-0000-000000000101', 'union'),
    ('40000000-0000-0000-0000-0000000000e2', '40000000-0000-0000-0000-0000000000c1', '98000000-0000-0000-0000-000000000102', 'union'),
    ('40000000-0000-0000-0000-0000000000e3', '40000000-0000-0000-0000-0000000000c2', '98000000-0000-0000-0000-000000000102', 'union')
  on conflict (id) do nothing;

  -- Reconciliation complaints 29/37: a real Fixtures Secretary test
  -- account -- permission_matrix.sql seeds CLUB_ADMIN/BASIC_USER/team-
  -- scoped accounts but no FIXTURE_SECRETARY, so complaint 29's filtered-
  -- export check and complaint 37's role-boundary check had no login-
  -- capable account to test against. Added here (not in permission_
  -- matrix.sql, a real regression test file this pass must not modify)
  -- since this is playground-only, non-regression data, matching this
  -- file's own established purpose. Login is magic-link via Mailpit, same
  -- as every other test.*@ovalball.local account.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.secretary@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('50000000-0000-0000-0000-000000000001', 'Test', 'BurnleySecretary', 'test.burnley.secretary@ovalball.local')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'FIXTURE_SECRETARY', 'active')
  on conflict (id) do nothing;

  -- Central Fixture Participant Resolution / complaint 44: every Site
  -- Admin capability (diagnostic_club_access, manage_team_catalogue,
  -- manage_competitions, manage_fixture_support) is deliberately
  -- off-by-default even for a Full Site Admin -- confirmed by direct audit
  -- (zero grants for test.site.admin anywhere in permission_matrix.sql)
  -- and tested there (fixture_management_grid.sql PASS 1/2/3/4/10). This
  -- is NOT a bug; the architecture is correct and must not be weakened.
  -- Granting it here, in playground-only data, makes the Full Site Admin
  -- test account convenient for manual QA of fixture support messaging
  -- without touching the regression file that asserts the off-by-default
  -- behaviour for OTHER Site Admin profiles.
  update public.site_admins set manage_fixture_support = true where user_id = '00000000-0000-0000-0000-000000000001';

  -- Reconciliation pass: venue/pitch playground data. The venues/
  -- club_pitches system was previously exercised only by hand through the
  -- live UI during manual testing, and that data evaporates on every
  -- reset (the standard bootstrap created zero venues/pitches on its own)
  -- -- exactly the "pitches have disappeared" symptom reported live.
  -- Seeding a realistic baseline here, same pattern as the rest of this
  -- file, so venues/pitches survive a fresh reset + bootstrap going
  -- forward.
  insert into public.venues (id, club_id, name, slug, address, postcode, is_default_home, active)
  values
    ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Burnley RUFC Ground', 'burnley-rufc-ground', 'Coal Clough Lane, Burnley', 'BB11 1AA', true, true),
    ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Towneley Playing Fields', 'towneley-playing-fields', 'Todmorden Road, Burnley', 'BB11 3ET', false, true),
    ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Rossendale RUFC Ground', 'rossendale-rufc-ground', 'Belvedere Road, Rossendale', 'BB4 6EA', true, true)
  -- Bare ON CONFLICT DO NOTHING, not just "(id)" -- the regression suite's
  -- own test files create their own club_pitches/venues rows with generic
  -- names ("Pitch 1" etc.) for these same clubs, which can collide with
  -- this seed's (club_id, name) uniqueness even when the ids never match.
  -- Same idempotency-bug class an earlier fork already fixed for the team
  -- inserts above -- catch it here too rather than "(id) do nothing",
  -- which only ignores a PK collision, not this different unique index.
  on conflict do nothing;

  insert into public.club_pitches (id, club_id, venue_id, display_name, sort_order)
  values
    ('60100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Pitch 1', 1),
    ('60100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Pitch 2', 2),
    ('60100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Training Pitch', 3),
    ('60100000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'Main Pitch', 1),
    ('60100000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003', 'Pitch 1', 1)
  on conflict do nothing;
end $$;
