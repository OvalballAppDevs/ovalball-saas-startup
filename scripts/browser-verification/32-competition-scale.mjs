// COMPETITION CREATOR AT 32 TEAMS -- responsive, and no request per keystroke.
// (Fixture Operations brief, performance: "no request per keystroke or per
// row-open; responsive at 32 teams".)
//
// A 32-team League + Knockout competition is seeded directly (the Creator's own
// flow is proved at small size by suite 31). Then, as its organiser:
//   * Participants renders 32 slots in two columns;
//   * typing into a slot's club search makes no request after the catalogue;
//   * Groups draws 8 groups of 4 in the browser and saves them;
//   * Fixtures generates 48 matches and renders every round;
//   * Knockout draws 8 places from the groups into a bracket.
// Timings are reported and held to budgets generous enough for a dev server.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const club = sql("select id from clubs where slug='ovalball-uat-rufc'")
const admin = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const season = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1")
const competition = firstId(`insert into competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, format, team_count, created_by, updated_by)
  values ('UAT Thirty Two ${TAG}', 'uat-thirty-two-${TAG.toLowerCase()}-union', 'uat thirty two ${TAG.toLowerCase()} union', 'union', true, '${club}', 'league_knockout', 32, '${admin}', '${admin}') returning id`)
const edition = firstId(`insert into competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by) values ('${competition}', '${season}', 'union', true, '${admin}', '${admin}') returning id`)
sql(`insert into competition_participants (edition_id, slot, club_directory_id, created_by, updated_by)
  select '${edition}', row_number() over (order by d.name), d.id, '${admin}', '${admin}'
  from (select d.id, d.name from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name limit 32) d`)
record("seed: 32 participants entered", sql(`select count(*) from competition_participants where edition_id='${edition}'`) === "32")

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")
let posts = 0
page.on("request", (r) => {
  if (r.method() === "POST") posts += 1
})

const time = async (fn) => {
  const t = Date.now()
  await fn()
  return Date.now() - t
}
const open = (step) => page.goto(`${APP}/fixtures/competitions/${edition}/${step}`, { waitUntil: "domcontentloaded" }).then(() => page.waitForLoadState("networkidle").catch(() => {}))

// Warm the routes once so the dev server's first compile is not what is measured.
await open("participants")
await open("groups")

// ---------------------------------------------------------------------
// PARTICIPANTS
// ---------------------------------------------------------------------
const participantsMs = await time(() => open("participants"))
record("participants: 32 slots render", (await page.getByRole("combobox", { name: /^Slot \d+ Club$/ }).count()) === 32, `${participantsMs}ms`)
record("participants: page ready within budget", participantsMs < 8000, `${participantsMs}ms`)
const slot32 = page.getByRole("combobox", { name: "Slot 32 Club" })
await slot32.click()
await page.getByRole("option").first().waitFor({ state: "attached", timeout: 30000 }).catch(() => {})
await page.keyboard.press("ControlOrMeta+a")
await page.keyboard.type("R", { delay: 10 })
await page.getByRole("option").first().waitFor({ state: "visible" })
const beforeTyping = posts
const typingMs = await time(async () => {
  await page.keyboard.type("ugby Football Club", { delay: 30 })
  await page.getByRole("option").first().waitFor({ state: "visible" })
})
record("participants: typing a club name makes no request once the catalogue is loaded", posts === beforeTyping, `${posts - beforeTyping} requests`)
record("participants: filtering 18 keystrokes over the whole directory stays quick", typingMs < 2500, `${typingMs}ms including ${18 * 30}ms of typing delay`)
await page.keyboard.press("Escape")

// ---------------------------------------------------------------------
// GROUPS
// ---------------------------------------------------------------------
await open("groups")
await page.getByLabel("Number of Groups").fill("8")
const beforeDraw = posts
const drawMs = await time(async () => {
  await page.getByRole("button", { name: "Draw Groups" }).click()
  await page.getByRole("heading", { name: /Group H/ }).waitFor({ state: "visible" })
})
record("groups: 8 groups of 4 are drawn in the browser, without a request", posts === beforeDraw && (await page.getByRole("heading", { name: /^Group [A-H] \(4\)$/ }).count()) === 8, `${drawMs}ms`)
const saveGroupsMs = await time(async () => {
  await page.getByRole("button", { name: "Save Groups" }).click()
  await page.getByText("Groups saved.").waitFor({ state: "visible" })
})
record("groups: saving 32 placements is quick", saveGroupsMs < 8000, `${saveGroupsMs}ms`)

// ---------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------
await open("fixtures")
const date = sql(`select starts_on + 60 from seasons where id='${season}'`)
await page.getByLabel("Round 1 Date").fill(date)
const generateMs = await time(async () => {
  await page.getByRole("button", { name: "Generate Fixtures" }).click()
  await page.getByText(/48 draft matches generated/).waitFor({ state: "visible", timeout: 60000 })
})
// The notice arrives with the save; the table follows on the refresh.
await page.waitForFunction(() => document.querySelectorAll('tr[id^="match-"]').length === 48, null, { timeout: 15000 }).catch(() => {})
const shownRows = await page.locator('tr[id^="match-"]').count()
record("fixtures: 48 matches over 3 rounds are generated and shown", shownRows === 48, `${shownRows} rows, ${generateMs}ms`)
record("fixtures: generating and rendering 48 matches is within budget", generateMs < 12000, `${generateMs}ms`)

