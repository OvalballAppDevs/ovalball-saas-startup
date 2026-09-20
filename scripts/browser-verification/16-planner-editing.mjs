// INLINE EDITING, DIRTY STATE AND BULK SAVE
// (completion brief §5-§13, §61).

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"
import { ensureFixtureWorld, seedFixturesAtScale } from "./fixture-world.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

// THIS SUITE STATES ITS OWN PRECONDITIONS.
//
// It reads canonical teams and pitches in the automated UAT club, and those
// records had silently gone, so the suite reported a product failure when what
// it had found was a missing row. It now creates whatever is absent and removes
// exactly what it created -- see fixture-world.mjs for why that lives in one
// place rather than in each suite.
const world = ensureFixtureWorld(sql, { tag: "s16" })

// THIS SUITE EDITS FIXTURES, so it makes the ones it edits. It used to edit
// whatever happened to be first on the page, which meant it mutated whichever
// club fixture another suite -- or a person -- had left there, and its
// assertions ("nothing is written before Save") could be satisfied or broken by
// rows it did not own.
const OWN = `EDIT-${Date.now()}`
const seeded = seedFixturesAtScale(sql, { clubId: world.clubId, count: 4, tag: OWN, startYear: 2032, oppositionPrefix: OWN, sweepPrefix: "EDIT-" })
// One of them cancelled, because the canonical refusal this suite checks (§9)
// is "a cancelled fixture will not take a new kick-off".
sql(`update public.fixtures set status = 'Cancelled', cancelled_at = now() where notes = '${OWN}' and raw_opposition_text = '${OWN} 4'`)

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 900 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

