#!/usr/bin/env node
/**
 * Permanent verification for the public Legal & Trust surface.
 *
 * Runs against a running Ovalball origin (local dev by default, or production
 * via BASE_URL) and asserts the things that must never silently regress:
 * every legal route is reachable WITHOUT logging in, the homepage carries the
 * operator name and the legal links, the old operator name is gone from public
 * output, protected application routes are still protected, and no public page
 * leaks a localhost URL.
 *
 *   node scripts/verify-legal-routes.mjs
 *   BASE_URL=https://ovalball.co.uk node scripts/verify-legal-routes.mjs
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

const LEGAL_ROUTES = [
  "/legal",
  "/legal/privacy",
  "/legal/children-privacy",
  "/legal/terms",
  "/legal/cookies",
  "/legal/safeguarding",
  "/legal/acceptable-use",
  "/legal/data-rights",
  "/legal/subprocessors",
  "/legal/copyright",
]

/** Public non-legal pages that must also stay reachable while logged out. */
const PUBLIC_ROUTES = ["/about", "/contact", "/clubs", "/fixtures", "/game-management", "/payment-services"]

const CONTACT_EMAIL = "hello@ovalball.co.uk"

/** Routes that must NOT be publicly readable. */
const PROTECTED_ROUTES = ["/club/settings", "/parent/children", "/calendar", "/fixtures/management", "/admin/clubs"]

let pass = 0
let fail = 0

function check(name, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" })
  let body = ""
  if (res.status === 200) body = await res.text()
  return { status: res.status, body, location: res.headers.get("location") ?? "" }
}

