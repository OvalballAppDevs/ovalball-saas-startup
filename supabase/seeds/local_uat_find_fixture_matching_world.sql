-- ===========================================================================
-- FIND A FIXTURE -- A CONTROLLED TEN-CLUB UAT MATCHING WORLD
-- ===========================================================================
--
-- WHY THIS EXISTS. FF-3 ("Available Clubs") could not be visually or logically
-- verified against the persistent review database, because the real network
-- around Ovalball UAT RUFC (the canonical viewer club, `ovalball-uat-rufc`)
-- returns zero genuinely compatible, correctly-dated matches. This seed adds
-- ten unmistakably synthetic "Ovalball UAT <Name> RFC" clubs, deliberately
-- varied so the real matching engine (find_fixture_candidate_teams_batch /
-- find_fixture_candidate_availability_batch) produces a rich, honest spread
-- of outcomes -- never fabricated status values inserted directly.
--
-- THE TEST SCENARIO, FIXED AND DOCUMENTED (see also
-- docs/product/clubhouse/FIND_FIXTURE_UAT_WORLD.md, the expected-result
-- oracle this fixture must stay consistent with):
--   TEST DATE:            2026-10-17 (a Saturday)
--   SELECTED VIEWER TEAMS: Men's 1st Team, Women's 1st Team, Under 16 Boys
--                          (Ovalball UAT RUFC's own real, pre-existing teams)
--
-- WHY ONLY THREE OF TEN CLUBS ARE PARTNERS. Section 7's own privacy rule --
-- proven elsewhere in this codebase and unchanged here -- coarsens
-- availability to real busy/tentative/no_known_clash values ONLY for an
-- ACTIVE PARTNER; a compatible-but-not-partnered club is truthfully
-- "Availability unknown" regardless of what its calendar actually contains.
-- Giving every club a fake partnership just to show a variety of statuses
-- would defeat the very rule this fixture exists to demonstrate. Ten clubs,
-- most non-partner, is the HONEST shape of the real network -- not a
-- shortcut taken because building fixtures/requests for all ten was harder.
--
-- WHAT PRODUCES EACH REAL STATUS (never inserted as a literal string):
--   UAT North  (partner):  no commitments on TEST DATE       -> no_known_clash
--   UAT South  (partner):  a real Booked fixture for its U16 -> busy
--   UAT West   (partner):  a real pending fixture_request
--                          targeting its Women's 1st         -> request_pending (tentative)
--   UAT Park   (partner):  no commitments, distant           -> no_known_clash, far
--   every non-partner club: genuinely compatible teams, but availability
--     withheld entirely by the partnership boundary           -> unknown
--   UAT Borough: League teams against a Union viewer          -> 0/3 matched, excluded
--   UAT United: no directory coordinate at all (geocode_status
--     left at its default 'pending', never a fabricated failure) -> unknown distance
--
-- IDEMPOTENT, ADDITIVE, LOCAL-ONLY. Every insert is guarded on its own
-- natural key (`normalized_key` / `slug` / the exact row it would create),
-- so re-running this file changes nothing already there. No table is reset,
-- no existing row is edited. Building/removing this fixture never requires
-- `supabase db reset` -- see the pinned local-database safety instruction.
--
-- SYNTHETIC CRESTS: run `node scripts/seed-find-fixture-uat-crests.mjs` once after this file (Storage
-- uploads have no raw-SQL path, so that companion script is the one place they happen). Ten
-- deliberately simple, unmistakably synthetic shield crests -- never a photograph, never modelled on
-- any real club -- wired through the exact same `clubs.logo_storage_path` / `club-logos` bucket path a
-- real club logo upload uses.
--
-- TO REMOVE THIS FIXTURE LATER: every row it creates is reachable by
-- `club_directory.source = 'local_dev_seed' and normalized_key like
-- 'ovalball-uat-%-rfc'` (excluding `ovalball-uat-rufc` itself, the pre-
-- existing viewer club) -- a single documented, reviewable deletion, never
-- attempted here.
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Find a Fixture UAT matching world is local-only.';
  end if;
end $$;

do $$
declare
  v_viewer_club uuid;
  v_coach       uuid;

  v_dir_a uuid; v_club_a uuid; v_team_a_womens uuid;
  v_dir_b uuid; v_club_b uuid; v_team_b_u16 uuid; v_team_b_womens uuid;
  v_dir_c uuid; v_club_c uuid;
  v_dir_d uuid; v_club_d uuid; v_team_d_womens uuid; v_team_d_mens uuid;
  v_dir_e uuid; v_club_e uuid;
  v_dir_f uuid; v_club_f uuid;
  v_dir_g uuid; v_club_g uuid;
  v_dir_h uuid; v_club_h uuid;
  v_dir_i uuid; v_club_i uuid; v_team_i_u16 uuid;
  v_dir_j uuid; v_club_j uuid;
begin
  select c.id into v_viewer_club from public.clubs c join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_viewer_club is null then
    raise notice 'SKIPPED: Ovalball UAT RUFC is not seeded yet.';
    return;
  end if;
  select u.id into v_coach from auth.users u where u.email = 'uat.coach@ovalball.test';

  -- Being CLUB_ADMIN does not, on its own, carry fixture.request.create/.fixture.create at a named
  -- team (confirmed directly against this exact persona while proving this fixture) -- that authority
  -- is genuinely team-scoped, exactly as `arrange_fixture_authority.sql` already establishes. The three
  -- teams this test scenario searches with need it explicitly, on the same coach persona every other
  -- Ovalball UAT RUFC seed already writes as, never a new persona invented for this one fixture.
  insert into public.team_permissions (membership_id, team_id, permission)
  select m.id, t.id, 'coach'
  from public.club_memberships m
  join auth.users u on u.id = m.user_id and u.email = 'uat.coach@ovalball.test'
  join public.teams t on t.club_id = m.club_id and t.display_name in ('Men''s 1st Team', 'Women''s 1st Team', 'Under 16 Boys')
  where m.club_id = v_viewer_club
    and not exists (select 1 from public.team_permissions tp where tp.membership_id = m.id and tp.team_id = t.id);

  -- One shared lookup for the team shapes this fixture actually uses, so each
  -- club's own team insert states its roster by name rather than repeating
  -- category/age_group/gender/squad_designation five times over.
  create temporary table if not exists tmp_ff_team_key_map (
    key text primary key, rugby_code text, category text, age_group text, gender text, squad_designation text
  );
  delete from tmp_ff_team_key_map;
  insert into tmp_ff_team_key_map (key, rugby_code, category, age_group, gender, squad_designation) values
    ('mens_1st',   'union',  'senior', null,   'mens',   '1st'),
    ('womens_1st', 'union',  'senior', null,   'womens', '1st'),
    ('u16',        'union',  'youth',  'U16',  'boys',   null),
    ('league_mens_open', 'league', 'senior', null, 'mens', null),
    ('league_u16',       'league', 'youth',  'U16', 'boys', null);

  -- =====================================================================
  -- UAT North RFC -- PARTNER, 3/3 compatible, no commitments on TEST DATE ITSELF
  -- -> 3/3 no known clash. Its Women's 1st DOES have a real fixture, but on
  -- the FOLLOWING Monday -- a different Monday-Sunday game week entirely --
  -- proving the game-week signal never leaks across the boundary. ~5 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT North RFC', 'Burnley', 'Lancashire', 'BB10 2AA', 'union', 'United Kingdom', 'England', 53.891894, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-north-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-north-rfc');
  select id into v_dir_a from public.club_directory where normalized_key = 'ovalball-uat-north-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_a, 'ovalball-uat-north-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_a);
  select id into v_club_a from public.clubs where directory_id = v_dir_a;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_a, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_a and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));
  select t.id into v_team_a_womens from public.teams t where t.club_id = v_club_a and t.category = 'senior' and t.gender = 'womens';

  -- PUBLIC CLUB PROFILE VISUAL-LOCK (Section 21/9): North's own real roster gets a full mini-to-youth
  -- age-graded spread purely so the profile's "Teams"/"Age Groups" metrics have something genuine to
  -- show ("9 Teams", "U7 - U18") -- never fabricated, always the club's own real active teams. NONE of
  -- these match the viewer's own three selected search teams (Men's 1st, Women's 1st, Under 16 Boys),
  -- so the Find a Fixture 3-team compatibility oracle's own determinism for North is untouched: adding a
  -- U7/U8/U10/U12/U14/U18 side never changes which of the viewer's teams find a compatible opponent here.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_a, 'union', 'youth', x.age_group, x.gender, null, true
  from (values ('U7', 'mixed'), ('U8', 'mixed'), ('U10', 'mixed'), ('U12', 'boys'), ('U14', 'boys'), ('U18', 'boys')) as x(age_group, gender)
  where not exists (select 1 from public.teams t where t.club_id = v_club_a and t.category = 'youth' and t.age_group = x.age_group and coalesce(t.gender,'') = coalesce(x.gender,''));

  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  select v_viewer_club, v_club_a, 'active', v_coach
  where not exists (select 1 from public.club_partnerships where (requesting_club_id = v_viewer_club and partner_club_id = v_club_a) or (requesting_club_id = v_club_a and partner_club_id = v_viewer_club));

  -- FOLLOWING MONDAY (2026-10-19), a different game week from TEST DATE (Saturday 2026-10-17, whose
  -- own week runs Monday 2026-10-12 to Sunday 2026-10-18) -- must never be surfaced as a same-week
  -- commitment, and must never affect North's own exact-date "no known clash" either.
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  select v_team_a_womens, date '2026-10-19', 'Booked', 'Away', 'Following week fixture'
  where v_team_a_womens is not null
    and not exists (select 1 from public.fixtures where owning_team_id = v_team_a_womens and kickoff_date = date '2026-10-19');

  -- =====================================================================
  -- UAT South RFC -- PARTNER, 3/3 compatible. A real Booked fixture for its
  -- U16 on TEST DATE -> 2 clear + 1 busy. ~12 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT South RFC', 'Burnley', 'Lancashire', 'BB10 2AB', 'union', 'United Kingdom', 'England', 53.993294, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-south-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-south-rfc');
  select id into v_dir_b from public.club_directory where normalized_key = 'ovalball-uat-south-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_b, 'ovalball-uat-south-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_b);
  select id into v_club_b from public.clubs where directory_id = v_dir_b;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_b, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_b and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));
  select t.id into v_team_b_u16 from public.teams t where t.club_id = v_club_b and t.category = 'youth' and t.age_group = 'U16';
  select t.id into v_team_b_womens from public.teams t where t.club_id = v_club_b and t.category = 'senior' and t.gender = 'womens';

  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  select v_viewer_club, v_club_b, 'active', v_coach
  where not exists (select 1 from public.club_partnerships where (requesting_club_id = v_viewer_club and partner_club_id = v_club_b) or (requesting_club_id = v_club_b and partner_club_id = v_viewer_club));

  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  select v_team_b_u16, date '2026-10-17', 'Booked', 'Home', 'Local league fixture'
  where not exists (select 1 from public.fixtures where owning_team_id = v_team_b_u16 and kickoff_date = date '2026-10-17');

  -- =====================================================================
  -- UAT East RFC -- NON-PARTNER, only Men's 1st + U16 -> 2/3 matched,
  -- availability withheld (unknown). ~18 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT East RFC', 'Burnley', 'Lancashire', 'BB10 2AC', 'union', 'United Kingdom', 'England', 54.080294, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-east-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-east-rfc');
  select id into v_dir_c from public.club_directory where normalized_key = 'ovalball-uat-east-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_c, 'ovalball-uat-east-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_c);
  select id into v_club_c from public.clubs where directory_id = v_dir_c;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_c, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_c and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  -- =====================================================================
  -- UAT West RFC -- PARTNER, 3/3 compatible. A pending fixture_request from
  -- UAT South's own Women's 1st (an unrelated third-party ask, not involving
  -- the viewer) targets its Women's 1st on TEST DATE -> tentative. Its own
  -- Men's 1st has a real fixture on the FRIDAY of the SAME game week as TEST
  -- DATE (genuinely clear on the exact Saturday itself, but "busy this week"
  -- -- the game-week signal this club exists to prove). Its U16 has no
  -- commitment anywhere -> genuinely clear. One club, three different real
  -- states -> "Mixed" at the club level. ~25 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT West RFC', 'Burnley', 'Lancashire', 'BB10 2AD', 'union', 'United Kingdom', 'England', 54.181794, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-west-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-west-rfc');
  select id into v_dir_d from public.club_directory where normalized_key = 'ovalball-uat-west-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_d, 'ovalball-uat-west-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_d);
  select id into v_club_d from public.clubs where directory_id = v_dir_d;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_d, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_d and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));
  select t.id into v_team_d_womens from public.teams t where t.club_id = v_club_d and t.category = 'senior' and t.gender = 'womens';
  select t.id into v_team_d_mens from public.teams t where t.club_id = v_club_d and t.category = 'senior' and t.gender = 'mens';

  -- FRIDAY of the SAME Monday-Sunday week as TEST DATE (2026-10-16; TEST DATE Saturday 2026-10-17's own
  -- week runs Monday 2026-10-12 to Sunday 2026-10-18) -- genuinely clear on the exact requested Saturday,
  -- but a real commitment elsewhere in the same game week.
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  select v_team_d_mens, date '2026-10-16', 'Booked', 'Home', 'Friday night fixture, same game week as the requested Saturday'
  where v_team_d_mens is not null
    and not exists (select 1 from public.fixtures where owning_team_id = v_team_d_mens and kickoff_date = date '2026-10-16');

  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  select v_viewer_club, v_club_d, 'active', v_coach
  where not exists (select 1 from public.club_partnerships where (requesting_club_id = v_viewer_club and partner_club_id = v_club_d) or (requesting_club_id = v_club_d and partner_club_id = v_viewer_club));

  -- The requesting side is UAT South's own Women's 1st (a genuinely age/category-
  -- compatible third party, unrelated to the viewer) asking UAT West's Women's
  -- 1st for the same date -- fixture_requests enforces real compatibility
  -- between its own two named teams, so this could not be an arbitrary pairing.
  if v_team_b_womens is not null and v_team_d_womens is not null then
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
    select v_club_b, v_club_d, 'Ovalball UAT West RFC', date '2026-10-17', v_coach
    where not exists (
      select 1 from public.fixture_request_groups g
      where g.requesting_club_id = v_club_b and g.opponent_club_id = v_club_d and g.proposed_date = date '2026-10-17'
    );

    insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
    select g.id, v_team_b_womens, v_team_d_womens, 'either', 'sent', v_coach
    from public.fixture_request_groups g
    where g.requesting_club_id = v_club_b and g.opponent_club_id = v_club_d and g.proposed_date = date '2026-10-17'
    and not exists (select 1 from public.fixture_requests r where r.group_id = g.id and r.target_team_id = v_team_d_womens);
  end if;

  -- =====================================================================
  -- UAT Valley RFC -- NON-PARTNER, only U16 -> 1/3 matched, unknown.
  -- ~30 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT Valley RFC', 'Burnley', 'Lancashire', 'BB10 2AE', 'union', 'United Kingdom', 'England', 54.254294, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-valley-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-valley-rfc');
  select id into v_dir_e from public.club_directory where normalized_key = 'ovalball-uat-valley-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_e, 'ovalball-uat-valley-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_e);
  select id into v_club_e from public.clubs where directory_id = v_dir_e;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_e, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_e and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  -- =====================================================================
  -- UAT Riverside RFC -- NON-PARTNER, Women's 1st + U16 -> 2/3 matched,
  -- unknown. ~45 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT Riverside RFC', 'Burnley', 'Lancashire', 'BB10 2AF', 'union', 'United Kingdom', 'England', 54.471594, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-riverside-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-riverside-rfc');
  select id into v_dir_f from public.club_directory where normalized_key = 'ovalball-uat-riverside-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_f, 'ovalball-uat-riverside-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_f);
  select id into v_club_f from public.clubs where directory_id = v_dir_f;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_f, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_f and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  -- =====================================================================
  -- UAT Borough RFC -- League club: 0/3 matched (Union/League isolation
  -- proven end to end, not just at the single-team level). ~50 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT Borough RL', 'Burnley', 'Lancashire', 'BB10 2AG', 'league', 'United Kingdom', 'England', 54.543794, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-borough-rl'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-borough-rl');
  select id into v_dir_g from public.club_directory where normalized_key = 'ovalball-uat-borough-rl';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_g, 'ovalball-uat-borough-rl', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_g);
  select id into v_club_g from public.clubs where directory_id = v_dir_g;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_g, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('league_mens_open', 'league_u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_g and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  -- =====================================================================
  -- UAT Athletic RFC -- NON-PARTNER, Women's 1st + U16 -> 2/3 matched,
  -- unknown. ~55 miles.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT Athletic RFC', 'Burnley', 'Lancashire', 'BB10 2AH', 'union', 'United Kingdom', 'England', 54.616294, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-athletic-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-athletic-rfc');
  select id into v_dir_h from public.club_directory where normalized_key = 'ovalball-uat-athletic-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_h, 'ovalball-uat-athletic-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_h);
  select id into v_club_h from public.clubs where directory_id = v_dir_h;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_h, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_h and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  -- =====================================================================
  -- UAT Park RFC -- PARTNER, 3/3 compatible, no commitments in the SAME game
  -- week as TEST DATE -> 3/3 no known clash. Its U16 does have a real
  -- fixture, but on the PRECEDING Sunday (2026-10-11 -- the last day of the
  -- week BEFORE TEST DATE's own week), proving a different-week commitment
  -- never leaks in from the other direction either. Also the FAR partner
  -- (~70 miles) -- proves Best Match/Most Clear can rank it ahead of a
  -- nearer, less-clear club even though Nearest does not.
  -- =====================================================================
  insert into public.club_directory (name, town, county, postcode, rugby_code, country, nation, latitude, longitude, geocode_status, active, verification_status, source, normalized_key)
  select 'Ovalball UAT Park RFC', 'Burnley', 'Lancashire', 'BB10 2AJ', 'union', 'United Kingdom', 'England', 54.833894, -2.234962, 'success', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-park-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-park-rfc');
  select id into v_dir_i from public.club_directory where normalized_key = 'ovalball-uat-park-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_i, 'ovalball-uat-park-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_i);
  select id into v_club_i from public.clubs where directory_id = v_dir_i;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_i, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_i and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));
  select t.id into v_team_i_u16 from public.teams t where t.club_id = v_club_i and t.category = 'youth' and t.age_group = 'U16';

  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  select v_viewer_club, v_club_i, 'active', v_coach
  where not exists (select 1 from public.club_partnerships where (requesting_club_id = v_viewer_club and partner_club_id = v_club_i) or (requesting_club_id = v_club_i and partner_club_id = v_viewer_club));

  -- PRECEDING SUNDAY (2026-10-11), the last day of the game week BEFORE TEST DATE's own week -- must
  -- never be surfaced as a same-week commitment.
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  select v_team_i_u16, date '2026-10-11', 'Booked', 'Away', 'Preceding week fixture'
  where v_team_i_u16 is not null
    and not exists (select 1 from public.fixtures where owning_team_id = v_team_i_u16 and kickoff_date = date '2026-10-11');

  -- =====================================================================
  -- UAT United RFC -- NON-PARTNER, 3/3 compatible, unknown availability
  -- AND no directory coordinate at all (geocode_status left at its
  -- genuine default 'pending', never a fabricated failure) -> proves
  -- unknown distance sorts last under Nearest.
  -- =====================================================================
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  select 'Ovalball UAT United RFC', 'Burnley', 'Lancashire', 'union', 'United Kingdom', 'England', true, 'local_dev_seed', 'local_dev_seed', 'ovalball-uat-united-rfc'
  where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-united-rfc');
  select id into v_dir_j from public.club_directory where normalized_key = 'ovalball-uat-united-rfc';

  insert into public.clubs (directory_id, slug, status)
  select v_dir_j, 'ovalball-uat-united-rfc', 'active'
  where not exists (select 1 from public.clubs where directory_id = v_dir_j);
  select id into v_club_j from public.clubs where directory_id = v_dir_j;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, active)
  select v_club_j, m.rugby_code, m.category, m.age_group, m.gender, m.squad_designation, true
  from tmp_ff_team_key_map m where m.key in ('mens_1st', 'womens_1st', 'u16')
  and not exists (select 1 from public.teams t where t.club_id = v_club_j and t.category = m.category
    and coalesce(t.age_group,'') = coalesce(m.age_group,'') and coalesce(t.gender,'') = coalesce(m.gender,'')
    and coalesce(t.squad_designation,'') = coalesce(m.squad_designation,''));

  drop table if exists tmp_ff_team_key_map;

  raise notice 'Find a Fixture UAT matching world: 10 synthetic clubs ready around Ovalball UAT RUFC for TEST DATE 2026-10-17.';
end $$;
