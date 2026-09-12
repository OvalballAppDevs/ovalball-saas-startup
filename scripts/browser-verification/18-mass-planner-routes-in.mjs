// MASS FIXTURE PLANNER -- THE OTHER THREE WAYS IN
// (Fixture Operations brief §14 "manual typing, spreadsheet paste, CSV
// upload, Fixture Day ... all converge on the SAME row model", §53, §73-74.)
//
// Paste is proved in 17. This proves the claim that matters architecturally:
// that a file and a fixture day are not separate features with their own
// screens and their own idea of a valid fixture, but two more ways of
// filling in the same grid.

import { execFileSync } from "node:child_process"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const TAG = `ROUTESIN-${Date.now()}`
const dir = mkdtempSync(join(tmpdir(), "ovalball-planner-"))

// DELIBERATELY NOT OVALBALL'S COLUMN NAMES. This is what a league actually
// sends: nothing here matches an Ovalball column literally, and the file
// carries two columns Ovalball has no home for.
const csvPath = join(dir, "league-season.csv")
writeFileSync(
  csvPath,
  [
    "Start Date,KO,Meet,Match Type,Our Team,Opponent,Ground,Referee,Notes",
    `03/02/2029,11:00,10:15,H,Under 12 Boys,Aberaeron Rugby Football Club,Ovalball UAT Ground,J Smith,${TAG}`,
    `10/02/2029,1400,13:00,A,Under 13 Boys,Abercarn Rugby Football Club,,T Jones,${TAG}`,
    `17/02/2029,11:30,10:45,Home,Under 14 Girls,Aberavon Rugby Football Club,Ovalball UAT Ground,,${TAG}`,
  ].join("\n"),
)

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")
await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// Wait for the ANSWER. The toolbar hides the tally while a check is in
// flight and says how many rows it is matching instead, so "the spinner is
// gone" is not the signal -- "N ready" is.
async function waitForCheck() {
  await page.waitForFunction(() => /\d+ ready/.test(document.body.innerText), null, { timeout: 180000 })
}

// ---------------------------------------------------------------------
// CSV UPLOAD -- into the grid, not into a separate review screen
// ---------------------------------------------------------------------
await page.setInputFiles('input[type="file"]', csvPath)
await page.waitForFunction(() => document.body.innerText.includes("rows read from"), null, { timeout: 60000 })

record("§14 an uploaded file lands in the planner grid, not on another page",
  page.url().includes("/fixtures/planner"), page.url())

const uploadedTeam = await page.inputValue('input[aria-label="Our Team, row 1"]')
const uploadedKo = await page.inputValue('input[aria-label="Kick Off, row 2"]')
record("§14 a league's own column names are understood without renaming anything",
  uploadedTeam === "Under 12 Boys" && uploadedKo === "1400",
  `row1 team="${uploadedTeam}", row2 KO="${uploadedKo}"`)

const noticeText = await page.locator("body").innerText()
record("columns Ovalball has no home for are named, not silently dropped",
  noticeText.includes("Referee"), noticeText.split("\n").find((l) => l.includes("Referee")) ?? "")

await waitForCheck()
let body = await page.locator("body").innerText()
record("§53 the uploaded rows go through the SAME validation a paste does",
  /3 ready/.test(body), body.split("\n").find((l) => /ready/.test(l)) ?? "no tally")

// ---------------------------------------------------------------------
// FIXTURE DAY -- writes rows, creates nothing, leaves nothing behind
// ---------------------------------------------------------------------
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.getByRole("button", { name: "Fixture Day" }).click()

// Scoped to the panel: the grid has cells with these same labels, and a
// locator that cannot tell them apart is testing the wrong control.
const dayPanel = page.getByRole("region", { name: "Fixture Day" })
await dayPanel.getByLabel("Date").fill("2029-04-14")
await dayPanel.getByLabel("Opposition Club").fill("Aberaeron Rugby Football Club")
await dayPanel.getByLabel("First Kick Off").fill("10:00")
await dayPanel.getByLabel("Minutes Between").fill("45")

