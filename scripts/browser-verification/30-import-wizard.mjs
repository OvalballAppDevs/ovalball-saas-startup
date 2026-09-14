// IMPORT FIXTURES -- a different job from planning a season.
// (Fixture Operations brief: Plan Season and Import Fixtures are separate; Import is
// Upload/Paste -> Map -> Preview -> Validate -> Stage -> Publish; mass loading is
// club administration only; an Ovalball opponent is asked, never booked.)
//
//   * Pasted spreadsheet rows land on Map with every column's meaning guessed
//     from its heading, and a column Ovalball has no home for left out.
//   * Preview shows the rows as read; Validate checks them against canonical
//     records without writing anything.
//   * An Ovalball club named without one of its teams is a row to look at, not
//     a fixture booked against them.
//   * Staging creates a batch and moves to Stage/Publish on the batch page.
//   * An .xlsx workbook is read directly, dates and times as the cells showed.
//   * Team staff never reach the import.

import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateRawSync } from "node:zlib"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const DAY = sql("select to_char((select starts_on from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1) + 150, 'DD/MM/YYYY')")
const TAG = Date.now().toString(36).slice(-5).toUpperCase()

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")

let writes = 0
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/fixtures/import")) writes += 1
})

await page.goto(`${APP}/fixtures/import`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
const steps = page.getByRole("navigation", { name: "Import steps" })
record("steps: Upload or Paste, Map Columns, Preview, Validate, Stage, Publish", (await steps.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/^\d+\s*/, "").split("\n")[0].trim()).join(",").replace(/\s+/g, " ") === "Upload or Paste,Map Columns,Preview,Validate,Stage,Publish", (await steps.innerText()).replace(/\s+/g, " "))

// ---------------------------------------------------------------------
// PASTE -> MAP
// ---------------------------------------------------------------------
await page.getByRole("tab", { name: "Paste Rows" }).click()
const pasted = [
  ["Match Date", "KO", "Our Team", "Opponent", "Type", "Referee"],
  [DAY, "10:30", "Under 12 Boys", "Fylde Rugby Football Club", "League", "A Smith"],
  [DAY, "12:00", "Under 13 Boys", "Preston Grasshoppers RFC", "friendly", "B Jones"],
  ["31/02/2027", "11:00", "Under 12 Girls", "Fylde Rugby Football Club", "Cup", `ref ${TAG}`],
]
  .map((r) => r.join("\t"))
  .join("\n")
await page.getByLabel("Rows from a Spreadsheet").fill(pasted)
await page.getByRole("button", { name: "Use These Rows" }).click()
await page.getByRole("heading", { name: "What Each Column Means" }).waitFor()
const mapped = async (col) => page.getByLabel(`Import ${col} As`).evaluate((el) => el.options[el.selectedIndex].text)
record("map: headings are understood by meaning (Match Date is Date, KO is Kick Off, Opponent is Opposition Club)", (await mapped("Match Date")).startsWith("Date") && (await mapped("KO")) === "Kick Off" && (await mapped("Opponent")).startsWith("Opposition Club"), `${await mapped("Match Date")} / ${await mapped("KO")} / ${await mapped("Opponent")}`)
record("map: Type is recognised as the fixture type", (await mapped("Type")) === "Type")
record("map: a column Ovalball has no home for is left out, not guessed", (await mapped("Referee")) === "Don’t Import")
record("map: nothing has been sent to the server yet", writes === 0, `${writes} requests`)

await page.getByLabel("Import Our Team As").selectOption("")
record("map: a required column left unmapped is named", (await page.getByText("Choose which column is Our Team.").count()) === 1)
record("map: and Preview waits for it", await page.getByRole("button", { name: /Preview \d+ Rows/ }).isDisabled())
await page.getByLabel("Import Our Team As").selectOption("ourTeam")

