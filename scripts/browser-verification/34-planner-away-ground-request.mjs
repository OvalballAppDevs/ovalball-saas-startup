// AN AWAY GROUND CHOSEN IN THE PLANNER REACHES THE FIXTURE.
// (Fixture Operations spec 7-10 and 41: opposition team default, away ground and
// pitch defaults, override preservation, an Ovalball opponent asked not booked,
// and incoming requests worded from the reader's side.)
//
// With real typing, as two real clubs:
//   * Ovalball UAT RUFC's Club Admin types an away Under 12 Boys row against
//     Preston: Preston's Under 12 Boys (never Under 12 Girls), Lightfoot Green and
//     its only pitch are suggested;
//   * a different ground and pitch are typed over them and kept;
//   * creating it sends Preston a request -- no fixture yet -- carrying both;
//   * the sender reads it as Away, Preston reads it as Home against the sender;
//   * Preston's Club Admin accepts, and the fixture is at the chosen ground and pitch.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const TAG = `AWAYGROUND-${Date.now().toString(36).toUpperCase()}`
const GROUND = `Preston Park ${TAG.slice(-4)}`
const PITCH = "Back Pitch"
if (!sql("select 1 from clubs where slug='preston-grasshoppers-uat'")) {
  console.error("Missing UAT data: run supabase/seeds/local_uat_fixture_operations.sql")
  process.exit(1)
}
// A Saturday in the current canonical season with no fixture or request for either Under 12 Boys side near it.
const DATE = sql(`
  with teams as (
    select t.id from teams t join clubs c on c.id = t.club_id
    where c.slug in ('ovalball-uat-rufc', 'preston-grasshoppers-uat') and t.display_name = 'Under 12 Boys' and t.active
  ), season as (
    select greatest(current_date + 14, starts_on) s, ends_on e from seasons
    where rugby_code = 'union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1
  )
  select d::date from season, generate_series((select s from season) + 90, (select e from season) - 7, interval '1 day') d
  where extract(isodow from d) = 6
    and not exists (select 1 from fixtures f where (f.owning_team_id in (select id from teams) or f.opponent_team_id in (select id from teams)) and f.status <> 'Cancelled' and f.kickoff_date between d::date - 3 and d::date + 3)
    and not exists (select 1 from fixture_requests r join fixture_request_groups g on g.id = r.group_id where r.status = 'sent' and (r.requesting_team_id in (select id from teams) or r.target_team_id in (select id from teams)) and g.proposed_date between d::date - 3 and d::date + 3)
  order by d limit 1`)
const [y, m, d] = DATE.split("-")
const DATE_TEXT = new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

const browser = await launch()
const pageErrors = []

// ---------------------------------------------------------------------
// PLAN: typed, as a person types it
// ---------------------------------------------------------------------
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")
await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

const cell = (label) => page.locator(`input[aria-label="${label}, row 1"]`)
const value = (label) => cell(label).inputValue()
async function typeInto(label, text, { choose = false } = {}) {
  await cell(label).click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(text, { delay: 15 })
  if (choose) {
    await page.locator('ul[role="listbox"] li[role="option"]').first().waitFor({ state: "visible", timeout: 30000 })
    await page.keyboard.press("Enter")
  } else {
    await page.keyboard.press("Tab")
  }
  await page.waitForTimeout(250)
}
await typeInto("Date", `${d}/${m}/${y}`)
await typeInto("Kick Off", "10:30")
await typeInto("H/A", "A")
await typeInto("Our Team", "Under 12 B", { choose: true })
await typeInto("Opposition Club", "Preston Grass", { choose: true })
await page.waitForFunction(() => document.querySelector('input[aria-label="Opposition Team, row 1"]')?.value, null, { timeout: 30000 }).catch(() => {})
record("plan: Preston's Under 12 Boys is suggested for our Under 12 Boys -- never their Under 12 Girls", (await value("Opposition Team")) === "Under 12 Boys", await value("Opposition Team"))
record("plan: away at Preston suggests their ground", (await value("Venue")) === "Lightfoot Green", await value("Venue"))
record("plan: and the only pitch at it", (await value("Pitch")) === "Pitch 1", await value("Pitch"))

