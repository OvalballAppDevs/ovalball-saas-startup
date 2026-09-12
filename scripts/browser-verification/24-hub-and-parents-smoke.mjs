// RUGBY HUB + PARENTS & SAFEGUARDING -- RELEASE-CANDIDATE SMOKE
// (Phase 2 §26 Hub desktop 1280 / mobile 390, §27 Parents & safety guides,
//  §AS axe at AA.)
//
// This is the merged release's first look at the Rugby Hub through a real
// authenticated session. The Hub arrived from a separate worktree, so the
// question is not "does the Hub work" -- it did on its own branch -- but
// "does it still work sitting on top of the primary line's schema, nav and
// content standard".
//
// It is run as a GUARDIAN, not as staff. Parents are who the safeguarding
// and welfare guides are written for, and a guardian also proves the Hub is
// reachable without club-staff authority.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const SHOTS = process.env.SHOT_DIR ?? "/Users/Devs/.claude/jobs/e976849c/tmp"
const WHO = "uat.guardian.one@ovalball.test"
const browser = await launch()

// The Hub's landing sections. A section that 404s or renders an error is a
// merge casualty; a section that renders EMPTY is a content-migration
// casualty, and the two need telling apart -- so both are asserted.
const HUB = [
  ["/rugby-hub", "Rugby Hub"],
  ["/rugby-hub/rules", "Rules"],
  ["/rugby-hub/game", "The Game"],
  ["/rugby-hub/skills", "Skills"],
  ["/rugby-hub/positions", "Positions"],
  ["/rugby-hub/development", "Player Development"],
  ["/rugby-hub/coaching", "Coaching"],
  ["/rugby-hub/officiating", "Officiating"],
  ["/rugby-hub/glossary", "Glossary"],
  ["/rugby-hub/story", "The Story of Rugby"],
  ["/rugby-hub/people", "People"],
  ["/rugby-hub/clubs", "Famous Clubs"],
  ["/rugby-hub/international", "International Rugby"],
  ["/rugby-hub/competitions", "Competitions"],
]

// §27: the surfaces a worried parent actually opens.
//
// /rugby-hub/safeguarding/contact is deliberately NOT in this list. It is a
// parameterised handoff (?club=&assignment=&mode=), not a readable guide, so
// a content-length floor is the wrong assertion for it -- visited bare it is
// SUPPOSED to be short. It gets its own check below.
const SAFETY = [
  ["/rugby-hub/parents", "Parents & Guardians"],
  ["/rugby-hub/player-welfare", "Player Welfare"],
  ["/rugby-hub/safeguarding", "Safeguarding"],
]

/**
 * The HTTP status is the honest signal for "did this route render".
 *
 * Sniffing the DOM for an error overlay does not work in dev: <nextjs-portal>
 * is the dev-tools indicator and is present on EVERY healthy page, so
 * treating it as an error marks the whole Hub broken. The response status
 * plus the error overlay's own text is what actually distinguishes them.
 */
async function visit(page, path, name, { width }) {
  const response = await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const status = response?.status() ?? 0

  const m = await page.evaluate(() => {
    // The page's own <main>, not the app shell's: the Hub nests one inside
    // the other, so document.querySelector would measure the outer shell.
    const mains = document.querySelectorAll("main")
    const own = mains.length ? mains[mains.length - 1] : document.body
    return {
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
      mains: mains.length,
      notFound: /This page could not be found/i.test(document.body.innerText.slice(0, 600)),
      overlay: /Unhandled Runtime Error|Build Error|Server Error/i.test(document.body.innerText),
      headings: document.querySelectorAll("h1, h2, h3").length,
      h1: document.querySelectorAll("h1").length,
      bodyText: own.innerText.trim().length,
      links: own.querySelectorAll("a").length,
    }
  })

  record(`§26 ${name} renders at ${width}px`,
    status === 200 && !m.notFound && !m.overlay && m.viewport === width,
    `HTTP ${status}${m.notFound ? " — not found" : ""}${m.overlay ? " — error overlay" : ""} · innerWidth ${m.viewport}`)
  record(`§26 ${name} carries real content, not an empty shell`,
    m.bodyText > 400 && m.headings > 0,
    `${m.bodyText} chars, ${m.headings} headings, ${m.links} links`)
  record(`§26 ${name} does not overflow at ${width}px`,
    m.content <= m.viewport, `content ${m.content}px in ${m.viewport}px`)
  // A nested <main> is two "main" landmarks in one document: a screen reader
  // offers two, and "skip to main content" becomes ambiguous.
  record(`§26 ${name} has exactly one main landmark`, m.mains === 1, `${m.mains} <main> elements`)
  return m
}