// ---------------------------------------------------------------------
// PREVIEW -> VALIDATE
// ---------------------------------------------------------------------
await page.getByRole("button", { name: "Preview 3 Rows", exact: true }).click()
await page.getByRole("heading", { name: "The Rows Ovalball Will Check" }).waitFor()
record("preview: the three rows are shown as read", (await page.locator("section[aria-labelledby='rows-title'] tbody tr").count()) === 3)
await page.getByRole("button", { name: "Check 3 Rows", exact: true }).click()
await page.getByRole("heading", { name: "Checked Against Ovalball" }).waitFor()
const rows = page.locator("section[aria-labelledby='rows-title'] tbody tr")
const rowText = async (i) => (await rows.nth(i).innerText()).replace(/\s+/g, " ")
record("validate: a row against a club not on Ovalball is ready", (await rowText(0)).includes("Ready"), await rowText(0))
record("validate: an Ovalball club named without one of its teams needs a look -- asked, not booked", (await rowText(1)).includes("Needs a look") && (await rowText(1)).includes("asked rather than booked"), await rowText(1))
record("validate: an impossible date is not readable, and says why", (await rowText(2)).includes("Not readable") && (await rowText(2)).includes("is not a date"), await rowText(2))
record("validate: checking wrote nothing", sql(`select count(*) from fixture_import_rows where raw::text like '%${TAG}%'`) === "0")

// ---------------------------------------------------------------------
// STAGE -> the batch page
// ---------------------------------------------------------------------
await page.getByRole("button", { name: "Stage 3 Rows", exact: true }).click()
await page.waitForURL(/\/fixtures\/import\/[0-9a-f-]+$/)
const batchId = page.url().split("/").pop()
record("stage: staging creates a batch and opens it", sql(`select row_count from fixture_import_batches where id='${batchId}'`) === "3")
const batchSteps = page.getByRole("navigation", { name: "Import steps" })
record("stage: the batch page continues the same steps at Publish", (await batchSteps.locator('[aria-current="step"]').innerText()).includes("Publish"))
record("stage: the Type column is carried as the stored classification", sql(`select normalized_game_type from fixture_import_rows where batch_id='${batchId}' and row_number=1`) === "League Fixture")
record("stage: nothing is published by staging", sql(`select count(*) from fixture_import_rows where batch_id='${batchId}' and status='published'`) === "0")

// ---------------------------------------------------------------------
// UPLOAD AN .XLSX
// ---------------------------------------------------------------------
function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8")
    const body = deflateRawSync(data)
    const nameBuf = Buffer.from(name, "utf8")
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
const dir = mkdtempSync(join(tmpdir(), "ovalball-xlsx-"))
const file = join(dir, "league-export.xlsx")
writeFileSync(
  file,
  zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Fixtures" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml": '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="20"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Kick Off</t></is></c><c r="C1" t="inlineStr"><is><t>Our Team</t></is></c><c r="D1" t="inlineStr"><is><t>Opposition</t></is></c></row><row r="2"><c r="A2" s="1"><v>46613</v></c><c r="B2" s="2"><v>0.4375</v></c><c r="C2" t="inlineStr"><is><t>Under 12 Boys</t></is></c><c r="D2" t="inlineStr"><is><t>Fylde Rugby Football Club</t></is></c></row></sheetData></worksheet>',
  }),
)
await page.goto(`${APP}/fixtures/import`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
await page.locator("#import-file").setInputFiles(file)
await page.getByRole("heading", { name: "What Each Column Means" }).waitFor()
const firstValues = await page.locator("section[aria-labelledby='map-title'] tbody tr").first().innerText()
record("xlsx: a workbook is read directly, the date as the cell showed it", firstValues.includes("14/08/2027"), firstValues.replace(/\s+/g, " "))
const kickoffValues = await page.locator("section[aria-labelledby='map-title'] tbody tr").nth(1).innerText()
record("xlsx: and the kick-off as a 24-hour time", kickoffValues.includes("10:30"), kickoffValues.replace(/\s+/g, " "))
record("xlsx: the file name is carried into the step bar", (await steps.innerText()).includes("league-export.xlsx"))

// ---------------------------------------------------------------------
// TEAM STAFF DO NOT IMPORT
// ---------------------------------------------------------------------
const tmCtx = await newContext(browser)
const tm = await tmCtx.newPage()
await signIn(tm, "uat.team.manager@ovalball.test")
await tm.goto(`${APP}/fixtures/import`, { waitUntil: "domcontentloaded" })
await tm.waitForLoadState("networkidle").catch(() => {})
record("team staff: a Team Manager is sent away from Import Fixtures", !tm.url().includes("/fixtures/import"), tm.url().replace(APP, ""))

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
sql(`delete from fixture_import_batches where id='${batchId}'`)
await browser.close()
process.exit(summarise() ? 0 : 1)
