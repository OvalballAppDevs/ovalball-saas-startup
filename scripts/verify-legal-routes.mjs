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
const PUBLIC_ROUTES = ["/about", "/contact"]

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
  for (const route of ["/about", "/contact", "/legal/privacy", "/legal/children-privacy", "/legal/terms", "/legal/cookies", "/legal/safeguarding", "/legal/data-rights"]) {
    check(`homepage links ${route}`, home.body.includes(`href="${route}"`))
  }

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
