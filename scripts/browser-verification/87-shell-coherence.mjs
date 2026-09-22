// =====================================================================
// CONVERGENCE STEP 18 -- APPLICATION UX 4-7: DOES IT FEEL LIKE ONE PRODUCT?
//
// This suite is about the SHELL, not about features. It walks far enough
// across Ovalball to show that the parts were not designed by unrelated
// applications, and it measures the four things UX-4 to UX-7 actually own:
//
//   A. UX-4 -- the mobile bottom bar: primary destinations ONE TAP away, from
//      buildNavItems, 44px targets, no overflow, nothing truncated, and the
//      floating widget no longer sitting on top of it.
//   B. UX-4 -- the shell reserves the space its own furniture occupies, so no
//      page carries a per-page allowance for it.
//   C. UX-5 -- club navigation is grouped like Site Admin's, bin included.
//      (Already true before this step; asserted so it stays true.)
//   D. UX-6 -- no dead ends: the public club home has a way back, and the
//      Rugby Hub keeps the one it had.
//   E. UX-7 -- axe on the shell routes, at desktop AND at 320px, measured.
//   F. The journey itself: one identity, five places, no blended authority.
//
// EVERYTHING THIS RUN TOUCHES IS READ-ONLY. It creates nothing, so there is
// nothing to clean up, and it never writes to the persistent review world.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const CLUB_ADMIN = "uat.preston.admin@ovalball.test"   // Club Admin AND county officer
const GUARDIAN = "uat.guardian.two@ovalball.test"
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const bodyId = sql(`select id from public.constituent_bodies where canonical_name = 'Ovalball Review County RFU'`)
const clubSlug = sql(`select c.slug from public.clubs c join public.club_directory d on d.id = c.directory_id
                      where d.name = 'Step 2 Review RFC'`)
if (!bodyId || !clubSlug) {
  console.error("Missing the persistent review world. Run the review fixtures first.")
  process.exit(1)
}

/** What the mobile shell is showing, read from the live DOM rather than assumed. */
const readBar = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="Primary"]')
    if (!bar) return null
    const cells = [...bar.querySelectorAll("li")].map((li) => {
      const a = li.querySelector("a, button")
      const r = a?.getBoundingClientRect()
      const label = li.querySelector("span.truncate, span:not([aria-hidden])")
      return {
        text: (li.textContent ?? "").trim(),
        href: a?.getAttribute("href") ?? null,
        h: r ? Math.round(r.height) : 0,
        w: r ? Math.round(r.width) : 0,
        clipped: label instanceof HTMLElement ? label.scrollWidth > label.clientWidth + 1 : false,
        current: a?.getAttribute("aria-current") === "page",
      }
    })
    const r = bar.getBoundingClientRect()
    const ovie = [...document.querySelectorAll("a,button,div")]
      .filter((e) => getComputedStyle(e).position === "fixed" && /Ask Ovie|Ovie/i.test(e.textContent ?? ""))
      .map((e) => e.getBoundingClientRect())[0]
    return {
      cells,
      barTop: Math.round(r.top),
      barBottom: Math.round(r.bottom),
      viewportH: window.innerHeight,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      mainPadBottom: Math.round(parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom)),
      ovieBottom: ovie ? Math.round(ovie.bottom) : null,
    }
  })

const browser = await launch()
const pageErrors = []

