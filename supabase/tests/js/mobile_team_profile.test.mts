import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * OWNER BRIEF -- TEAM PROFILES + CLUB ADMIN HOME INTEGRATION. Permanent structural pins so the
 * safeguarding gate and the one-canonical-route convergence cannot regress silently.
 */
test("loadTeamProfile never counts squad/staff before checking authority.view -- an unknown viewer must never see a fabricated zero or a fabricated partial count", () => {
  const src = code("packages/contracts/src/team/profile.ts")
  // The RPC call must be textually inside the `if (authority.view)` branch, not run unconditionally.
  const gateIndex = src.indexOf("if (authority.view)")
  const rpcIndex = src.indexOf('rpc("team_people_counts"')
  assert.ok(gateIndex >= 0, "the authority.view gate is missing")
  assert.ok(rpcIndex > gateIndex, "the people-counts RPC runs before (or without) the authority.view gate")
  assert.match(src, /counts: TeamProfilePeople\["counts"\] = null/, "counts default to null (unknown), never to a computed zero, before authority is checked")
  // A client-side RLS-filtered `.count()` on `player_team_memberships` looks safe but is not: a viewer who
  // holds `team.team.view` without `team.roster.view` (a guardian whose own child plays on the team is a real
  // example) gets RLS-filtered rows for their own child alone, so `.count()` silently returns a fabricated
  // ONE instead of the team's real size -- confirmed against a live UAT persona/team pair. The counts must
  // come from the capability-gated `team_people_counts` RPC (SECURITY DEFINER, re-checks `team.team.view`
  // server-side, returns null on both fields where it is not held), never a direct table count.
  assert.doesNotMatch(src, /from\("player_team_memberships"\)|from\("team_permissions"\)/, "counts must come from the team_people_counts RPC, never a direct RLS-filtered table count")
})

test("TeamProfileScreen never claims an empty squad -- the restricted state says 'not part of your view', never 'no players', and the two stay textually distinct", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  const restrictedText = fn.slice(fn.indexOf("!profile.people.rosterVisible"), fn.indexOf("!profile.people.rosterVisible") + 200)
  assert.match(restrictedText, /Squad isn(&apos;|')t part of your view/, "the restricted state's own honest copy is missing")
  assert.doesNotMatch(restrictedText, /No players/i, "a denied roster must never render as a fabricated empty squad -- the two states must use different wording")
})

test("the club Teams list, the Clubhouse cross-club Teams tab and Club Admin Home's Your Teams rail all route to the one canonical /teams/[teamId], never a role-named copy", () => {
  const clubTeamsIndex = code("apps/mobile/app/(tabs)/club/teams/index.tsx")
  const clubhouseProfile = code("apps/mobile/app/(tabs)/clubhouse/club/[directoryId].tsx")
  const clubHome = code("apps/mobile/src/club/home.tsx")
  for (const src of [clubTeamsIndex, clubhouseProfile, clubHome]) {
    assert.match(src, /pathname: "\/teams\/\[teamId\]"/, "a team row does not route to the canonical Team Profile")
  }
  const oldRoute = code("apps/mobile/app/(tabs)/club/teams/[teamId].tsx")
  assert.match(oldRoute, /TeamProfileScreen/, "the legacy club-scoped route no longer converges on the shared screen")
  assert.doesNotMatch(oldRoute, /loadClubOverview/, "the legacy route still carries its own duplicate read instead of converging")
})

test("Club Admin Home has no 'From Here' section and no mobile Fixture Control Centre link -- both retired in favour of the four-tile grid and the Admin Console", () => {
  const src = code("apps/mobile/src/club/home.tsx")
  assert.doesNotMatch(src, /From Here/, "the retired 'From Here' section is still present")
  assert.doesNotMatch(src, /Fixture Control Centre/, "the mobile Fixture Control Centre link-out is still present -- it stays desk-only, reached from the Admin Console")
  for (const tile of ["Clubhouse", "Pitch Allocation", "Rugby Hub", "Admin Console"]) {
    assert.match(src, new RegExp(tile), `the ${tile} tile is missing from the four-tile grid`)
  }
})

/**
 * TEAM PROFILE SECTION 1 -- OVERVIEW. Permanent structural pins for the metrics row, About This Team,
 * the season register and cover-photo authority foundation.
 */
test("the Players/Staff/Fixtures/Wins row never shows a fabricated zero -- an unavailable metric is an em dash, not 0", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /m\.value === null \? "—" : m\.value/, "an unavailable metric must render as an em dash, never a computed or default zero")
  assert.match(src, /profile\.people\.counts\?\.players \?\? null/, "Players reads the same authority-gated aggregate as Squad, never a second count")
  assert.match(src, /profile\.people\.counts\?\.staff \?\? null/, "Staff reads the same authority-gated aggregate as Squad, never a second count")
})

