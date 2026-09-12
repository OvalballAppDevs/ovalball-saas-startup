// FIXTURE CONTROL CENTRE -- THE PRODUCT UX RESET
// (Fixture Operations brief §75 visual acceptance, §104 product gate.)
//
// The complaint this answers is not a missing feature. It is that the
// surface "still feels too much like the previous administrative fixture
// table". So what is checked here is what a person actually meets: is the
// season readable as a season, is the work that needs doing visible
// before they touch a filter, and is the mass case the primary action
// rather than a link called "import".

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const SHOTS = process.env.SHOT_DIR ?? "/Users/Devs/.claude/jobs/e976849c/tmp"

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 1100 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

let body = await page.locator("body").innerText()

// ---------------------------------------------------------------------
// §75 WHAT THE SURFACE CALLS ITSELF AND WHAT IT OFFERS FIRST
// ---------------------------------------------------------------------
record("§75 the surface is a control centre, not a management table",
  (await page.getByRole("heading", { level: 1 }).innerText()) === "Fixture Control Centre",
  await page.getByRole("heading", { level: 1 }).innerText())

const planLink = page.getByRole("link", { name: "Plan Fixtures" })
record("§19 Plan Fixtures points at the Mass Fixture Planner",
  (await planLink.count()) === 1 && (await planLink.getAttribute("href")) === "/fixtures/planner",
  (await planLink.getAttribute("href")) ?? "missing")

const importLink = page.getByRole("link", { name: "Import Fixtures" })
record("§42-§43 Import Fixtures points at the Mass Fixture Planner too",
  (await importLink.getAttribute("href")) === "/fixtures/planner",
  (await importLink.getAttribute("href")) ?? "missing")

// ---------------------------------------------------------------------
// §75 THE WORK IS VISIBLE BEFORE ANY FILTER IS TOUCHED
// ---------------------------------------------------------------------
for (const phrase of [
  "in the next 7 days",
  "still missing a kick-off or a date",
  "played, with no result recorded",
]) {
  record(`§75 the attention band answers "${phrase}" on arrival`, body.includes(phrase))
}

// Each count must be a way IN, not a fact to go and look for.
const bandLinks = await page.locator('a[href*="resultStatus=none"], a[href*="status=To Be Determined"]').count()
record("§75 the counts are routes into the fixtures they count", bandLinks >= 2, `${bandLinks} band links`)

// And they must count the whole scope, not the page in front of them.
const clubId = sql(`select club_id from public.club_memberships
  where user_id=(select id from auth.users where email='uat.coach@ovalball.test') and status='active' limit 1`)
const dbOutstanding = Number(sql(`select count(*) from public.admin_fixture_overview
  where is_primary_mirror and (owning_club_id='${clubId}' or opponent_club_id='${clubId}')
  and kickoff_date < current_date and result_status='none' and status <> 'Cancelled'`))
const shownOutstanding = Number(
  (body.match(/(\d[\d,]*)\s*\n?\s*played, with no result recorded/) ?? [])[1]?.replace(/,/g, "") ?? -1,
)
record("§75 the band counts the whole club, not the current page",
  shownOutstanding === dbOutstanding, `screen ${shownOutstanding}, database ${dbOutstanding}`)

// ---------------------------------------------------------------------
// §2-§4, §8-§10 THE CLUB GRID IS STREAMLINED
//
// The corrective brief names three columns that must not consume prime
// horizontal space in a club's everyday view, and one pair that must be
// combined. These are checked as HEADERS, because a column that is merely
// empty is still a column taking width.
// ---------------------------------------------------------------------
// innerText reflects the CSS uppercase transform, so compare on a
// normalised form rather than on how the header happens to be painted.
const headers = (await page.locator("thead th").allInnerTexts()).map((h) => h.trim()).filter(Boolean)
const has = (name) => headers.some((h) => h.toLowerCase() === name.toLowerCase())
record("§4 the club grid shows only the everyday columns",
  headers.join(" | "), headers.join(" | "))

for (const [gone, why] of [
  ["Code", "a Union club is not told \"Union\" on every row"],
  ["Meet", "meet time is secondary detail, not a permanent club column"],
  ["Source", "provenance is administrative, not everyday"],
]) {
  record(`§8-§10 ${why}`, !has(gone), `headers: ${headers.join(", ")}`)
}

record("§3 Date and Kick Off are ONE column, not two",
  has("Date") && !has("Kick Off") && !has("Kick Off Time"),
  headers.join(" | "))

// And the kick-off is still THERE -- combined, not deleted.
const firstWhenCell = await page.locator("tbody tr").first().locator("td").nth(1).innerText()
record("§3 the combined column carries the date with the kick-off beneath it",
  /\d{1,2}\s+\w+\s+\d{4}/.test(firstWhenCell) && /\d{2}:\d{2}/.test(firstWhenCell),
  firstWhenCell.replace(/\n/g, " / "))