const dayTeams = ["Under 12 Boys", "Under 13 Boys", "Under 14 Girls", "Under 15 Boys"]
for (const t of dayTeams) await dayPanel.getByRole("button", { name: t, exact: true }).click()

// §48 renamed this: Fixture Day now says where it is taking you.
await dayPanel.getByRole("button", { name: /Continue to Planner/ }).click()
await waitForCheck()

const kickoffs = await Promise.all(
  [1, 2, 3, 4].map((n) => page.inputValue(`input[aria-label="Kick Off, row ${n}"]`)),
)
record("§14 Fixture Day writes one ordinary row per team, staggered",
  kickoffs.join(",") === "10:00,10:45,11:30,12:15", kickoffs.join(", "))

const sharedDate = await Promise.all(
  [1, 4].map((n) => page.inputValue(`input[aria-label="Date, row ${n}"]`)),
)
record("§14 every Fixture Day row shares the one date and opponent",
  sharedDate[0] === "2029-04-14" && sharedDate[1] === "2029-04-14" &&
    (await page.inputValue('input[aria-label="Opposition Club, row 4"]')) === "Aberaeron Rugby Football Club")

body = await page.locator("body").innerText()
record("§14 the rows are editable in the grid like any other, not locked into a wizard",
  /4 ready/.test(body), body.split("\n").find((l) => /ready/.test(l)) ?? "no tally")

record("Fixture Day created nothing by itself",
  Number(sql("select count(*) from public.fixtures where kickoff_date = '2029-04-14'")) === 0)

// THE ARCHITECTURAL CLAIM, tested as a claim: no Fixture Day entity exists.
const dayTables = sql(`select count(*) from information_schema.tables
  where table_schema='public' and (table_name ilike '%fixture_day%' or table_name ilike '%fixtureday%')`)
record("§14 no Fixture Day table was invented for this", Number(dayTables) === 0)

// ---------------------------------------------------------------------
// §73-74 A PHONE GETS A USABLE SURFACE, NOT A SIDEWAYS SPREADSHEET
// ---------------------------------------------------------------------
const mobileCtx = await newContext(browser, { width: 390, height: 844 })
const mobile = await mobileCtx.newPage()
await signIn(mobile, "uat.coach@ovalball.test")
await mobile.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await mobile.waitForLoadState("networkidle").catch(() => {})

const widths = await mobile.evaluate(() => ({
  viewport: window.innerWidth,
  content: document.documentElement.scrollWidth,
  grid: document.querySelector("table") ? getComputedStyle(document.querySelector("table").closest("div")).display : "absent",
}))
record("§73 the page reports the viewport it was actually given",
  widths.viewport === 390, `innerWidth ${widths.viewport}`)
record("§74 no horizontal overflow at 390px",
  widths.content <= widths.viewport, `content ${widths.content}px in ${widths.viewport}px`)
record("§74 the ten-column grid is not what a phone is shown",
  widths.grid === "none", `grid container display: ${widths.grid}`)
record("§74 a phone gets a labelled card editor instead",
  (await mobile.locator("article").count()) >= 1 &&
    (await mobile.locator('input[aria-label^="Opposition Club, row"], article input').count()) >= 1,
  `${await mobile.locator("article").count()} cards`)

// ---------------------------------------------------------------------
// ACCESSIBILITY
// ---------------------------------------------------------------------
const axeSource = (await import("node:fs")).readFileSync(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8")
await page.addScriptTag({ content: axeSource })
const violations = await page.evaluate(async () => {
  const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
  return results.violations.map((v) => `${v.id} (${v.nodes.length})`)
})
record("the planner is axe-clean at AA", violations.length === 0, violations.join("; ") || "no violations")

record("QA cleanup: this script created nothing to clean up",
  Number(sql(`select count(*) from public.fixtures where notes = '${TAG}'`)) === 0)

await browser.close()
summarise()
