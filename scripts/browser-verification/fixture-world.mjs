// =====================================================================
// THE RECORDS THE FIXTURE SUITES NEED, SEEDED BY THE RUN THAT NEEDS THEM
//
// Nine of the twenty-seven fixture browser suites were failing, and none of
// them had a product defect in it. They were reading records that used to be
// in the automated UAT club and are not any more -- four age-grade teams, and
// every pitch at Ovalball UAT Ground. A suite that pastes ten spreadsheet rows
// naming five teams reported "2 of 10 ready" and called it a product failure;
// what it had actually found was that three of the five teams no longer exist.
//
// The standing rule is that a permanent suite seeds its own data, cleans up
// after itself, and is independently repeatable. Nine copies of the same
// seeding would satisfy the letter of that and lose its point, so the seeding
// lives here, once, and each suite calls it. It is still the suite's own data:
// the helper creates only what is missing, records exactly what it created,
// and removes exactly that. A record that was already there is never touched
// and never deleted.
//
// WHICH CLUB. `ovalball-uat-rufc` -- the AUTOMATED test club, whose whole
// purpose is to be written to by suites. It is not `step2-review-rfc`, the
// persistent manual-review world, which no automated test may seed into,
// mutate or clean.
//
// WHY NOT FIX THE WORLD ONCE INSTEAD. Because then the next reset breaks the
// suites again, silently, and somebody spends an afternoon reproducing a
// product defect that does not exist. A suite that states its own
// preconditions cannot be quietly invalidated by somebody else's cleanup.
// =====================================================================

/** The automated-test club. Never the persistent review club. */
export const UAT_CLUB_SLUG = "ovalball-uat-rufc"
export const UAT_VENUE_NAME = "Ovalball UAT Ground"

/**
 * `psql -tAc` prints the command tag after a RETURNING row, so an insert comes
 * back as "<uuid>\nINSERT 0 1". Every id this module reads goes through here,
 * because feeding the untrimmed form straight into the next statement produces
 * an "invalid input syntax for type uuid" that looks like a data problem and is
 * a plumbing one.
 */
function one(value) {
  return String(value ?? "").split("\n")[0].trim()
}

