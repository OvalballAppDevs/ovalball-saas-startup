// =====================================================================
// CONVERGENCE STEP 15 -- THE GOVERNING BODY WORKSPACE, IN A REAL BROWSER
//
// Step 14 gave a governing body a page. This walks the PRODUCT the owner will
// review, as the county's own administrator:
//
//   sign in -> switch context to the county -> Overview (what needs doing)
//   -> Clubs -> a club's own public home -> Competitions -> start one
//   -> the canonical Competition Creator -> back -> People & Access -> Overview
//
// And the boundaries that make it safe:
//
//   * switching into the county does NOT carry club authority with it;
//   * a body officer is not offered their club's Fixtures, Teams or People;
//   * an ordinary club user is refused the workspace outright;
//   * a Viewer is told the truth instead of being shown controls that refuse them.
//
// Sprint mode: one product journey, one unauthorised entry, one mobile width,
// one accessibility sanity pass. The authority matrix is
// supabase/tests/step15_governing_product.sql, where it belongs.
//
// EVERYTHING THIS RUN CREATES IS REMOVED AND THE REMOVAL IS ASSERTED. The
// persistent review organisation, its officers and its own competition are the
// owner's review material and are never touched.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const OFFICER = "uat.preston.admin@ovalball.test"       // BODY_ADMIN at the review county
const VIEWER = "uat.adult.player@ovalball.test"         // BODY_VIEWER at the same county
const ORDINARY = "uat.team.manager@ovalball.test"       // no relationship to any body
const COMP_NAME = `S15 Journey Cup ${TAG}`
const GRANTEE = "uat.guardian.four@ovalball.test"       // an existing account with no county role

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const bodyId = sql(`select id from public.constituent_bodies where canonical_name = 'Ovalball Review County RFU'`)
if (!bodyId) {
  console.error("Missing the local review organisation. Run:")
  console.error("  node scripts/review-fixtures/step2-review-club.mjs enrich-governing")
  process.exit(1)
}