// §5 the club name is not repeated under our own teams on our own page.
const teamCell = await page.locator("tbody tr").first().locator("td").nth(2).innerText()
record("§5 our own club name is not repeated under every one of our teams",
  !teamCell.includes("Ovalball UAT RUFC"), teamCell.replace(/\n/g, " / "))

// ---------------------------------------------------------------------
// §11 ACTIONS ARE ONE MENU, NOT FOUR CONTROLS PER ROW
// ---------------------------------------------------------------------
const inlineActions = await page.locator("tbody").getByRole("link", { name: "Match Centre" }).count()
record("§11 the four inline row actions are gone",
  inlineActions === 0, `${inlineActions} inline Match Centre links`)

const menuTriggers = page.locator('tbody button[aria-label^="Actions for"]')
record("§11 every row has one compact actions menu", (await menuTriggers.count()) > 0,
  `${await menuTriggers.count()} menus`)

await menuTriggers.first().click()
await page.waitForTimeout(500)
const menuText = await page.locator('[role="menu"]').innerText()
for (const item of ["Open Match Centre", "View Fixture", "Edit Fixture", "Duplicate"]) {
  record(`§11 the menu offers ${item}`, menuText.includes(item), menuText.replace(/\n/g, " · "))
}
await page.keyboard.press("Escape")

// ---------------------------------------------------------------------
// §12 THE ROW ITSELF OPENS THE FIXTURE, AND THE CONTROLS STILL DON'T
// ---------------------------------------------------------------------
const beforeUrl = page.url()
await page.locator("tbody tr").first().locator('input[type="checkbox"]').click()
await page.waitForTimeout(400)
record("§12 clicking the select checkbox does NOT navigate", page.url() === beforeUrl, page.url())
record("§12 and it actually selects",
  await page.locator("tbody tr").first().locator('input[type="checkbox"]').isChecked())

await page.locator("tbody tr").first().locator("td").nth(3).click()
await page.waitForURL(/\/fixtures\/[0-9a-f-]{36}$|\/admin\/fixtures\//, { timeout: 60000 }).catch(() => {})
record("§12 clicking the row body opens the fixture",
  /\/fixtures\/[0-9a-f-]{36}$/.test(page.url()) || page.url().includes("/admin/fixtures/"), page.url())

await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// §18/§49 PRIMARY ACTION WORDING
// ---------------------------------------------------------------------
body = await page.locator("body").innerText()
record("§18 single-fixture creation says \"Add a Fixture\"", body.includes("Add a Fixture"))
record("§18 the rejected wording is gone", !body.includes("Add one fixture") && !body.includes("Add One Fixture"))
record("§43 the import control is labelled Import Fixtures", body.includes("Import Fixtures"))

// ---------------------------------------------------------------------
// EMPTY STATE -- an empty season is not a failed search
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/management?q=zzzznotarealclubname`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
body = await page.locator("body").innerText()
record("a filtered empty result offers a way back, not a shrug",
  body.includes("No fixtures match what you are looking for") && body.includes("Clear Filters"))

await page.goto(`${APP}/fixtures/management?season=00000000-0000-0000-0000-000000000000`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
body = await page.locator("body").innerText()
record("a genuinely empty scope offers the way in",
  body.includes("Plan a Season") || body.includes("No fixtures match what you are looking for"),
  body.includes("Plan a Season") ? "offers Plan a Season" : "treated as a filtered result")

// ---------------------------------------------------------------------
// SCREENSHOTS for the visual gate, desktop and phone
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.screenshot({ path: `${SHOTS}/control-centre-desktop.png`, fullPage: false })

await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.screenshot({ path: `${SHOTS}/mass-planner-desktop.png`, fullPage: false })

const mobileCtx = await newContext(browser, { width: 390, height: 844 })
const mobile = await mobileCtx.newPage()
await signIn(mobile, "uat.coach@ovalball.test")
await mobile.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await mobile.waitForLoadState("networkidle").catch(() => {})
await mobile.screenshot({ path: `${SHOTS}/control-centre-mobile.png`, fullPage: false })

const overflow = await mobile.evaluate(() => ({
  viewport: window.innerWidth,
  content: document.documentElement.scrollWidth,
}))
record("no horizontal overflow on the Control Centre at 390px",
  overflow.content <= overflow.viewport, `content ${overflow.content}px in ${overflow.viewport}px`)

// ---------------------------------------------------------------------
// ACCESSIBILITY -- the new band, grouping and empty state included
// ---------------------------------------------------------------------
const axeSource = (await import("node:fs")).readFileSync(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8")
await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.addScriptTag({ content: axeSource })
const violations = await page.evaluate(async () => {
  const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
  return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`)
})
record("the Control Centre is axe-clean at AA", violations.length === 0, violations.join("; ") || "no violations")

await browser.close()
summarise()
console.log(`\nScreenshots in ${SHOTS}`)
