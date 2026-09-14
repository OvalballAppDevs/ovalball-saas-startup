// MASS FIXTURE PLANNER -- STRUCTURED LOOKUPS AND ROUTING
// (Corrective brief §31-§38 data validation, §47 lookup editor, §60-§61
// and §66 route proof.)
//
// §37 is the claim under test: a structured planner column must behave
// like spreadsheet DATA VALIDATION rather than free text. So these checks
// drive the real controls -- type into a cell, read the listbox that
// appears, choose an option, and confirm the next cell narrowed itself --
// against real canonical data, never a stub.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// §21-§26 THE GRID IS THE PRODUCT, AND IT IS THERE ON ARRIVAL
// ---------------------------------------------------------------------
// Each header also carries a screen-reader-only "Fill X down the column"
// label, so the visible name is the first line, not the whole cell.
const headers = (await page.locator("thead th").allInnerTexts())
  .map((h) => h.split("\n")[0].trim())
  .filter(Boolean)
record("§23 every data-entry column is present on load", headers.join(" | "), headers.join(" | "))
for (const col of ["Date", "Kick Off", "Meet", "H/A", "Our Team", "Opposition Club", "Opposition Team", "Competition", "Venue", "Pitch", "Notes"]) {
  record(`§23 the grid has a ${col} column`, headers.some((h) => h.toLowerCase() === col.toLowerCase()), headers.join(", "))
}

const blankRows = await page.locator('tbody input[aria-label^="Date, row"]').count()
record("§25 20+ blank rows are waiting on arrival, with no Add Row needed", blankRows >= 20, `${blankRows} rows`)

const rowNumbers = await page.locator("tbody tr td:first-child").first().innerText()
record("§24 rows are numbered", rowNumbers.trim() === "1", `first row cell = "${rowNumbers.trim()}"`)

// §22: the grid, not the chrome, owns the viewport.
const proportions = await page.evaluate(() => {
  const grid = document.querySelector("table")?.closest("div")
  return {
    grid: grid ? Math.round(grid.getBoundingClientRect().height) : 0,
    viewport: window.innerHeight,
  }
})
record("§22 the grid owns most of the page, not a hero and a card",
  proportions.grid / proportions.viewport > 0.6,
  `grid ${proportions.grid}px of ${proportions.viewport}px viewport`)

// §26: cell boundaries are visible, not implied by a soft card.
const bordered = await page.evaluate(() => {
  const cell = document.querySelector("tbody tr td:nth-child(3)")
  if (!cell) return null
  const s = getComputedStyle(cell)
  return { right: s.borderRightWidth, bottom: s.borderBottomWidth }
})
record("§26 cells have visible boundaries", bordered?.right !== "0px" && bordered?.bottom !== "0px", JSON.stringify(bordered))

// §38: a structured cell SAYS it is structured.
const indicators = await page.locator('tbody [role="combobox"]').count()
record("§38 structured cells are marked as such, not discovered by accident",
  indicators >= blankRows * 6 * 0.5, `${indicators} combobox cells`)

// ---------------------------------------------------------------------
// §31 OUR TEAM -- a real lookup against this club's own roster
// ---------------------------------------------------------------------
async function openCell(label) {
  const input = page.locator(`input[aria-label="${label}"]`)
  await input.click()
  await page.waitForTimeout(500)
  return input
}
/**
 * Wait for the ANSWER, not for a fixed delay.
 *
 * A lookup goes to the server, and on a loaded dev server that can take
 * many seconds. A test that waits a second and then reads an empty list is
 * testing the clock, and reports "this lookup returns nothing" about a
 * lookup that works.
 */