test("About This Team never shows an admin prompt to an unauthorised viewer, and never invents a description", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /if \(!description && !canManage\) return null/, "with no real description and no management authority, the whole card must be absent")
  assert.doesNotMatch(src, /Our (Under|U\d)|is a key part of|focused on player development/i, "a fabricated team description must never appear")
  const contract = code("packages/contracts/src/team/profile.ts")
  assert.match(contract, /description: string \| null/, "description is read as a real nullable field, never given a placeholder default")
})

test("the season and fixture/win summary come from the canonical seasons register, never a computed cutoff", () => {
  const src = code("packages/contracts/src/team/profile.ts")
  assert.match(src, /from\("seasons"\)/, "the season is read from the canonical register")
  assert.match(src, /eq\("rugby_code", rugbyCode\)/, "the season lookup is scoped to this team's own rugby code -- union and league seasons run separately")
  assert.doesNotMatch(src, /new Date\(\)\.getFullYear\(\)|currentYear|hardcoded/i, "no invented or computed season boundary")
})

test("cover-photo edit authority reuses the existing Team Manage and Club Profile Edit capabilities -- no new capability was invented", () => {
  const src = code("packages/contracts/src/team/profile.ts")
  assert.match(src, /canEditCover: authority\.teamManage \|\| clubAuthority\.profileEdit/, "cover-edit authority must be exactly the existing team.team.manage OR club.profile.edit signal, never a third, newly-invented capability")
})

test("the Staff tab says it is not built yet rather than showing a fabricated or duplicated roster", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /"staff", label: "Staff"/, "the four-tab shell (Overview, Fixtures, Squad, Staff) must be in place for Sections 2-4 to attach to")
  assert.match(src, /tab === "staff"/, "the Staff tab must render something, not silently do nothing")
  assert.doesNotMatch(src, /James Wilson|Head Coach|Sarah Mitchell/i, "no invented staff member ever appears")
})

/**
 * TEAM PROFILE SECTION 1A -- VISUAL CONVERGENCE + TEAM HEADER ACTIONS. The ellipsis menu, Team Photo's
 * honest shell, and Fold Team staying out of that menu.
 */