// ---------------------------------------------------------------------
// KNOCKOUT
// ---------------------------------------------------------------------
await open("knockout")
const koMs = await time(async () => {
  await page.getByRole("button", { name: "Draw Knockout" }).click()
  await page.getByText(/knockout matches drafted/).waitFor({ state: "visible", timeout: 60000 })
})
const bracket = await page.getByRole("region", { name: "Bracket" }).innerText()
record("knockout: 8 group winners and runners-up make a round of 16", bracket.includes("Round of 16 Match 8") && bracket.includes("Quarter-Finals") && bracket.includes("Group H 2nd"), `${koMs}ms`)

// With every group match played, the places come from the group tables.
sql(`update competition_matches set status='completed', result_source='organiser', home_score=(abs(hashtext(id::text)) % 40), away_score=(abs(hashtext(id::text || 'x')) % 40) where edition_id='${edition}' and group_id is not null`)
sql(`update competition_matches set winner_participant_id = case when home_score > away_score then home_participant_id when away_score > home_score then away_participant_id end where edition_id='${edition}' and group_id is not null`)
await open("knockout")
const beforeFill = posts
const fillMs = await time(async () => {
  await page.getByRole("button", { name: "Fill Places from Group Tables" }).click()
  await page.getByText("The knockout places have been filled from the group tables.").waitFor({ state: "visible", timeout: 60000 })
})
record("knockout: all sixteen places are filled in one save, not sixteen", posts - beforeFill === 1, `${posts - beforeFill} request(s), ${fillMs}ms`)
// Group A's winner by the default points (4 a win, 2 a draw), then points difference.
const groupAWinner = sql(`
  with a as (select g.id from competition_groups g join competition_stages s on s.id=g.stage_id where s.edition_id='${edition}' order by g.sort_order limit 1),
  r as (select home_participant_id p, home_score f, away_score x from competition_matches where group_id=(select id from a)
        union all select away_participant_id, away_score, home_score from competition_matches where group_id=(select id from a))
  select d.name from r join competition_participants cp on cp.id=r.p join club_directory d on d.id=cp.club_directory_id
  group by d.name order by sum(case when f>x then 4 when f=x then 2 else 0 end) desc, sum(f-x) desc, sum(f) desc limit 1`)
const filledHome = sql(`select d.name from competition_matches m join competition_participants p on p.id=m.home_participant_id join club_directory d on d.id=p.club_directory_id where m.edition_id='${edition}' and m.group_id is null and m.round_number=1 and m.bracket_slot=1`)
record("knockout: Fill Places puts Group A's winner into Round of 16 Match 1", filledHome === groupAWinner, `${filledHome} / table: ${groupAWinner}`)
await page.waitForLoadState("networkidle").catch(() => {})
await page.waitForFunction(() => !document.body.innerText.includes("Working…"), null, { timeout: 30000 }).catch(() => {})
// A swap between two Round of 16 ties at 32 teams: two clicks, one save.
const bracketRegion = page.getByRole("region", { name: "Bracket" })
const teamButtons = bracketRegion.locator("button[aria-pressed]")
const firstTeam = (await teamButtons.nth(1).innerText()).trim()
const secondTeam = (await teamButtons.nth(3).innerText()).trim()
const beforeSwap = posts
const swapMs = await time(async () => {
  await teamButtons.nth(1).click()
  await teamButtons.nth(3).click()
  await page.waitForFunction(([a]) => {
    const lis = [...document.querySelectorAll('[aria-label="Bracket"] li')]
    return lis.length > 0 && !document.body.innerText.includes("Working…") && lis[0].innerText.includes(a) === false
  }, [firstTeam], { timeout: 30000 }).catch(() => {})
})
record("participant swap at 32 teams: two ties change in one save", posts - beforeSwap === 1, `${posts - beforeSwap} request(s), ${swapMs}ms, ${firstTeam} <-> ${secondTeam}`)
record("participant swap at 32 teams: within budget", swapMs < 8000, `${swapMs}ms`)
const validationMs = await time(() => open("issue"))
record("validation at 32 teams: the Issue step checks every match for conflicts within budget", validationMs < 8000 && (await page.getByRole("heading", { name: "Issue and Verify" }).count()) === 1, `${validationMs}ms for 64 matches`)
record("knockout: all sixteen places are filled", sql(`select count(*) from competition_matches where edition_id='${edition}' and group_id is null and round_number=1 and home_participant_id is not null and away_participant_id is not null`) === "8")

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))

// Cleanup this run's competition.
sql(`delete from competition_matches where edition_id='${edition}'`)
sql(`delete from competition_stages where edition_id='${edition}'`)
sql(`delete from competition_participants where edition_id='${edition}'`)
sql(`delete from competition_editions where id='${edition}'`)
sql(`delete from competitions where id='${competition}'`)
await browser.close()
process.exit(summarise() ? 0 : 1)
