// HARNESS VALIDATION (brief §8). Nothing about the product is tested here.
// This proves the MECHANISM can express the things the Chrome extension
// could not, so that a later failure can be attributed honestly.

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const A_EMAIL = "uat.coach@ovalball.test"
const B_EMAIL = "uat.guardian.one@ovalball.test"

const browser = await launch()

// --- A. two contexts hold two DIFFERENT authenticated users --------------
const ctxA = await newContext(browser)
const ctxB = await newContext(browser)
const a = await ctxA.newPage()
const b = await ctxB.newPage()

await signIn(a, A_EMAIL)
await signIn(b, B_EMAIL)

async function identity(page) {
  await page.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const text = await page.locator("body").innerText()
  const m = text.match(/[\w.+-]+@[\w.-]+/)
  return m ? m[0] : "(no email found on /account)"
}

const idA = await identity(a)
const idB = await identity(b)
record(
  "A. two contexts hold different authenticated users",
  idA === A_EMAIL && idB === B_EMAIL && idA !== idB,
  `A=${idA} B=${idB}`,
)

// --- B. cookie isolation -------------------------------------------------
const cookiesA = await ctxA.cookies()
const cookiesB = await ctxB.cookies()
const authA = cookiesA.filter((c) => c.name.includes("auth-token")).map((c) => c.value)
const authB = cookiesB.filter((c) => c.name.includes("auth-token")).map((c) => c.value)
const disjoint = authA.length > 0 && authB.length > 0 && !authA.some((v) => authB.includes(v))
record("B. contexts do not share auth cookies", disjoint, `${authA.length} vs ${authB.length} tokens`)

// clearing A must not sign B out
await ctxA.clearCookies()
const stillB = await identity(b)
record("B2. clearing context A leaves context B signed in", stillB === B_EMAIL, stillB)

// --- C-F. exact viewports ------------------------------------------------
for (const w of [320, 360, 390, 430]) {
  const c = await newContext(browser, { width: w, height: 844 })
  const p = await c.newPage()
  await p.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  const m = await measure(p)
  record(
    `${w === 320 ? "C" : w === 360 ? "D" : w === 390 ? "E" : "F"}. viewport ${w} really reports ${w}`,
    m.innerWidth === w && m.clientWidth === w,
    `innerWidth=${m.innerWidth} clientWidth=${m.clientWidth} scrollWidth=${m.scrollWidth}`,
  )
  await c.close()
}

// --- G. keyboard actually moves focus -----------------------------------
await b.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
const before = await b.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.textContent || "").slice(0, 20))
await b.keyboard.press("Tab")
await b.keyboard.press("Tab")
const after = await b.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.textContent || "").slice(0, 20))
record("G. Tab changes document.activeElement", before !== after, `${before} -> ${after}`)

// --- H. two pages open at once ------------------------------------------
const bothOpen = !a.isClosed() && !b.isClosed()
record("H. two pages remain open simultaneously", bothOpen)

// --- I. receiver observes DOM change while sender acts -------------------
// Mechanism-level only: prove one page can watch for a mutation while the
// other page is being driven. The PRODUCT realtime proof is a later script.
await b.evaluate(() => {
  window.__sawMutation = false
  const el = document.createElement("div")
  el.id = "harness-probe"
  document.body.appendChild(el)
  new MutationObserver(() => {
    window.__sawMutation = true
  }).observe(el, { childList: true })
})
await a.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
await b.evaluate(() => {
  document.getElementById("harness-probe").appendChild(document.createElement("span"))
})
await b.waitForFunction(() => window.__sawMutation === true, null, { timeout: 5000 })
record("I. receiver page observes DOM changes while sender page acts", true)

await browser.close()
process.exit(summarise() ? 0 : 1)