test("the team ellipsis menu is capability-gated, never a role check, and never exposes Fold Team directly", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /canEditCover && \(/, "Team Photo is offered only where the same cover-edit authority already computed for the screen says yes")
  assert.match(src, /canManageSettings && \(/, "Team Settings is offered only where team.team.manage already says yes")
  assert.doesNotMatch(src, /role\s*===?\s*["'](CLUB_ADMIN|Coach|Team Manager)["']/i, "the menu must not decide from a role label")
  assert.doesNotMatch(src, /Fold Team/, "Fold Team must not be exposed from the Team Profile ellipsis -- it stays inside Team Settings' own danger zone")
})

test("Team Photo shows the team's real current photo and an honest 'coming soon' state, never a working picker that doesn't exist yet", () => {
  const src = code("apps/mobile/src/team/team-photo-screen.tsx")
  assert.match(src, /demoTeamCoverAsset\(identity\)/, "the shown photo is the same real/fallback resolution the Profile hero and Home card already use, never a new one invented for this screen")
  assert.match(src, /coming soon/i, "the screen must say plainly that choosing a new photo isn't built yet")
  assert.doesNotMatch(src, /ImagePicker|launchImageLibraryAsync|expo-image-picker/, "no working picker exists yet -- wiring one here would be exactly the fake functionality the brief forbids")
  assert.match(src, /: !canEdit \? \(/, "an unauthorised direct visit to this route must still refuse on its own account, never trust the menu having hidden the row")
})

test("the Team Profile top bar centres its title independently of what sits on either side", () => {
  const src = code("apps/mobile/src/components/app-header.tsx")
  assert.match(src, /position: "absolute", left: 0, right: 0/, "the title is centred by an absolute overlay across the whole bar, not merely flexed into whatever space the back button and rightAction happen to leave")
})

/**
 * TEAM PROFILE SECTION 1B -- PHYSICAL REVIEW CORRECTIONS + UAT FIXTURE REVIEW DATA. The tab/content
 * layering fix, the governed description editor, and the review-only UAT fixture seed.
 */
test("the forest tab strip has its own dedicated spacer -- the rounded content sheet's negative margin must never overlap the tabs themselves", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const forestOpen = src.indexOf('backgroundColor: surface.forest')
  const tabsRow = src.indexOf("TABS.map(")
  const spacer = src.indexOf('height: radius.xl', tabsRow)
  assert.ok(forestOpen >= 0 && tabsRow > forestOpen, "the tabs must render inside the forest block")
  assert.ok(spacer > tabsRow, "a dedicated spacer view must come AFTER the tabs row, so the sheet's negative margin eats the spacer, never the tabs' own height or touch targets")
})

test("the Team Profile still exposes exactly four canonical tabs, in order, and neither restores pill tabs nor invents a fifth", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const match = src.match(/const TABS: \{ key: Tab; label: string \}\[\] = \[([\s\S]*?)\]/)
  assert.ok(match, "the TABS constant must exist as a single literal array")
  const labels = [...match![1].matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(labels, ["Overview", "Fixtures", "Squad", "Staff"], "the four destinations, in this exact order, are the whole tab strip")
  const tabRow = src.slice(src.indexOf("{TABS.map("), src.indexOf("{TABS.map(") + 800)
  assert.doesNotMatch(tabRow, /pill|Pill/, "pill-shaped tabs must not be restored -- the tab row itself must never reach for the pill radius token")
})

test("'Add Description' opens the focused native description editor, never Team Settings, and an existing description offers Edit instead of Add", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /onEditDescription: \(\) => void/, "OverviewTab must accept a dedicated description-edit callback")
  assert.match(src, /setEditingDescription\(true\)/, "activating description edit must open the sheet, not navigate to Team Settings")
  assert.doesNotMatch(src, /AboutThisTeam[\s\S]{0,120}Team Settings/, "About This Team must never hand off to Team Settings for the description")
  const aboutFn = src.slice(src.indexOf("function AboutThisTeam"))
  assert.match(aboutFn, /!description && canManage && <Button label="Add Description"/, "Add Description only appears once there is genuinely no description yet")
  assert.match(aboutFn, /!!description && canManage[\s\S]{0,300}Edit<\/Text>/, "an existing description must offer Edit, never keep showing Add Description")
})