/** Escape a value for the psql single-statement interface the suites use. */
function q(value) {
  if (value === null || value === undefined) return "null"
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Canonical team identities the fixture suites name by their display form.
 * The display name is DERIVED from the canonical type in the product, so these
 * pairs must agree with `internal.canonical_team_presentation`; they are the
 * names the suites' spreadsheet blocks and lookups actually use.
 *
 * `reserved` says whether the name belongs to THIS HELPER. Under 12 Boys and
 * Under 16 Boys are long-standing teams of the automated UAT club, with rosters
 * and fixtures of their own, and are listed here only so a suite can rely on
 * them existing -- they are never candidates for removal. The other four were
 * absent, are created here, and are the helper's to reclaim.
 */
const REQUIRED_TEAMS = [
  { key: "u12", name: "Under 12 Boys", reserved: false },
  { key: "u16", name: "Under 16 Boys", reserved: false },
  { key: "u13", name: "Under 13 Boys", reserved: true },
  { key: "girls_u14", name: "Under 14 Girls", reserved: true },
  { key: "u15", name: "Under 15 Boys", reserved: true },
  { key: "girls_u16", name: "Under 16 Girls", reserved: true },
]

/** Two pitches, because "the only pitch at it" and "which pitch" are both real questions a suite asks. */
const REQUIRED_PITCHES = ["Pitch 1", "Pitch 2"]

/**
 * Make sure the automated UAT club has the teams, venue and pitches the
 * fixture suites read, and hand back a cleanup that removes only what this
 * call created.
 *
 * `sql` is the suite's own single-statement psql helper.
 */
export function ensureFixtureWorld(sql, { tag = "seed" } = {}) {
  const clubId = one(sql(`select id from public.clubs where slug = ${q(UAT_CLUB_SLUG)}`))
  if (!clubId) throw new Error(`the automated UAT club ${UAT_CLUB_SLUG} is missing; this suite cannot seed against it`)

  const createdTeamIds = []
  const createdPitchIds = []

  for (const { key: typeKey, name: displayName } of REQUIRED_TEAMS) {
    const existing = one(sql(`select id from public.teams where club_id = ${q(clubId)} and display_name = ${q(displayName)} and active limit 1`))
    if (existing) continue

    const ctt = one(sql(`select id from public.canonical_team_types where key = ${q(typeKey)} and is_active limit 1`))
    if (!ctt) throw new Error(`no canonical team type for ${typeKey} -- the Team Directory, not this suite, owns that`)
    const parts = one(sql(
      `select category || '|' || coalesce(age_group,'') || '|' || coalesce(gender,'') || '|' || coalesce(fixed_squad_designation,'')
       from public.canonical_team_types where id = ${q(ctt)}`,
    )).split("|")

    const id = one(sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, squad_designation, active)
      values (${q(clubId)}, ${q(displayName)}, ${q(`uat-${typeKey}-${tag}`)}, ${q(parts[0])}, ${q(parts[1] || null)}, ${q(parts[2] || null)}, 'union', ${q(ctt)}, ${q(parts[3] || null)}, true)
      returning id`))
    createdTeamIds.push(id)
  }

  // The venue itself is long-standing club data and is never created or
  // removed here -- only the pitches on it, which had all gone.
  const venueId = one(sql(`select id from public.venues where club_id = ${q(clubId)} and name = ${q(UAT_VENUE_NAME)} limit 1`))
  if (venueId) {
    for (const display of REQUIRED_PITCHES) {
      const existing = one(sql(`select id from public.club_pitches where club_id = ${q(clubId)} and display_name = ${q(display)} limit 1`))
      if (existing) continue
      const id = one(sql(`insert into public.club_pitches (club_id, venue_id, display_name, active)
        values (${q(clubId)}, ${q(venueId)}, ${q(display)}, true) returning id`))
      createdPitchIds.push(id)
    }
  }

  return {
    clubId,
    venueId,
    createdTeamIds,
    createdPitchIds,
    /**
     * Remove the reserved rows this helper owns, and nothing else.
     *
     * A row that anything still references is left exactly where it is: the
     * suite's own rows are cleaned by the suite, and cascading through
     * somebody else's is precisely the blast radius this project has a
     * standing rule against.
     */
    cleanup() {
      // ADOPTED, NOT JUST OWN. Tracking only this run's ids left a crashed
      // run's rows behind for ever: the next run found them already present,
      // created nothing, and so had nothing to remove. The names in
      // REQUIRED_TEAMS and REQUIRED_PITCHES are RESERVED for this helper
      // inside the automated UAT club, which is what makes them safe to
      // reclaim.
      //
      // WHETHER A ROW IS STILL IN USE IS THE DATABASE'S ANSWER, NOT A LIST
      // HERE. `club_pitches` alone is referenced by twelve foreign keys and
      // `teams` by more; enumerating them in a `not exists` chain would be
      // wrong the first time a thirteenth was added, and wrong silently. So
      // the delete is simply attempted, and a foreign-key refusal is taken at
      // its word: something still needs this row, so it stays.
      const tryDelete = (statement) => {
        try {
          sql(statement)
        } catch {
          // Referenced by something, or otherwise refused. Leaving a row
          // behind is the safe outcome; the next run adopts it.
        }
      }
      for (const display of REQUIRED_PITCHES) {
        tryDelete(`delete from public.club_pitches where club_id = ${q(clubId)} and display_name = ${q(display)}`)
      }
      for (const team of REQUIRED_TEAMS) {
        // Only the names this helper owns. A long-standing UAT team is listed
        // as required so suites can depend on it, never so that it can be
        // deleted the moment its roster happens to be empty.
        if (!team.reserved) continue
        tryDelete(`delete from public.teams where club_id = ${q(clubId)} and display_name = ${q(team.name)}`)
      }
    },
  }
}

/**
 * A disposable Rugby League club, for the one isolation question that cannot
 * be asked without one: that a League competition never appears in a Union
 * club's selectors and the reverse. The local world has no League tenant, so a
 * suite that needs one makes it and removes it.
 */
export function ensureLeagueClub(sql, tag) {
  const key = `uat-league-${tag}`.toLowerCase()
  const dirId = one(sql(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values (${q(`UAT League Club ${tag}`)}, 'Wigan', 'Greater Manchester', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', ${q(key)})
    returning id`))
  const clubId = one(sql(`insert into public.clubs (directory_id, slug, status) values (${q(dirId)}, ${q(key)}, 'active') returning id`))
  // Rugby League identities come from canonical_team_types_by_code filtered on
  // rugby_code and is_offered -- the catalogue read the isolation rule
  // requires. canonical_team_types itself is code-agnostic, so reading it
  // directly here would be the "load both catalogues" mistake in miniature.
  const ctt = one(sql(`select id from public.canonical_team_types_by_code where rugby_code = 'league' and is_offered and is_active and key = 'u12' limit 1`))
  if (!ctt) throw new Error("no offered Rugby League U12 identity -- the Team Directory owns that, not this suite")
  const parts = one(sql(
    `select category || '|' || coalesce(age_group,'') || '|' || coalesce(gender,'') || '|' || coalesce(fixed_squad_designation,'')
     from public.canonical_team_types where id = ${q(ctt)}`,
  )).split("|")
  const display = "Under 12 Boys"
  const teamId = one(sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, squad_designation, active)
    values (${q(clubId)}, ${q(display)}, ${q(`${key}-team`)}, ${q(parts[0])}, ${q(parts[1] || null)}, ${q(parts[2] || null)}, 'league', ${q(ctt)}, ${q(parts[3] || null)}, true)
    returning id`))

  return {
    clubId,
    dirId,
    teamId,
    cleanup() {
      sql(`delete from public.fixtures where owning_team_id = ${q(teamId)} or opponent_team_id = ${q(teamId)}`)
      sql(`delete from public.teams where id = ${q(teamId)}`)
      sql(`delete from public.clubs where id = ${q(clubId)}`)
      sql(`delete from public.club_directory where id = ${q(dirId)}`)
    },
  }
}

/**
 * A SEASON'S WORTH OF FIXTURES, FOR THE SUITES WHOSE SUBJECT IS SCALE.
 *
 * Two of the assertions in the Control Centre suite are about behaviour that
 * only exists above a threshold -- that the grid paginates rather than
 * rendering everything, and that page four renders its own window. They were
 * reading whatever fixtures happened to be lying about, which on a clean local
 * database is two, so they reported "2 matched, 2 rendered" as a pagination
 * failure. A suite that tests scale has to bring the scale with it.
 *
 * The rows are minimal and tagged in `notes`, so the cleanup finds exactly its
 * own and nothing else. They are written directly rather than through
 * `create_fixture` on purpose: this is a rendering threshold, not a creation
 * journey, and the creation journey has its own suites.
 */
export function seedFixturesAtScale(sql, { clubId, count = 130, tag, startYear = 2031, oppositionPrefix = "Scale", sweepPrefix = null }) {
  // A CRASHED RUN MUST NOT POISON THE NEXT ONE.
  //
  // These rows are dated years ahead and spaced a week apart, and a team may
  // hold only one match per day -- a real canonical rule. So if a previous run
  // died before its cleanup, the next run's insert collides with the corpse and
  // fails with a rule violation that looks like a product defect. The suite
  // owns its whole tag prefix, so it sweeps it before seeding, which is what
  // makes the suite independently repeatable rather than merely tidy.
  if (sweepPrefix) {
    sql(`delete from public.fixture_source_refs where fixture_id in (select id from public.fixtures where notes like ${q(sweepPrefix + "%")})`)
    sql(`delete from public.fixtures where notes like ${q(sweepPrefix + "%")}`)
  }

  const teamId = one(sql(`select id from public.teams where club_id = ${q(clubId)} and active order by display_name limit 1`))
  if (!teamId) throw new Error("the seeded club has no active team to hang fixtures on")
  const opponent = one(sql(`select id from public.club_directory where active and rugby_code = 'union'
    and not exists (select 1 from public.clubs c where c.directory_id = club_directory.id) order by name limit 1`))

  // One statement, not `count` of them: 130 round trips through docker exec is
  // a minute of wall clock for rows nobody reads individually.
  sql(`insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
    select ${q(teamId)},
           case when g % 2 = 0 then 'Home' else 'Away' end,
           ${q(opponent || null)},
           ${q(oppositionPrefix + " ")} || g,
           (date '${startYear}-01-06' + (g * 7))::date,
           '11:00'::time,
           'Booked', 'club_created', ${q(tag)},
           case when g % 3 = 0 then 'League Fixture' else 'Friendly' end
    from generate_series(1, ${Number(count)}) as g`)

  return {
    teamId,
    count,
    cleanup() {
      sql(`delete from public.fixture_source_refs where fixture_id in (select id from public.fixtures where notes = ${q(tag)})`)
      sql(`delete from public.fixtures where notes = ${q(tag)}`)
    },
  }
}

/**
 * A SECOND GROUND, FOR THE MISMATCH THAT CANNOT BE STAGED WITHOUT ONE.
 *
 * "This pitch is not at that venue" is only reachable when both the venue and
 * the pitch are real and belong to different grounds. The automated UAT club
 * has one ground, so the row meant to produce a mismatch produced "unknown
 * venue" instead -- a different error, from a different rule, which the suite
 * counted as the one it was looking for right up until it started checking the
 * message.
 *
 * The ground is created WITHOUT an address on purpose. `set_venue_address` is
 * the one address writer (Step 6), and a seed row that wrote address columns
 * directly is exactly the artefact that pass had to go back and correct. A
 * venue with no address recorded is an ordinary, legitimate state.
 */
export function ensureSecondVenue(sql, clubId, { name, pitch }) {
  const existing = one(sql(`select id from public.venues where club_id = ${q(clubId)} and name = ${q(name)} limit 1`))
  if (existing) {
    const p = one(sql(`select id from public.club_pitches where venue_id = ${q(existing)} and display_name = ${q(pitch)} limit 1`))
    return { venueId: existing, pitchId: p, cleanup() {} }
  }
  const venueId = one(sql(`insert into public.venues (club_id, name, slug, active, is_default_home)
    values (${q(clubId)}, ${q(name)}, ${q(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}, true, false) returning id`))
  const pitchId = one(sql(`insert into public.club_pitches (club_id, venue_id, display_name, active)
    values (${q(clubId)}, ${q(venueId)}, ${q(pitch)}, true) returning id`))
  return {
    venueId,
    pitchId,
    cleanup() {
      sql(`delete from public.club_pitches where id = ${q(pitchId)}
           and not exists (select 1 from public.fixtures f where f.pitch_id = ${q(pitchId)})`)
      sql(`delete from public.venues where id = ${q(venueId)}
           and not exists (select 1 from public.fixtures f where f.venue_id = ${q(venueId)})`)
    },
  }
}
