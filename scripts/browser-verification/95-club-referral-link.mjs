// =====================================================================
// ONE REFERRAL LINK PER CLUB -- THE WEB HALF (20270740000000)
//
// A club's referral link is `/r/<its slug>`. The server decides who is
// credited, when the club that used it is approved
// (supabase/tests/referral_link_attribution.sql); what only a browser can
// show is that the slug actually reaches that decision. It travels in the
// address and nowhere else, so every hop has to carry it:
//
//   A. /r/<slug> signed out, at a phone width and a desktop width: the
//      recommending club by name, the two ways in, no cookie and nothing in
//      browser storage, no sideways scroll, axe.
//   B. Other slugs: a differently-cased one is the same club; an unknown
//      or hostile one is no referral and carries nothing on.
//   C. Get Started opens signup with the slug in the address.
//   D. Signed in: Find Your Club reaches the Clubhouse with the slug; the
//      list card's View Profile keeps it; the MAP PIN'S card renders; and a
//      claim from the pin and from the club profile both carry the slug.
//
// D exists because of a defect it caught before release. The map mounts
// each pin's card in its own React root (createRoot into Leaflet's popup),
// where there is no router, so `useSearchParams()` is null -- and the claim
// dialog's first version read the slug through it. Every pin for a club not
// yet on Ovalball threw on open. The type checker cannot see that (the
// hook's type says it is never null) and no other suite opens a pin.
//
// NOTHING IS WRITTEN. Each claim is filled in for real and submitted, and
// the server action is captured and ABORTED in the browser before it leaves
// the page; the suite then asserts that no claim was created.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, measure, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"

/** The persistent UAT club whose link is shared, and its Club Admin (a UAT persona, never the owner). */
const SLUG = "ovalball-uat-rufc"
const ADMIN = "uat.coach@ovalball.test"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const clubName = sql(`select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.slug = '${SLUG}' and c.status = 'active'`)
const adminId = sql(`select id from auth.users where email = '${ADMIN}'`)
/**
 * A club the map shows as a pin and offers to claim: active in the Club Directory, geocoded inside the
 * map's own bounds, with no Ovalball club at all -- and a name that no other club's name, town or
 * postcode contains, so searching for it leaves exactly its own pin.
 */
const target = sql(`
  select d.id || '|' || d.name from public.club_directory d
  where d.active and d.geocode_status = 'success'
    and d.latitude between 49 and 61 and d.longitude between -11.5 and 2
    and length(d.name) >= 6
    and not exists (select 1 from public.clubs c where c.directory_id = d.id)
    and not exists (
      select 1 from public.club_directory o
      where o.active and o.id <> d.id
        and (strpos(lower(o.name), lower(d.name)) > 0
          or strpos(lower(coalesce(o.town, '')), lower(d.name)) > 0
          or strpos(replace(lower(coalesce(o.postcode, '')), ' ', ''), replace(lower(d.name), ' ', '')) > 0))
  order by d.name limit 1`)
if (!clubName || !adminId || !target) {
  console.error("Missing the review world's UAT club, its Club Admin, or any claimable directory club. Run:")
  console.error("  node scripts/review-fixtures/step2-review-club.mjs")
  process.exit(1)
}
const [targetId, targetName] = target.split("|")
const startedAt = sql("select now()")

const errors = []
const watch = (page, label) => page.on("pageerror", (e) => errors.push(`${label}: ${e.message.split("\n")[0]}`))

/** axe's targets live under nodes[].target; flattened the way 87 and 88 flatten them for recordAxe. */
async function runAxe(page) {
  await page.addScriptTag({ content: axeSource() })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
}

