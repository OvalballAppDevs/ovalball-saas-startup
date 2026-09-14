// ONE FIXTURE EDITOR -- the Control Centre's Edit Fixture sheet.
// (Fixture Operations brief §7 Quick Edit, §8 canonical edit model, §9 opposition
// defaults, §10 venue defaults and the override rule.)
//
// What a fixture secretary relies on, proved with real input events against a
// real fixture:
//
//   * Edit Fixture opens one sheet from the row menu, and saving a kick-off
//     changes the kick-off -- the venue and the notes survive (the old editor
//     wiped both on every save).
//   * Choosing an Ovalball opposition club says they are ASKED, not booked, and
//     never binds one of their teams from here.
//   * Away suggests the opposition's primary ground, marked Suggested.
//   * A dirty sheet does not close on Escape without asking.
//   * Typing a club name is filtered in the browser: no request per keystroke.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const TAG = `ED${Date.now().toString(36).slice(-5).toUpperCase()}`
const U12 = sql("select t.id from teams t join clubs c on c.id=t.club_id where c.slug='ovalball-uat-rufc' and t.display_name='Under 12 Boys' and t.active limit 1")
const VENUE = sql("select v.id from venues v join clubs c on c.id=v.club_id where c.slug='ovalball-uat-rufc' and v.is_default_home limit 1")
// An opponent no other fixture suite uses, so the row this run opens is this run's fixture.
const FYLDE = sql("select id from club_directory where name='Rossendale RUFC' and rugby_code='union' limit 1")
const PRESTON = sql("select c.directory_id from clubs c where c.slug='preston-grasshoppers-uat'")
if (!U12 || !VENUE || !FYLDE || !PRESTON) {
  console.error("Missing UAT data: run supabase/seeds/local_uat_fixture_operations.sql")
  process.exit(1)
}
const OPP = `Rossendale RUFC`
// Late in the season, away from the near-term dates the competition suite schedules.
const DATE = sql("select (select starts_on from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1) + 200")
const [dy, dm, dd] = DATE.split("-").map(Number)
const DATE_TEXT = new Date(Date.UTC(dy, dm - 1, dd)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const FIXTURE = sql(`insert into fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, venue_id, status, source, notes, game_type)
  values ('${U12}', 'Home', '${FYLDE}', '${OPP}', '${DATE}', '10:30', '${VENUE}', 'Booked', 'club_created', 'Bring both kits ${TAG}', 'Friendly') returning id`).split("\n")[0]

// A competition of this run's own, issued and confirmed, so the lock on its
// fixture is proved every run rather than whenever some other run left one.
const COACH = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const UAT_CLUB = sql("select id from clubs where slug='ovalball-uat-rufc'")
const UAT_DIR = sql("select directory_id from clubs where slug='ovalball-uat-rufc'")
const SEASON = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1")
const EXTERNAL = sql("select d.id from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name offset 250 limit 1")
const COMP_NAME = `UAT Locked Cup ${TAG}`
const COMPETITION = sql(`insert into competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, format, team_count, created_by, updated_by)
  values ('${COMP_NAME}', 'uat-locked-${TAG.toLowerCase()}-union', 'uat locked cup ${TAG.toLowerCase()} union', 'union', true, '${UAT_CLUB}', 'league', 2, '${COACH}', '${COACH}') returning id`).split("\n")[0]
const EDITION = sql(`insert into competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by) values ('${COMPETITION}', '${SEASON}', 'union', true, '${COACH}', '${COACH}') returning id`).split("\n")[0]
sql(`do $$ declare v_stage uuid; v_home uuid := gen_random_uuid(); v_away uuid := gen_random_uuid(); v_match uuid := gen_random_uuid(); v_ask uuid; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '${COACH}', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_competition_participants('${EDITION}', jsonb_build_array(
    jsonb_build_object('id', v_home, 'slot', 1, 'club_directory_id', '${UAT_DIR}', 'club_id', '${UAT_CLUB}', 'team_id', '${U12}'),
    jsonb_build_object('id', v_away, 'slot', 2, 'club_directory_id', '${EXTERNAL}')));
  v_stage := public.save_competition_stage('${EDITION}', null, 'league', 'League', 1, '{"matches":"single"}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(jsonb_build_object('id', v_match, 'round_number', 1,
    'home_participant_id', v_home, 'away_participant_id', v_away, 'match_date', '${DATE}'::date + 7, 'kickoff_time', '10:30')), null, null);
  perform public.issue_competition_matches('${EDITION}', null);
  select id into v_ask from public.competition_match_verifications where match_id = v_match and status = 'awaiting' limit 1;
  if v_ask is not null then perform public.respond_competition_match(v_ask, 'confirmed'); end if;
end $$`)
function cleanupCompetition() {
  sql(`delete from notifications where data->>'competition_match_id' in (select id::text from competition_matches where edition_id='${EDITION}')`)
  sql(`delete from fixtures where id in (select l.fixture_id from competition_match_fixtures l join competition_matches m on m.id=l.match_id where m.edition_id='${EDITION}')`)
  sql(`delete from competition_editions where id='${EDITION}'`)
  sql(`delete from competitions where id='${COMPETITION}'`)
}
let competitionCleaned = false
process.on("exit", () => {
  if (competitionCleaned) return
  competitionCleaned = true
  try {
    cleanupCompetition()
  } catch (e) {
    console.error("cleanup failed:", e)
  }
})

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")

const row = () => sql(`select kickoff_time, venue_id, coalesce(notes,''), home_away, coalesce(opponent_directory_id::text,''), coalesce(opponent_team_id::text,''), coalesce(venue_address,'') from fixtures where id='${FIXTURE}'`).split("|")

async function openEditor(opposition = OPP) {
  await page.goto(`${APP}/fixtures/management?date=all&q=${encodeURIComponent(opposition)}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const tr = page.locator("tbody tr").filter({ hasText: opposition }).filter({ hasText: DATE_TEXT }).filter({ has: page.locator(`button[aria-label^="Actions for"]`) })
  await tr.first().locator(`button[aria-label^="Actions for"]`).click()
  await page.getByRole("menuitem", { name: "Edit Fixture" }).click()
  const sheet = page.getByRole("dialog", { name: "Edit Fixture" })
  await sheet.waitFor({ state: "visible" })
  await sheet.getByRole("button", { name: "Save Changes" }).waitFor({ state: "visible" })
  return sheet
}

// ---------------------------------------------------------------------
// §7 Quick Edit: one sheet, and a save changes only what changed
// ---------------------------------------------------------------------
let sheet = await openEditor()
record("§7 Edit Fixture opens one sheet from the row menu", await sheet.isVisible())
record("§8 the sheet names the fixture", (await sheet.innerText()).includes(OPP))
record("§8 the Club Admin sees no locked field on their own fixture", (await sheet.locator('[aria-label="Locked"]').count()) === 0)
record("§7 Save Changes is disabled until something changes", await sheet.getByRole("button", { name: "Save Changes" }).isDisabled())

await sheet.getByLabel("Kick-Off", { exact: true }).fill("11:15")
await sheet.getByRole("button", { name: "Save Changes" }).click()
await sheet.waitFor({ state: "hidden" })
let [ko, venue, notes] = row()
record("§7 the kick-off is saved", ko === "11:15:00", ko)
record("§7 saving a kick-off keeps the venue (the old editor wiped it)", venue === VENUE, venue)
record("§7 saving a kick-off keeps the notes", notes === `Bring both kits ${TAG}`, notes)

// ---------------------------------------------------------------------
// §9 an Ovalball opposition club is asked; §10 away ground suggested
// ---------------------------------------------------------------------
sheet = await openEditor()
let posts = 0
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/fixtures/management")) posts += 1
})
const club = sheet.getByRole("combobox", { name: "Opposition Club" })
const before = posts
await club.click()
await page.keyboard.press("ControlOrMeta+a")
await page.keyboard.type("Preston Grass", { delay: 40 })
const option = page.getByRole("option", { name: /Preston Grasshoppers RFC/ })
await option.first().waitFor({ state: "visible" })
const typingPosts = posts - before
record("§9 typing a club name is filtered in the browser (one catalogue load, not a request per keystroke)", typingPosts <= 1, `${typingPosts} POST for focus and 13 keystrokes`)
record("§9 an Ovalball club is marked On Ovalball in the list", (await option.first().innerText()).includes("On Ovalball"))
await page.keyboard.press("Enter")
await sheet.getByText("so they are asked rather than booked").waitFor({ state: "visible" })
record("§9 choosing a different Ovalball club says they are asked, not booked", true)
const suggestedTeam = sheet.getByLabel(/^Opposition Team/)
await suggestedTeam.waitFor({ state: "visible" })
record("§9 their strong team match is suggested, to be ASKED for -- never bound", (await suggestedTeam.evaluate((el) => el.options[el.selectedIndex].text)).startsWith("Under 12 Boys") && (await sheet.getByText("Saving asks them to confirm this team").count()) === 1)
// Record the club alone first; asking for the team is proved next.
await suggestedTeam.selectOption("")

await sheet.getByRole("radio", { name: "Away" }).click()
const ground = sheet.getByLabel(/^Ground/)
await ground.waitFor({ state: "visible" })
record("§10 Away suggests the opposition's primary ground", (await ground.inputValue()) === "Lightfoot Green", await ground.inputValue())
record("§10 the default is marked Suggested until touched", (await sheet.locator("label", { hasText: "Ground" }).innerText()).includes("Suggested"))

await sheet.getByRole("button", { name: "Save Changes" }).click()
await sheet.waitFor({ state: "hidden" })
let r = row()
record("§9 the fixture now records Preston Grasshoppers as the club, with no team bound", r[4] === PRESTON && r[5] === "", `${r[4]} team=${r[5]}`)
record("§10 the fixture is Away at their ground, recorded by name", r[3] === "Away" && r[6] === "Lightfoot Green" && r[1] === "", `${r[3]} ${r[6]} venue_id=${r[1]}`)
record("§7 the notes still survive", r[2] === `Bring both kits ${TAG}`, r[2])

// ---------------------------------------------------------------------
// §9 a missing opposition team: the Ovalball club is ASKED to confirm it
// ---------------------------------------------------------------------
const PRESTON_U12 = sql("select t.id from teams t join clubs c on c.id=t.club_id where c.slug='preston-grasshoppers-uat' and t.age_group='U12' and t.gender='boys'")
sheet = await openEditor("Preston Grasshoppers RFC")
const teamSelect = sheet.getByLabel(/^Opposition Team/)
await teamSelect.waitFor({ state: "visible" })
const teamOptions = await teamSelect.locator("option").allInnerTexts()
record("§9 the missing team offers Preston's eligible teams, best match first, never a girls side", teamOptions[1]?.startsWith("Under 12 Boys") && !teamOptions.some((o) => o.includes("Girls")), teamOptions.join(" | "))
await teamSelect.selectOption(PRESTON_U12)
await sheet.getByRole("button", { name: "Save Changes" }).click()
await sheet.getByText("has been asked to confirm their team").waitFor({ state: "visible" })
record("§9 saving asks the club rather than setting their team, and the sheet says so", row()[5] === "")
record("§9 the reopened fixture shows it is waiting for Preston", await sheet.getByText(/Waiting for Preston Grasshoppers RFC to confirm Under 12 Boys/).isVisible())
const askRequest = sql(`select id from fixture_requests where existing_fixture_id='${FIXTURE}' and status='sent'`)
record("§9 one open fixture request carries this fixture", Boolean(askRequest))
await page.keyboard.press("Escape")

const prestonCtx = await newContext(browser, { width: 1280, height: 900 })
const prestonPage = await prestonCtx.newPage()
await signIn(prestonPage, "uat.preston.admin@ovalball.test")
await prestonPage.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" })
await prestonPage.waitForLoadState("networkidle").catch(() => {})
const incoming = prestonPage.locator("main li, main article, main div").filter({ hasText: DATE_TEXT.replace(/ \d{4}$/, "") }).filter({ has: prestonPage.getByRole("button", { name: /^Accept/ }) }).last()
await incoming.getByRole("button", { name: /^Accept/ }).first().click()
await prestonPage.waitForTimeout(1500)
await prestonCtx.close()
const fixturesAfter = sql(`select count(*) from fixtures where owning_team_id='${U12}' and kickoff_date='${DATE}'`)
record("§9 Preston's Club Admin accepts in their ordinary fixture requests", sql(`select status from fixture_requests where id='${askRequest}'`) === "accepted")
record("§9 accepting completes this fixture with their team -- no second fixture", row()[5] === PRESTON_U12 && fixturesAfter === "1", `team=${row()[5]} fixtures that day=${fixturesAfter}`)

// ---------------------------------------------------------------------
// §8 a competition's fixture is locked, naming the competition
// ---------------------------------------------------------------------
const linked = sql(`select l.fixture_id from competition_match_fixtures l join competition_matches m on m.id=l.match_id where m.edition_id='${EDITION}' limit 1`)
record("§8 this run's issued and confirmed competition match has its club fixture", /^[0-9a-f-]{36}$/.test(linked), linked)
const reason = linked
  ? sql(`begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '${COACH}', 'role', 'authenticated')::text, true); select public.fixture_editable_fields('${linked}')->'schedule'->>'reason'; rollback;`).split("\n").filter((l) => l.startsWith("Set by") || l.startsWith("Only")).pop() ?? ""
  : ""
record("§8 a competition fixture reports its date and kick-off as set by the competition", reason === `Set by the competition "${COMP_NAME}". Ask the organiser to change it.`, reason)

// ---------------------------------------------------------------------
// §7 a dirty sheet asks before closing
// ---------------------------------------------------------------------
const PRESTON_NAME = "Preston Grasshoppers RFC"
sheet = await openEditor(PRESTON_NAME)
await sheet.getByLabel("Notes").fill("Changed my mind")
await page.keyboard.press("Escape")
const warn = sheet.getByText("You have unsaved changes.")
record("§7 Escape on a dirty sheet asks instead of discarding", await warn.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false))
await sheet.getByRole("button", { name: "Keep Editing" }).click()
record("§7 Keep Editing keeps the sheet and the typing", (await sheet.getByLabel("Notes").inputValue()) === "Changed my mind")
await page.keyboard.press("Escape")
await sheet.getByRole("button", { name: "Discard Changes" }).click()
await sheet.waitFor({ state: "hidden" })
record("§7 Discard Changes closes without saving", row()[2] === `Bring both kits ${TAG}`)

// ---------------------------------------------------------------------
// Phone width: the same editor, full width
// ---------------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${APP}/fixtures/management?date=all&q=${encodeURIComponent(PRESTON_NAME)}`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.getByRole("button", { name: /^Edit / }).first().click()
const mobileSheet = page.getByRole("dialog", { name: "Edit Fixture" })
await mobileSheet.waitFor({ state: "visible" })
const box = await mobileSheet.boundingBox()
record("phone: the card opens the same Edit Fixture sheet, full width", Boolean(box && box.width >= 380), `${box?.width}px`)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
record("phone: nothing scrolls sideways", overflow <= 1, `${overflow}px`)

// ---------------------------------------------------------------------
// §7 the result, recorded from the Control Centre once the match is played
// ---------------------------------------------------------------------
await page.setViewportSize({ width: 1440, height: 950 })
// The most recent day, in the season, on which neither Under 12 Boys team already plays.
const PLAYED = sql(`select d::date from generate_series(current_date - 1, (select starts_on from seasons where rugby_code='union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1), interval '-1 day') d
  where not exists (select 1 from fixtures f where f.id <> '${FIXTURE}' and f.status <> 'Cancelled' and f.kickoff_date = d::date
    and (f.owning_team_id in ('${U12}', '${PRESTON_U12}') or f.opponent_team_id in ('${U12}', '${PRESTON_U12}')))
  order by d desc limit 1`)
sql(`update fixtures set kickoff_date='${PLAYED}' where id='${FIXTURE}'`)
const [py, pm, pd] = PLAYED.split("-").map(Number)
const PLAYED_TEXT = new Date(Date.UTC(py, pm - 1, pd)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
await page.goto(`${APP}/fixtures/management?date=all&q=${encodeURIComponent("Preston Grasshoppers RFC")}`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.locator("tbody tr").filter({ hasText: PLAYED_TEXT }).filter({ hasText: "Preston" }).first().locator(`button[aria-label^="Actions for"]`).click()
await page.getByRole("menuitem", { name: "Edit Fixture" }).click()
sheet = page.getByRole("dialog", { name: "Edit Fixture" })
await sheet.getByLabel("Home Score").waitFor({ state: "visible" })
await sheet.getByLabel("Home Score").fill("17")
await sheet.getByLabel("Away Score").fill("22")
await sheet.getByRole("button", { name: "Save Changes" }).click()
await sheet.waitFor({ state: "hidden" })
const scores = sql(`select home_score, away_score, result_status from fixtures where id='${FIXTURE}'`)
record("§7 a played fixture's result is recorded from the Control Centre editor", scores.startsWith("17|22|"), scores)
record("§7 against an Ovalball team the result waits for the other club to confirm", scores.endsWith("awaiting_confirmation"), scores)

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))

// This run's rows only. A result writes a system message and a submission, which go first.
sql(`update club_partnerships set source_fixture_id=null where source_fixture_id='${FIXTURE}'`)
// A request lives in a request group; removing the request alone left the group behind on every run.
sql(`delete from fixture_request_groups where id in (select group_id from fixture_requests where existing_fixture_id='${FIXTURE}' or resulting_fixture_id='${FIXTURE}')`)
sql(`delete from fixture_requests where existing_fixture_id='${FIXTURE}' or resulting_fixture_id='${FIXTURE}'`)
sql(`delete from fixture_messages where fixture_id='${FIXTURE}'`)
sql(`delete from fixture_result_submissions where fixture_id='${FIXTURE}'`)
sql(`delete from fixtures where id='${FIXTURE}'`)
cleanupCompetition()
competitionCleaned = true
record("cleanup: this run's competition and its fixture are gone", sql(`select count(*) from competitions where id='${COMPETITION}'`) === "0")
await browser.close()
process.exit(summarise() ? 0 : 1)
