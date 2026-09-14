// FIXTURE OPERATIONS -- EXACT VIEWPORTS
// (Corrective brief §62 mobile 320/360/390/430, §63 tablet 834, §64 axe.)
//
// These widths are why this harness exists: the Chrome extension resizes a
// real macOS window, which enforces a minimum width well above 320px, so a
// "320px" measurement taken through it is a false pass. Playwright sets the
// CSS viewport directly, and the page is asked to report its own innerWidth
// so the number under test is the one the page actually saw.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const SHOTS = process.env.SHOT_DIR ?? "/Users/Devs/.claude/jobs/e976849c/tmp"
const browser = await launch()

const SURFACES = [
  { path: "/fixtures/management", name: "Fixture Control Centre" },
  { path: "/fixtures/planner", name: "Mass Fixture Planner" },
]

for (const width of [320, 360, 390, 430, 834]) {
  const ctx = await newContext(browser, { width, height: 900 })
  const page = await ctx.newPage()
  await signIn(page, "uat.coach@ovalball.test")

  for (const surface of SURFACES) {
    await page.goto(`${APP}${surface.path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const m = await page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
      // The widest single element that sticks out, named -- "something
      // overflows" is not a finding anybody can act on.
      worst: (() => {
        let worst = null
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect()
          if (r.right > window.innerWidth + 1 && (!worst || r.right > worst.right)) {
            worst = { right: Math.round(r.right), tag: el.tagName, cls: String(el.className).slice(0, 60) }
          }
        }
        return worst
      })(),
    }))

    record(`§62-§63 ${surface.name} reports the viewport it was given at ${width}px`,
      m.viewport === width, `innerWidth ${m.viewport}`)
    record(`§62-§63 ${surface.name} does not overflow the body at ${width}px`,
      m.content <= m.viewport, `content ${m.content}px in ${m.viewport}px${m.worst ? ` — widest: ${m.worst.tag}.${m.worst.cls} to ${m.worst.right}px` : ""}`)
  }

  // §62: the phone must not be shown the columns the club grid dropped.
  if (width <= 430) {
    await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    // Scoped to the CARDS, not the whole page: "Rugby Union 27/28" in the
    // season filter is a canonical season name -- real data a club chooses
    // between -- not the per-row code label this check is about.
    const cards = await page.locator("ul > li").allInnerTexts().catch(() => [])
    const noisy = cards.filter((c) => /Site Admin created|CSV import|Club created|Source:|·\s*(Union|League)\b/.test(c))
    record(`§62 no Code or Source noise on the phone cards at ${width}px`,
      noisy.length === 0,
      noisy.length === 0 ? `${cards.length} cards, clean` : noisy.slice(0, 2).join(" · ").replace(/\n/g, " / "))
  }

  // §63: a tablet gets the real grid, scrolling inside its own container.
  if (width === 834) {
    await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const grid = await page.evaluate(() => {
      const table = document.querySelector("table")
      const box = table?.closest("div")
      if (!table || !box) return null
      return {
        visible: getComputedStyle(box).display !== "none",
        scrolls: box.scrollWidth > box.clientWidth,
        overflowX: getComputedStyle(box).overflowX,
      }
    })
    record("§63 the tablet gets the real spreadsheet, not the phone cards", grid?.visible === true, JSON.stringify(grid))
    record("§63 and it scrolls inside its own container, not the page",
      grid?.overflowX === "auto" || grid?.overflowX === "scroll", JSON.stringify(grid))
    await page.screenshot({ path: `${SHOTS}/planner-tablet-834.png` })
  }

  if (width === 390) {
    await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.screenshot({ path: `${SHOTS}/control-centre-390.png` })
    await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.screenshot({ path: `${SHOTS}/planner-390.png` })
  }

  await ctx.close()
}

// ---------------------------------------------------------------------
// §64 ACCESSIBILITY on the redesigned surfaces, desktop
// ---------------------------------------------------------------------
const axeSource = (await import("node:fs")).readFileSync(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8")

const a11yCtx = await newContext(browser, { width: 1512, height: 950 })
const a11y = await a11yCtx.newPage()
await signIn(a11y, "uat.coach@ovalball.test")

for (const surface of SURFACES) {
  await a11y.goto(`${APP}${surface.path}`, { waitUntil: "domcontentloaded" })
  await a11y.waitForLoadState("networkidle").catch(() => {})
  await a11y.addScriptTag({ content: axeSource })
  const violations = await a11y.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`)
  })
  record(`§64 ${surface.name} is axe-clean at AA`, violations.length === 0, violations.join("; ") || "no violations")
}

// §64: the actions menu and a lookup cell must both be reachable and
// operable from the keyboard alone.
await a11y.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await a11y.waitForLoadState("networkidle").catch(() => {})
const trigger = a11y.locator('tbody button[aria-label^="Actions for"]').first()
await trigger.focus()
await a11y.keyboard.press("Enter")
await a11y.waitForTimeout(700)
record("§64 the actions menu opens from the keyboard",
  (await a11y.locator('[role="menu"]').count()) > 0)
await a11y.keyboard.press("Escape")

await a11y.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await a11y.waitForLoadState("networkidle").catch(() => {})
// Focus alone no longer opens the list: in a spreadsheet, arrowing down a
// column must move between cells, and a list that opened on every focus took
// ArrowDown for itself. Alt+Down opens it, as it does on a native select.
await a11y.locator('input[aria-label="Our Team, row 1"]').focus()
await a11y.keyboard.press("Alt+ArrowDown")
await a11y.waitForTimeout(300)
record("§64 a structured cell announces itself as a combobox with a list",
  (await a11y.locator('input[aria-label="Our Team, row 1"][role="combobox"]').count()) === 1 &&
    (await a11y.locator('ul[role="listbox"]').count()) > 0)
await a11y.keyboard.press("ArrowDown")
await a11y.keyboard.press("Enter")
record("§64 and is operable by keyboard alone",
  (await a11y.inputValue('input[aria-label="Our Team, row 1"]')).length > 0,
  await a11y.inputValue('input[aria-label="Our Team, row 1"]'))

await browser.close()
summarise()
console.log(`\nScreenshots in ${SHOTS}`)