async function main() {
  console.log(`Legal & Trust verification against ${BASE}\n`)

  console.log("Public legal routes reachable while logged out:")
  const pages = {}
  for (const route of LEGAL_ROUTES) {
    const r = await get(route)
    pages[route] = r.body
    check(`${route} returns 200`, r.status === 200, `got ${r.status}${r.location ? ` -> ${r.location}` : ""}`)
  }

  console.log("\nPublic About and Contact pages reachable while logged out:")
  for (const route of PUBLIC_ROUTES) {
    const r = await get(route)
    pages[route] = r.body
    check(`${route} returns 200`, r.status === 200, `got ${r.status}${r.location ? ` -> ${r.location}` : ""}`)
  }

  console.log("\nAbout page content:")
  const about = pages["/about"] ?? ""
  check("about names the product", /Ovalball is technology built for rugby/i.test(about))
  check("about names the operator", about.includes("Pipaxon Technologies Ltd"))
  check("about states what we're building for", /What we&#x27;re building for|What we're building for/.test(about))
  check("about links the contact page", about.includes('href="/contact"'))
  check("about shows the contact email", about.includes(CONTACT_EMAIL))

  console.log("\nContact page content:")
  const contact = pages["/contact"] ?? ""
  check("contact shows the email address in the page text", contact.includes(CONTACT_EMAIL))
  check("contact has a working mailto link", contact.includes(`href="mailto:${CONTACT_EMAIL}"`))
  check("contact offers a reason selector", /Reason for contacting us/i.test(contact))
  for (const reason of [
    "General enquiry",
    "Club interested in Ovalball",
    "Account support",
    "Privacy / data rights",
    "Safeguarding / online safety",
    "Technical problem",
  ]) {
    check(`contact offers reason "${reason}"`, contact.includes(reason))
  }
  check("contact carries the privacy wording", /respond to your enquiry/i.test(contact))
  check("contact links the Privacy Notice", contact.includes('href="/legal/privacy"'))

  console.log("\nClubs page:")
  const clubs = pages["/clubs"] ?? ""
  check("clubs leads with the grassroots headline", /Rugby starts with its clubs/.test(clubs))
  check("clubs tells the community story", /More than a team|A club is the people/i.test(clubs))
  check("clubs covers grassroots", /Grassroots rugby is where the game begins/i.test(clubs))
  check("clubs makes the connected-clubs argument", /Fixtures do not happen in isolation/i.test(clubs))
  check("clubs has the partner heading", /Ovalball is proudly partnered with/i.test(clubs))
  check("clubs shows the honest empty partner state", /More club partnerships will be announced here/i.test(clubs))
  check("clubs uses the shared image bank", /arms-round|club-house|handshake/.test(clubs))
  check("clubs CTA links signup and fixtures", clubs.includes('href="/signup"') && clubs.includes('href="/fixtures"'))
  check("clubs makes NO endorsement or scale claim", !/thousands of clubs|trusted by the RFU|official partner|used by international/i.test(clubs))

  console.log("\nFixtures page (public, logged out):")
  const fixtures = pages["/fixtures"] ?? ""
  check("fixtures serves the marketing page, not a login redirect", /Fixtures, without the chaos/.test(fixtures))
  check("fixtures states the one-record principle", /One fixture\. One record\./i.test(fixtures))
  check("fixtures has the request preview", /Request a fixture/i.test(fixtures))
  check("fixtures has the conversation preview", /Fixture conversation/i.test(fixtures))
  check("fixtures has the calendar preview", /Calendar/.test(fixtures))
  check("fixtures has the pitch allocation preview", /Pitch allocation/i.test(fixtures))
  check("fixtures labels previews as previews", /Product preview/i.test(fixtures))
  check("fixtures preserves the permission-accurate calendar wording", /Authorised users see the fixture/i.test(fixtures))
  check(
    "fixtures uses only synthetic club names",
    /Northbridge|Westbrook|Eastfield|Riverside/.test(fixtures) &&
      !/Guildford|Camberley|Woking|Burnley/.test(fixtures)
  )

  console.log("\nGame Management page:")
  const game = pages["/game-management"] ?? ""
  check("game management leads on game-day readiness", /Know your team before game day/i.test(game))
  check("game management tells the pre-whistle story", /Selecting a side shouldn|before the whistle/i.test(game))
  check(
    "game management uses the canonical availability vocabulary",
    /Attending/.test(game) && /Can&#x27;t attend|Can't attend/.test(game) && /Unsure/.test(game)
  )
  check("game management shows team availability counts", /Match availability/i.test(game) && /No response/i.test(game))
  check("game management has the squad-planning story", /Know the shape of the squad/i.test(game))
  check(
    "game management does NOT claim an automatic team picker",
    /does not pick your side/i.test(game) && !/automatically (picks|selects) your/i.test(game)
  )
  check("game management has the club-preparation story", /catering and hospitality/i.test(game))
  check("game management has the fixture updates story", /Updates that belong to the game/i.test(game))
  check(
    "game management separates club negotiation from participant information",
    /parents do not see the club-to-club negotiation/i.test(game)
  )
  check("game management has the connected-game visual", /Everyone who needs it, connected/i.test(game))
  check("game management makes no arrival-time claim", !/arrival time|Arrival<\/dt>/i.test(game))
  check("game management links to fixtures", game.includes('href="/fixtures"'))

  console.log("\nPayment Services page:")
  const pay = pages["/payment-services"] ?? ""
  check("payments leads on membership", /without the monthly chase/i.test(pay))
  check("payments has the spreadsheet story", /shouldn&#x27;t live in a spreadsheet|shouldn't live in a spreadsheet/i.test(pay))
  check("payments has the member setup journey", /Setting up a membership/i.test(pay))
  check("payments has the recurring collection story", /scheduled through GoCardless/i.test(pay))
  check("payments has the finance dashboard", /Membership overview/i.test(pay) && /Needs attention/i.test(pay))
  check("payments uses canonical obligation labels", /Scheduled for collection/.test(pay) && /Submitted to GoCardless/.test(pay))
  check("payments has the needs-attention story", /A failed payment is information, not a judgement/i.test(pay))
  check("payments frames visibility as support, not chasing", /not so they can chase harder/i.test(pay))
  check("payments states the provider relationship accurately", /Ovalball integrates with GoCardless/i.test(pay))
  check("payments states production collection is NOT live", /not yet switched on in the live service/i.test(pay))
  check("payments links privacy, subprocessors and terms", pay.includes('href="/legal/privacy"') && pay.includes('href="/legal/subprocessors"') && pay.includes('href="/legal/terms"'))
  check(
    "payments makes NO guaranteed-collection or instant-settlement claim",
    !/always be collected|guaranteed|instantly|within seconds|bank-grade|100% secure/i.test(pay)
  )
  check("payments does NOT claim an official partnership", !/proudly partnered with GoCardless|official partner/i.test(pay))
  check("payments exposes no bank details", !/sort code|account number|IBAN/i.test(pay))

  console.log("\nCopyright and intellectual property:")
  const copyrightPage = pages["/legal/copyright"] ?? ""
  const year = new Date().getFullYear()
  check("copyright page names the operator", copyrightPage.includes("Pipaxon Technologies Ltd"))
  check("copyright page asserts rights reserved", /All rights reserved/.test(copyrightPage))
  check(
    "copyright page disclaims club crests and governing-body marks",
    /crests/i.test(copyrightPage) && /RFU/.test(copyrightPage) && /RFL/.test(copyrightPage)
  )
  check(
    "copyright page confirms clubs and users keep ownership",
    /retain ownership/i.test(copyrightPage)
  )
  check(
    "copyright page makes NO registered-trademark claim",
    !/registered trade ?mark|®/i.test(copyrightPage)
  )
  check("terms link to the copyright page", (pages["/legal/terms"] ?? "").includes('href="/legal/copyright"'))

  console.log("\nNo unverified company identifiers anywhere in public legal output:")
  const allLegal = Object.entries(pages)
    .filter(([route]) => route.startsWith("/legal") || route === "/about" || route === "/contact")
    .map(([, body]) => body)
    .join("\n")
  check("no Companies House number claimed", !/company (registration )?(number|no\.?)\s*[:#]?\s*\d/i.test(allLegal))
  check("no VAT number claimed", !/VAT (registration )?(number|no\.?)\s*[:#]?\s*\w/i.test(allLegal))
  check("no ICO registration number claimed", !/ICO (registration )?(number|reference)\s*[:#]?\s*\w/i.test(allLegal))
  check("no registered office address claimed", !/registered office/i.test(allLegal))

  console.log("\nContact email reaches the pages that must offer a contact route:")
  for (const route of ["/legal/privacy", "/legal/data-rights", "/legal/safeguarding", "/legal/terms"]) {
    check(`${route} names ${CONTACT_EMAIL}`, (pages[route] ?? "").includes(CONTACT_EMAIL))
  }

  console.log("\nLegacy legal routes still resolve:")
  for (const route of ["/privacy", "/terms", "/cookies"]) {
    const r = await get(route)
    const ok = r.status === 200 || ((r.status === 307 || r.status === 308) && r.location.includes("/legal/"))
    check(`${route} resolves (200 or redirect to /legal/*)`, ok, `got ${r.status} ${r.location}`)
  }

  console.log("\nHomepage:")
  const home = await get("/")
  check("homepage returns 200", home.status === 200, `got ${home.status}`)
  check("homepage names the operator (Pipaxon Technologies Ltd)", home.body.includes("Pipaxon Technologies Ltd"))
  check("homepage contains NO current Jaxippa reference", !/jaxippa/i.test(home.body))
  check("homepage asserts rights reserved", home.body.includes(`© ${year} Pipaxon Technologies Ltd. All rights reserved.`)
    || home.body.includes(`&copy; ${year} Pipaxon Technologies Ltd. All rights reserved.`))
  for (const label of ["About", "Contact", "Privacy", "Children&#x27;s Privacy", "Terms", "Cookies", "Safeguarding", "Data Rights"]) {
    const plain = label.replace("&#x27;", "'")
    check(`homepage footer shows "${plain}"`, home.body.includes(label) || home.body.includes(plain))
  }
  for (const route of ["/about", "/contact", "/clubs", "/fixtures", "/game-management", "/payment-services", "/legal/privacy", "/legal/children-privacy", "/legal/terms", "/legal/cookies", "/legal/safeguarding", "/legal/data-rights"]) {
    check(`homepage links ${route}`, home.body.includes(`href="${route}"`))
  }
  for (const label of ["Game Management", "Payment Services"]) {
    check(`homepage nav offers "${label}"`, home.body.includes(label))
  }
  check(
    "homepage no longer dead-links Clubs or Fixtures to placeholder anchors",
    !home.body.includes('href="#clubs"') && !home.body.includes('href="#fixtures"')
  )

  console.log("\nDocument content:")
  check("privacy names Ovalball", /Ovalball/.test(pages["/legal/privacy"] ?? ""))
  check("privacy names the operator", (pages["/legal/privacy"] ?? "").includes("Pipaxon Technologies Ltd"))
  check("privacy covers social sign-in", /Google, Facebook or Apple/.test(pages["/legal/privacy"] ?? ""))
  check("terms names the operator", (pages["/legal/terms"] ?? "").includes("Pipaxon Technologies Ltd"))
  check("data-rights has a Facebook deletion section", /Facebook Login/i.test(pages["/legal/data-rights"] ?? ""))
  check("cookies states no advertising trackers", /does not use advertising cookies/i.test(pages["/legal/cookies"] ?? ""))
  check("children's page is reachable and child-facing", /privacy guide for young players/i.test(pages["/legal/children-privacy"] ?? ""))

  console.log("\nNo public page leaks a localhost URL:")
  for (const [route, body] of Object.entries(pages)) {
    check(`${route} has no localhost link`, !/https?:\/\/localhost|127\.0\.0\.1/.test(body))
  }
  check("homepage has no localhost link", !/https?:\/\/localhost|127\.0\.0\.1/.test(home.body))

  console.log("\nNo analytics or marketing tracker on public pages:")
  const trackerPattern = /googletagmanager|google-analytics|gtag\(|connect\.facebook\.net|fbq\(|hotjar|mixpanel|posthog/i
  check("homepage loads no tracker", !trackerPattern.test(home.body))
  check("privacy loads no tracker", !trackerPattern.test(pages["/legal/privacy"] ?? ""))

  console.log("\nProtected application routes remain protected:")
  for (const route of PROTECTED_ROUTES) {
    const r = await get(route)
    const isRedirect = r.status === 307 || r.status === 302 || r.status === 308
    check(`${route} is not publicly readable`, isRedirect || r.status === 401 || r.status === 404, `got ${r.status}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("verification error:", err.message)
  process.exit(1)
})
