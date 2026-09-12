// INLINE EDITING, DIRTY STATE AND BULK SAVE
// (completion brief §5-§13, §61).

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 900 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

const PLANNER = `${APP}/fixtures/management?date=all`
await page.goto(PLANNER, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// §5 read state stays read state until asked
// ---------------------------------------------------------------------
record("§5 cells are plain until edited, not permanent form controls",
  (await page.evaluate(() => document.querySelectorAll("tbody input[type=time], tbody input[type=date]").length)) === 0)

const meetCells = page.locator('tbody button[aria-label^="Meet time"]')
record("§5 meet-time cells are individually editable", (await meetCells.count()) > 0,
  `${await meetCells.count()} cells`)

// ---------------------------------------------------------------------
// §5 double-click opens the right editor for the field
// ---------------------------------------------------------------------
await meetCells.first().dblclick()
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
async function editMeet(index, value) {
  const cell = page.locator('tbody button[aria-label^="Meet time"]').nth(index)
  await cell.dblclick()
  const input = page.locator("tbody input[type=time]").first()
  await input.waitFor({ state: "visible", timeout: 10000 })
  await input.fill(value)
  await input.press("Enter")
  await page.waitForTimeout(300)
}

await editMeet(0, "09:05")
await editMeet(1, "09:10")

const toolbar = await page.locator("body").innerText()
record("§6 the toolbar states how many fixtures are unsaved",
  /2 unsaved changes/i.test(toolbar), toolbar.match(/\d+ unsaved changes?/i)?.[0] ?? "(not shown)")
record("§6 edited cells are marked, and not by colour alone",
  (await page.locator("tbody button:has-text('edited')").count()) >= 2)
record("§6 nothing is written before Save",
  sql("select count(*) from public.fixtures where meet_time in ('09:05','09:10');") === "0")

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
await editMeet(0, "09:05")
await editMeet(1, "09:10")
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
  sql("select count(*) from public.fixtures where meet_time in ('09:05','09:10');") === "2")

// ---------------------------------------------------------------------
// §9 a refused row is named, and the good rows still save
// ---------------------------------------------------------------------
// A cancelled fixture refuses a kick-off change -- a real canonical rule,
// so the planner should report that one row and keep the rest.
const cancelled = sql("select id from public.fixtures where status = 'Cancelled' limit 1;")
if (cancelled) {
  const result = sql(`
    select string_agg(ok::text || ':' || coalesce(error_message, '-'), ' | ')
    from public.bulk_update_fixtures(
      jsonb_build_array(jsonb_build_object('fixture_id', '${cancelled}', 'kickoff_date', '2027-06-01'))
    );`)
  record("§9 a canonical refusal is returned per row with its own reason",
    /^false:/.test(result) && result.length > 8, result)
} else {
  record("§9 a canonical refusal is returned per row with its own reason", false, "no cancelled fixture available")
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

await browser.close()
process.exit(summarise() ? 0 : 1)