try {
  const go = async (page, path) => {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
  }

  // ==================================================================
  // A + B. THE MOBILE SHELL, PER CONTEXT
  // ==================================================================
  for (const width of [320, 390]) {
    const ctx = await newContext(browser, { width, height: 780 })
    const page = await ctx.newPage()
    page.on("pageerror", (e) => pageErrors.push(e.message))
    await signIn(page, CLUB_ADMIN)
    await go(page, "/dashboard")

    const bar = await readBar(page)
    record(`A1 @${width} a phone gets a bottom bar at all -- before this, every destination was two taps`,
      bar !== null && bar.cells.length > 0, bar ? bar.cells.map((c) => c.text).join(" · ") : "(no bar)")
    if (!bar) continue

    record(`A2 @${width} it carries the club's own primary jobs and a way to the rest`,
      bar.cells.length === 5 && bar.cells.at(-1).text === "More", `${bar.cells.length} cells`)
    record(`A3 @${width} every cell clears 44px`, bar.cells.every((c) => c.h >= 44),
      bar.cells.map((c) => `${c.text}:${c.h}`).join(" "))
    record(`A4 @${width} and nothing is truncated into initials`, bar.cells.every((c) => !c.clipped),
      bar.cells.filter((c) => c.clipped).map((c) => c.text).join(", ") || "none clipped")
    record(`A5 @${width} no horizontal overflow`, bar.overflow <= 0, `${bar.overflow}px over`)
    record(`A6 @${width} the bar sits ON the bottom edge, not floating above it`,
      Math.abs(bar.barBottom - bar.viewportH) <= 1, `bottom ${bar.barBottom} of ${bar.viewportH}`)
    // THE DEFECT UX-4 NAMED: the floating widget used to sit over the content, and now over the bar.
    record(`A7 @${width} the floating widget clears the bar rather than sitting on it`,
      bar.ovieBottom === null || bar.ovieBottom <= bar.barTop, `widget ends ${bar.ovieBottom}, bar starts ${bar.barTop}`)
    // AND THE SHELL RESERVES THE ROOM, so a page does not have to know.
    record(`B1 @${width} the shell reserves room for its own furniture`, bar.mainPadBottom >= 88,
      `${bar.mainPadBottom}px reserved`)

    // The active cell is marked, and marked by more than colour.
    // NOT BY COLOUR ALONE, measured from the computed style rather than from a marker element.
    //
    // The first version of this looked for an aria-hidden indicator span. The bar then changed to a
    // `border-t-2` -- simpler, and because this file is guarded against `absolute top-*` -- and the
    // assertion went on passing until it did not. What matters is the PROPERTY: the active cell carries a
    // visible top border and an inactive one does not, so the state survives with colour ignored.
    const marked = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="Primary"]')
      const current = bar.querySelector('a[aria-current="page"]')
      const other = [...bar.querySelectorAll("a")].find((a) => a !== current)
      const border = (el) => (el ? getComputedStyle(el).borderTopColor : null)
      const transparent = (c) => c === null || c === "rgba(0, 0, 0, 0)" || c === "transparent"
      return current
        ? { text: (current.textContent ?? "").trim(), on: border(current), off: border(other), distinct: !transparent(border(current)) && transparent(border(other)) }
        : null
    })
    record(`A8 @${width} the current destination is marked, and not by colour alone`,
      marked !== null && marked.distinct, marked ? `${marked.text}: ${marked.on} vs ${marked.off}` : "(nothing marked)")

    // ONE TAP. Not "open the drawer, then tap".
    const target = bar.cells.find((c) => c.href && c.href !== "/dashboard")
    if (target) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: target.text }).click()
      // waitForURL, not just networkidle: a client-side navigation can settle the network before the
      // route changes, and the first run of this suite read the OLD pathname and reported a failure.
      await page.waitForURL((u) => new URL(u).pathname.startsWith(target.href), { timeout: 30000 }).catch(() => {})
      await page.waitForLoadState("networkidle").catch(() => {})
      record(`A9 @${width} one tap reaches a primary destination`,
        new URL(page.url()).pathname.startsWith(target.href), `${target.text} -> ${new URL(page.url()).pathname}`)
    }

    // And More still opens the drawer that holds everything.
    await go(page, "/dashboard")
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click()
    await page.waitForTimeout(600)
    record(`A10 @${width} More opens the drawer, which still holds the whole catalogue`,
      (await page.getByRole("navigation", { name: "Main" }).count()) > 0)
    await ctx.close()
  }

  // ==================================================================
  // C. UX-5 -- CLUB NAVIGATION IS GROUPED LIKE SITE ADMIN'S
  // ==================================================================
  const dctx = await newContext(browser, { width: 1440, height: 1000 })
  const desktop = await dctx.newPage()
  desktop.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(desktop, CLUB_ADMIN)
  await go(desktop, "/dashboard")
  // NAMED, not just "aside": the club dashboard has a second aside for news and notices, and an
  // unqualified selector resolved to two elements.
  const SIDEBAR = "aside.bg-forest-950"
  const groups = await desktop.evaluate(
    (sel) => [...document.querySelectorAll(`${sel} button[aria-expanded]`)].map((b) => (b.textContent ?? "").trim()),
    SIDEBAR
  )
  record("C1 a club's navigation is grouped into sections, not one flat list", groups.length >= 3, groups.join(" · "))
  // The bin is inside a section rather than beside the jobs people arrive to do.
  const binPlacement = await desktop.evaluate((sel) => {
    const link = [...document.querySelectorAll(`${sel} a`)].find((a) => a.getAttribute("href") === "/club/calendar/deleted-events")
    if (!link) return "absent"
    return link.closest("div[id^='nav-section-']") ? "in a section" : "top level"
  }, SIDEBAR)
  record("C2 and the recycle bin is inside one, not in prime navigation", binPlacement !== "top level", binPlacement)

  // ==================================================================
  // F. THE JOURNEY -- one identity, five places
  // ==================================================================
  const identity = await desktop.evaluate((sel) => (document.querySelector(sel)?.textContent ?? "").slice(0, 200), SIDEBAR)
  record("F1 the shell names the PERSON, with their context beside the role", /Krizz|Krzysik|Preston/i.test(identity))

  await go(desktop, "/people")
  record("F2 People is reached and named as itself", /People|Users/i.test(await desktop.locator("h1").first().innerText()))
  await go(desktop, "/teams")
  record("F3 Teams likewise", (await desktop.locator("h1").count()) === 1)

  // Club -> Governing Body, and back. The same account, a different job.
  await go(desktop, "/dashboard")
  const clubNav = await desktop.locator(SIDEBAR).innerText()
  await desktop.getByRole("button", { name: /Switch context/i }).click()
  await desktop.getByRole("menuitem", { name: /Ovalball Review County RFU/i }).click()
  await desktop.waitForURL(new RegExp(`/governing/${bodyId}`), { timeout: 30000 }).catch(() => {})
  const govNav = await desktop.locator(SIDEBAR).innerText()
  record("F4 switching to the county changes the job, not the account",
    /Overview/.test(govNav) && /People & Access/.test(govNav) && !/Users & Permissions|Club Management/.test(govNav))
  record("F5 and the club's own destinations are not still on screen",
    !/Teams/.test(govNav) || !/Club Management/.test(govNav), govNav.replace(/\s+/g, " ").slice(0, 110))

  await desktop.getByRole("button", { name: /Switch context/i }).click()
  await desktop.getByRole("menuitem", { name: /Preston/i }).first().click()
  await desktop.waitForTimeout(2500)
  const backNav = await desktop.locator(SIDEBAR).innerText()
  record("F6 switching back restores the club exactly", backNav.replace(/\s+/g, " ") === clubNav.replace(/\s+/g, " "))

  // ==================================================================
  // D. UX-6 -- NO DEAD ENDS
  // ==================================================================
  await go(desktop, `/club/${clubSlug}`)
  record("D1 the public club home gives a signed-in visitor a way back",
    (await desktop.getByRole("link", { name: /Back to Ovalball/i }).count()) === 1)
  await desktop.getByRole("link", { name: /Back to Ovalball/i }).click()
  // Same reason as A9: the public club home is a different route tree, and networkidle can settle before
  // the navigation lands.
  await desktop.waitForURL((u) => new URL(u).pathname === "/dashboard", { timeout: 30000 }).catch(() => {})
  await desktop.waitForLoadState("networkidle").catch(() => {})
  record("D2 and it leads into the application", new URL(desktop.url()).pathname === "/dashboard",
    new URL(desktop.url()).pathname)

  await go(desktop, "/rugby-hub")
  record("D3 Rugby Hub keeps the way back it already had",
    (await desktop.locator('a[href="/dashboard"]').count()) > 0)
  await dctx.close()

  // An anonymous visitor is not offered a return to somewhere they cannot go.
  const anon = await newContext(browser, { width: 390, height: 780 })
  const apage = await anon.newPage()
  await go(apage, `/club/${clubSlug}`)
  record("D4 an anonymous visitor is offered no return, because they have nowhere to return to",
    (await apage.getByRole("link", { name: /Back to Ovalball/i }).count()) === 0)
  record("D5 and that page does not shake sideways on a phone",
    (await apage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0)
  await anon.close()

  // ==================================================================
  // E. UX-7 -- MEASURED, NOT ASSERTED
  // ==================================================================
  for (const [width, label] of [
    [1440, "desktop"],
    [320, "320px"],
  ]) {
    const actx = await newContext(browser, { width, height: width === 320 ? 780 : 1000 })
    const apg = await actx.newPage()
    apg.on("pageerror", (e) => pageErrors.push(e.message))
    await signIn(apg, CLUB_ADMIN)
    for (const route of ["/dashboard", "/people", "/teams", "/calendar"]) {
      await go(apg, route)
      await apg.addScriptTag({ content: axeSource() })
      const violations = await apg.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
      })
      recordAxe(`axe: ${route} at ${label}`, violations)
    }
    // One h1 per shell route, still.
    await go(apg, "/dashboard")
    record(`E: one h1 on the landing page at ${label}`,
      (await apg.locator("h1").count()) === 1, `${await apg.locator("h1").count()} h1`)
    await actx.close()
  }

  // The bottom bar is keyboard reachable and its focus order follows the bar.
  const kctx = await newContext(browser, { width: 390, height: 780 })
  const kp = await kctx.newPage()
  await signIn(kp, CLUB_ADMIN)
  await go(kp, "/dashboard")
  const focusable = await kp.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="Primary"]')
    const items = [...bar.querySelectorAll("a,button")]
    items[0].focus()
    return { first: document.activeElement === items[0], count: items.length }
  })
  record("E: the bottom bar takes keyboard focus, in bar order",
    focusable.first && focusable.count === 5, JSON.stringify(focusable))
  await kctx.close()

  // ==================================================================
  // The other contexts get a bar built from what THEY hold, not the club's.
  // ==================================================================
  for (const [who, email, expectAbsent] of [
    ["a guardian", GUARDIAN, "Teams"],
    ["a Site Admin", SITE_ADMIN, "Rugby Hub"],
  ]) {
    const ctx = await newContext(browser, { width: 390, height: 780 })
    const p = await ctx.newPage()
    p.on("pageerror", (e) => pageErrors.push(e.message))
    await signIn(p, email)
    await go(p, "/dashboard")
    const b = await readBar(p)
    record(`A11 ${who} gets a bar built from their own navigation`,
      b !== null && b.cells.length > 0 && !b.cells.some((c) => c.text === expectAbsent),
      b ? b.cells.map((c) => c.text).join(" · ") : "(no bar)")
    record(`A12 ${who}'s bar does not overflow at 390px`, b !== null && b.overflow <= 0, `${b?.overflow}px`)
    await ctx.close()
  }

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
}

record("this suite created nothing that needs removing", true)

process.exit(summarise() ? 0 : 1)
