// MASS FIXTURE PLANNER -- SPREADSHEET INTERACTION
// (Season Planner spreadsheet slice §3-§12, §17-§21.)
//
// The claim under test is muscle memory: a fixture secretary who knows Excel
// can select, fill, copy, paste, clear and delete in this grid without being
// taught, and every one of those paths still ends in canonical validation.
//
// Everything here is a REAL input event -- mouse down/move/up for the fill
// handle, keyboard shortcuts for the clipboard, right-click for the menu --
// against real canonical data. Nothing sets a React value directly.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")

let plannerPosts = 0
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/fixtures/planner")) plannerPosts += 1
})

async function openPlanner() {
  await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
}

const cell = (label) => page.locator(`input[aria-label="${label}"]`)
const val = (label) => cell(label).inputValue()
const vals = (labels) => Promise.all(labels.map(val))
const clipboard = () => page.evaluate(() => navigator.clipboard.readText())
const rowHead = (n) => page.locator("tbody tr td[data-row-head]").nth(n - 1)
const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))

/** Select a cell without opening its list, the way a person clicks then carries on. */
async function selectCell(label) {
  await cell(label).click()
  await page.keyboard.press("Escape")
}

async function typeInto(label, text) {
  await selectCell(label)
  await page.keyboard.type(text)
  await page.keyboard.press("Enter")
}

/** Wait until a lookup list for the focused cell has real options. */
async function options() {
  await page
    .waitForFunction(() => {
      const ul = document.querySelector('ul[role="listbox"]')
      return ul && ul.querySelectorAll('[role="option"]').length > 0
    }, null, { timeout: 30000 })
    .catch(() => {})
  return (await page.locator('ul[role="listbox"] [role="option"]').allInnerTexts()).map((t) => t.split("\n")[0])
}

async function chooseByTyping(label, text) {
  await cell(label).click()
  await page.keyboard.type(text)
  const opts = await options()
  await page.keyboard.press("Enter")
  return opts
}

