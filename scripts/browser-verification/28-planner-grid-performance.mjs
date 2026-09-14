// MASS FIXTURE PLANNER -- WHAT THE SPREADSHEET COSTS AT SIZE
// (Season Planner spreadsheet slice §16.)
//
// Timings are OBSERVED, not asserted: this is a development build on a loaded
// laptop, and a threshold invented here would be a number nobody agreed to.
// Each figure is taken from the moment the input is sent to the moment the
// result is on screen, so it includes the harness's own overhead.
//
// What IS asserted is the architectural claim: no grid interaction issues a
// number of server requests proportional to the rows it touches. Filling fifty
// rows is zero requests; pasting fifty rows is one validation, not fifty.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")

let posts = 0
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/fixtures/planner")) posts += 1
})

const cell = (label) => page.locator(`input[aria-label="${label}"]`)
const rowHead = (n) => page.locator("tbody tr td[data-row-head]").nth(n - 1)

async function timed(label, action, done) {
  const before = posts
  const started = Date.now()
  await action()
  await page.waitForFunction(done.fn, done.arg, { timeout: 60000 })
  const ms = Date.now() - started
  const requests = posts - before
  record(`OBSERVED  ${label}`, true, `${ms}ms, ${requests} server request${requests === 1 ? "" : "s"}`)
  return { ms, requests }
}

const hasOptions = {
  fn: () => {
    const ul = document.querySelector('ul[role="listbox"]')
    return Boolean(ul && ul.querySelectorAll('[role="option"]').length > 0)
  },
  arg: null,
}
const valueIs = (label, predicate) => ({
  fn: ([l, p]) => new Function("v", `return ${p}`)(document.querySelector(`input[aria-label="${l}"]`)?.value ?? null),
  arg: [label, predicate],
})

async function measureAt(rowCount) {
  await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
  const loadStart = Date.now()
  await page.locator('input[aria-label="Date, row 25"]').waitFor()
  record(`OBSERVED  [${rowCount} rows] initial grid render (25 rows on arrival)`, true, `${Date.now() - loadStart}ms after DOM ready`)
  await page.waitForLoadState("networkidle").catch(() => {})

  // Grow to the size under test with Add Rows (ten at a time), as a person would.
  while ((await page.locator('tbody input[aria-label^="Date, row"]').count()) < rowCount) {
    await page.getByRole("button", { name: "Add Rows" }).click()
  }
  const n = await page.locator('tbody input[aria-label^="Date, row"]').count()

  const row = Math.min(rowCount, n) - 2
  await timed(`[${n} rows] open Opposition Club on row ${row}`, () => cell(`Opposition Club, row ${row}`).click(), {
    fn: () => Boolean(document.querySelector('ul[role="listbox"]')),
    arg: null,
  })
  await timed(`[${n} rows] type "Aber" and see filtered options`, () => page.keyboard.type("Aber"), hasOptions)
  await timed(`[${n} rows] commit with Enter`, () => page.keyboard.press("Enter"), valueIs(`Opposition Club, row ${row}`, "v && v.startsWith('Aber')"))

  await cell(`Venue, row ${row}`).scrollIntoViewIfNeeded()
  const venue = await timed(`[${n} rows] open Venue on row ${row}`, () => cell(`Venue, row ${row}`).click(), hasOptions)
  record(`§10 [${n} rows] opening Venue issues no request`, venue.requests === 0)
  await page.keyboard.press("Escape")

  if (n >= 100) {
    await cell("Our Team, row 1").click()
    await page.keyboard.type("Under 12")
    await page.keyboard.press("Enter")
    await cell("Our Team, row 1").click()
    await page.keyboard.press("Escape")
    await cell("Our Team, row 50").click({ modifiers: ["Shift"] })
    const fill = await timed(`[${n} rows] Fill Down across 50 rows`, () => page.keyboard.press("ControlOrMeta+d"), valueIs("Our Team, row 50", "v && v.startsWith('Under 12')"))
    record(`§16 [${n} rows] filling 50 rows issues no server request`, fill.requests === 0, `${fill.requests}`)

    await rowHead(1).click()
    await rowHead(50).click({ modifiers: ["Shift"] })
    await page.keyboard.press("ControlOrMeta+c")
    await cell("Date, row 51").click()
    const paste = await timed(`[${n} rows] paste 50 copied rows`, () => page.keyboard.press("ControlOrMeta+v"), valueIs("Our Team, row 100", "v && v.startsWith('Under 12')"))
    record(`§16 [${n} rows] pasting 50 rows is one validation request, not 50`, paste.requests <= 1, `${paste.requests}`)
    await page.waitForFunction(() => !document.body.innerText.includes("Checking…"), null, { timeout: 120000 })

    await cell("Our Team, row 51").click()
    await page.keyboard.press("Escape")
    await cell("Notes, row 100").click({ modifiers: ["Shift"] })
    const clear = await timed(`[${n} rows] clear a 50 x 7 range with Delete`, () => page.keyboard.press("Delete"), valueIs("Our Team, row 100", "v === ''"))
    record(`§16 [${n} rows] clearing a range issues no server request`, clear.requests === 0)

    await rowHead(1).click()
    await rowHead(50).click({ modifiers: ["Shift"] })
    const del = await timed(
      `[${n} rows] delete 50 selected rows`,
      () => page.getByRole("toolbar", { name: "Selected rows" }).getByRole("button", { name: "Delete Selected Rows" }).click(),
      valueIs("Our Team, row 1", "v === ''"),
    )
    record(`§16 [${n} rows] deleting rows issues no server request`, del.requests === 0)
  }
}

await measureAt(25)
await measureAt(50)
await measureAt(120)

record("OBSERVED  development-build figures on a loaded machine", true, "recorded for the product owner to judge, not a production benchmark")
await browser.close()
const ok = summarise()
process.exit(ok ? 0 : 1)
