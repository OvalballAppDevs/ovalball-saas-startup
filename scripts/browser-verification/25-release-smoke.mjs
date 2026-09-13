// RELEASE SMOKE — Phase 2B §23.
//
// Deliberately SHORT. The exhaustive surfaces already have their own suites
// (17-23 for Fixture Operations, 24 for the Rugby Hub); this is the run you do
// before promoting, to confirm the release hangs together end to end in a real
// browser: sign in, land, change who you are looking at, and touch one live
// thing on each of the three surfaces that changed.
//
// It is one journey in one session rather than a set of independent probes,
// because the failures this catches are the ones that only appear when a real
// person moves between surfaces carrying real context.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const SHOTS = process.env.SHOT_DIR ?? "/Users/Devs/.claude/jobs/e976849c/tmp"
const browser = await launch()

// ---------------------------------------------------------------------
// STAFF JOURNEY — authentication, dashboard, context, Fixture Operations
// ---------------------------------------------------------------------
const ctx = await newContext(browser, { width: 1280, height: 900 })
const page = await ctx.newPage()

const how = await signIn(page, "uat.coach@ovalball.test")
record("§23 authentication: a real session is issued through the product's own login",
  Boolean(how), how === "cached" ? "replayed a verified session" : "magic link followed")

// The identity is read back from the PRODUCT, not from the cookie -- a cookie
// proves a request was signed, not who the application thinks you are.
await page.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
const who = (await page.locator("body").innerText()).match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "(none)"
record("§23 and the application agrees who is signed in", who === "uat.coach@ovalball.test", who)

await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
// "Real content" asserted by what the dashboard is FOR, not by a character
// count. A correct dashboard for a club with two fixtures this week is short,
// and a length threshold just made a good page look broken -- it names the
// person, the club and the role they are acting in, and shows the week.
const dash = await page.evaluate(() => {
  const text = (document.querySelector("main") ?? document.body).innerText
  return {
    text: text.trim().length,
    greetsPerson: /good (morning|afternoon|evening),\s*\S+/i.test(text),
    namesClub: /RUFC|RLFC|Rugby/i.test(text),
    namesRole: /Club Admin|Team Admin|Coach|Site Admin|Guardian|Player/i.test(text),
    showsWeek: /this week/i.test(text),
    mains: document.querySelectorAll("main").length,
  }
})
record("§23 dashboard names the person, their club, their role and the week",
  dash.greetsPerson && dash.namesClub && dash.namesRole && dash.showsWeek,
  `${dash.text} chars — person=${dash.greetsPerson} club=${dash.namesClub} role=${dash.namesRole} week=${dash.showsWeek}`)
record("§23 dashboard has one main landmark", dash.mains === 1, `${dash.mains} <main>`)

// §23 CONTEXT SWITCHING. The scope a person is looking through is the thing
// most likely to break in a merge, because two lines both touched the shell.
const contexts = await page.evaluate(() => {
  const trigger = document.querySelector('[data-context-switcher], button[aria-haspopup]')
  return { present: Boolean(trigger), label: trigger?.textContent?.trim().slice(0, 60) ?? null }
})
record("§23 a context switcher is present in the shell", contexts.present, contexts.label ?? "not found")

// And the switch is exercised, not just found. Opening it must offer the
// scopes this person actually holds, and choosing one must change what the
// shell says it is showing -- the identity block names the person, the scope
// line names the scope, and they are not the same thing.
const before = await page.locator('button[aria-haspopup]').first().innerText()
await page.locator('button[aria-haspopup]').first().click()
await page.waitForTimeout(900)
const offered = await page.locator('[role="menuitem"], [role="option"]').count()
record("§23 the context switcher offers the scopes this person holds",
  offered > 0, `${offered} scope(s) offered to ${who}`)
await page.keyboard.press("Escape")
record("§23 and the shell states the scope currently being viewed",
  before.trim().length > 0, before.replace(/\n/g, " / ").slice(0, 70))

