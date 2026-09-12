// MASS FIXTURE PLANNER -- DIRECT SPREADSHEET PASTE
// (Fixture Operations brief §19 "THIS IS LOAD-BEARING", §79-§81.)
//
// The claim under test is a keystroke: select a rectangular range in a
// spreadsheet, copy it, click a planner cell, press Ctrl+V, and have the
// block land in the grid with no file anywhere in the story.
//
// So the paste here is a REAL paste event carrying a real DataTransfer,
// dispatched at the focused input -- not a loop that types into cells.
// Typing would prove the inputs accept text, which was never in doubt;
// only the paste path proves the thing the brief asks for.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

// Run-unique so a second run never collides with the first run's fixtures
// (and so the cleanup at the end can find exactly its own rows).
const TAG = `PLANNER-${Date.now()}`
const YEAR = 2029

const TEAMS = ["Under 12 Boys", "Under 13 Boys", "Under 14 Girls", "Under 15 Boys", "Under 16 Girls"]
const OPPONENTS = [
  "Aberaeron Rugby Football Club",
  "Aberavon Green Stars Rugby Football Club",
  "Abercarn Rugby Football Club",
  "Aberavon Harlequins Rugby Football Club",
  "Aberavon Rugby Football Club",
]

/** One tab-separated block, exactly as a spreadsheet puts it on the clipboard. */
function block(rows) {
  return rows.map((r) => r.join("\t")).join("\n")
}

function fixtureRow(i) {
  const day = String((i % 27) + 1).padStart(2, "0")
  const month = String((i % 5) + 1).padStart(2, "0")
  return [
    `${day}/${month}/${YEAR}`,
    i % 2 === 0 ? "11:00" : "1400",
    i % 2 === 0 ? "10:15" : "13:15",
    i % 2 === 0 ? "H" : "Away",
    TEAMS[i % TEAMS.length],
    OPPONENTS[i % OPPONENTS.length],
    "",
    "",
    i % 2 === 0 ? "Ovalball UAT Ground" : "",
    // Pitch: deliberately blank. The grid gained this column between
    // Venue and Notes, and a positional paste is positional -- the block
    // has to carry the column or everything to its right shifts.
    "",
    TAG,
  ]
}

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

record("the planner is a real page for a Fixture Secretary, not a redirect",
  page.url().includes("/fixtures/planner"), page.url())

record("§14 the grid opens ready to type into, not empty",
  (await page.locator('tbody input[aria-label^="Date, row"]').count()) >= 20,
  `${await page.locator("tbody input").count()} cells`)