function teardown() {
  try {
    // This run's competition and its edition only, found by this run's own tag -- never by "the newest".
    sql(`delete from public.competition_editions where competition_id in
           (select id from public.competitions where name like 'S15 Journey Cup %');
         delete from public.competitions where name like 'S15 Journey Cup %';`)
    // And this run's grant. REVOKED rows are history elsewhere, but this one is a row this suite
    // created, so removing it is putting back what it changed rather than deleting somebody's record.
    sql(`delete from public.constituent_body_roles r using auth.users u
          where u.id = r.user_id and u.email = '${GRANTEE}' and r.constituent_body_id = '${bodyId}';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const browser = await launch()
const pageErrors = []
let editionUrl = null

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(page, OFFICER)

  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // ==================================================================
  // A. GETTING THERE, AS A CONTEXT RATHER THAN A PAGE
  // ==================================================================
  await go("/dashboard")
  // This person is a Club Admin FIRST -- the default context must not jump to the county.
  const nav = await page.locator("nav").first().innerText()
  record("A1 a Club Admin who is also a county officer still lands in their club", /Fixtures|Teams|People/i.test(nav), nav.replace(/\s+/g, " ").slice(0, 90))

  // Switch context through the product's own switcher, not by typing a URL.
  await page.getByRole("button", { name: /Switch context/i }).click()
  await page.getByRole("menuitem", { name: /Ovalball Review County RFU/i }).click()
  await page.waitForURL(new RegExp(`/governing/${bodyId}`), { timeout: 30000 }).catch(() => {})
  record("A2 switching to the county LANDS in the county's workspace, not on a club page",
    page.url().includes(`/governing/${bodyId}`), page.url().replace(APP, ""))

  const govNav = await page.locator("nav").first().innerText()
  record("A3 and the navigation becomes the organisation's four jobs",
    /Overview/i.test(govNav) && /Clubs/i.test(govNav) && /Competitions/i.test(govNav) && /People & Access/i.test(govNav),
    govNav.replace(/\s+/g, " ").slice(0, 110))
  // THE BOUNDARY THAT MATTERS: the same account's club authority is not carried across.
  record("A4 while the SAME account's club destinations are gone -- the two jobs do not bleed",
    !/Fixtures/i.test(govNav) && !/Teams/i.test(govNav) && !/Training/i.test(govNav),
    govNav.replace(/\s+/g, " ").slice(0, 110))
  // And the identity block still names the PERSON, with the organisation beside the role.
  const shell = await page.locator("body").innerText()
  record("A5 the identity block names the person, with the organisation beside their role",
    /Organisation Administrator/i.test(shell) && /Review County/i.test(shell))

  // ==================================================================
  // B. THE OVERVIEW, AND THEN THE CLUBS
  // ==================================================================
  const overview = await page.locator("main").innerText()
  record("B1 the Overview leads with what needs doing", /needs attention/i.test(overview))
  record("B2 and names the real work rather than a metric",
    /teams entered|matches drawn|no season|only administrator|affiliated/i.test(overview),
    overview.replace(/\s+/g, " ").slice(0, 160))
  record("B3 with no invented analytics", !/\d+%|trend|engagement|score\b/i.test(overview))

  await page.getByRole("link", { name: /^All Clubs$/i }).click()
  await page.waitForURL(/\/clubs$/, { timeout: 30000 }).catch(() => {})
  const clubs = await page.locator("main").innerText()
  record("B4 Clubs names the affiliated clubs", /Affiliated Clubs/i.test(clubs) && /Step 2 Review RFC/i.test(clubs))
  record("B5 and says which of them are on Ovalball", /on Ovalball/i.test(clubs))
  // AFFILIATION IS NOT AUTHORITY, and the page has to say so rather than merely behave.
  record("B6 it states that affiliation is not access to the club's own data",
    /does not give this organisation access/i.test(clubs))
  // ASSERTED ON CONTROLS, not on prose: the page explains what a transfer WOULD need, and the point is
  // that it offers no button to do one. Searching the text for the word found the explanation.
  const clubControls = await page.evaluate(() =>
    [...document.querySelectorAll("main button, main a")]
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => /add|remove|affiliat|transfer|suspend|edit|change/i.test(t))
  )
  record("B7 and offers no control that would rewrite affiliation", clubControls.length === 0,
    clubControls.join(" | ") || "(no such control)")

  // Into a club's OWN PUBLIC HOME -- the legitimate destination, never an admin surface.
  const clubLink = page.locator("main a").filter({ hasText: /On Ovalball/i }).first()
  const clubHref = (await clubLink.count()) > 0 ? await clubLink.getAttribute("href") : null
  record("B8 a club is reached at its own public home, not through club administration",
    (clubHref ?? "").startsWith("/club/"), clubHref ?? "(no club link)")
  if (clubHref) {
    await go(clubHref)
    const clubPage = await page.locator("body").innerText()
    // The public club home carries public Rugby Hub guidance that legitimately addresses parents and
    // guardians, so the earlier word search matched its own signposting. What actually matters is that a
    // county officer reaching a club gets no person-level record and no club administration.
    record("B9 which shows the club, and none of its people or their records",
      !/Date of Birth\b/i.test(clubPage) && !/Club Settings|Users & Permissions|Safeguarding Officer/i.test(clubPage))
  }

  // ==================================================================
  // C. COMPETITIONS -- THE SEAM INTO THE PRODUCT THAT ALREADY EXISTS
  // ==================================================================
  await go(`/governing/${bodyId}/competitions`)
  const comps = await page.locator("main").innerText()
  record("C1 Competitions shows what the organisation already runs", /Review County Junior Cup/i.test(comps))
  record("C2 with how far each one has actually got",
    /teams entered|no teams entered|matches|no season/i.test(comps),
    comps.replace(/\s+/g, " ").slice(0, 160))

  await page.getByRole("button", { name: /Start a Competition/i }).click()
  await page.getByLabel(/Competition Name/i).fill(COMP_NAME)
  record("C3 starting one asks for a name and nothing the canonical model already knows",
    /Rugby Union competition organised by this organisation/i.test(await page.locator("main").innerText()))
  await page.getByRole("button", { name: /^Create Competition$/i }).click()

  // IT HANDS OVER TO THE CANONICAL CREATOR rather than growing a second one.
  await page.waitForURL(/\/fixtures\/competitions\/[0-9a-f-]+\//, { timeout: 30000 }).catch(() => {})
  editionUrl = page.url()
  record("C4 and hands straight over to the canonical Competition Creator",
    /\/fixtures\/competitions\/[0-9a-f-]+\//.test(editionUrl), editionUrl.replace(APP, ""))

  const created = sql(`select organiser_constituent_body_id::text || '|' || rugby_code
                       from public.competitions where name = '${COMP_NAME}'`)
  record("C5 recorded against the organisation, in the organisation's own rugby code",
    created === `${bodyId}|union`, created || "(nothing created)")
  const seasonOk = sql(`select s.name from public.competitions c
                        join public.competition_editions e on e.competition_id = c.id
                        join public.seasons s on s.id = e.season_id
                        where c.name = '${COMP_NAME}'`)
  record("C6 with its season from the canonical Seasons register", seasonOk.length > 0, seasonOk || "(no season)")

  // The Creator's own step bar works for this organiser -- the point of reusing it.
  const creator = await page.locator("main").innerText()
  record("C7 the Creator's own steps are available to the county, not just to a club",
    /Participants/i.test(creator) && /Details/i.test(creator))
  // And "back" goes to the ORGANISATION, because that is where they came from.
  const back = page.locator("main a").filter({ hasText: /^Competitions$/ }).first()
  const backHref = (await back.count()) > 0 ? await back.getAttribute("href") : null
  record("C8 whose back link returns to the ORGANISATION's competitions, not to club fixtures",
    (backHref ?? "").includes(`/governing/${bodyId}/competitions`), backHref ?? "(no back link)")

  // ==================================================================
  // D. PEOPLE & ACCESS
  // ==================================================================
  await go(`/governing/${bodyId}/people`)
  const people = await page.locator("main").innerText()
  // ONE NAME PER ROLE. The first run of this suite found the sidebar saying "Organisation
  // Administrator" and this page saying "Administrator" for the same row -- one concept with two names,
  // now resolved to a single authority in lib/governing/roles.ts. The assertion keeps it that way.
  record("D1 People & Access says who has access and what they hold",
    /Who Has Access/i.test(people) && /Organisation Administrator/i.test(people) && /Competitions Officer/i.test(people))
  record("D1b in the SAME words the sidebar uses for the same role",
    /Organisation Administrator/i.test(shell) && /Organisation Administrator/i.test(people))
  record("D2 and what each role actually allows, not just its name",
    /What Each Role Allows/i.test(people) && /Cannot change who has access/i.test(people))
  record("D3 it states that none of it reaches a child's records",
    /does not give access to a club's members|dates of birth|safeguarding/i.test(people))
  record("D4 and is honest that inviting somebody with no account is not built",
    /Without an Ovalball Account/i.test(people))

  // A REAL GRANT, through the product.
  await page.getByRole("button", { name: /^Give Access$/i }).click()
  await page.getByLabel(/Email Address/i).fill(GRANTEE)
  await page.getByRole("radio", { name: /Organisation Viewer/i }).check()
  await page.getByRole("button", { name: /^Give Access$/i }).click()
  await page.waitForTimeout(2500)
  const granted = sql(`select r.role_key from public.constituent_body_roles r join auth.users u on u.id = r.user_id
                       where u.email = '${GRANTEE}' and r.constituent_body_id = '${bodyId}' and r.state = 'ACTIVE'`)
  record("D5 giving access by email writes the canonical relationship", granted === "BODY_VIEWER", granted || "(nothing)")
  record("D6 and the page then shows them", /Organisation Viewer/i.test(await page.locator("main").innerText()))

  // An address with no account is an ordinary answer, not an error.
  await page.getByRole("button", { name: /^Give Access$/i }).click()
  await page.getByLabel(/Email Address/i).fill(`nobody.${TAG}@ovalball.test`)
  await page.getByRole("button", { name: /^Give Access$/i }).click()
  await page.waitForTimeout(2000)
  record("D7 an address with no Ovalball account is answered plainly, not as a failure",
    /No Ovalball account uses that address/i.test(await page.locator("main").innerText()))

  // BACK TO THE OVERVIEW, closing the journey.
  await page.getByRole("link", { name: /^Overview$/i }).click()
  await page.waitForURL(new RegExp(`/governing/${bodyId}$`), { timeout: 30000 }).catch(() => {})
  record("D8 and the workspace comes back to its own Overview",
    page.url().endsWith(`/governing/${bodyId}`), page.url().replace(APP, ""))

  // ==================================================================
  // E. ACCESSIBILITY OF THE CHANGED SURFACES
  // ==================================================================
  for (const [label, path] of [
    ["the Overview", `/governing/${bodyId}`],
    ["Clubs", `/governing/${bodyId}/clubs`],
    ["Competitions", `/governing/${bodyId}/competitions`],
    ["People & Access", `/governing/${bodyId}/people`],
  ]) {
    await go(path)
    await page.addScriptTag({ content: axeSource() })
    const violations = await page.evaluate(async () => {
      const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
      return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
    })
    recordAxe(`axe: ${label}`, violations)
    const headings = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2")].map((h) => h.tagName)
    )
    record(`E: ${label} has one h1 and real section headings`,
      headings.filter((h) => h === "H1").length === 1 && headings.filter((h) => h === "H2").length >= 2,
      headings.join(","))
  }

  // Keyboard: the primary action on each page is reachable and focusable.
  await go(`/governing/${bodyId}/people`)
  const focused = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Give Access/i.test(b.textContent ?? ""))
    btn?.focus()
    return document.activeElement === btn
  })
  record("E: the primary action takes keyboard focus", focused)

  // ==================================================================
  // F. A VIEWER IS TOLD THE TRUTH
  // ==================================================================
  await ctx.close()
  const vctx = await newContext(browser, { width: 1440, height: 1100 })
  const v = await vctx.newPage()
  v.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(v, VIEWER)
  await go(`/governing/${bodyId}/competitions`, v)
  const vcomps = await v.locator("main").innerText()
  record("F1 a Viewer sees the competitions", /Review County Junior Cup/i.test(vcomps))
  record("F2 and is told they are view only rather than shown a control that refuses them",
    /View only/i.test(vcomps) && !/Start a Competition/i.test(vcomps))
  await go(`/governing/${bodyId}/people`, v)
  const vpeople = await v.locator("main").innerText()
  record("F3 a Viewer sees who has access", /Who Has Access/i.test(vpeople))
  // ON CONTROLS AGAIN: the page PRINTS what an administrator's role allows ("give or remove other
  // people's access"), which a text search reads as an offer. What matters is that a Viewer is handed
  // no button.
  const viewerControls = await v.evaluate(() =>
    [...document.querySelectorAll("main button, main a")]
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => /give access|remove|revoke/i.test(t))
  )
  record("F4 and is offered no way to change it", viewerControls.length === 0,
    viewerControls.join(" | ") || "(no such control)")
  record("F5 and is given no email addresses", !new RegExp(OFFICER.replace(".", "\\."), "i").test(vpeople))
  await vctx.close()

  // ==================================================================
  // G. THE PHONE
  // ==================================================================
  const small = await newContext(browser, { width: 390, height: 844 })
  const m = await small.newPage()
  await signIn(m, OFFICER)
  for (const [label, path] of [
    ["Overview", `/governing/${bodyId}`],
    ["Clubs", `/governing/${bodyId}/clubs`],
    ["Competitions", `/governing/${bodyId}/competitions`],
    ["People & Access", `/governing/${bodyId}/people`],
  ]) {
    await go(path, m)
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`G: ${label} does not overflow at 390px`, overflow <= 0, `${overflow}px over`)
  }
  await go(`/governing/${bodyId}`, m)
  record("G: the Overview leads with Needs Attention on a phone too",
    /needs attention/i.test(await m.locator("main").innerText()))
  await small.close()

  // ==================================================================
  // H. SOMEBODY WITH NO RELATIONSHIP
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const o = await octx.newPage()
  await signIn(o, ORDINARY)
  for (const path of [`/governing/${bodyId}`, `/governing/${bodyId}/clubs`, `/governing/${bodyId}/competitions`, `/governing/${bodyId}/people`]) {
    await go(path, o)
    const text = await o.locator("body").innerText()
    record(`H: ${path.replace(`/governing/${bodyId}`, "the workspace") || "the workspace"} shows an outsider nothing of the organisation`,
      !/Step 2 Review RFC/i.test(text) && !/Review County Junior Cup/i.test(text) && !/Who Has Access/i.test(text))
  }
  const onav = await o.locator("nav").first().innerText()
  record("H: and the workspace is not in their navigation at all", !/Governing|Organisation/i.test(onav))
  await octx.close()

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

// ====================================================================
// AND EVERYTHING THIS RUN CREATED IS GONE, while the owner's review material
// -- the county, its three officers and its own competition -- is untouched.
// ====================================================================
record("cleanup: this run's competition and its edition are gone",
  sql(`select count(*) from public.competitions where name like 'S15 Journey Cup %'`) === "0")
record("cleanup: this run's access grant is gone",
  sql(`select count(*) from public.constituent_body_roles r join auth.users u on u.id = r.user_id
       where u.email = '${GRANTEE}' and r.constituent_body_id = '${bodyId}'`) === "0")
record("cleanup: the persistent review organisation is untouched",
  sql(`select count(*) from public.constituent_body_roles where constituent_body_id = '${bodyId}' and state = 'ACTIVE'`) === "3" &&
    sql(`select count(*) from public.competitions where organiser_constituent_body_id = '${bodyId}'`) === "1")

process.exit(summarise() ? 0 : 1)