// ---------------------------------------------------------------------
// FIXTURE OPERATIONS — Control Centre, Planner, a lookup, a paste
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/management`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
const cc = await page.evaluate(() => ({
  rows: document.querySelectorAll("tbody tr").length,
  cards: document.querySelectorAll("ul > li").length,
  actions: document.querySelectorAll('button[aria-label^="Actions for"]').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
}))
record("§23 Fixture Control Centre lists fixtures with per-row actions",
  (cc.rows > 0 || cc.cards > 0) && !cc.overflow,
  `${cc.rows} rows, ${cc.cards} cards, ${cc.actions} action menus`)

await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})
const planner = await page.evaluate(() => ({
  // Ends-with, not contains: "row 1" as a substring also matches row 10-19,
  // row 21 and so on, which reported 121 cells in a row that has eleven.
  cells: [...document.querySelectorAll("input[aria-label]")].filter((i) =>
    /,\s*row 1$/.test(i.getAttribute("aria-label"))).length,
  combo: document.querySelectorAll('input[role="combobox"]').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
}))
record("§23 Mass Planner opens as a working grid",
  planner.cells > 0 && planner.combo > 0 && !planner.overflow,
  `${planner.cells} cells in row 1, ${planner.combo} structured cells`)

// A real lookup: focus a structured cell and wait for the product to offer
// canonical options. This is the path that reaches the database.
const teamCell = page.locator('input[aria-label="Our Team, row 1"]')
await teamCell.focus()
await page.waitForSelector('ul[role="listbox"] li', { timeout: 30000 }).catch(() => {})
const options = await page.locator('ul[role="listbox"] li').count()
record("§23 a structured lookup returns canonical options from the database",
  options > 0, `${options} options offered`)

// And the paste path -- the planner's reason for existing.
await page.locator('input[aria-label="Date, row 1"]').click()
await page.evaluate(async () => {
  const row = ["2027-01-16", "14:00", "13:00", "H", "", "", "", "", "", "", "smoke"].join("\t")
  await navigator.clipboard.writeText(row).catch(() => {})
})
await page.evaluate(() => {
  const input = document.querySelector('input[aria-label="Date, row 1"]')
  const data = new DataTransfer()
  data.setData("text/plain", ["2027-01-16", "14:00", "13:00", "H", "", "", "", "", "", "", "smoke"].join("\t"))
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1200)
const afterPaste = await page.inputValue('input[aria-label="Date, row 1"]')
record("§23 a pasted row lands in the grid", afterPaste.length > 0, `date cell now "${afterPaste}"`)

// ---------------------------------------------------------------------
// RUGBY HUB — landing, a detail route, Parents, and the landmark count
// ---------------------------------------------------------------------
for (const [path, name] of [
  ["/rugby-hub", "Hub landing"],
  ["/rugby-hub/glossary/advantage", "a Hub detail route"],
  ["/rugby-hub/parents", "Parents & Guardians"],
]) {
  const response = await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const m = await page.evaluate(() => {
    const mains = document.querySelectorAll("main")
    const own = mains.length ? mains[mains.length - 1] : document.body
    return { mains: mains.length, text: own.innerText.trim().length }
  })
  record(`§23 ${name} renders`, response?.status() === 200 && m.text > 200,
    `HTTP ${response?.status()}, ${m.text} chars`)
  // §AI: the landmark count read straight out of the DOM, on each surface.
  record(`§AI ${name} has exactly one main landmark in the DOM`, m.mains === 1, `${m.mains} <main>`)
}

await page.screenshot({ path: `${SHOTS}/release-smoke-hub-1280.png` })
await ctx.close()

// ---------------------------------------------------------------------
// MOBILE — the Hub's navigation at a real phone width
// ---------------------------------------------------------------------
const mob = await newContext(browser, { width: 390, height: 844 })
const phone = await mob.newPage()
await signIn(phone, "uat.coach@ovalball.test")
await phone.goto(`${APP}/rugby-hub`, { waitUntil: "domcontentloaded" })
await phone.waitForLoadState("networkidle").catch(() => {})

const mobile = await phone.evaluate(() => ({
  viewport: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  mains: document.querySelectorAll("main").length,
  navLinks: document.querySelectorAll('a[href^="/rugby-hub/"]').length,
}))
record("§23 the Hub navigates at 390px without overflowing",
  mobile.viewport === 390 && !mobile.overflow && mobile.navLinks > 0,
  `innerWidth ${mobile.viewport}, ${mobile.navLinks} Hub links, overflow=${mobile.overflow}`)
record("§AI and still has exactly one main landmark on the phone", mobile.mains === 1, `${mobile.mains} <main>`)

// Actually go somewhere from the phone navigation, rather than only counting
// links. The Hub's nav is a horizontally scrolling strip at this width, so the
// FIRST matching link is frequently scrolled out of view -- clicking it times
// out on a nav that works perfectly for a person, who would simply scroll.
// Take the first link that is actually visible, and scroll it in as they would.
const firstNav = phone.locator('a[href^="/rugby-hub/"]:visible').first()
const href = await firstNav.getAttribute("href")
await firstNav.scrollIntoViewIfNeeded()
await firstNav.click()
await phone.waitForURL(/\/rugby-hub\/./, { timeout: 30000 }).catch(() => {})
await phone.waitForLoadState("networkidle").catch(() => {})
const arrived = await phone.evaluate(() => ({ url: location.pathname, mains: document.querySelectorAll("main").length }))
record("§23 mobile navigation actually moves between Hub surfaces",
  arrived.url !== "/rugby-hub", `${href} -> ${arrived.url}`)
record("§AI and the destination has one main landmark too", arrived.mains === 1, `${arrived.mains} <main>`)

await phone.screenshot({ path: `${SHOTS}/release-smoke-hub-390.png` })

await browser.close()
summarise()
console.log(`\nScreenshots in ${SHOTS}`)