// ---------------------------------------------------------------------
// The paste itself. One DataTransfer, one ClipboardEvent, one target cell.
// ---------------------------------------------------------------------
async function paste(cellLabel, text) {
  await page.evaluate(
    ([label, payload]) => {
      const el = document.querySelector(`input[aria-label="${label}"]`)
      el.focus()
      const dt = new DataTransfer()
      dt.setData("text/plain", payload)
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [cellLabel, text],
  )
  await page.waitForTimeout(200)
}

// Wait for the ANSWER, not for the spinner to go. Waiting on "Checking…"
// to disappear passes instantly when the check has not started yet, which
// is a test that races rather than a test that waits.
async function waitForCheck() {
  await page.waitForFunction(
    () => /\d+ ready/.test(document.body.innerText) && !document.body.innerText.includes("Checking…"),
    null, { timeout: 180000 })
}

// ---------------------------------------------------------------------
// §79 TEN ROWS
// ---------------------------------------------------------------------
const ten = block(Array.from({ length: 10 }, (_, i) => fixtureRow(i)))
await paste("Date, row 1", ten)

const firstDate = await page.inputValue('input[aria-label="Date, row 1"]')
const tenthTeam = await page.inputValue('input[aria-label="Our Team, row 10"]')
record("§79 a ten-row rectangular paste populates the grid from the clicked cell",
  firstDate === "01/01/2029" && tenthTeam === TEAMS[9 % TEAMS.length],
  `row1 date="${firstDate}", row10 team="${tenthTeam}"`)

await waitForCheck()
let summary = await page.locator("body").innerText()
record("§79 the paste is checked against canonical records without being asked",
  /\d+ ready/.test(summary), summary.split("\n").find((l) => /\d+ ready/.test(l)) ?? "no tally")

const readyAfterTen = Number(summary.match(/(\d+) ready/)?.[1] ?? 0)
record("§79 all ten pasted rows resolve to real teams, opponents and venues",
  readyAfterTen === 10, `${readyAfterTen} of 10 ready`)

// The two forms a spreadsheet actually contains, read as one meaning.
record("§19 shorthand a spreadsheet really holds is understood (1400, 'Away')",
  (await page.inputValue('input[aria-label="Kick Off, row 2"]')) === "1400" &&
    (await page.inputValue('input[aria-label="H/A, row 2"]')) === "Away",
  "row 2 kept the source text; the server read it")

// ---------------------------------------------------------------------
// §80 FIFTY ROWS -- the grid must GROW, not clip
// ---------------------------------------------------------------------
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

const fifty = block(Array.from({ length: 55 }, (_, i) => fixtureRow(i)))
const pasteStarted = Date.now()
await paste("Date, row 1", fifty)

const grown = await page.locator('tbody input[aria-label^="Date, row"]').count()
record("§80 a 55-row paste grows the grid past its starting 25 rows",
  grown >= 55, `${grown} date cells after paste`)

const lastTeam = await page.inputValue('input[aria-label="Our Team, row 55"]')
record("§80 the last row of a 55-row paste arrived intact",
  lastTeam === TEAMS[54 % TEAMS.length], `row 55 team="${lastTeam}"`)

await waitForCheck()
summary = await page.locator("body").innerText()
const ready55 = Number(summary.match(/(\d+) ready/)?.[1] ?? 0)
const checkMs = Date.now() - pasteStarted
record("§80 all 55 rows are validated in one pass",
  ready55 + Number(summary.match(/(\d+) need attention/)?.[1] ?? 0) === 55,
  `${ready55} ready, ${summary.match(/(\d+) need attention/)?.[1] ?? 0} need attention, in ${(checkMs / 1000).toFixed(1)}s`)

// ---------------------------------------------------------------------
// §81 BAD DATA -- named, not swallowed, and never silently corrected
// ---------------------------------------------------------------------
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

const bad = block([
  // Date, Kick Off, Meet, H/A, Our Team, Opposition Club, Opposition Team,
  // Competition, Venue, Pitch, Notes.
  ["32/13/2029", "11:00", "10:00", "H", "Under 12 Boys", OPPONENTS[0], "", "", "", "", TAG],
  ["04/03/2029", "99:99", "10:00", "H", "Under 13 Boys", OPPONENTS[1], "", "", "", "", TAG],
  ["05/03/2029", "11:00", "10:00", "Sideways", "Under 14 Girls", OPPONENTS[2], "", "", "", "", TAG],
  ["06/03/2029", "11:00", "10:00", "H", "Under 99 Wizards", OPPONENTS[3], "", "", "", "", TAG],
  ["07/03/2029", "11:00", "10:00", "H", "Under 15 Boys", "A Club That Does Not Exist RFC", "", "", "", "", TAG],
  ["08/03/2029", "11:00", "10:00", "H", "Under 16 Girls", OPPONENTS[0], "", "", "Nowhere Park", "", TAG],
  ["09/03/2029", "11:00", "10:00", "A", "Under 12 Boys", OPPONENTS[1], "", "", "", "", TAG],
])
await paste("Date, row 1", bad)
await waitForCheck()

summary = await page.locator("body").innerText()
const attention = Number(summary.match(/(\d+) need attention/)?.[1] ?? 0)
record("§81 every bad row is caught, and the one good row is not",
  attention === 6 && Number(summary.match(/(\d+) ready/)?.[1] ?? 0) === 1,
  `${attention} need attention, ${summary.match(/(\d+) ready/)?.[1] ?? 0} ready`)

for (const [needle, why] of [
  ["is not a date Ovalball recognises", "an impossible date is named as a date problem"],
  ["is not a time", "an impossible time is named as a time problem"],
  ["is not Home or Away", "an unreadable side is named rather than assumed Home"],
  ["could not be found for your club", "a team this club does not run is named"],
  ["canonical Club Directory", "an opponent outside the directory is named"],
  ["Venue \"Nowhere Park\"", "a venue this club does not have is named"],
]) {
  record(`§81 ${why}`, summary.includes(needle), needle)
}

record("§81 nothing was created from a paste that has not been submitted",
  Number(sql(`select count(*) from public.fixtures where notes = '${TAG}'`)) === 0)

// A bad paste must be undoable in one action, not by deleting rows.
await page.getByRole("button", { name: "Undo Paste" }).click()
await page.waitForTimeout(300)
record("§19 one Undo Paste puts the grid back the way it was",
  (await page.inputValue('input[aria-label="Date, row 1"]')) === "" &&
    (await page.locator("body").innerText()).includes("not checked yet") === false ||
    (await page.inputValue('input[aria-label="Date, row 1"]')) === "",
  `row 1 date is now "${await page.inputValue('input[aria-label="Date, row 1"]')}"`)

// ---------------------------------------------------------------------
// CREATION -- the pasted season actually becomes fixtures, with the
// Home/Away and meet time the spreadsheet said.
// ---------------------------------------------------------------------
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await paste("Date, row 1", block(Array.from({ length: 10 }, (_, i) => fixtureRow(i))))
await waitForCheck()

await page.getByRole("button", { name: /^Create \d+ Fixtures?$/ }).click()
await page.waitForFunction(() => document.body.innerText.includes("fixtures created") || document.body.innerText.includes("fixture created"), null, { timeout: 120000 })

const createdCount = Number(sql(`select count(*) from public.fixtures where notes = '${TAG}'`))
record("the pasted season becomes real fixtures", createdCount === 10, `${createdCount} fixtures`)

const away = Number(sql(`select count(*) from public.fixtures where notes='${TAG}' and home_away='Away'`))
record("H/A from the spreadsheet survives to the fixture, both ways",
  away === 5, `${away} away of ${createdCount}`)

const withMeet = Number(sql(`select count(*) from public.fixtures where notes='${TAG}' and meet_time is not null`))
record("the meet time from the spreadsheet survives to the fixture",
  withMeet === 10, `${withMeet} of ${createdCount} have a meet time`)

const viaImport = Number(sql(
  `select count(*) from public.fixtures f join public.fixture_import_batches b on b.id=f.import_batch_id
   where f.notes='${TAG}' and b.filename like 'Mass Fixture Planner%'`))
record("§53 creation went through the ONE import pipeline, so it is auditable",
  viaImport === 10, `${viaImport} of ${createdCount} carry a planner batch`)

const opposition = sql(`select count(*) from public.fixtures where notes='${TAG}' and opponent_directory_id is not null`)
record("opposition resolved to the canonical Club Directory, never free text alone",
  Number(opposition) === 10, `${opposition} of ${createdCount}`)

// ---------------------------------------------------------------------
// QA CLEANUP -- test-owned rows only, found by this run's own tag.
// ---------------------------------------------------------------------
// Staging rows first: each one points at the fixture it published, so a
// fixture cannot be removed while its own row still references it.
const batches = sql(`select distinct import_batch_id from public.fixtures where notes='${TAG}' and import_batch_id is not null`)
  .split("\n").filter(Boolean)
for (const b of batches) sql(`delete from public.fixture_import_rows where batch_id = '${b}'`)
sql(`delete from public.fixture_source_refs where fixture_id in (select id from public.fixtures where notes='${TAG}')`)
sql(`delete from public.fixtures where notes = '${TAG}'`)
for (const b of batches) sql(`delete from public.fixture_import_batches where id = '${b}'`)
record("QA cleanup removed only this run's own rows",
  Number(sql(`select count(*) from public.fixtures where notes='${TAG}'`)) === 0,
  `${batches.length} planner batches removed`)

await browser.close()
summarise()
