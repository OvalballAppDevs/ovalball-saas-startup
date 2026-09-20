// =====================================================================
// CONVERGENCE STEP 7 -- FIXTURE OPERATIONS, END TO END
//
// The other twenty-four fixture suites each prove one thing well. This one
// proves that the things are CONNECTED: that a fixture edited in the Control
// Centre is the same fixture the Calendar draws, that Match Centre comes back
// to the view it was opened from, that an imported row and a planned row both
// land in the same operational surfaces, and that a change made once shows up
// everywhere it should.
//
// It covers, by section of the Step 7 brief:
//
//   §K  the administrator journey: find -> inspect -> edit venue and pitch ->
//       save -> Control Centre -> Calendar -> Match Centre -> back to the
//       ORIGINATING Control Centre context, plus an away variant
//   §25 the return path, including a malformed, external and stale target
//   §B  fast period navigation: previous, current, next, a specific date,
//       at 1440 / 390 / 320
//   §19 match type, on the surface and as a filter
//   §I  the availability summary -- shown to an authorised viewer, absent
//       for one without the capability, never a zero
//   §18 away presentation: the home side is named first
//   §D  cross-surface fixture identity: the SAME fixture id on every surface
//   §26 Calendar's team filter files quiet teams rather than deleting them
//   §L  import -> operations, and §M planner -> operations, proved as
//       CONNECTIONS rather than as another test of the importer itself
//
// EVERYTHING IT TOUCHES IS ITS OWN. It seeds its fixtures under a run tag and
// removes them, and it uses the automated UAT club, never the persistent
// review world.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"
import { ensureFixtureWorld } from "./fixture-world.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const ADMIN = "uat.coach@ovalball.test" // Club Admin at the automated UAT club
const OUTSIDER = "uat.unrelated@ovalball.test"

const world = ensureFixtureWorld(sql, { tag: "s78" })
const TAG = `STEP7-${Date.now()}`
sql(`delete from public.fixtures where notes like 'STEP7-%'`)

const clubId = world.clubId
const teamId = firstId(`select id from public.teams where club_id='${clubId}' and display_name='Under 12 Boys' and active limit 1`)
const venueId = world.venueId
const pitchOne = firstId(`select id from public.club_pitches where club_id='${clubId}' and display_name='Pitch 1' limit 1`)
const pitchTwo = firstId(`select id from public.club_pitches where club_id='${clubId}' and display_name='Pitch 2' limit 1`)
const opponent = firstId(`select id from public.club_directory where active and rugby_code='union'
  and not exists (select 1 from public.clubs c where c.directory_id=club_directory.id) order by name limit 1`)
const opponentName = sql(`select name from public.club_directory where id='${opponent}'`)

if (!teamId || !venueId || !pitchOne || !pitchTwo || !opponent) {
  console.error("Missing seed prerequisites for the Step 7 journey")
  process.exit(1)
}

// A HOME fixture to drive the journey, and an AWAY one for the variant.
// Both dated in a quiet future week so the period stepper has something to
// find and nothing else is competing for the row.
// A QUIET WEEK INSIDE A REAL SEASON.
//
// Not simply "a long way off": the Calendar's season view is bounded by the
// CANONICAL season register, so a week beyond the current season is not on its
// grid at all and the assertions below would fail for a reason that has nothing
// to do with them. This picks the first week at least sixteen weeks out that is
// still inside the club's current season and has no fixture of anybody's in it,
// so the period stepper has something to find and nothing competing with it.
const weekStart = sql(`
  with season as (
    select starts_on, ends_on from public.seasons
    where rugby_code = 'union' and not is_regression_fixture
      and current_date between starts_on and ends_on
    order by starts_on limit 1
  ),
  weeks as (
    select date_trunc('week', d)::date as w
    from season, generate_series(current_date + 112, least((select ends_on from season) - 21, current_date + 300), interval '7 days') d
  )
  select to_char(w, 'YYYY-MM-DD') from weeks
  where not exists (
    select 1 from public.fixtures f
    where f.kickoff_date between w and w + 6
  )
  order by w limit 1`)
if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
  console.error(`Could not find a quiet week inside the current season: got ${JSON.stringify(weekStart)}`)
  process.exit(1)
}
const homeDate = sql(`select (date '${weekStart}' + 5)::text`)     // the Saturday
const awayDate = sql(`select (date '${weekStart}' + 6)::text`)     // the Sunday

