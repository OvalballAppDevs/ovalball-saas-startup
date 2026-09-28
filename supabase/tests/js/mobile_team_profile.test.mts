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

test("the Staff tab renders the real StaffTab component, never a fabricated or duplicated roster", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /"staff", label: "Staff"/, "the four-tab shell (Overview, Fixtures, Squad, Staff) must be in place")
  assert.match(src, /tab === "staff" && \(\s*<StaffTab/, "the Staff tab must render the real StaffTab component, not a placeholder")
  // "Head Coach" is now legitimate presentational copy (Section 4's own coaching-title feature); the
  // literal mockup names it was never allowed to fabricate stay excluded specifically.
  assert.doesNotMatch(src, /James Wilson|Sarah Mitchell|Mark Thompson|Lisa Carter|Tom Evans/i, "no invented staff member from the Section 4 mockup ever appears verbatim")
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

test("Edit Team Photo is the one canonical cover editor -- take/choose/library, real preview, refuses on its own account", () => {
  const src = code("apps/mobile/src/team/team-photo-screen.tsx")
  assert.match(src, /demoTeamCoverAsset\(identity\)/, "the shown photo falls back to the same real/fallback resolution the Profile hero and Home card already use")
  assert.match(src, /Take Photo/, "must offer Take Photo")
  assert.match(src, /Choose from Library/, "must offer Choose from Library")
  assert.match(src, /Use Ovalball Image Library/, "must offer the Ovalball Image Library, not a vendor-branded label")
  assert.doesNotMatch(src, /Use Higgsfield Image/, "Higgsfield is a production source, never a consumer-facing vendor label (Section 9)")
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

test("the Team Profile now exposes exactly five canonical tabs, in order, and neither restores pill tabs nor invents a sixth", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const match = src.match(/const TABS: \{ key: Tab; label: string \}\[\] = \[([\s\S]*?)\]/)
  assert.ok(match, "the TABS constant must exist as a single literal array")
  const labels = [...match![1].matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(labels, ["Overview", "Fixtures", "Squad", "Staff", "Media"], "Media joins as the fifth destination, in this exact order (Section 5)")
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

/**
 * TEAM PROFILE SECTION 4 -- STAFF. The canonical multi-role reader (team_staff), explicit-team-id
 * management with no synthetic context switch, and the safeguarding-conscious contact/avatar rules.
 */
test("Staff is the fourth Team Profile tab (Media the fifth), with no nested Squad/Staff switch anywhere in the shell", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const match = src.match(/const TABS: \{ key: Tab; label: string \}\[\] = \[([\s\S]*?)\]/)
  const labels = [...match![1].matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(labels, ["Overview", "Fixtures", "Squad", "Staff", "Media"], "Staff is fourth, Media fifth and last")
  assert.match(src, /tab === "staff" && \(\s*<StaffTab/, "the Staff tab must render the real StaffTab component")
})

test("Staff reads through the new team_staff RPC, never the legacy team_people coach branch or a direct table read", () => {
  const src = code("packages/contracts/src/team/staff.ts")
  assert.match(src, /supabase\.rpc\("team_staff", \{ p_team_id: teamId \}\)/, "must call the new canonical multi-role reader")
  assert.doesNotMatch(src, /\.from\("role_assignments"\)|\.from\("team_permissions"\)|\.from\("club_memberships"\)/, "no direct table read may stand in for the RPC")
})

test("Staff never fabricates HEAD_COACH/ASSISTANT_COACH as real role keys -- authority stays exactly COACH", () => {
  const migration = code("supabase/migrations/20270570000000_one_person_many_team_roles.sql")
  assert.doesNotMatch(migration, /insert into public\.role_definitions[\s\S]{0,200}HEAD_COACH|insert into public\.role_definitions[\s\S]{0,200}ASSISTANT_COACH/, "no new role_definitions row may be created for a coaching title")
  assert.match(migration, /attributes = case when p_title is null then attributes - 'staff_title' else jsonb_set\(attributes, '\{staff_title\}', to_jsonb\(p_title\)\)/, "a title must only ever touch attributes.staff_title on an existing role assignment")
  assert.match(migration, /if v_assignment\.role_key <> 'COACH' then/, "the title setter must refuse any role assignment that isn't COACH")
})

test("Safeguarding Officer is never presented as an ordinary team staff role", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.doesNotMatch(src, /SAFEGUARDING_OFFICER/, "Safeguarding Officer is club-scoped and SITE-assignable only (confirmed against the live role_definitions row) -- it has no place in this team-scoped picker")
})

test("Add Staff Member and role management both use this screen's own explicit clubId/teamId, never a switched active-context team", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.doesNotMatch(src, /useTeamAuthority|useAppContexts/, "Staff management must never depend on the viewer's switched active context (Section 26) -- every mutation carries its own explicit team id")
  assert.match(src, /grantTeamStaffRole\(supabase, picked\.membershipId, roleKey, teamId,/, "granting a role must pass this screen's own explicit teamId")
  assert.match(src, /grantTeamStaffRole\(supabase, member\.membershipId, key, teamId,/, "Manage Staff Member's own role toggle must also pass the explicit teamId")
})

test("Add Staff searches existing club people first and never creates a new identity or a second membership model", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(src, /readClubPeople\(supabase, clubId, \{ search: query/, "must search the club's own existing people directory")
  assert.doesNotMatch(src, /createPerson|createProfile|signUp|insert into public\.profiles/i, "no new identity may be created from this sheet -- only existing club people are selectable")
})

test("removing a staff role revokes exactly that one assignment, never the person's membership, player place or guardian link", () => {
  const src = code("packages/contracts/src/team/staff.ts")
  assert.match(src, /rpc\("transition_role_assignment", \{ p_assignment_id: assignmentId, p_to_state: "REVOKED"/, "must revoke by the specific assignment id, never a broader membership action")
  assert.doesNotMatch(src, /delete_membership|remove_guardian|archive_player_team_membership|delete_player/i, "revoking a staff role must never reach for a membership/player/guardian deletion path")
})

test("Add Staff honestly reports partial failure -- it never claims full success when only some of several roles were granted", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(src, /const succeeded: string\[\] = \[\]/, "results must be tracked per role")
  assert.match(src, /const failed: string\[\] = \[\]/, "failures must be tracked separately from successes")
  assert.match(src, /Added \$\{succeeded\.length\} of \$\{newRoles\.length\} roles\./, "a partial result must say exactly how many of how many succeeded, never a bare success message")
})

test("Add Staff Member never mutates straight from the role-selection screen -- a Confirm step sits between selecting roles and granting them", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  const rolesStep = src.slice(src.indexOf('step === "roles" && picked'), src.indexOf('step === "confirm" && picked'))
  assert.match(rolesStep, /label="Continue" onPress=\{\(\) => setStep\("confirm"\)\}/, "the role-selection screen's own button must only advance to Confirm, never call submit directly")
  assert.doesNotMatch(rolesStep, /onPress=\{submit\}/, "submit must not be reachable from the role-selection screen")
  const confirmStep = src.slice(src.indexOf('step === "confirm" && picked'))
  assert.match(confirmStep, /label="Confirm and Add" onPress=\{submit\}/, "only the Confirm screen's own primary action may call submit")
})

test("Manage Staff Member stages role changes locally and applies them behind one Save Changes, never firing a mutation the instant a checkbox is tapped", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  const toggleFn = src.slice(src.indexOf("function toggle(key: string) {"), src.indexOf("async function save()"))
  assert.doesNotMatch(toggleFn, /grantTeamStaffRole|revokeTeamStaffRole|setCoachTitle/, "toggling a role checkbox must only update local staged state, never call a mutation RPC directly")
  assert.match(src, /label="Save Changes" onPress=\{save\} busy=\{busy\} disabled=\{!hasChanges\}/, "Save Changes must be the one action that applies the staged diff, and must be disabled when nothing changed")
})

test("Manage Staff Member's Save Changes only grants/revokes the roles that actually changed, leaving every unchanged role alone", () => {
  const saveFn = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(saveFn, /const toGrant = \[\.\.\.selected\]\.filter\(\(k\) => !currentKeys\.has\(k\)\)/, "only newly-selected roles may be granted")
  assert.match(saveFn, /const toRevoke = member\.roles\.filter\(\(r\) => !selected\.has\(r\.roleKey\)\)/, "only deselected roles may be revoked -- every role still selected is left untouched")
})

test("Add Staff Member and Manage Staff Member share the exact same role catalogue and selector component, never two role vocabularies", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  const selectorDefinitions = [...src.matchAll(/function RoleSelector\(/g)]
  assert.equal(selectorDefinitions.length, 1, "there must be exactly one RoleSelector component")
  const selectorUses = [...src.matchAll(/<RoleSelector /g)]
  assert.equal(selectorUses.length, 2, "both Add Staff Member and Manage Staff Member must render the same RoleSelector")
})

test("Team Safeguarding Lead is offered as a grantable team role, ordered after First Aider, and never inherits club Safeguarding Officer authority", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(src, /GRANTABLE_ROLES: \(typeof TEAM_STAFF_ROLE_KEYS\)\[number\]\[\] = \["TEAM_MANAGER", "COACH", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD"\]/, "Team Safeguarding Lead must be offered, in the owner's own suggested order")
  const migration = code("supabase/migrations/20270571000000_a_team_names_its_own_safeguarding_contact.sql")
  assert.match(migration, /'TEAM_SAFEGUARDING_LEAD', 'TEAM', 'Team Safeguarding Lead', 'VO'/, "Team Safeguarding Lead must reuse the same view-only VO bundle First Aider already reuses, never the club officer's SO bundle")
  assert.doesNotMatch(migration, /'SO'/, "this role must never reference the club Safeguarding Officer's own bundle")
})

test("the Confirm screen never duplicates BottomSheet's own built-in Cancel button", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  const confirmStep = src.slice(src.indexOf('step === "confirm" && picked'))
  assert.doesNotMatch(confirmStep, /label="Cancel"/, "BottomSheet already renders its own Cancel button after children -- a second one here would show two Cancel buttons stacked on the Confirm screen (found live, by physical review)")
})

test("Add Staff Member's Invite a New Staff Member path is honest about the missing invitation architecture, never a decorative QR code", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(src, /Select from Club People/, "the existing-person path must be offered")
  assert.match(src, /Invite a New Staff Member/, "the invite path must be offered as an option, per the approved mockup")
  assert.doesNotMatch(src, /QrCode|Share QR Code|Share Invite Code/, "no QR code or invite code UI may be built until a real TEAM_STAFF invitation kind exists server-side -- this pass reports the gap rather than faking it")
})

test("Staff carries no contact action at all -- no messaging route and no phone number, honouring the existing 'no messaging route from a team entity' lock (team_operations_ca7.test.mts) over Section 29's own request", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.doesNotMatch(src, /open_direct_conversation|openConversationWith|my_direct_message_candidates|loadRecipients/, "no direct-conversation primitive may appear anywhere under apps/mobile/src/team/ -- a pre-existing, owner-locked architectural rule this section's own brief did not know about")
  assert.doesNotMatch(src, /\.phone\b|phoneNumber|Linking\.openURL\(`tel:/i, "no phone number or tel: action is exposed -- Section 7's own conservative default")
})

test("the Staff row's avatar is a real signed personal picture where the bucket admits it, falling back to initials -- never a club crest, kit or generated portrait", () => {
  const staffTs = code("packages/contracts/src/team/staff.ts")
  assert.match(staffTs, /resolvePersonalAvatarUrls\(supabase, rows\.map\(\(r\) => r\.avatar_storage_path\)\)/, "must resolve real profiles.avatar_storage_path pictures via the canonical signed-URL resolver")
  const tabTsx = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(tabTsx, /<PersonAvatar name={member\.displayName} url={member\.avatarUrl} size=\{52\} \/>/, "the row must pass the resolved URL through, with PersonAvatar's own initials fallback for anyone it resolves to null")
})

test("Staff's restricted state is worded distinctly from empty, and loading never flashes zero staff", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  const restrictedIndex = src.indexOf("!rosterVisible || refused")
  const loadingIndex = src.indexOf("staff === null")
  const emptyIndex = src.indexOf('title="No staff added yet"')
  assert.ok(restrictedIndex >= 0 && restrictedIndex < loadingIndex && loadingIndex < emptyIndex, "restricted must be decided before loading, and loading before the empty state can ever render")
  assert.match(src, /NotForYou title="Staff isn&apos;t part of your view"/, "a denied staff roster must say so honestly, never 'No staff added yet'")
})

test("the open Manage Staff Member sheet re-syncs to the freshly reloaded roster after every change, never keeps showing a stale role snapshot", () => {
  const src = code("apps/mobile/src/team/staff-tab.tsx")
  assert.match(src, /setManaging\(staff\.find\(\(m\) => m\.membershipId === managing\.membershipId\) \?\? null\)/, "the currently-open Manage sheet must be replaced with the matching person from the freshly reloaded staff array (or closed if their last role is gone), never left showing what the roles looked like before the change")
})

/**
 * TEAM PROFILE SECTION 5 -- MEDIA (Team Gallery + Ovalball Image Library + the one canonical cover
 * editor). See the migration's own safeguarding note (20270572000000) for the audited finding that
 * Ovalball has no per-child media-publication-consent primitive -- these tests hold the mitigation
 * that was actually built: private-bucket signed URLs, no face/person tagging, no fabricated stock
 * history, and the exact same authority the Profile screen already computes for cover editing.
 */

test("Media renders the real MediaTab component as the fifth tab, never a placeholder", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /tab === "media" && \(\s*<MediaTab/, "the Media tab must render the real MediaTab component")
  assert.match(src, /canManage={profile\.canEditCover}/, "Media management authority must reuse canEditCover, never a new capability")
})

test("Team Gallery reads through the private, signed-URL team-gallery-media bucket, never a public URL", () => {
  const src = code("packages/contracts/src/team/media.ts")
  assert.match(src, /createSignedUrls\(rows\.map/, "gallery photos must be resolved as short-lived signed URLs")
  assert.doesNotMatch(src, /getPublicUrl[\s\S]*team-gallery-media|team-gallery-media[\s\S]*getPublicUrl/, "the gallery bucket must never be read through a public URL")
})

test("the Team Gallery migration puts youth-safeguarding-relevant media in a PRIVATE bucket, and documents the consent-model gap rather than inventing one", () => {
  const migration = code("supabase/migrations/20270572000000_a_team_keeps_its_own_photographs.sql")
  assert.match(migration, /'team-gallery-media', 'team-gallery-media', false,/, "the gallery bucket must be created private (public: false)")
  assert.match(migration, /SAFEGUARDING FINDING/, "the migration must document the guardian-consent audit finding, not silently skip it")
  assert.doesNotMatch(migration, /face_api|detectFaces|ml_kit|vision\.faces|person_tag|face_recognition/i, "no face-recognition or auto-tagging API call may be introduced")
})

test("Media management reuses exactly the Profile screen's own cover authority -- no team.media.view/team.media.manage capability was invented", () => {
  const migration = code("supabase/migrations/20270572000000_a_team_keeps_its_own_photographs.sql")
  assert.doesNotMatch(migration, /has_capability\('team\.media\.(view|manage)'/, "no new media-specific capability key may be checked -- team.team.manage/club.profile.edit already express this")
  assert.match(migration, /internal\.has_capability\('team\.team\.manage', 'team'/, "writes must reuse team.team.manage")
  assert.match(migration, /internal\.has_capability\('club\.profile\.edit', 'club'/, "writes must reuse club.profile.edit")
})

test("a stock cover selection is validated server-side against a fixed allow-list, never trusted from the client", () => {
  const migration = code("supabase/migrations/20270572000000_a_team_keeps_its_own_photographs.sql")
  assert.match(migration, /if p_stock_key is not null and not \(p_stock_key = any\(array\[/, "set_team_cover must refuse any stock key outside its own server-side allow-list")
})

test("the gallery preview shows at most six photos and only offers Show All once there are more", () => {
  const src = code("apps/mobile/src/team/media-tab.tsx")
  assert.match(src, /readTeamMedia\(supabase, identity\.id, 6\)/, "the tab's own preview read must be capped at six")
  assert.match(src, /media\.length > 6 &&/, "Show all must only render once there are more than six photos")
})

test("an empty Team Gallery is shown honestly -- never padded out with Ovalball Image Library stock pretending to be this team's own history", () => {
  const src = code("apps/mobile/src/team/media-tab.tsx")
  assert.match(src, /title="Build your team gallery"/, "an empty gallery must say so honestly")
  assert.doesNotMatch(src, /STOCK_COVER_CATALOGUE|stockCoversForCategory/, "the Media tab's own gallery preview must never reach into the stock catalogue")
})

test("Media's restricted state is worded distinctly from empty, matching the same pattern Staff already established", () => {
  const src = code("apps/mobile/src/team/media-tab.tsx")
  const restrictedIndex = src.indexOf("!rosterVisible || refused")
  const emptyIndex = src.indexOf('title="Build your team gallery"')
  assert.ok(restrictedIndex >= 0 && restrictedIndex < emptyIndex, "restricted must be decided before an empty gallery can ever render")
  assert.match(src, /NotForYou title="Photos aren&apos;t part of your view"/, "a denied gallery must say so honestly, never 'Build your team gallery'")
})

test("Edit Team Photo and Media's own Edit Cover Photo button converge on the exact same route -- one canonical cover editor, not two", () => {
  const tabSrc = code("apps/mobile/src/team/media-tab.tsx")
  const menuSrc = code("apps/mobile/src/team/profile-screen.tsx")
  const route = /pathname: "\/teams\/\[teamId\]\/photo", params: \{ teamId: identity\.id \}/
  assert.match(tabSrc, route, "Media's Edit Cover Photo button must route to the one canonical /teams/[teamId]/photo destination")
  assert.match(menuSrc, /onTeamPhoto=\{\(\) => \{ setMenuOpen\(false\); router\.push\(\{ pathname: "\/teams\/\[teamId\]\/photo"/, "the ellipsis menu's Team Photo action must route to the exact same destination")
})

test("the Ovalball Image Library's stock catalogue uses stable canonical keys, never array position, and the server allow-list matches it key for key", () => {
  const lib = code("apps/mobile/src/team/cover-library.ts")
  const keys = [...lib.matchAll(/key: "([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.ok(keys.length >= 8, "the catalogue should carry a genuine library, not a token entry")
  assert.equal(new Set(keys).size, keys.length, "every catalogue key must be unique")
  const migration = code("supabase/migrations/20270572000000_a_team_keeps_its_own_photographs.sql")
  for (const key of keys) {
    assert.match(migration, new RegExp(`'${key}'`), `server allow-list must include catalogue key ${key}`)
  }
})

test("stock cover imagery is built only from existing bundled assets -- no new image generation call in this pass", () => {
  const lib = code("apps/mobile/src/team/cover-library.ts")
  assert.doesNotMatch(lib, /generate_image|higgsfield|Higgsfield/i, "no image-generation call may appear in the stock catalogue module -- every asset must already be bundled")
  assert.match(lib, /require\("\.\.\/\.\.\/assets\//, "every catalogue entry must resolve to an already-bundled local asset")
})

test("a read-only Media viewer sees the cover and gallery but never Edit Cover Photo, Add Photos or any management control", () => {
  const tabSrc = code("apps/mobile/src/team/media-tab.tsx")
  assert.match(tabSrc, /canManage && \(/, "the Edit Cover Photo floating action must be gated on canManage")
  assert.match(tabSrc, /canManage && \(\s*<Button\s*\n\s*label="Add Photos"/, "Add Photos must be gated on canManage")
  const gallerySrc = code("apps/mobile/src/team/team-gallery-screen.tsx")
  assert.match(gallerySrc, /canManage && <Button label="Add Photos"/, "the full Team Gallery's own Add Photos must also be gated on canManage")
  assert.match(gallerySrc, /onManage=\{canManage \? \(index\) => setManageId\(media\[index\]\.id\) : undefined\}/, "the photo-management overflow action must only be offered to PhotoViewer for an authorised manager")
})

test("adding or removing a Team Gallery photo goes through the governed add_team_media/remove_team_media RPCs, never a direct table write", () => {
  const src = code("packages/contracts/src/team/media.ts")
  assert.match(src, /supabase\.rpc\("add_team_media"/, "adding a photo must call the canonical RPC")
  assert.match(src, /supabase\.rpc\("remove_team_media"/, "removing a photo must call the canonical RPC")
  assert.doesNotMatch(src, /\.from\("team_media"\)\.(insert|update|delete)/, "no direct client write to team_media may stand in for the RPCs")
})

test("the Team Gallery/cover upload path id never depends on globalThis.crypto -- found live, that Hermes has no crypto.randomUUID polyfill here", () => {
  const src = code("packages/contracts/src/team/media.ts")
  assert.doesNotMatch(src, /globalThis\.crypto|crypto\.randomUUID/, "no upload path may depend on a crypto API this runtime doesn't actually provide")
  assert.match(src, /Math\.random\(\)/, "the path id must be generated without a platform crypto dependency, matching the shared package's own constraint")
})

test("the photo viewer's manage overflow renders inside PhotoViewer's own Modal, never as a sibling that would sit behind it", () => {
  const src = code("apps/mobile/src/team/media-tab.tsx")
  const viewerFn = src.slice(src.indexOf("export function PhotoViewer"))
  assert.match(viewerFn, /onManage && \(/, "PhotoViewer must render its own manage affordance when offered one, inside its Modal")
  const gallerySrc = code("apps/mobile/src/team/team-gallery-screen.tsx")
  assert.match(gallerySrc, /onManage=\{canManage \? \(index\) => setManageId\(media\[index\]\.id\) : undefined\}/, "the full gallery screen must pass management through PhotoViewer's own prop, never render a second absolutely-positioned control outside the Modal")
})

test("PhotoViewer and ManagePhotoSheet are never mounted at once -- two stacked Modals don't present correctly on iOS", () => {
  const src = code("apps/mobile/src/team/team-gallery-screen.tsx")
  assert.match(src, /viewerIndex !== null && media && !managing && \(/, "the viewer must unmount before the Manage sheet's own Modal opens, found live as a silently-broken tap otherwise")
})

/**
 * TEAM PROFILE SECTION 6 -- TEAM DETAILS. Read-only presentation of the team's identity fields with
 * exactly one governed edit (Description). Name/Age Grade/Gender/Season are Category C by audit --
 * see team-details-screen.tsx's own header comment for the full reasoning per field.
 */

test("Team Details is the one canonical route, reached from the ellipsis menu and from Overview's own Team Details row", () => {
  const profileSrc = code("apps/mobile/src/team/profile-screen.tsx")
  const matches = [...profileSrc.matchAll(/pathname: "\/teams\/\[teamId\]\/details"/g)]
  assert.equal(matches.length, 2, "exactly two entry points must route to /teams/[teamId]/details -- the ellipsis menu and Overview's own row, never a third or a duplicate destination")
  const routeSrc = code("apps/mobile/app/(tabs)/teams/[teamId]/details.tsx")
  assert.match(routeSrc, /TeamDetailsScreen/, "the route must render the real TeamDetailsScreen component")
})

test("Team Name, Age Grade, Gender and Season are read-only -- no chevron, no tap handler, no mutation RPC anywhere in Team Details", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.doesNotMatch(src, /ChevronRight/, "a read-only row must never carry a chevron implying it can be tapped")
  assert.doesNotMatch(src, /set_team_name|set_team_category|set_team_age_group|set_team_gender|set_team_season/i, "no mutation RPC may exist for name, age grade, gender or season -- all four are Category C by this section's own audit")
  assert.match(src, /function DetailRow\(\{ label, value, first \}/, "the read-only row component must take only label/value, never an onPress")
})

test("Team Details never performs a direct client-side update on the teams table", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.doesNotMatch(src, /\.from\("teams"\)\.(update|upsert)/, "no direct table write may stand in for a governed RPC")
})

test("Description is the one genuinely editable field, reusing the exact governed set_team_description RPC and the existing EditDescriptionSheet -- no second write path", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.match(src, /import \{ EditDescriptionSheet \} from "\.\/edit-description-sheet"/, "must reuse the existing sheet component, never a second description editor")
  assert.doesNotMatch(src, /setTeamDescription|set_team_description/, "the screen itself must never call the RPC directly -- EditDescriptionSheet already owns that call")
})

test("edit affordances on Team Details are gated on exactly canEditCover -- the same authority Overview's own About This Team card already uses", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.match(src, /const canManage = profile\?\.canEditCover \?\? false/, "Team Details must reuse the exact same authority signal, never derive a new one")
  assert.match(src, /!!identity\.description && canManage &&/, "the Edit action must be gated on canManage")
  assert.match(src, /!identity\.description && canManage &&/, "the Add Description action must be gated on canManage")
})

test("Team Name reuses the canonical fullLabel -- Overview and Team Details can never disagree on what a team is called", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.match(src, /identity\.fullLabel/, "Team Name must read the same canonical fullLabel Overview's own hero already renders, never a second naming computation")
})

test("Age Grade and Gender humanise the same canonical vocabulary Overview's own meta line already uses, and never invent a value the underlying field doesn't have", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.match(src, /"mens":\s*\n\s*return "Men"/, "gender vocabulary must match Overview's own teamMetaLine mapping")
  assert.match(src, /return "Not set"/, "an absent field must render as an honest 'Not set', never a fabricated value")
})

test("Season is read from the canonical current-season register, never a field the team itself owns -- teams has no season_id to edit", () => {
  const src = code("apps/mobile/src/team/team-details-screen.tsx")
  assert.match(src, /profile\.season\?\.label \?\? "Not set"/, "Season must read the exact same TeamProfile.season Overview's own summary already resolves")
})

test("the ellipsis menu's Team Details row is offered whenever the menu itself is available, and Fold Team is never duplicated into it", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  const menuFn = src.slice(src.indexOf("function TeamMenuSheet"))
  assert.match(menuFn, /accessibilityLabel="Team Details\. Name, age grade, gender, season and description"/, "the ellipsis menu must offer Team Details")
  assert.doesNotMatch(menuFn, /Fold Team/, "Fold Team must stay inside Team Settings' own danger zone, never surfaced in this quick menu")
})