async function dragFillHandleTo(label) {
  const handle = page.locator("[data-fill-handle]")
  const from = await handle.boundingBox()
  const to = await cell(label).boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

await openPlanner()

// ---------------------------------------------------------------------
// §3 A GRID, ANNOUNCED AS ONE
// ---------------------------------------------------------------------
record("§3 the grid is a multi-selectable grid for assistive technology",
  (await page.locator('table[role="grid"][aria-multiselectable="true"]').count()) === 1)

// ---------------------------------------------------------------------
// §11 KEYBOARD LOOKUP -- type, arrows, Enter, and on to the next cell
// ---------------------------------------------------------------------
await cell("Our Team, row 1").click()
await page.keyboard.type("Under 12")
let opts = await options()
record("§11 typing into Our Team filters immediately", opts.length > 0 && opts.every((o) => o.startsWith("Under 12")), opts.join(", "))
await page.keyboard.press("ArrowDown")
const activeDescendant = await cell("Our Team, row 1").getAttribute("aria-activedescendant")
record("§19 the list exposes its active option to assistive technology", Boolean(activeDescendant), activeDescendant ?? "none")
await page.keyboard.press("Enter")
record("§11 Enter commits the highlighted canonical team", (await val("Our Team, row 1")).startsWith("Under 12"), await val("Our Team, row 1"))
record("§11 and focus moves on to the next cell in the row", (await focused()) === "Opposition Club, row 1", await focused())

// ---------------------------------------------------------------------
// §4 FILL HANDLE -- one team, dragged ten rows, as one undoable step
// ---------------------------------------------------------------------
await selectCell("Our Team, row 1")
const team = await val("Our Team, row 1")
await dragFillHandleTo("Our Team, row 10")
const filledTeams = await vals(Array.from({ length: 10 }, (_, i) => `Our Team, row ${i + 1}`))
record("§4 dragging the fill handle down ten rows repeats Our Team", filledTeams.every((t) => t === team), filledTeams.join(" | "))
record("§4 the fill stops where the pointer stopped", (await val("Our Team, row 11")) === "")

await page.getByRole("button", { name: "Undo Fill" }).click()
record("§17 one Undo reverses the whole ten-row fill",
  (await vals(["Our Team, row 2", "Our Team, row 10"])).every((v) => v === "") && (await val("Our Team, row 1")) === team)
await selectCell("Our Team, row 1")
await dragFillHandleTo("Our Team, row 10")

// ---------------------------------------------------------------------
// §9 OPPOSITION, AND A REPEATING TWO-CELL PATTERN
// ---------------------------------------------------------------------
const postsBeforeLookups = plannerPosts
opts = await chooseByTyping("Opposition Club, row 1", "Aberaeron")
record("§9 Opposition filters the canonical catalogue as you type", opts.some((o) => o.startsWith("Aberaeron")), opts.slice(0, 3).join(" | "))
opts = await chooseByTyping("Opposition Club, row 2", "Abercarn")
const pair = await vals(["Opposition Club, row 1", "Opposition Club, row 2"])

await selectCell("Opposition Club, row 1")
await cell("Opposition Club, row 2").click({ modifiers: ["Shift"] })
await dragFillHandleTo("Opposition Club, row 6")
const pattern = await vals([1, 2, 3, 4, 5, 6].map((n) => `Opposition Club, row ${n}`))
record("§4 a two-cell pattern repeats in order: A, B, A, B, A, B",
  pattern.join("|") === [pair[0], pair[1], pair[0], pair[1], pair[0], pair[1]].join("|"), pattern.join(" | "))

for (const n of [7, 8, 9, 10, 11]) {
  await cell(`Opposition Club, row ${n}`).click()
  await page.keyboard.type("Aber")
  await options()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
}
record("§9 §16 opening and filtering Opposition on seven rows issues no server request",
  plannerPosts === postsBeforeLookups, `${plannerPosts - postsBeforeLookups} planner POSTs`)
await openPlanner()
await page.waitForTimeout(1500)

// ---------------------------------------------------------------------
// §5 COPY / PASTE -- one cell, one cell into a range, a rectangle
// ---------------------------------------------------------------------
await typeInto("H/A, row 1", "H")
await selectCell("H/A, row 1")
await page.keyboard.press("ControlOrMeta+c")
record("§5 copying one cell puts exactly its value on the clipboard", (await clipboard()) === "H", JSON.stringify(await clipboard()))
await selectCell("H/A, row 2")
await page.keyboard.press("ControlOrMeta+v")
await page.waitForTimeout(200)
record("§5 pasting one cell into one cell", (await val("H/A, row 2")) === "H")

await selectCell("H/A, row 3")
await cell("H/A, row 6").click({ modifiers: ["Shift"] })
await page.keyboard.press("ControlOrMeta+v")
await page.waitForTimeout(200)
record("§5 one copied cell pasted into a larger selection fills all of it",
  (await vals(["H/A, row 3", "H/A, row 4", "H/A, row 5", "H/A, row 6"])).every((v) => v === "H"))

await chooseByTyping("Our Team, row 1", "Under 12")
await page.keyboard.press("Escape")
await chooseByTyping("Opposition Club, row 1", "Aberaeron")
await selectCell("Our Team, row 1")
await dragFillHandleTo("Our Team, row 3")
await selectCell("Opposition Club, row 1")
await dragFillHandleTo("Opposition Club, row 3")

await selectCell("Our Team, row 1")
await cell("Opposition Club, row 3").click({ modifiers: ["Shift"] })
await page.keyboard.press("ControlOrMeta+c")
const tsv = await clipboard()
record("§5 a copied rectangle is tab/newline text Excel and Sheets read",
  tsv.split("\n").length === 3 && tsv.split("\n").every((l) => l.split("\t").length === 2), JSON.stringify(tsv))
await selectCell("Our Team, row 12")
await page.keyboard.press("ControlOrMeta+v")
await page.waitForTimeout(250)
const pasted = await vals(["Our Team, row 12", "Opposition Club, row 12", "Our Team, row 14", "Opposition Club, row 14", "Our Team, row 15"])
record("§5 pasting a rectangle preserves its geometry",
  pasted[0] === (await val("Our Team, row 1")) && pasted[1] === (await val("Opposition Club, row 1")) && pasted[2] !== "" && pasted[3] !== "" && pasted[4] === "",
  pasted.join(" | "))

// External paste: a real ClipboardEvent carrying what Excel puts on the clipboard.
const excel = "01/02/2031\t11:00\t10:15\tH\tUnder 13 Boys\tAberaeron Rugby Football Club\r\n08/02/2031\t1400\t13:15\tAway\tUnder 13 Boys\tAbercarn Rugby Football Club\r\n"
await selectCell("Date, row 18")
await page.evaluate((text) => {
  const el = document.querySelector('input[aria-label="Date, row 18"]')
  const dt = new DataTransfer()
  dt.setData("text/plain", text)
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
}, excel)
await page.waitForTimeout(250)
record("§5 an external TSV paste lands with its shape",
  (await val("Date, row 18")) === "01/02/2031" && (await val("Opposition Club, row 19")) === "Abercarn Rugby Football Club" && (await val("Kick Off, row 19")) === "1400")

// ---------------------------------------------------------------------
// §6 RIGHT-CLICK -- Copy and Clear Contents on a range
// ---------------------------------------------------------------------
await selectCell("H/A, row 3")
await cell("H/A, row 6").click({ modifiers: ["Shift"] })
await cell("H/A, row 4").click({ button: "right" })
const menuItems = (await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts()).map((t) => t.split("\n")[0])
record("§6 right-click opens the grid's own menu with the minimum actions",
  ["Copy", "Paste", "Fill Down", "Fill Right", "Clear Contents", "Delete Selected Rows"].every((a) => menuItems.includes(a)), menuItems.join(", "))
await page.getByRole("menuitem", { name: /^Copy/ }).click()
record("§6 right-click Copy copies the selected range", (await clipboard()) === "H\nH\nH\nH", JSON.stringify(await clipboard()))

await cell("H/A, row 5").click({ button: "right" })
await page.getByRole("menuitem", { name: /^Clear Contents/ }).click()
record("§6 right-click Clear Contents empties the range and keeps the rows",
  (await vals(["H/A, row 3", "H/A, row 6"])).every((v) => v === "") && (await page.locator('tbody input[aria-label^="Date, row"]').count()) >= 25)

// Keyboard reach: Shift+F10 opens it, Escape returns to the grid.
await selectCell("H/A, row 2")
await page.keyboard.press("Shift+F10")
const menuFocus = await page.evaluate(() => document.activeElement?.getAttribute("role"))
await page.keyboard.press("Escape")
record("§19 the menu is reachable from the keyboard and Escape returns focus to the cell",
  menuFocus === "menuitem" && (await focused()) === "H/A, row 2", `${menuFocus} → ${await focused()}`)

const nativeMenuOutsideGrid = await page.evaluate(() => {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  document.querySelector("h1").dispatchEvent(ev)
  return ev.defaultPrevented
})
record("§6 the browser's own context menu is untouched outside the grid", nativeMenuOutsideGrid === false)

// ---------------------------------------------------------------------
// §8 DELETE / BACKSPACE clears a range, never navigates
// ---------------------------------------------------------------------
const urlBefore = page.url()
await selectCell("Our Team, row 12")
await cell("Opposition Club, row 14").click({ modifiers: ["Shift"] })
await page.keyboard.press("Backspace")
record("§8 Backspace clears every cell in the selected range",
  (await vals(["Our Team, row 12", "Opposition Club, row 13", "Opposition Club, row 14"])).every((v) => v === ""))
record("§8 and does not trigger browser navigation", page.url() === urlBefore)
await page.keyboard.press("ControlOrMeta+z")
record("§17 Cmd/Ctrl+Z undoes the clear as one step", (await val("Our Team, row 12")) !== "", await val("Our Team, row 12"))

// ---------------------------------------------------------------------
// §7 ROW NUMBERS -- click, Shift-click, Cmd/Ctrl-click
// ---------------------------------------------------------------------
await rowHead(1).click()
await rowHead(10).click({ modifiers: ["Shift"] })
let bar = await page.locator('[role="toolbar"][aria-label="Selected rows"]').innerText().catch(() => "")
record("§7 clicking row 1 then Shift-clicking row 10 selects ten rows", bar.includes("10 rows selected"), bar.split("\n")[0])
record("§19 selected rows are conveyed with aria-selected", (await page.locator('tbody tr[aria-selected="true"]').count()) === 10)
await rowHead(5).click({ modifiers: ["ControlOrMeta"] })
bar = await page.locator('[role="toolbar"][aria-label="Selected rows"]').innerText().catch(() => "")
record("§7 Cmd/Ctrl-click toggles one row out", bar.includes("9 rows selected"), bar.split("\n")[0])
await rowHead(5).click({ modifiers: ["ControlOrMeta"] })

const headPos = await rowHead(1).boundingBox()
const headEnd = await rowHead(4).boundingBox()
await page.mouse.move(headPos.x + 5, headPos.y + 5)
await page.mouse.down()
await page.mouse.move(headEnd.x + 5, headEnd.y + 5, { steps: 6 })
await page.mouse.up()
bar = await page.locator('[role="toolbar"][aria-label="Selected rows"]').innerText().catch(() => "")
record("§7 dragging down the row numbers selects a range", bar.includes("4 rows selected"), bar.split("\n")[0])

// ---------------------------------------------------------------------
// §7 §8 MASS CLEAR, THEN MASS DELETE -- two different things
// ---------------------------------------------------------------------
// Distinct markers, so "moved up" and "left alone" cannot pass on blank cells.
for (const n of [1, 2, 3, 4]) await typeInto(`Notes, row ${n}`, `ROW${n}-MARK`)
await rowHead(1).click()
await rowHead(3).click({ modifiers: ["Shift"] })
const beforeDelete = await vals(["Notes, row 4"])
await page.getByRole("toolbar", { name: "Selected rows" }).getByRole("button", { name: "Clear Contents" }).click()
record("§7 Clear Contents on selected rows empties them in place",
  (await vals(["Our Team, row 1", "Opposition Club, row 3", "Notes, row 1", "Notes, row 3"])).every((v) => v === "") &&
    beforeDelete[0] === "ROW4-MARK" && (await val("Notes, row 4")) === "ROW4-MARK")
await page.getByRole("button", { name: "Undo Clear" }).click()

await rowHead(1).click()
await rowHead(3).click({ modifiers: ["Shift"] })
await rowHead(2).click({ button: "right" })
await page.getByRole("menuitem", { name: /^Delete Selected Rows/ }).click()
const rowCount = await page.locator('tbody input[aria-label^="Date, row"]').count()
record("§7 Delete Selected Rows removes the rows and moves the grid up", (await val("Notes, row 1")) === "ROW4-MARK", `row 1 notes now "${await val("Notes, row 1")}"`)
record("§7 and restores the blank pool rather than shrinking the grid", rowCount >= 25, `${rowCount} rows`)
record("§8 deleting draft rows touched no persisted fixture", Number(sql("select count(*) from public.fixtures where kickoff_date between '2031-02-01' and '2031-02-28'")) === 0)

// ---------------------------------------------------------------------
// §10 VENUE AND PITCH -- the pitch follows the venue, and changes with it
// ---------------------------------------------------------------------
await openPlanner()
opts = await chooseByTyping("Venue, row 1", "Ovalball UAT")
await page.keyboard.press("Escape")
await cell("Pitch, row 1").click()
opts = await options()
const dbPitches = sql(`select string_agg(p.display_name, ',' order by p.display_name) from public.club_pitches p join public.venues v on v.id=p.venue_id where v.name='Ovalball UAT Ground' and p.active`)
record("§10 Pitch offers only the chosen venue's pitches", [...opts].sort().join(",") === dbPitches, `${opts.join(", ")} (db: ${dbPitches})`)
await page.keyboard.press("ArrowDown")
await page.keyboard.press("Enter")
const chosenPitch = await val("Pitch, row 1")
opts = await chooseByTyping("Venue, row 1", "Towneley")
await page.waitForTimeout(200)
const noticeText = await page.locator("body").innerText()
record("§10 changing to a venue without that pitch clears the incompatible pitch",
  chosenPitch !== "" && (await val("Pitch, row 1")) === "" && noticeText.includes("is not at"), `pitch was "${chosenPitch}", now "${await val("Pitch, row 1")}"`)

// ---------------------------------------------------------------------
// §18 VALIDATION CONVERGES -- typed, internal clipboard and external paste
// ---------------------------------------------------------------------
await openPlanner()
const bad = [
  ["01/03/2031", "11:00", "10:00", "Sideways", "Under 12 Boys", "Aberaeron Rugby Football Club", "", "", "", "", ""],
  ["02/03/2031", "11:00", "10:00", "H", "Under 99 Wizards", "Aberaeron Rugby Football Club", "", "", "", "", ""],
  ["03/03/2031", "11:00", "10:00", "H", "Under 12 Boys", "A Club That Does Not Exist RFC", "", "", "", "", ""],
  ["04/03/2031", "11:00", "10:00", "H", "Under 12 Boys", "Aberaeron Rugby Football Club", "", "", "Towneley Park Pitches", "Pitch 1", ""],
].map((r) => r.join("\t")).join("\n")
await selectCell("Date, row 1")
await page.evaluate((text) => {
  const el = document.querySelector('input[aria-label="Date, row 1"]')
  const dt = new DataTransfer()
  dt.setData("text/plain", text)
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
}, bad)
await page.waitForFunction(() => /\d+ need attention/.test(document.body.innerText) && !document.body.innerText.includes("Checking…"), null, { timeout: 120000 })
let body = await page.locator("body").innerText()
const externalAttention = Number(body.match(/(\d+) need attention/)?.[1] ?? 0)
record("§18 external paste: every bad row is caught", externalAttention === 4, `${externalAttention} need attention`)

// Internal copy of the same four rows, pasted below, must be judged identically.
await rowHead(1).click()
await rowHead(4).click({ modifiers: ["Shift"] })
await page.keyboard.press("ControlOrMeta+c")
await selectCell("Date, row 6")
await page.keyboard.press("ControlOrMeta+v")
await page.waitForFunction(() => /\d+ need attention/.test(document.body.innerText) && !document.body.innerText.includes("Checking…"), null, { timeout: 120000 })
body = await page.locator("body").innerText()
record("§18 the grid's own clipboard gets exactly the same canonical checks", Number(body.match(/(\d+) need attention/)?.[1] ?? 0) === 8, body.match(/\d+ need attention/)?.[0])

await page.getByRole("button", { name: "Check Rows" }).click().catch(() => {})
await page.waitForFunction(() => !document.body.innerText.includes("Checking…"), null, { timeout: 120000 })
const summaryText = (await page.locator("section").filter({ hasText: "need attention" }).first().innerText().catch(() => "")) + (await page.locator("body").innerText())
for (const [needle, why] of [
  ["is not Home or Away", "an invalid H/A is a validation error"],
  ["could not be found for your club", "an unknown team is a validation error"],
  ["canonical Club Directory", "an unknown opposition is a validation error"],
  ["is not at venue", "a venue/pitch mismatch is a validation error"],
]) {
  record(`§18 ${why}`, summaryText.includes(needle), needle)
}
record("§21 no canonical entity was invented by typing, pasting or filling",
  Number(sql("select count(*) from public.club_directory where name ilike 'A Club That Does Not Exist%'")) === 0 &&
    Number(sql("select count(*) from public.teams where display_name ilike 'Under 99%'")) === 0)

await cell("Opposition Club, row 20").click()
await page.keyboard.type("Does Not Exist")
await page.waitForTimeout(150)
const emptyList = await page.locator('ul[role="listbox"]').innerText().catch(() => "")
record("§21 an unknown opposition is offered nothing, not a new club", emptyList.includes("No match"), emptyList.replace(/\n/g, " "))
await page.keyboard.press("Escape")
await page.keyboard.press("Escape")

// ---------------------------------------------------------------------
// §19 ACCESSIBILITY with a live selection and the menu open
// ---------------------------------------------------------------------
const axeSource = readFileSync(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8")
await selectCell("Our Team, row 2")
await cell("Venue, row 4").click({ modifiers: ["Shift"] })
await cell("Venue, row 3").click({ button: "right" })
await page.addScriptTag({ content: axeSource })
const violations = await page.evaluate(async () => {
  const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
  return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`)
})
record("§19 the planner is axe-clean at AA with a range selected and the menu open", violations.length === 0, violations.join("; ") || "no violations")
await page.keyboard.press("Escape")

record("no uncaught page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))

// ---------------------------------------------------------------------
// §20 TABLET -- touch still selects and bulk-operates; no body overflow
// ---------------------------------------------------------------------
const tabletCtx = await browser.newContext({ viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: false, storageState: await ctx.storageState() })
tabletCtx.setDefaultTimeout(60000)
const tablet = await tabletCtx.newPage()
await tablet.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await tablet.waitForLoadState("networkidle").catch(() => {})
await tablet.locator("tbody tr td[data-row-head]").nth(0).tap()
await tablet.locator("tbody tr td[data-row-head]").nth(2).tap()
const tabletBar = await tablet.locator('[role="toolbar"][aria-label="Selected rows"]').innerText().catch(() => "")
record("§20 on touch, tapping row numbers builds a multi-row selection", tabletBar.includes("2 rows selected"), tabletBar.split("\n")[0])
const overflow = await tablet.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
record("§20 no horizontal body overflow at tablet width outside the grid's own scroller", overflow <= 0, `${overflow}px`)
await tabletCtx.close()

await browser.close()
const ok = summarise()
process.exit(ok ? 0 : 1)