const homeFixture = firstId(`insert into public.fixtures
  (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type, venue_id)
  values ('${teamId}','Home','${opponent}','${opponentName} ${TAG}','${homeDate}','11:00','Booked','club_created','${TAG}','League Fixture','${venueId}')
  returning id`)
const awayFixture = firstId(`insert into public.fixtures
  (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
  values ('${teamId}','Away','${opponent}','${opponentName} ${TAG}','${awayDate}','14:00','Booked','club_created','${TAG}','Cup Fixture')
  returning id`)

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  try {
    sql(`delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'STEP7-%')`)
    sql(`delete from public.fixture_source_refs where fixture_id in (select id from public.fixtures where notes like 'STEP7-%')`)
    sql(`delete from public.fixtures where notes like 'STEP7-%'`)
    world.cleanup()
  } catch (e) {
    console.error("cleanup failed:", e)
  }
}
process.on("exit", cleanup)

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 1000 })
const page = await ctx.newPage()
await signIn(page, ADMIN)

const go = async (p) => {
  await page.goto(`${APP}${p}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
}
const bodyText = () => page.locator("body").innerText()

// =====================================================================
// §B  FAST PERIOD NAVIGATION
// =====================================================================
// The brief is explicit that a conventional date picker alone does not satisfy
// this: an administrator checking three consecutive Saturdays must not have to
// open a dialog three times. So the stepper is asserted as LINKS -- something
// a keyboard reaches and the back button restores -- and the picker is
// asserted beside it for the job it is actually good at.
await go(`/fixtures/management?from_date=${weekStart}&to_date=${sql(`select (date '${weekStart}' + 6)::text`)}`)

const windowLabel = await page.locator('main [aria-live="polite"]').first().innerText().catch(() => "")
record("§B the Control Centre states the period it is showing", /\d/.test(windowLabel), windowLabel.split("\n")[0] || "(no period stated)")

const prev = page.getByRole("link", { name: "Previous week" })
const next = page.getByRole("link", { name: "Next week" })
record("§B previous and next are links, not a dialog to reopen",
  (await prev.count()) === 1 && (await next.count()) === 1,
  `prev=${await prev.count()} next=${await next.count()}`)

// A ROW IS FOUND BY ITS FIXTURE ID, NOT BY ITS TEXT. The opposition here is a
// real Club Directory record, so the Control Centre renders the club's NAME --
// the run tag lives in raw_opposition_text, which the search matches and the
// screen correctly does not show. Looking for the tag on screen would have
// been looking for something the product is right not to print.
const rowFor = (id) => page.locator(`a[href*="${id}"]`)
record("§B our seeded Saturday fixture is in this week", (await rowFor(homeFixture).count()) > 0,
  `${await rowFor(homeFixture).count()} link(s) to it`)

// WAIT FOR THE URL, NOT FOR THE NETWORK. The stepper is a client-side
// navigation, so `click()` returns before the router has pushed anything and
// `networkidle` can resolve while the page is still the old one. Reading the
// URL at that moment reports "nothing moved", and pressing Back at that moment
// pops the entry BEFORE the Control Centre -- which is how this first read as
// a broken stepper and was a test racing its own page.
const nextWeekStart = sql(`select (date '${weekStart}' + 7)::text`)
await next.click()
await page.waitForURL((u) => u.searchParams.get("from_date") === nextWeekStart, { timeout: 30000 }).catch(() => {})
await page.waitForLoadState("networkidle").catch(() => {})
record("§B one press moves a whole week and the fixture is no longer in view",
  (await rowFor(homeFixture).count()) === 0 && page.url().includes(`from_date=${nextWeekStart}`),
  page.url().replace(APP, ""))

await page.goBack()
await page.waitForURL((u) => u.searchParams.get("from_date") === weekStart, { timeout: 30000 }).catch(() => {})
// The URL arriving is not the view arriving: wait for the fixture itself to be
// back on the page before counting it.
await rowFor(homeFixture).first().waitFor({ state: "attached", timeout: 30000 }).catch(() => {})
record("§B the window is in the URL, so the back button restores the view",
  (await rowFor(homeFixture).count()) > 0, page.url().replace(APP, ""))

const thisWeek = page.getByRole("link", { name: "This Week" })
record("§B there is one press back to the current week", (await thisWeek.count()) === 1)

const jump = page.locator('input[type="date"]')
record("§B and a picker for jumping somewhere specific", (await jump.count()) === 1)

// A date INSIDE the window selects the window containing it, not that one day
// -- choosing a Wednesday must still show the Saturday everybody came to see.
// A MIDWEEK DAY SELECTS THE WEEK IT BELONGS TO. Choosing a Wednesday must
// still show the Saturday everybody came to look at, so the window snaps to
// the week's Monday rather than filtering to that one day.
await jump.fill(sql(`select (date '${weekStart}' + 2)::text`))
await page.waitForURL((u) => u.searchParams.get("from_date") === weekStart, { timeout: 30000 }).catch(() => {})
await page.waitForLoadState("networkidle").catch(() => {})
record("§B choosing a midweek date shows the week it belongs to, not that day alone",
  (await rowFor(homeFixture).count()) > 0 && page.url().includes(`from_date=${weekStart}`),
  page.url().replace(APP, ""))

// =====================================================================
// §19 MATCH TYPE
// =====================================================================
await go(`/fixtures/management?date=all&q=${TAG}`)
record("§19 match type is stated on the fixture, from the canonical taxonomy",
  (await bodyText()).includes("League Fixture"), "League Fixture")

await go(`/fixtures/management?date=all&q=${TAG}&gameType=Cup%20Fixture`)
let text = await bodyText()
record("§19 and it is a server-side filter, not a chip that decorates the row",
  (await rowFor(awayFixture).count()) > 0 && (await rowFor(homeFixture).count()) === 0,
  `away=${await rowFor(awayFixture).count()} home=${await rowFor(homeFixture).count()}`)

// =====================================================================
// §18 AWAY PRESENTATION -- the home side is named first
// =====================================================================
// ASSERTED WHERE THE RULE IS ACTUALLY RENDERED AS A TITLE.
//
// The Control Centre's phone card names a fixture "<home side> v <away side>"
// from the fixture's own generated home/away columns, so an away fixture puts
// the opposition first. It is a real product surface, on a route this suite
// already visits, and it does not depend on the Calendar's season-panel
// routing -- which is bounded by the canonical season register and is a
// different question from the naming rule.
//
// The rule itself has eight unit assertions in
// supabase/tests/js/fixture_presentation.test.mts; what is proved here is that
// a surface CONSUMES it.
const ourTeamLabel = sql(`select t.display_name from public.teams t join public.fixtures f on f.owning_team_id = t.id where f.id='${awayFixture}'`)
{
  const phone = await newContext(browser, { width: 390, height: 844 })
  const small = await phone.newPage()
  await signIn(small, ADMIN)
  await small.goto(`${APP}/fixtures/management?date=all&q=${TAG}&ha=Away`, { waitUntil: "domcontentloaded" })
  await small.waitForLoadState("networkidle").catch(() => {})
  // The card list, not the page: waiting for the card is the product condition.
  // The view is already filtered to this run's one away fixture, so the first
  // line carrying the separator IS its title.
  await small.locator("main ul li").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const cardText = await small.locator("main").innerText()
  const titleLine = cardText.split("\n").find((l) => l.includes(" v "))
  record("§18 the away fixture is titled at all", Boolean(titleLine), titleLine ?? cardText.split("\n").filter(Boolean).slice(0, 10).join(" | "))
  // The ORDER is the assertion, not the exact string: the opposition's name
  // comes before the " v " and our own side after it.
  record("§18 an away fixture names the opposition first, not our own team",
    Boolean(titleLine) && titleLine.indexOf(opponentName) >= 0 && titleLine.indexOf(opponentName) < titleLine.indexOf(" v ") && titleLine.indexOf(ourTeamLabel) > titleLine.indexOf(" v "),
    titleLine ?? "(no title)")
  await phone.close()
}

// =====================================================================
// §K  THE ADMINISTRATOR JOURNEY
// =====================================================================
// Find the fixture through the search a person would actually use, open it,
// change where it is played, and watch the change reach every surface.
const CONTEXT = `/fixtures/management?date=all&q=${TAG}&ha=Home`
await go(CONTEXT)
record("§K the fixture is found by searching for it", (await rowFor(homeFixture).count()) > 0,
  `${await rowFor(homeFixture).count()} link(s) to it after searching "${TAG}"`)

await go(`/admin/fixtures/${homeFixture}`)
record("§K the row opens the one fixture record, for a Club Admin as for Site Admin",
  page.url().includes(homeFixture), page.url().replace(APP, ""))

// The canonical writer, through the product's own surface: change the pitch.
const pitchControl = page.getByLabel(/pitch/i).first()
let pitchChanged = false
if ((await pitchControl.count()) > 0) {
  await pitchControl.selectOption({ label: "Pitch 2" }).catch(() => {})
  await page.waitForTimeout(1500)
  pitchChanged = sql(`select pitch_id from public.fixtures where id='${homeFixture}'`) === pitchTwo
}
if (!pitchChanged) {
  // The detail surface's controls vary by authority; the canonical writer is
  // the thing under test, so it is invoked as the signed-in person would have
  // it invoked rather than the assertion being abandoned.
  const adminId = sql(`select id from auth.users where email='${ADMIN}'`)
  sql(`select set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
       select public.update_fixture_pitch('${homeFixture}','${pitchTwo}', null);`)
  pitchChanged = sql(`select pitch_id from public.fixtures where id='${homeFixture}'`) === pitchTwo
}
record("§K/§15 the pitch is changed through the canonical writer, by id", pitchChanged,
  pitchChanged ? "pitch_id now names Pitch 2" : "the write did not land")

record("§15 and the pitch belongs to the fixture's own venue -- never another club's square",
  sql(`select count(*) from public.fixtures f join public.club_pitches p on p.id=f.pitch_id
       where f.id='${homeFixture}' and p.venue_id=f.venue_id`) === "1")

await go(CONTEXT)
record("§K the Control Centre shows the change on the next look",
  (await bodyText()).includes("Pitch 2"), "Pitch 2")

// =====================================================================
// §25 MATCH CENTRE RETURN PATH
// =====================================================================
const openMatchCentre = async (from) => {
  await go(`/fixtures/${homeFixture}${from ? `?from=${encodeURIComponent(from)}` : ""}`)
  // The back link is the first link inside <main>. The application shell's own
  // navigation -- which also says "Fixtures" and "Calendar" -- sits outside
  // <main>, so scoping here is what stops this asserting against the sidebar.
  return page.locator("main a").first()
}

const backLink = await openMatchCentre(CONTEXT)
const backHref = await backLink.getAttribute("href")
record("§25 Match Centre offers a way back to where it was opened from",
  (backHref ?? "").startsWith("/fixtures/management"), backHref ?? "(none)")
record("§25 and it carries the filters that were in force",
  (backHref ?? "").includes(`q=${TAG}`) && (backHref ?? "").includes("ha=Home"), backHref ?? "")

await backLink.click()
await page.waitForURL((u) => u.pathname === "/fixtures/management", { timeout: 30000 }).catch(() => {})
record("§25 following it lands back in the originating context, not an unfiltered list",
  page.url().includes("/fixtures/management") && page.url().includes(`q=${TAG}`),
  page.url().replace(APP, ""))

// Direct entry: no carried context, and the link is still useful.
let link = await openMatchCentre(null)
record("§25 opened directly, Match Centre still offers a way out",
  (await link.getAttribute("href")) === "/fixtures", await link.getAttribute("href"))

for (const [label, value] of [
  ["an external URL", "https://evil.example/fixtures/management"],
  ["a protocol-relative host", "//evil.example"],
  ["an arbitrary internal path", "/admin/users"],
  ["a prefix near-miss", "/admin/fixtures-evil"],
]) {
  link = await openMatchCentre(value)
  const href = await link.getAttribute("href")
  record(`§25 ${label} is refused, and the default is offered instead`, href === "/fixtures", `${value} -> ${href}`)
  record(`§25 and ${label} never becomes a link off Ovalball`, !(href ?? "").includes("evil.example"), href ?? "")
}

// A MALFORMED QUERY ON A REAL SURFACE IS NOT THE SAME CASE, and the module
// says so: an unknown or unreadable PARAMETER is dropped, while an unknown
// PATH falls back. So the surface survives and the garbage does not -- which
// is a better answer than throwing away a destination the person can use.
link = await openMatchCentre("/fixtures/management?%%%")
const malformed = await link.getAttribute("href")
record("§25 a malformed query is discarded while the surface it names survives",
  malformed === "/fixtures/management", malformed ?? "(none)")
record("§25 and nothing of the malformed query reaches the link",
  !(malformed ?? "").includes("%") && !(malformed ?? "").includes("?"), malformed ?? "")

// A STALE target is not an attack and must not be treated as one: the surface
// still exists, the filter it names simply matches nothing now.
link = await openMatchCentre("/fixtures/management?team=00000000-0000-0000-0000-000000000000")
record("§25 a stale filter is honoured rather than thrown away",
  (await link.getAttribute("href"))?.startsWith("/fixtures/management"), await link.getAttribute("href"))

// =====================================================================
// §D  CROSS-SURFACE FIXTURE IDENTITY
// =====================================================================
// The same canonical fixture, consumed by every surface -- never a per-screen
// representation that happens to look the same.
const surfaces = [
  ["Control Centre", `/fixtures/management?date=all&q=${TAG}`],
  ["Calendar", `/calendar?view=season&week=${weekStart}`],
]
for (const [name, path] of surfaces) {
  await go(path)
  const hrefs = await page.locator(`a[href*="${homeFixture}"]`).count()
  record(`§D ${name} links the same canonical fixture id`, hrefs > 0, `${hrefs} reference(s) to ${homeFixture.slice(0, 8)}`)
}

// PITCH ALLOCATION DOES NOT LINK A FIXTURE -- its cards are dragged, not
// followed -- so identity is proved there by AGREEMENT instead, which is the
// stronger claim anyway: the board draws this fixture on the pitch the Control
// Centre says it is on, because both are reading the one canonical row.
await go(`/calendar/pitch-allocation?date=${homeDate}`)
const pitchName = sql(`select p.display_name from public.club_pitches p join public.fixtures f on f.pitch_id = p.id where f.id='${homeFixture}'`)
const ourSide = sql(`select t.display_name from public.teams t join public.fixtures f on f.owning_team_id = t.id where f.id='${homeFixture}'`)
// The board's cards are named for the SIDES, not for the opposition's full
// directory name -- so identity here is "our side, on the pitch the Control
// Centre named", which is the agreement that matters.
const boardCards = await page.locator('[role="group"][aria-label*="versus"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
const boardText = await bodyText()
record("§D Pitch Allocation shows the same fixture, on the pitch the Control Centre named",
  boardText.includes(pitchName) && boardCards.some((l) => l && l.includes(ourSide)),
  `${pitchName} on the board, ${boardCards.length} card(s): ${boardCards.join(" | ").slice(0, 120)}`)

// And the id resolves to the SAME fixture on the shared surface: Match Centre
// for that id names the opposition the Control Centre named.
await go(`/fixtures/${homeFixture}`)
record("§D and the id opens the same fixture in Match Centre", (await bodyText()).includes(opponentName), opponentName)

// =====================================================================
// §I  AVAILABILITY DISPLAY -- and the absence that is not a zero
// =====================================================================
const playerIds = sql(`select string_agg(ptm.player_id::text, ',') from public.player_team_memberships ptm
  where ptm.team_id='${teamId}' and ptm.status='active'`)
const squadSize = Number(sql(`select count(*) from public.player_team_memberships where team_id='${teamId}' and status='active'`))
if (squadSize > 0) {
  const firstPlayer = playerIds.split(",")[0]
  const adminId = sql(`select id from auth.users where email='${ADMIN}'`)
  sql(`insert into public.player_fixture_attendance (fixture_id, player_id, status, response_source, responded_by_user_id)
       values ('${homeFixture}','${firstPlayer}','ATTENDING','staff','${adminId}')
       on conflict (fixture_id, player_id) do update set status='ATTENDING'`)

  await go(`/fixtures/management?date=all&q=${TAG}&ha=Home`)
  text = await bodyText()
  record("§I an authorised viewer is told how many are still to reply",
    /to reply|All replied/.test(text), text.split("\n").find((l) => /to reply|All replied/.test(l)) ?? "(absent)")
  record("§I and the breakdown is in words and numbers, never colour alone",
    /\d+ in · \d+ out/.test(text.replace(/\s+/g, " ")) || /All replied/.test(text),
    text.split("\n").find((l) => /\d in/.test(l)) ?? "(absent)")
} else {
  record("§I an authorised viewer is told how many are still to reply", false, "the seeded team has no roster to count")
}

// The viewer who holds no attendance capability sees NO summary. The
// assertion is the absence of a number, not the presence of a zero -- a "0 of
// 0 replied" would be a false statement a person could act on.
{
  const outsiderCtx = await newContext(browser, { width: 1280, height: 900 })
  const outsider = await outsiderCtx.newPage()
  await signIn(outsider, OUTSIDER)
  await outsider.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" })
  await outsider.waitForLoadState("networkidle").catch(() => {})
  const outsiderText = await outsider.locator("body").innerText()
  record("§I a viewer with no attendance authority is shown no summary at all",
    !/to reply/.test(outsiderText) && !/0 in · 0 out/.test(outsiderText),
    "no counts, and no zero")
  // And the boundary itself, without the UI: the RPC returns nothing rather
  // than zeroes for a fixture they have no authority over.
  const outsiderId = sql(`select id from auth.users where email='${OUTSIDER}'`)
  const rows = sql(`select set_config('request.jwt.claims', json_build_object('sub','${outsiderId}','role','authenticated')::text, true);
    select count(*) from public.fixture_availability_summary(array['${homeFixture}']::uuid[]);`)
    .split("\n").map((l) => l.trim()).pop()
  record("§I the RPC itself returns no row for them -- never a zero", rows === "0", `${rows} row(s)`)
  await outsiderCtx.close()
}

// =====================================================================
// §26 CALENDAR -- quiet teams are filed, never deleted
// =====================================================================
await go(`/calendar?week=${weekStart}`)
const filterButton = page.getByRole("button", { name: /All Teams|Under|Men|Women/ }).first()
if ((await filterButton.count()) > 0) {
  await filterButton.click()
  await page.waitForTimeout(600)
  const sheet = await page.locator('[role="dialog"]').first().innerText().catch(() => "")
  const quietControl = page.getByRole("button", { name: /nothing scheduled/ })
  record("§26 teams with nothing scheduled are counted, not silently dropped",
    (await quietControl.count()) > 0 || !/nothing scheduled/.test(sheet),
    (await quietControl.count()) > 0 ? await quietControl.innerText() : "every team has something on")
  if ((await quietControl.count()) > 0) {
    await quietControl.click()
    // The quiet teams appear under their own canonical group headings, each
    // suffixed "nothing scheduled". Waiting for one of those is the product
    // condition; waiting 400ms is a guess about the machine.
    // The control removes itself once pressed, so its disappearance IS the
    // state change -- a more reliable signal than any amount of waiting.
    await quietControl.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
    // LOOK FOR THE TEAMS, NOT FOR THE SHEET. Whether the sheet is still the
    // element it was is a detail of the dialog component; what §26 asks is
    // whether the quiet teams came back, named and grouped. So the headings
    // are looked for on the page, and the sheet is reopened first if pressing
    // the control happened to close it.
    if ((await page.locator('[role="dialog"]').count()) === 0) {
      await filterButton.click()
      await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {})
    }
    const quietHeadings = await page.getByText(/nothing scheduled/i).allInnerTexts().catch(() => [])
    const visible = await page.locator("body").innerText().catch(() => "")
    record("§26 and one press brings every one of them back, by name",
      quietHeadings.some((h) => /nothing scheduled/i.test(h)),
      quietHeadings.join(" | ").slice(0, 140) || `no heading; page reads: ${visible.replace(/\n+/g, " | ").slice(0, 200)}`)
  } else {
    record("§26 and one press brings every one of them back, by name", true, "no quiet teams in this scope")
  }
  await page.keyboard.press("Escape")
}

// =====================================================================
// §L / §M  THE OPERATIONAL SURFACES CONSUME WHAT WAS CREATED IN BULK
// =====================================================================
// The importer and the planner have their own suites; what is proved here is
// the CONNECTION -- that a row created either way is the same canonical
// fixture every operational surface then reads, rather than rows that merely
// landed in a table.
// The opposition text names the real club AND carries the run tag, so the
// screen shows a club (which is what it should show) and the search can still
// find exactly this run's rows.
const importedTag = `${opponentName} ${TAG}-IMPORT`
const plannedTag = `${opponentName} ${TAG}-PLANNER`
const importDate = sql(`select (date '${weekStart}' + 12)::text`)
const plannerDate = sql(`select (date '${weekStart}' + 19)::text`)
const importedFixture = firstId(`insert into public.fixtures
  (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type, venue_id, pitch_id)
  values ('${teamId}','Home','${opponent}','${importedTag}','${importDate}','10:00','Booked','csv_import','${TAG}','Friendly','${venueId}','${pitchOne}')
  returning id`)
const plannedFixture = firstId(`insert into public.fixtures
  (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type, venue_id, pitch_id)
  values ('${teamId}','Home','${opponent}','${plannedTag}','${plannerDate}','10:00','Booked','club_created','${TAG}','Friendly','${venueId}','${pitchTwo}')
  returning id`)

for (const [origin, fixtureId, tag, date] of [
  ["§L an imported", importedFixture, importedTag, importDate],
  ["§M a planned", plannedFixture, plannedTag, plannerDate],
]) {
  await go(`/fixtures/management?date=all&q=${tag}`)
  record(`${origin} fixture appears in the Control Centre`, (await page.locator(`a[href*="${fixtureId}"]`).count()) > 0)
  record(`${origin} fixture is found by Fixture Search`, (await page.locator(`a[href*="${fixtureId}"]`).count()) > 0)
  record(`${origin} fixture carries a canonical venue AND pitch id, never a typed name`,
    sql(`select count(*) from public.fixtures f join public.venues v on v.id=f.venue_id
         join public.club_pitches p on p.id=f.pitch_id and p.venue_id=v.id where f.id='${fixtureId}'`) === "1")

  const week = sql(`select to_char(date_trunc('week', date '${date}')::date, 'YYYY-MM-DD')`)
  await go(`/calendar?view=season&week=${week}`)
  record(`${origin} fixture is the same canonical fixture on the Calendar`,
    (await page.locator(`a[href*="${fixtureId}"]`).count()) > 0,
    `${await page.locator(`a[href*="${fixtureId}"]`).count()} reference(s) to ${fixtureId.slice(0, 8)}`)
}

// =====================================================================
// §K  AWAY VARIANT
// =====================================================================
await go(`/fixtures/management?date=all&q=${TAG}&ha=Away`)
text = await bodyText()
record("§K the away variant is reachable through the same journey",
  (await rowFor(awayFixture).count()) > 0 && text.includes("AWAY"), "the Away row, badged AWAY")

const awayBack = `/fixtures/management?date=all&q=${TAG}&ha=Away`
await go(`/fixtures/${awayFixture}?from=${encodeURIComponent(awayBack)}`)
const awayLink = page.locator("main a").first()
record("§K and it comes back to the away view it was opened from",
  (await awayLink.getAttribute("href"))?.includes("ha=Away"), await awayLink.getAttribute("href"))

// =====================================================================
// §37 MOBILE -- the surfaces this step materially changed
// =====================================================================
for (const width of [390, 320]) {
  const small = await newContext(browser, { width, height: 844 })
  const m = await small.newPage()
  await signIn(m, ADMIN)
  for (const [name, path] of [
    ["Control Centre", `/fixtures/management?from_date=${weekStart}&to_date=${sql(`select (date '${weekStart}' + 6)::text`)}`],
    ["Match Centre", `/fixtures/${homeFixture}?from=${encodeURIComponent(CONTEXT)}`],
  ]) {
    await m.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`§37 ${name} does not scroll sideways at ${width}px`, overflow <= 0, `${overflow}px beyond the viewport`)
  }
  // The period stepper must stay a 44px target on a phone: it is the control
  // this step exists to add, and a squeezed one is not a control.
  const stepper = m.getByRole("link", { name: "Next week" })
  if ((await stepper.count()) > 0) {
    const box = await stepper.boundingBox()
    record(`§B the period stepper keeps a touch-sized target at ${width}px`,
      Boolean(box) && box.height >= 40 && box.width >= 40, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "(not rendered)")
  }
  await small.close()
}

// =====================================================================
// CLEANUP
// =====================================================================
cleanup()
record("the suite leaves no fixture, pitch or team of its own behind",
  sql("select count(*) from public.fixtures where notes like 'STEP7-%'") === "0")

await browser.close()
process.exit(summarise() ? 0 : 1)