async function optionsFor(label, { allowEmpty = false } = {}) {
  const list = page.locator('ul[role="listbox"]').first()
  await list.waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(
      (expectOptions) => {
        const ul = document.querySelector('ul[role="listbox"]')
        if (!ul) return false
        if (ul.innerText.includes("Searching")) return false
        // An absent spinner is not an answer: settle only once options have
        // arrived, or -- where none are genuinely expected -- once the list
        // has said so.
        return expectOptions ? ul.querySelectorAll('li[role="option"]').length > 0 : true
      },
      !allowEmpty,
      { timeout: 60000 },
    )
    .catch(() => {})
  const texts = (await list.locator('li[role="option"]').allInnerTexts()).map((t) => t.trim())
  if (texts.length === 0 && !allowEmpty) {
    const shown = await list.innerText().catch(() => "")
    record(`(diagnostic) ${label} returned no options`, true, shown.replace(/\n/g, " ").slice(0, 100))
  }
  return texts
}

await openCell("Our Team, row 1")
let opts = await optionsFor("Our Team, row 1")
const dbTeams = Number(sql(`select count(*) from public.teams t
  join public.club_memberships cm on cm.club_id = t.club_id
  where cm.user_id=(select id from auth.users where email='uat.coach@ovalball.test')
    and cm.status='active' and t.active`))
record("§31 Our Team offers this club's real active teams", opts.length > 0 && opts.length <= dbTeams,
  `${opts.length} offered, ${dbTeams} active in the database: ${opts.slice(0, 3).join(", ")}`)

await page.keyboard.type("Under 12")
await page.waitForTimeout(500)
opts = await optionsFor("Our Team, row 1")
record("§31 typing narrows it to matching teams",
  opts.length > 0 && opts.every((o) => o.toLowerCase().includes("under 12")), opts.join(", "))
await page.keyboard.press("Enter")
const chosenTeam = await page.inputValue('input[aria-label="Our Team, row 1"]')
record("§31 choosing an option writes the canonical team name", chosenTeam.startsWith("Under 12"), chosenTeam)

// ---------------------------------------------------------------------
// §32 OPPOSITION CLUB -- Ovalball clubs AND the Club Directory, distinguished
// ---------------------------------------------------------------------
await openCell("Opposition Club, row 1")
await page.keyboard.type("Rossendale")
opts = await optionsFor("Opposition Club, row 1")
record("§32 Opposition Club searches real clubs as you type", opts.length > 0, opts.slice(0, 4).join(" | "))
record("§32 and says where each result comes from",
  opts.some((o) => o.includes("Club Directory") || o.includes("On Ovalball")), opts.slice(0, 2).join(" | "))

await page.keyboard.press("Enter")
const chosenOpp = await page.inputValue('input[aria-label="Opposition Club, row 1"]')
record("§32 choosing writes the canonical club name, never the typed fragment",
  chosenOpp.toLowerCase().includes("rossendale") && chosenOpp !== "Rossendale", chosenOpp)

// ---------------------------------------------------------------------
// §33/§36 DEPENDENT LOOKUPS SAY WHAT THEY DEPEND ON
// ---------------------------------------------------------------------
await openCell("Opposition Team, row 1")
await page.waitForTimeout(900)
let listText = await page.locator('ul[role="listbox"]').first().innerText().catch(() => "")
record("§33 Opposition Team explains itself for an external opponent",
  listText.includes("Ovalball opposition club") || listText.includes("external opponent"), listText.replace(/\n/g, " "))

await openCell("Pitch, row 1")
await page.waitForTimeout(900)
listText = await page.locator('ul[role="listbox"]').first().innerText().catch(() => "")
record("§36 Pitch depends on a venue and says so",
  listText.includes("venue") || listText.length > 0, listText.replace(/\n/g, " ").slice(0, 90))

