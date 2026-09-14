// A COMPETITION IS A NAME AND A CODE -- AND STAYS IN ITS CODE.
// (Fixture Operations spec 3, 19-21: quick-create requires Competition Name and
// Rugby Code, never a silent default; a new competition is selectable straight
// away in its own code's fixture selectors and never in the other code's.)
//
// As a Full Site Admin, with real input:
//   * Save stays disabled with a name until Union or League is chosen;
//   * "Lancashire U12 Cup" is created as Union, and a League competition as League;
//   * the Edit Fixture sheet for a Union fixture offers the Union competition and
//     not the League one; for a League fixture, the League one and not the Union one.
// The two fixtures and two competitions are this run's own and are removed.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const UNION_NAME = `Lancashire U12 Cup ${TAG}`
const LEAGUE_NAME = `Cumbria U12 Nines ${TAG}`
const unionTeam = sql("select t.id from teams t join clubs c on c.id=t.club_id where c.slug='ovalball-uat-rufc' and t.display_name='Under 12 Boys' and t.active limit 1")
const leagueTeam = sql("select t.id from teams t join clubs c on c.id=t.club_id join club_directory d on d.id=c.directory_id where d.rugby_code='league' and t.rugby_code='league' and t.active order by t.created_at limit 1")
const unionOpp = sql("select id from club_directory where rugby_code='union' and active and not exists (select 1 from clubs c where c.directory_id=club_directory.id) order by name offset 200 limit 1")
if (!unionTeam || !leagueTeam || !unionOpp) {
  console.error("Missing UAT data: a Union team, a League team and an external Union club are needed")
  process.exit(1)
}
const unionOppName = sql(`select name from club_directory where id='${unionOpp}'`)
const unionDay = sql("select (current_date + 60)::text")
const leagueDay = sql("select coalesce((select greatest(current_date + 10, starts_on + 10) from seasons where rugby_code='league' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1), current_date + 10)::text")
const unionFixture = firstId(`insert into fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
  values ('${unionTeam}', 'Home', '${unionOpp}', 'Isolation Union ${TAG}', '${unionDay}', '10:30', 'Booked', 'club_created', 'iso-${TAG}', 'Cup Fixture') returning id`)
const leagueFixture = firstId(`insert into fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
  values ('${leagueTeam}', 'Home', null, 'Isolation League ${TAG}', '${leagueDay}', '10:30', 'Booked', 'club_created', 'iso-${TAG}', 'Cup Fixture') returning id`)

function cleanup() {
  sql(`delete from fixtures where notes='iso-${TAG}'`)
  for (const name of [UNION_NAME, LEAGUE_NAME]) {
    sql(`delete from competition_editions where competition_id in (select id from competitions where name='${name}')`)
    sql(`delete from audit_log where table_name='competitions' and record_id in (select id from competitions where name='${name}')`)
    sql(`delete from competitions where name='${name}'`)
  }
}
let cleaned = false
process.on("exit", () => {
  if (cleaned) return
  cleaned = true
  try {
    cleanup()
  } catch (e) {
    console.error("cleanup failed:", e)
  }
})

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.fullsiteadmin@ovalball.test")
const settle = () => page.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// QUICK CREATE
// ---------------------------------------------------------------------
await page.goto(`${APP}/admin/competitions`, { waitUntil: "domcontentloaded" })
await settle()
const form = page.locator("form").filter({ hasText: "Add a Competition" })
const save = form.getByRole("button", { name: "Save Competition" })
await form.getByLabel("Name").fill(UNION_NAME)
record("quick create: a name alone cannot be saved -- the code is never assumed", await save.isDisabled())
record("quick create: neither Union nor League is chosen until somebody chooses", (await form.getByRole("radio", { checked: true }).count()) === 0)
await form.getByRole("radio", { name: "Union" }).click()
record("quick create: Name + Union can be saved", await save.isEnabled())
await save.click()
await form.getByText(new RegExp(`${UNION_NAME} is ready for`)).waitFor({ state: "visible", timeout: 30000 })
record("quick create: the Union competition exists with an edition in the current Union season", sql(`select c.rugby_code || '|' || e.rugby_code from competitions c join competition_editions e on e.competition_id=c.id where c.name='${UNION_NAME}'`) === "union|union")

await form.getByLabel("Name").fill(LEAGUE_NAME)
await form.getByRole("radio", { name: "League" }).click()
await save.click()
await form.getByText(new RegExp(`${LEAGUE_NAME}`)).first().waitFor({ state: "visible", timeout: 30000 })
const leagueRow = sql(`select c.rugby_code || '|' || coalesce(e.rugby_code, 'no edition') from competitions c left join competition_editions e on e.competition_id=c.id where c.name='${LEAGUE_NAME}'`)
record("quick create: the League competition is League", leagueRow.startsWith("league|"), leagueRow)

// ---------------------------------------------------------------------
// ISOLATION IN THE FIXTURE EDITOR
// ---------------------------------------------------------------------
async function competitionOptions(fixtureId, opposition) {
  await page.goto(`${APP}/admin/fixtures?date=all&q=${encodeURIComponent(opposition)}`, { waitUntil: "domcontentloaded" })
  await settle()
  await page.locator(`button[aria-label^="Actions for"][aria-label*="${opposition}"]`).first().click()
  await page.getByRole("menuitem", { name: "Edit Fixture" }).click()
  const sheet = page.getByRole("dialog", { name: "Edit Fixture" })
  await sheet.waitFor({ state: "visible" })
  await sheet.getByLabel("Competition").waitFor({ state: "visible" })
  const options = await sheet.getByLabel("Competition").locator("option").allInnerTexts()
  await page.keyboard.press("Escape")
  return options
}
const unionOptions = await competitionOptions(unionFixture, unionOppName)
record("isolation: a Union fixture's Competition offers the new Union competition", unionOptions.some((o) => o.startsWith(UNION_NAME)), unionOptions.filter((o) => o.includes(TAG)).join(" | "))
record("isolation: and never the League one", !unionOptions.some((o) => o.startsWith(LEAGUE_NAME)))
if (leagueRow.endsWith("no edition")) {
  record("isolation: a League fixture's Competition offers the new League competition (needs a League season)", false, "No current or upcoming League season is registered locally")
} else {
  const leagueOptions = await competitionOptions(leagueFixture, `Isolation League ${TAG}`)
  record("isolation: a League fixture's Competition offers the new League competition", leagueOptions.some((o) => o.startsWith(LEAGUE_NAME)), leagueOptions.filter((o) => o.includes(TAG)).join(" | "))
  record("isolation: and never the Union one", !leagueOptions.some((o) => o.startsWith(UNION_NAME)))
}

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
await browser.close()
cleanup()
cleaned = true
record("cleanup: this run's fixtures and competitions are gone", sql(`select count(*) from competitions where name in ('${UNION_NAME}', '${LEAGUE_NAME}')`) === "0" && sql(`select count(*) from fixtures where notes='iso-${TAG}'`) === "0")
process.exit(summarise() ? 0 : 1)