test("the description editor saves through the governed set_team_description RPC, never a direct client-side table update", () => {
  const editorSrc = code("apps/mobile/src/team/edit-description-sheet.tsx")
  assert.match(editorSrc, /setTeamDescription\(supabase, teamId, text\)/, "the sheet must call the shared contracts helper, not roll its own mutation")
  assert.doesNotMatch(editorSrc, /\.from\("teams"\)\.update/, "no direct client-side update of teams.description is permitted -- authority is enforced server-side only")

  const contractSrc = code("packages/contracts/src/team/profile.ts")
  assert.match(contractSrc, /rpc\("set_team_description"/, "setTeamDescription must call the canonical RPC by name")
  assert.doesNotMatch(contractSrc, /\.from\("teams"\)\.update\(\{[^}]*description/, "the contracts layer itself must not perform an ungoverned direct update either")
})

test("the UAT fixture review data for Team Profile Section 1B lives in a seed file, never a production migration or a hardcoded component fixture", () => {
  const migrationFiles = readdirSync("supabase/migrations")
  assert.ok(
    migrationFiles.every((f) => !f.endsWith("_local_uat_team_profile_review.sql") && f !== "local_uat_team_profile_review.sql"),
    "the review fixture data must never appear as a migration file"
  )
  const seedSrc = code("supabase/seeds/local_uat_team_profile_review.sql")
  assert.match(seedSrc, /local_dev_seed/, "the seed must carry the standard real-dataset guard")
  assert.match(seedSrc, /if not exists/i, "the seed must be idempotent, not a blind insert")

  const screenSrc = code("apps/mobile/src/team/profile-screen.tsx")
  assert.doesNotMatch(screenSrc, /28-12|10-22|Ovalball UAT Opposition RFC/, "no review fixture's data may be hardcoded directly into the screen component")
})

test("the populated Next Fixture card is the same NextFixtureCard the screen already used for a real profile.nextUp, never a second fixture screen or an invented placeholder", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /profile\.nextUp \?[\s\S]{0,40}<NextFixtureCard item=\{profile\.nextUp\}/, "Next Fixture must render straight from profile.nextUp via the shared card, not a bespoke populated-state component")
  assert.match(src, /onPress=\{\(\) => onOpenFixture\(profile\.nextUp!\)\}/, "tapping it must route through the one canonical fixture-open handler, never a duplicate fixture screen")
})

/**
 * TEAM PROFILE SECTION 2 -- FIXTURES. A focused team-scoped Upcoming/Past/All, never the Club Admin
 * fixture agenda re-rendered inside this profile.
 */
test("the Fixtures tab's Upcoming and Past reads reuse the exact same team-only scope loadTeamProfile already built -- never a second, broader query", () => {
  const src = code("packages/contracts/src/team/profile.ts")
  const scopeIndex = src.indexOf('const scope = { kind: "teams"')
  const historyIndex = src.indexOf("loadAgenda(supabase, scope, teamAgendaWindows(todayIso).past")
  assert.ok(scopeIndex >= 0, "the one team-only scope must still be declared")
  assert.ok(historyIndex > scopeIndex, "the new past-fixture read must reuse that same `scope` variable, never construct a second one")
  assert.match(src, /history: history\.items/, "the past window's items must be returned on the profile, not silently dropped")
})

test("Upcoming and Past exclude cancelled fixtures; All keeps them, restrained, in their real date order", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const listsFn = src.slice(src.indexOf("const fixtureLists = useMemo"), src.indexOf("const canOpenFullFixtureList"))
  assert.match(listsFn, /const upcoming = onlyFixtures\(profile\.upcoming\)\.filter\(notCancelled\)/, "Upcoming must filter out Cancelled")
  assert.match(listsFn, /const past = onlyFixtures\(profile\.history\)\.filter\(notCancelled\)/, "Past must filter out Cancelled")
  assert.doesNotMatch(listsFn.slice(listsFn.indexOf("const all =")), /notCancelled/, "All must NOT filter out Cancelled -- it is the one segment that keeps real fixture history intact")
  assert.match(listsFn, /\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/, "All must be in real chronological date order, not left in whatever order the two source reads happened to arrive")
})

test("each Fixtures segment previews at most five rows via the existing pageFixtures helper, never a hand-rolled slice", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function FixturesTab"), src.indexOf("function FixtureSegments"))
  assert.match(fn, /pageFixtures\(lists\[segment\], false\)\.shown/, "the segment's rows must come from pageFixtures with expansion off, capping at its own five-row default")
})

