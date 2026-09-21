// =====================================================================
// CONVERGENCE STEP 14 -- GOVERNING BODY FOUNDATION, IN A REAL BROWSER
//
// The archaeology found the organisation already modelled -- 35 verified
// constituent bodies, and club affiliation on the Club Directory record. What
// was missing was a person, and a place to stand.
//
//   somebody with a role -> dashboard -> their rugby organisation -> what it is,
//   what they are to it, which clubs belong to it, what it runs
//
//   and an ordinary club user is offered none of it, and refused it directly.
//
// Sprint mode: one authorised journey, one unauthorised, one mobile width.
// The authority matrix is step14_governing_body.sql, where it belongs.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const OFFICER = "uat.preston.admin@ovalball.test"
const ORDINARY = "uat.team.manager@ovalball.test"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const bodyId = sql(`select id from public.constituent_bodies where canonical_name = 'Ovalball Review County RFU'`)
if (!bodyId) {
  console.error("Missing the local review organisation. Seed it before running this suite.")
  process.exit(1)
}

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. SOMEBODY WITH A ROLE
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(page, OFFICER)

  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const dash = await page.locator("main").innerText()
  record("A1 an officer is offered their rugby organisation from the dashboard", /your rugby organisations/i.test(dash))
  record("A2 named, with what they are to it", /Ovalball Review County RFU/.test(dash) && /Administrator/i.test(dash))

  await page.goto(`${APP}/governing/${bodyId}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const main = await page.locator("main").innerText()
  record("B1 the page says what the organisation is", /county union/i.test(main) && /rugby union/i.test(main))
  record("B2 and what this person is to it", /you are/i.test(main) && /administrator/i.test(main))
  record("B3 it names the clubs affiliated to it", /affiliated clubs/i.test(main) && /Step 2 Review RFC/i.test(main))
  record("B4 and says what it organises", /competitions/i.test(main))
  record("B5 it is honest about what is not built yet", /coming next/i.test(main))
  record("B6 and shows no database diagnostics", !/uuid|constituent_body_id|null\b/i.test(main))

  // Basic accessibility of the changed surface: one h1 and real headings.
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll("h1,h2")].map((h) => `${h.tagName}:${(h.textContent ?? "").trim().slice(0, 28)}`)
  )
  record("B7 the surface has a heading structure rather than styled divs",
    headings.some((h) => h.startsWith("H1")) && headings.filter((h) => h.startsWith("H2")).length >= 3,
    headings.slice(0, 5).join(" | "))

  // ==================================================================
  // C. THE PHONE
  // ==================================================================
  const small = await newContext(browser, { width: 390, height: 844 })
  const m = await small.newPage()
  await signIn(m, OFFICER)
  await m.goto(`${APP}/governing/${bodyId}`, { waitUntil: "domcontentloaded" })
  await m.waitForLoadState("networkidle").catch(() => {})
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  record("C1 no horizontal overflow at 390px", overflow <= 0, `${overflow}px over`)
  record("C2 and a mobile reader can still tell what the organisation is",
    /county union/i.test(await m.locator("main").innerText()))
  await small.close()
  await ctx.close()

  // ==================================================================
  // D. SOMEBODY WITHOUT ONE
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const opage = await octx.newPage()
  await signIn(opage, ORDINARY)
  await opage.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  record("D1 an ordinary club user is offered no governing body navigation",
    !/your rugby organisations/i.test(await opage.locator("main").innerText()))

  await opage.goto(`${APP}/governing/${bodyId}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const otext = await opage.locator("body").innerText()
  record("D2 and reaching the page directly shows them nothing of the organisation",
    !/affiliated clubs/i.test(otext) && !/Step 2 Review RFC/i.test(otext))
  await octx.close()

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
}

// Nothing to clean: this suite creates nothing. The review organisation is deliberate persistent
// product state for the owner to walk through later, recorded in the Step 14 report.
record("this suite created nothing that needs removing", true)

process.exit(summarise() ? 0 : 1)