/** Fill in and submit the open claim dialog; capture the server action and abort it, so nothing is written. */
async function interceptClaim(page, scope) {
  const dialog = page.getByRole("dialog")
  await dialog.waitFor()
  await dialog.locator("#claim-role").selectOption({ index: 1 })
  await dialog.locator("#claim-declaration").fill("Browser verification only -- this request is aborted before it leaves the page.")
  let resolveBody
  const body = new Promise((r) => (resolveBody = r))
  const everything = () => true
  await page.route(everything, async (route) => {
    const req = route.request()
    if (req.method() === "POST" && req.headers()["next-action"]) {
      resolveBody(req.postData() ?? "")
      await route.abort()
      return
    }
    await route.continue()
  })
  const mark = errors.length
  await dialog.getByRole("button", { name: "Submit Claim" }).click()
  const captured = await Promise.race([body, new Promise((r) => setTimeout(() => r(null), 15000))])
  await page.unroute(everything)
  record(`${scope}: the claim carries the referral slug`, captured !== null && captured.includes(`"${SLUG}"`), captured === null ? "no server action was sent" : captured.slice(0, 140))
  await page.waitForTimeout(800)
  // The abort is this suite's own doing, and so is what it throws in the page.
  for (const e of errors.splice(mark)) console.log(`NOTE  expected after the deliberate abort: ${e.slice(0, 160)}`)
  await page.keyboard.press("Escape")
}