test("'View Full Fixture List' opens the one canonical Fixtures agenda pre-scoped to this team, and only where that agenda's own active-context scoping is already known to cover it", () => {
  const screenSrc = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(screenSrc, /router\.push\(\{ pathname: "\/fixtures", params: \{ teamId \} \}/, "the CTA must route to the canonical /fixtures screen, never a second full-fixtures page")
  const gate = screenSrc.slice(screenSrc.indexOf("const canOpenFullFixtureList"), screenSrc.indexOf("return (\n    <View style={{ flex: 1, backgroundColor: colour.chalk }}>"))
  assert.match(gate, /active\?\.kind === "site_admin"/, "Site Admin's platform-wide scope is a legitimate case")
  assert.match(gate, /active\?\.kind === "team" && active\.id === identity\.id/, "a viewer already standing in this exact team's own context is a legitimate case")
  assert.match(gate, /active\?\.kind === "club" && active\.clubId === identity\.clubId/, "a viewer standing in this team's own club is a legitimate case")

  const fixturesSrc = code("apps/mobile/app/(tabs)/fixtures/index.tsx")
  assert.match(fixturesSrc, /setFilter\(\(f\) => \(\{ \.\.\.f, teamId: params\.teamId \?\? null \}\)\)/, "the incoming teamId must only ever NARROW the existing AgendaFilter.teamId field, never open a second query path")
})

test("the Team Profile fixture row never renders meet time, and shows a real result only where one exists -- never a fabricated score", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const rowFn = src.slice(src.indexOf("function TeamFixtureRow"), src.indexOf("function OverviewTab"))
  assert.doesNotMatch(rowFn, /meetTime/, "meet time is match-day operational detail and must never appear in a fixture list row")
  assert.match(rowFn, /resultOutcome\(item\.result\)/, "the result must come from the canonical resultOutcome helper, never a hand-rolled win/loss guess")
  assert.match(rowFn, />Result pending</, "a past fixture with no recorded result must say so honestly, never show an invented score")
})

test("tapping a Team Profile fixture row routes through the same canonical destination table every other agenda surface uses", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /onOpenFixture=\{open\}/, "FixturesTab must be driven by the screen's one `open` handler (routeForAgendaItem), never a second routing rule")
})

test("the Fixtures tab only ever renders once the profile has loaded -- loading and a genuine read error are never rendered as an empty fixture list", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const problemGuard = src.indexOf("problem ? (")
  const loadingGuard = src.indexOf("!identity || !profile")
  const fixturesTabCall = src.indexOf('tab === "fixtures" && (')
  assert.ok(problemGuard >= 0 && problemGuard < fixturesTabCall, "the error guard must sit before any tab content, including Fixtures")
  assert.ok(loadingGuard >= 0 && loadingGuard < fixturesTabCall, "the loading skeleton guard must sit before any tab content, including Fixtures")
})

test("Fixtures/Squad/Staff collapse to the compact forest header -- Overview keeps the rich photographic hero, never a second route for either state", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /\{tab === "overview" && \(\s*<TeamCoverHero/, "the photographic hero must be Overview-only")
  assert.match(src, /title=\{identity\?\.fullLabel \?\? "Team"\}/, "the pinned bar must carry the team's real name so the compact tabs have an identity to read")
})

/**
 * TEAM PROFILE SECTION 3 -- SQUAD. The legitimate player roster, reusing the same team_people RPC and
 * team.roster.view gate the existing People screen already relies on -- no parallel roster reader, no
 * jersey numbers the canonical schema doesn't carry, and no player photo storage read this build didn't
 * already have authority for.
 */
test("Squad reads through the canonical team_people RPC, scoped to this one team, never a parallel roster query", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  assert.match(fn, /readTeamPeople\(supabase, identity\.id\)/, "Squad must read via the shared readTeamPeople helper, scoped to this team's own id")
  assert.doesNotMatch(fn, /\.from\("player_team_memberships"\)|\.from\("players"\)|\.from\("team_permissions"\)/, "Squad must never read roster rows directly off a table -- team_people is the one authorised reader")
})

test("Squad's restricted state is gated on the real team.roster.view predictor and is never rendered as an empty squad", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  const restrictedIndex = fn.indexOf("!profile.people.rosterVisible || refused")
  const loadingIndex = fn.indexOf("people === null")
  const emptyIndex = fn.indexOf('title="No players yet"')
  assert.ok(restrictedIndex >= 0 && restrictedIndex < loadingIndex, "the restricted check must be decided before the loading skeleton ever renders")
  assert.ok(loadingIndex < emptyIndex, "loading must be checked and returned before the empty-squad state can ever be reached")
  assert.match(fn, /NotForYou title="Squad isn&apos;t part of your view"/, "a denied roster must say so honestly, using the same NotForYou pattern the People screen already uses -- never 'No players yet'")
  assert.match(fn, /e\.code === "42501"/, "the RPC's own refusal must be handled defensively as a second line, even though rosterVisible already predicts it")
})