const PLANNER = `${APP}/fixtures/management?date=all&q=${OWN}`
await page.goto(PLANNER, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// §5 read state stays read state until asked
// ---------------------------------------------------------------------
record("§5 cells are plain until edited, not permanent form controls",
  (await page.evaluate(() => document.querySelectorAll("tbody input[type=time], tbody input[type=date]").length)) === 0)

// MEET TIME MOVED. The Control Centre redesign made Meet a Site Admin column
// -- meet time is secondary detail that belongs with the fixture rather than
// in a club's prime horizontal space -- so a club's inline-editable time is the
// KICK-OFF, under the date. This suite is about inline editing, dirty state and
// bulk save; those are unchanged, and it now exercises them on the field the
// club surface actually offers. Site Admin's meet-time cell is asserted below,
// where it now lives.
const timeCells = page.locator('tbody button[aria-label^="Kick off time"]')
record("§5 kick-off cells are individually editable", (await timeCells.count()) > 0,
  `${await timeCells.count()} cells`)

// ---------------------------------------------------------------------
// §5 double-click opens the right editor for the field
// ---------------------------------------------------------------------
await timeCells.first().dblclick()
await page.waitForTimeout(400)
record("§5 double-click opens a time editor",
  (await page.locator("tbody input[type=time]").count()) > 0)

// §61 Escape abandons without changing anything
await page.keyboard.press("Escape")
await page.waitForTimeout(300)
record("§61 Escape closes the editor without committing",
  (await page.locator("tbody input[type=time]").count()) === 0 &&
    (await page.locator("text=unsaved").count()) === 0)

// ---------------------------------------------------------------------
// §6 edit two rows -> dirty state names how many
// ---------------------------------------------------------------------
async function editKickoff(index, value) {
  const cell = page.locator('tbody button[aria-label^="Kick off time"]').nth(index)
  await cell.dblclick()
  const input = page.locator("tbody input[type=time]").first()
  await input.waitFor({ state: "visible", timeout: 10000 })
  await input.fill(value)
  await input.press("Enter")
  await page.waitForTimeout(300)
}

await editKickoff(0, "09:05")
await editKickoff(1, "09:10")

const toolbar = await page.locator("body").innerText()
record("§6 the toolbar states how many fixtures are unsaved",
  /2 unsaved changes/i.test(toolbar), toolbar.match(/\d+ unsaved changes?/i)?.[0] ?? "(not shown)")
record("§6 edited cells are marked, and not by colour alone",
  (await page.locator("tbody button:has-text('edited')").count()) >= 2)
record("§6 nothing is written before Save",
  sql(`select count(*) from public.fixtures where notes = '${OWN}' and kickoff_time in ('09:05','09:10');`) === "0")

// ---------------------------------------------------------------------
// §6 Discard returns to canonical values
// ---------------------------------------------------------------------
await page.getByRole("button", { name: "Discard Changes" }).click()
await page.waitForTimeout(400)
record("§6 Discard clears the dirty state",
  !/unsaved changes/i.test(await page.locator("body").innerText()))

// ---------------------------------------------------------------------
// §8/§9/§10 save two rows through the canonical bulk path
// ---------------------------------------------------------------------
await editKickoff(0, "09:05")
await editKickoff(1, "09:10")
await page.getByRole("button", { name: "Save Changes" }).click()
await page.waitForFunction(
  () => /Saved \d+ fixtures?/.test(document.body.innerText) || /need attention/.test(document.body.innerText),
  null,
  { timeout: 30000 },
)

const afterSave = await page.locator("body").innerText()
record("§10 the save reports what actually happened",
  /Saved 2 fixtures/.test(afterSave), afterSave.match(/Saved \d+ fixtures?|[\d]+ saved · \d+ need attention/)?.[0] ?? "(no report)")
record("§8 the change reached the database through the canonical writer",
  sql(`select count(*) from public.fixtures where notes = '${OWN}' and kickoff_time in ('09:05','09:10');`) === "2")

// ---------------------------------------------------------------------
// §9 a refused row is named, and the good rows still save
// ---------------------------------------------------------------------
// A cancelled fixture refuses a kick-off change -- a real canonical rule,
// so the planner should report that one row and keep the rest.
// THE CALL IS MADE AS A REAL SIGNED-IN PERSON.
//
// This used to invoke bulk_update_fixtures straight from psql, as superuser,
// with no session at all -- so the function's FIRST line refused it with "You
// must be signed in" and the suite died before reaching the rule it came to
// test. It never proved the per-row refusal; it proved that an unauthenticated
// caller is refused, which a different suite already covers, and then crashed.
// The claim is set the same way the SQL suites set it, so the function runs as
// the Coach who is driving this browser.
const cancelled = sql(`select id from public.fixtures where notes = '${OWN}' and status = 'Cancelled' limit 1;`)
const coachId = sql("select id from auth.users where email = 'uat.coach@ovalball.test' limit 1;")
if (cancelled && coachId) {
  const result = sql(`
    select set_config('request.jwt.claims', json_build_object('sub', '${coachId}', 'role', 'authenticated')::text, true) is not null
      and true;
    select string_agg(ok::text || ':' || coalesce(error_message, '-'), ' | ')
    from public.bulk_update_fixtures(
      jsonb_build_array(jsonb_build_object('fixture_id', '${cancelled}', 'kickoff_date', '2027-06-01'))
    );`).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""
  record("§9 a canonical refusal is returned per row with its own reason",
    /^false:/.test(result) && result.length > 8, result)
} else {
  record("§9 a canonical refusal is returned per row with its own reason", false,
    cancelled ? "the Coach identity is missing" : "this run seeded no cancelled fixture")
}

// ---------------------------------------------------------------------
// §11 selection
// ---------------------------------------------------------------------
await page.goto(PLANNER, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.locator('tbody input[type=checkbox]').first().check()
await page.locator('tbody input[type=checkbox]').nth(1).check()
await page.waitForTimeout(300)
record("§11 selecting rows is reported in the toolbar",
  /2 fixtures selected/i.test(await page.locator("body").innerText()),
  (await page.locator("body").innerText()).match(/\d+ fixtures? selected/i)?.[0] ?? "(not shown)")

await page.getByRole("button", { name: "Clear Selection" }).click()
await page.waitForTimeout(300)
record("§11 selection can be cleared",
  !/fixtures selected/i.test(await page.locator("body").innerText()))

// SITE ADMIN KEEPS THE MEET COLUMN, and it is still inline-editable there --
// asserted where it now lives rather than deleted along with the club
// assertion, so the field is not quietly left untested by a layout change.
const siteCtx = await newContext(browser, { width: 1440, height: 900 })
const sitePage = await siteCtx.newPage()
await signIn(sitePage, "uat.fullsiteadmin@ovalball.test")
await sitePage.goto(`${APP}/admin/fixtures?date=all&q=${OWN}`, { waitUntil: "domcontentloaded" })
await sitePage.waitForLoadState("networkidle").catch(() => {})
record("§5 meet time is still inline-editable, on the surface that now carries it",
  (await sitePage.locator('tbody button[aria-label^="Meet time"]').count()) > 0,
  `${await sitePage.locator('tbody button[aria-label^="Meet time"]').count()} cells on /admin/fixtures`)
await siteCtx.close()

seeded.cleanup()
world.cleanup()
await browser.close()
process.exit(summarise() ? 0 : 1)