for (const width of [1280, 390]) {
  const ctx = await newContext(browser, { width, height: 900 })
  const page = await ctx.newPage()
  await signIn(page, WHO)

  for (const [path, name] of HUB) await visit(page, path, name, { width })
  for (const [path, name] of SAFETY) await visit(page, path, `${name} (§27)`, { width })

  // §27: a safeguarding page that does not tell a parent who to contact has
  // failed at the only job it has.
  await page.goto(`${APP}/rugby-hub/safeguarding`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const safeguarding = await page.locator("main").last().innerText()
  record(`§27 Safeguarding names a route to a person at ${width}px`,
    /officer|contact|report|concern/i.test(safeguarding), `${safeguarding.length} chars`)

  // §27: and the handoff route refuses to guess. Reached without the club and
  // assignment it needs, it must SAY the link is incomplete -- not render a
  // blank page, and not invent an officer.
  const bare = await page.goto(`${APP}/rugby-hub/safeguarding/contact`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const bareText = await page.locator("main").last().innerText()
  record(`§27 the safeguarding handoff explains an incomplete link rather than guessing at ${width}px`,
    bare?.status() === 200 && /missing required information/i.test(bareText),
    `HTTP ${bare?.status()} — ${bareText.replace(/\n/g, " / ").slice(0, 90)}`)

  // §26: a detail page, not just an index -- indexes can survive a broken
  // content import that detail pages do not.
  await page.goto(`${APP}/rugby-hub/glossary`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const firstTerm = page.locator('a[href*="/rugby-hub/glossary/"]').first()
  const hasTerm = (await firstTerm.count()) > 0
  if (hasTerm) {
    // Wait for the URL to actually change. networkidle can settle before a
    // client-side App Router transition has committed, which reports a
    // working link as a broken one.
    await firstTerm.click()
    await page.waitForURL(/\/rugby-hub\/glossary\/./, { timeout: 30000 }).catch(() => {})
    await page.waitForLoadState("networkidle").catch(() => {})
    const detail = await page.evaluate(() => {
      const mains = document.querySelectorAll("main")
      const own = mains.length ? mains[mains.length - 1] : document.body
      return {
        url: location.pathname,
        text: own.innerText.trim().length,
        overlay: /Unhandled Runtime Error|Build Error|Server Error/i.test(document.body.innerText),
      }
    })
    record(`§26 a Hub detail page opens from its index at ${width}px`,
      !detail.overlay && /\/rugby-hub\/glossary\/./.test(detail.url) && detail.text > 200,
      `${detail.url} — ${detail.text} chars`)
  } else {
    record(`§26 a Hub detail page opens from its index at ${width}px`, false, "no term links on the glossary index")
  }

  if (width === 390) {
    await page.goto(`${APP}/rugby-hub`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.screenshot({ path: `${SHOTS}/hub-390.png` })
    await page.goto(`${APP}/rugby-hub/parents`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.screenshot({ path: `${SHOTS}/hub-parents-390.png` })
  }

  await ctx.close()
}

// ---------------------------------------------------------------------
// §AS ACCESSIBILITY at AA on the Hub and the safety guides
// ---------------------------------------------------------------------
const axeSource = (await import("node:fs")).readFileSync(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8")

const a11yCtx = await newContext(browser, { width: 1280, height: 950 })
const a11y = await a11yCtx.newPage()
await signIn(a11y, WHO)

for (const [path, name] of [...HUB.slice(0, 6), ...SAFETY, ["/rugby-hub/safeguarding/contact", "Safeguarding Contact"]]) {
  await a11y.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await a11y.waitForLoadState("networkidle").catch(() => {})
  await a11y.addScriptTag({ content: axeSource })
  const violations = await a11y.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`)
  })
  record(`§AS ${name} is axe-clean at AA`, violations.length === 0, violations.join("; ") || "no violations")
}

await browser.close()
summarise()
console.log(`\nScreenshots in ${SHOTS}`)