await typeInto("Venue", GROUND)
await typeInto("Pitch", PITCH)
await typeInto("Notes", TAG)
record("plan: the chosen ground and pitch are kept, not replaced by Preston's", (await value("Venue")) === GROUND && (await value("Pitch")) === PITCH, `${await value("Venue")} / ${await value("Pitch")}`)
await page.getByRole("button", { name: "Check Rows" }).click()
await page.waitForFunction(() => /\d+ ready/.test(document.body.innerText) && !document.body.innerText.includes("Checking…"), null, { timeout: 120000 })
await page.getByRole("button", { name: /^Create 1 Fixture$/ }).click()
await page.waitForFunction(() => /requests? sent to Ovalball clubs/.test(document.body.innerText), null, { timeout: 120000 })
const request = sql(`select r.id || '|' || coalesce(r.proposed_ground, '') || '|' || r.venue_preference || '|' || coalesce(r.proposed_pitch, '') from fixture_requests r join fixture_request_groups g on g.id = r.group_id where r.note = '${TAG}' and g.proposed_date = '${DATE}'`)
const [requestId, proposed, preference, proposedPitch] = request.split("|")
record("create: Preston is asked -- a request is sent and no fixture is booked", Boolean(requestId) && sql(`select count(*) from fixtures where notes='${TAG}'`) === "0", request)
record("create: the request carries the ground and pitch that were chosen", proposed === GROUND && proposedPitch === PITCH && preference === "away", `${proposed}, ${proposedPitch} (${preference})`)
await page.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
const sent = page.locator("li").filter({ hasText: `At ${GROUND}, ${PITCH}` }).first()
const sentText = (await sent.innerText().catch(() => "")).replace(/\s+/g, " ")
record("create: the club that asked reads the same fixture as Away", /· Away\b/.test(sentText), sentText)
await ctx.close()

// ---------------------------------------------------------------------
// ANSWER: Preston sees the ground and accepts
// ---------------------------------------------------------------------
const pctx = await newContext(browser, { width: 1440, height: 950 })
const preston = await pctx.newPage()
preston.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(preston, "uat.preston.admin@ovalball.test")
await preston.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" })
await preston.waitForLoadState("networkidle").catch(() => {})
const openRequests = preston.getByRole("button", { name: /Fixture Requests|Requests/ }).first()
if ((await preston.getByText(`At ${GROUND}, ${PITCH}`).count()) === 0 && (await openRequests.count()) > 0) await openRequests.click()
const incoming = preston.locator("li").filter({ hasText: `At ${GROUND}, ${PITCH}` }).first()
await incoming.waitFor({ state: "visible", timeout: 30000 })
const incomingText = (await incoming.innerText()).replace(/\s+/g, " ")
record("answer: Preston's request names the proposed ground and pitch", incomingText.includes(DATE_TEXT), incomingText)
record("answer: Preston reads it from their side -- Home, against the club that asked", incomingText.includes("Under 12 Boys v Under 12 Boys, Ovalball UAT RUFC") && /· Home\b/.test(incomingText) && !/· away/i.test(incomingText), incomingText)
await incoming.getByRole("button", { name: /^Accept/ }).first().click()
for (let i = 0; i < 40 && sql(`select status from fixture_requests where id='${requestId}'`) !== "accepted"; i += 1) await preston.waitForTimeout(300)
const fixture = sql(`select f.id || '|' || f.home_away || '|' || coalesce(f.venue_address, '') || '|' || coalesce(f.venue_id::text, '') from fixture_requests r join fixtures f on f.id = r.resulting_fixture_id where r.id = '${requestId}'`)
const [fixtureId, homeAway, address, venueId] = fixture.split("|")
record("answer: accepting creates the fixture", Boolean(fixtureId) && homeAway === "Away", fixture)
record("answer: the fixture is at the ground and pitch that were chosen, not Preston's default", address === `${GROUND}, ${PITCH}` && venueId === "", `${address} ${venueId}`)
await pctx.close()

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))

// Cleanup: this run's request, fixture and staging rows.
const batch = sql(`select batch_id from fixture_import_rows where published_request_id='${requestId}'`)
sql(`delete from fixture_import_rows where published_request_id='${requestId}'`)
if (batch) sql(`delete from fixture_import_batches where id='${batch}'`)
const group = sql(`select group_id from fixture_requests where id='${requestId}'`)
if (fixtureId) {
  sql(`update fixture_requests set resulting_fixture_id=null where id='${requestId}'`)
  sql(`delete from notifications where data->>'fixture_id'='${fixtureId}'`)
  sql(`delete from fixtures where id='${fixtureId}'`)
}
sql(`delete from notifications where data->>'fixture_request_id'='${requestId}'`)
sql(`delete from fixture_requests where id='${requestId}'`)
if (group) sql(`delete from fixture_request_groups where id='${group}'`)
await browser.close()
process.exit(summarise() ? 0 : 1)