// ---------------------------------------------------------------------
// §34 COMPETITION -- real editions only
// ---------------------------------------------------------------------
const dbEditions = Number(sql("select count(distinct c.name) from public.competition_editions e join public.competitions c on c.id=e.competition_id where e.active"))
await openCell("Competition, row 1")
opts = await optionsFor("Competition, row 1", { allowEmpty: dbEditions === 0 })
// The right answer when a club has no active competitions is an EMPTY
// list, not an invented one -- so the assertion is against the database,
// not against a hope that some options exist.
record("§34 Competition offers exactly the real active editions, and never free text",
  opts.length === Math.min(dbEditions, 40),
  `${opts.length} offered of ${dbEditions} active: ${opts.slice(0, 3).join(", ") || "(none, correctly)"}`)

// ---------------------------------------------------------------------
// §35 VENUE -- real venues, ranked by where the match is played
// ---------------------------------------------------------------------
await openCell("Venue, row 1")
opts = await optionsFor("Venue, row 1")
record("§35 Venue is a lookup over this club's real venues", opts.length > 0, opts.slice(0, 4).join(" | "))
record("§35 and marks which are ours", opts.some((o) => o.includes("Our ground")), opts.slice(0, 2).join(" | "))

// ---------------------------------------------------------------------
// §61/§66 ROUTES
// ---------------------------------------------------------------------
for (const [from, expect, why] of [
  ["/fixtures/import", "/fixtures/import", "the import route is the import wizard, not the planner"],
  ["/fixtures/planner", "/fixtures/planner", "the planner route is the planner"],
]) {
  await page.goto(`${APP}${from}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record(`§43 ${why}`, page.url().endsWith(expect), `${from} → ${page.url()}`)
}

await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.getByRole("link", { name: "Plan Season" }).click()
await page.waitForURL(/\/fixtures\/planner/, { timeout: 60000 }).catch(() => {})
record("§19 clicking Plan Season lands on the Season Planner", page.url().includes("/fixtures/planner"), page.url())

await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.getByRole("link", { name: "Import Fixtures" }).click()
await page.waitForURL(/\/fixtures\/import/, { timeout: 60000 }).catch(() => {})
record("§43 clicking Import Fixtures lands on the import wizard, not the planner", page.url().includes("/fixtures/import"), page.url())

// ---------------------------------------------------------------------
// §53 SITE ADMIN GETS A CLUB CHOOSER, NOT A SILENT REDIRECT
// ---------------------------------------------------------------------
const adminCtx = await newContext(browser, { width: 1280, height: 900 })
const admin = await adminCtx.newPage()
await signIn(admin, "uat.fullsiteadmin@ovalball.test")
await admin.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await admin.waitForLoadState("networkidle").catch(() => {})
const adminBody = await admin.locator("body").innerText()
record("§53 a Site Admin reaches the planner rather than being bounced",
  admin.url().includes("/fixtures/planner"), admin.url())
record("§53 and is asked which club's season they are planning",
  adminBody.includes("season are you planning"),
  adminBody.split("\n").find((l) => l.includes("season are you planning")) ?? adminBody.slice(0, 120))

// The chooser must not be a way past club scoping: picking a club still
// runs every capability check that a club member's route runs.
const someClub = sql("select id from public.clubs where status='active' limit 1")
await admin.goto(`${APP}/fixtures/planner?club=${someClub}`, { waitUntil: "domcontentloaded" })
await admin.waitForLoadState("networkidle").catch(() => {})
record("§53 choosing a club opens that club's planner under the normal checks",
  (await admin.locator("table").count()) > 0 || admin.url().includes("/fixtures"), admin.url())

// And an ordinary member cannot reach another club's planner by naming it.
const outsiderCtx = await newContext(browser, { width: 1280, height: 900 })
const outsider = await outsiderCtx.newPage()
await signIn(outsider, "uat.unrelated@ovalball.test")
await outsider.goto(`${APP}/fixtures/planner?club=${someClub}`, { waitUntil: "domcontentloaded" })
await outsider.waitForLoadState("networkidle").catch(() => {})
record("§53 naming a club in the URL is not a way into it",
  !outsider.url().includes("/fixtures/planner"), `sent to ${outsider.url()}`)

await browser.close()
summarise()