test("Squad never fabricates a jersey number and never renders contact, DOB or safeguarding detail", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadRow("), src.indexOf("function SquadRowSkeleton"))
  assert.doesNotMatch(fn, /#\d|jersey|squadNumber|shirtNumber/i, "no jersey/squad number field exists on the canonical roster reader -- Squad must not invent one from list order or anywhere else")
  assert.doesNotMatch(fn, /\bemail\b|\bphone\b|dateOfBirth|\bdob\b/i, "team_people carries names only -- no contact or identity detail belongs on a squad row")
})

test("Squad's player avatar is the same honest initials fallback the People screen already uses, never a new storage read", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadRow("), src.indexOf("function SquadRowSkeleton"))
  assert.match(fn, /<PersonAvatar name={person\.name} url={null} size=\{44\} \/>/, "no authorised whole-roster avatar source exists yet -- this must stay the deliberate initials fallback, not a new bucket read")
})

test("Add Player and the row's detail destination are both gated on the viewer already standing in this team's own context, never on club-wide or Site Admin scope", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const gate = src.slice(src.indexOf("const inThisTeamContext"), src.indexOf("return (\n    <View style={{ flex: 1, backgroundColor: colour.chalk }}>"))
  assert.match(gate, /active\?\.kind === "team" && active\.id === identity\.id/, "inThisTeamContext must require the exact team context, since /team/people and /team/settings/* resolve their own team id from it")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  assert.match(fn, /const canAdd = inThisTeamContext && \(profile\.authority\.rosterManage \|\| profile\.authority\.joinCodeManage\)/, "Add Player must require both team context and a real authority -- never shown merely because the profile itself is visible")
  assert.match(fn, /const openPlayer = inThisTeamContext \? /, "the row's own destination must use the identical team-context gate, not a separate or looser one")
})

test("Add Player offers only the two real mobile-reachable ways a squad grows today, each independently capability-gated", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const sheetFn = src.slice(src.indexOf("function AddPlayerSheet"), src.length)
  assert.match(sheetFn, /canManageCodes && \(/, "Join Codes must be its own independent gate")
  assert.match(sheetFn, /canManageRequests && \(/, "Join Requests must be its own independent gate")
  assert.doesNotMatch(sheetFn, /createPlayer|addPlayerDirect|insert_player|new_player_rpc/i, "no new player-creation mutation may be invented for this sheet")
  const squadFn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  assert.match(squadFn, /router\.push\("\/team\/settings\/join-codes" as never\)/, "must route to the canonical Join Codes screen, never a new invitation mechanism")
  assert.match(squadFn, /router\.push\("\/team\/settings\/requests" as never\)/, "must route to the canonical Join Requests screen, never a new membership mutation")
})

test("the Squad heading count is the real rendered roster length, never the separately-computed aggregate", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  assert.match(fn, /const players = people\.players/, "the rendered list must come from the real fetched roster")
  assert.match(fn, /accessibilityLabel={`\$\{players\.length\} players`}/, "the heading count must reconcile with the rendered rows by construction, not by coincidence")
})

test("search is case-insensitive over the already-authorised roster only, and distinguishes zero-match from a genuinely empty squad", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const fn = src.slice(src.indexOf("function SquadTab"), src.indexOf("function SquadRow("))
  assert.match(fn, /query\.trim\(\)\.toLowerCase\(\)/, "the search query must be normalised")
  assert.match(fn, /p\.name\.toLowerCase\(\)\.includes\(q\)/, "search must be case-insensitive name matching over the already-fetched roster, never a second network call")
  assert.match(fn, /title="No players match your search"/, "a genuinely empty squad and a zero-match search must be worded differently")
})
