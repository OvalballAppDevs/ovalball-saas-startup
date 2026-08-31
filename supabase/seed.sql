-- Local development seed. Runs automatically after every `supabase db
-- reset --local` (see supabase/config.toml [db.seed]). Deliberately empty
-- of any real data or hardcoded user -- site_admins has a bootstrap problem
-- (its own INSERT policy requires already being a Site Admin), and the
-- correct fix is a documented local-only procedure, never a hardcoded email
-- baked into a file that runs in every environment.
--
-- To make your own local test account a Site Admin after signing up
-- through the app (magic link arrives at http://127.0.0.1:54324, Mailpit):
--
--   docker exec supabase_db_ovalball-saas-startup psql -U postgres -d postgres -c "
--     insert into public.site_admins (user_id, status)
--     select id, 'active' from auth.users where email = 'your-local-test-email@example.com'
--     on conflict (user_id) do nothing;
--   "
--
-- This grants Site Admin only on your own local database, never touches
-- remote/production, and is never run automatically -- you choose which
-- local account gets it, every time.

-- ============================================================
-- Reference data: a handful of stable, hand-named club_directory rows
-- (source = 'local_dev_seed') that the SQL test suites and this app's own
-- walkthrough/test fixtures key off of by exact name -- e.g.
-- supabase/tests/*.sql look up 'Burnley RUFC' by name. Keep these even
-- though supabase/seeds/club_directory.sql (loaded right after this file,
-- see config.toml [db.seed] sql_paths) now also loads the full real
-- 1389-row dataset: that file's real-world data can be regenerated/reordered
-- from source and its names aren't a contract anything depends on, so tests
-- deliberately don't reference it. Re-seeded fresh, identically, on every
-- `db reset --local`.
-- ============================================================

insert into public.club_directory
  (name, rugby_code, country, nation, town, county, postcode, source, source_url, verification_status, normalized_key, active)
values
  ('Burnley RUFC', 'union', 'United Kingdom', 'England', 'Burnley', 'Lancashire', 'BB10 2LS', 'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'burnley rufc', true),
  ('Preston Grasshoppers RFC', 'union', 'United Kingdom', 'England', 'Preston', 'Lancashire', 'PR2 5NA', 'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'preston grasshoppers rfc', true),
  ('Leigh RUFC', 'union', 'United Kingdom', 'England', 'Leigh', 'Greater Manchester', 'WN7 3NA', 'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'leigh rufc', true),
  ('Rossendale RUFC', 'union', 'United Kingdom', 'England', 'Rossendale', 'Lancashire', 'BB4 6RA', 'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'rossendale rufc', true),
  ('Blackburn RUFC', 'union', 'United Kingdom', 'England', 'Blackburn', 'Lancashire', 'BB2 6PB', 'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'blackburn rufc', true);
-- No ON CONFLICT clause: club_directory.name is deliberately not unique
-- (see 20260830143455_club_directory.sql), and this file only ever runs
-- against a just-migrated, empty database via `db reset --local`, so there
-- is nothing to conflict with.