const browser = await launch()
try {
  // ---------------------------------------------------------------- A, B, C. signed out
  for (const [width, height] of [
    [390, 844],
    [1280, 900],
  ]) {
    const context = await newContext(browser, { width, height })
    const page = await context.newPage()
    watch(page, `signed out ${width}`)
    const jarBefore = (await context.cookies()).map((c) => c.name).sort()
    const res = await page.goto(`${APP}/r/${SLUG}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(`${width}: /r/${SLUG} answers 200`, res?.status() === 200, String(res?.status()))
    const h1 = (await page.locator("h1").innerText()).trim()
    record(`${width}: names the recommending club`, h1 === `${clubName} recommends Ovalball`, h1)
    const start = await page.locator("a", { hasText: "Get Started" }).getAttribute("href")
    record(`${width}: Get Started carries the slug to signup`, start === `/signup?ref=${SLUG}`, start)
    const back = await page.locator("a", { hasText: "Sign In" }).getAttribute("href")
    record(`${width}: Sign In returns to the Clubhouse with the slug`, back === `/login?next=${encodeURIComponent(`/clubhouse?ref=${SLUG}`)}`, back)
    const m = await measure(page)
    record(`${width}: the viewport is really ${width} and nothing scrolls sideways`, m.innerWidth === width && m.scrollWidth <= m.clientWidth, JSON.stringify(m))
    const jarAfter = (await context.cookies()).map((c) => c.name).sort()
    record(`${width}: the page writes no cookie`, JSON.stringify(jarAfter) === JSON.stringify(jarBefore), `before [${jarBefore}] after [${jarAfter}]`)
    const store = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))
    record(`${width}: and nothing in browser storage`, store.local.length === 0 && store.session.length === 0, JSON.stringify(store))

    if (width === 390) {
      recordAxe(`${width}: axe on /r/${SLUG}`, await runAxe(page))

      await page.goto(`${APP}/r/${SLUG.toUpperCase()}`, { waitUntil: "domcontentloaded" })
      const cased = await page.locator("a", { hasText: "Get Started" }).getAttribute("href")
      record("a differently-cased slug is the same club, carried lower-case", (await page.locator("h1").innerText()).trim() === `${clubName} recommends Ovalball` && cased === `/signup?ref=${SLUG}`, cased)

      await page.goto(`${APP}/r/no-such-club-${Date.now()}`, { waitUntil: "domcontentloaded" })
      const dead = (await page.locator("h1").innerText()).trim()
      const deadStart = await page.locator("a", { hasText: "Get Started" }).getAttribute("href")
      const deadBack = await page.locator("a", { hasText: "Sign In" }).getAttribute("href")
      record("an unknown slug says the link isn't active and carries nothing on", dead === "This link isn't active" && deadStart === "/signup" && deadBack === `/login?next=${encodeURIComponent("/clubhouse")}`, `${dead} | ${deadStart} | ${deadBack}`)
      recordAxe("390: axe on an inactive link", await runAxe(page))

      for (const hostile of ["..%2Fadmin", "%2e%2e", "a%20b", "x".repeat(120)]) {
        const r = await page.goto(`${APP}/r/${hostile}`, { waitUntil: "domcontentloaded" })
        const carried = await page.locator("a[href*='ref=']").count()
        record(`a hostile slug (${hostile.slice(0, 12)}) is no referral`, (r?.status() ?? 500) < 500 && carried === 0, `status ${r?.status()}, ${carried} links carrying ref`)
      }

      await page.goto(`${APP}/r/${SLUG}`, { waitUntil: "domcontentloaded" })
      await page.locator("a", { hasText: "Get Started" }).click()
      await page.waitForURL(/\/signup\?ref=/, { timeout: 60000 }).catch(() => {})
      record("Get Started opens signup with the slug in the address", page.url().endsWith(`/signup?ref=${SLUG}`), page.url())
    }
    await context.close()
  }

  // ---------------------------------------------------------------- D. signed in
  const context = await newContext(browser, { width: 1280, height: 900 })
  const page = await context.newPage()
  watch(page, "signed in")
  await signIn(page, ADMIN)
  await page.goto(`${APP}/r/${SLUG}`, { waitUntil: "domcontentloaded" })
  const find = page.locator("a", { hasText: "Find Your Club" })
  const findHref = await find.getAttribute("href")
  record("signed in: one way in, Find Your Club, to the Clubhouse with the slug", findHref === `/clubhouse?ref=${SLUG}` && (await page.locator("a", { hasText: "Get Started" }).count()) === 0, findHref)
  await find.click()
  await page.waitForURL(/\/clubhouse\?ref=/, { timeout: 90000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("Find Your Club lands on the Clubhouse with the slug still in the address", page.url().endsWith(`/clubhouse?ref=${SLUG}`), page.url())

  await page.locator("#club-map-search").fill(targetName)
  await page.getByRole("button", { name: new RegExp(targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click()
  const profileHref = await page.locator("a", { hasText: "View Profile" }).first().getAttribute("href")
  record("the list card's View Profile keeps the slug", profileHref === `/clubhouse/club/${targetId}?ref=${SLUG}`, profileHref)
  await page.waitForTimeout(1500)

  // Leaflet ignores `alt` on a div icon, so a pin has no name to find it by: the search has narrowed the
  // map to this one club, so the one unclustered pin left is its own.
  const pin = page.locator(".leaflet-marker-icon:not(.marker-cluster)")
  const pins = await pin.count()
  record("the search leaves exactly one pin on the map", pins === 1, `${pins} pins`)
  if (pins === 1) {
    const mark = errors.length
    await pin.click({ force: true })
    await page.waitForTimeout(1200)
    const popup = page.locator(".leaflet-popup-content")
    const text = (await popup.count()) ? (await popup.innerText()).replace(/\s+/g, " ") : ""
    const thrown = errors.slice(mark)
    record("the map pin's card renders in its own React root", text.includes(targetName) && text.includes("Claim This Club") && thrown.length === 0, thrown.join(" | ").slice(0, 200) || text.slice(0, 120))
    if (text.includes("Claim This Club")) {
      await popup.getByRole("button", { name: "Claim This Club" }).click()
      await interceptClaim(page, "from the map pin")
    }
  }

  await page.goto(`${APP}${profileHref}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByRole("button", { name: "Claim This Club" }).first().click()
  await interceptClaim(page, "from the club profile")
  await context.close()
} finally {
  await browser.close()
}

const written = sql(`select count(*) from public.club_claims where directory_id = '${targetId}' and created_at >= '${startedAt}'`)
record("nothing was written: no claim exists from this run", written === "0", `${written} claims`)
record("no uncaught error in any page", errors.length === 0, errors.join(" | ").slice(0, 240))

process.exit(summarise() ? 0 : 1)
