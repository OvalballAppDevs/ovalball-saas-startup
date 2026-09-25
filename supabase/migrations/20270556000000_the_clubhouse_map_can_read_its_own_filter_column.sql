-- CLUBHOUSE PROGRAMME SECTION 5 -- A REAL, LIVE REGRESSION FOUND VERIFYING THE TEAM-CONTEXT FIX.
--
-- Section 5's own required live-browser proof (signed in as uat.team.manager@ovalball.test, a genuine
-- team-context persona) hit `permission denied for table club_directory` loading /clubhouse -- the
-- WHOLE map/list screen, for every viewer, club-context or team-context alike, not something specific
-- to this section's own change.
--
-- ROOT CAUSE: Section 3 (Clubhouse Programme, Club Directory & Geo Coverage) added `source` to
-- `fetchAllDirectoryRows`'s own select list (packages/contracts/src/clubhouse/map-read-model.ts),
-- needed for `isKnownTestFixture({source, verification_status})` -- the filter that keeps
-- `partnership_automation.sql`'s deliberately-committed test fixture rows out of real users' club
-- lists. `verification_status` was already in `authenticated`'s column-level SELECT grant on
-- `club_directory` (20270342000000_database_api_perimeter.sql's own column-grant migration);
-- `source` never was. No automated test caught this: the JS unit tests exercise `isKnownTestFixture`
-- as a pure function without a live database, and Sections 3/4 both recorded "no device/browser
-- session available" for their own proof -- so nobody had loaded the Clubhouse map in a real signed-in
-- browser since Section 3 shipped the query change, until this section's own required proof did.
--
-- THE FIX IS THE SAME SHAPE AS THE EXISTING GRANT, WIDENED BY EXACTLY ONE COLUMN. `source` carries the
-- same sensitivity as `verification_status`, already public to any signed-in account: which governing
-- body or public source a directory row's facts came from (e.g. 'welsh_rugby_union',
-- 'site_admin_manual'), never notes, official_email, address or the other Site-Admin-only provenance
-- columns (source_url, source_updated_at, external_id, normalized_key) that stay exactly as
-- restricted as 20270342000000 left them.
grant select (source) on public.club_directory to authenticated;

comment on column public.club_directory.source is
  'Which governing body or public source this row came from (e.g. welsh_rugby_union, site_admin_manual). Public directory fact, same sensitivity as verification_status -- granted to authenticated so Clubhouse (packages/contracts/src/clubhouse/map-read-model.ts) can filter out known test fixtures (isKnownTestFixture). Never notes/official_email/source_url/external_id, which stay Site-Admin only.';
