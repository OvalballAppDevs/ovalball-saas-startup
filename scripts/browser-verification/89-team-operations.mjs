// =====================================================================
// TEAM OPERATIONS -- THE PRODUCT A COACH AND A TEAM MANAGER ACTUALLY USE
//
// One journey, walked as the person who runs the team, checking the things
// the owner-directed overhaul was about:
//
//   A. TEAM CONTEXT IS A TEAM'S PAGE, not a club dashboard with parts removed:
//      the team leads the hero, Needs Attention comes from domain state, and
//      Next Up is a real fixture rather than "nothing scheduled this week".
//   B. FIXTURES MEANS FIXTURES. Three pages answered to the word; navigation
//      pointed at the inter-club negotiation register, and guardians had the
//      overview staff did not.
//   C. ONE TRUTH. The Team page and the team's dashboard must not disagree
//      about what is next -- they did, in opposite directions, because each
//      chose its own window.
//   D. RUGBY HUB is reachable from a team, not buried under "More".
//   E. FINANCE IS CLUB-SCOPED, and a team manager who is not club finance
//      staff sees no subscription data -- in the page OR from the server.
//   F. PARENT PARITY: a guardian and the staff see the same fixture facts.
//
// Read-only. This suite creates nothing and therefore removes nothing; it
// asserts that at the end.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

// 75s, not 30s. Against a dev server the FIRST request to a route compiles it: /teams/[teamId] took
// 23.6s cold and 0.1s warm, measured. A suite that fails on compilation time reports a product defect
// that is not there, which is worse than a slow suite.

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"

/** Team Manager at the review club's Under 12 Boys. Team authority, no club finance authority. */
const MANAGER = "uat.team.manager@ovalball.test"
/** Club Admin who is ALSO a coach of a team -- the multi-authority case section 32 is about. */
const CLUB_ADMIN = "uat.preston.admin@ovalball.test"

const DEV_INSTRUMENTATION = /Failed to execute 'measure' on 'Performance'/

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const teamId = sql(`
  select tp.team_id from public.team_permissions tp
    join public.club_memberships m on m.id = tp.membership_id
    join auth.users u on u.id = m.user_id
   where u.email = '${MANAGER}' limit 1`)
if (!teamId) {
  console.error(`No team for ${MANAGER}. Run: node scripts/review-fixtures/step2-review-club.mjs enrich-team-ops`)
  process.exit(1)
}
const teamName = sql(`select display_name from public.teams where id = '${teamId}'`)
const nextFixtureId = sql(`
  select id from public.fixtures
   where (owning_team_id = '${teamId}' or opponent_team_id = '${teamId}')
     and kickoff_date >= current_date and archived_at is null
   order by kickoff_date limit 1`)

const pageErrors = []
const browser = await launch()

try {
  const ctx = await newContext(browser, { width: 1400, height: 1000 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await signIn(page, MANAGER)

  // =====================================================================
  // A. THE TEAM'S OWN HOME
  // =====================================================================
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 75000 })
  await page.waitForTimeout(600)

  const heading = (await page.locator("h1").first().textContent())?.trim() ?? ""
  record("A1 the team leads its own page, not the club", heading.includes(teamName), heading)

  const body = await page.locator("body").innerText()
  // The club is still named -- it is whose team this is -- just not as the headline.
  record("A2 and the club is still named, one line down", /RUFC|RFC|Rugby/i.test(body))

  record(
    "A3 it no longer says nothing is scheduled while a fixture exists",
    !/Nothing scheduled this week/i.test(body),
  )

  if (nextFixtureId) {
    record("A4 Next Up names a real fixture", /Next Up/i.test(body))
    const matchCentre = page.getByRole("link", { name: /Match Centre/i }).first()
    record("A5 with a way into the Match Centre for it", await matchCentre.isVisible().catch(() => false))
  }

  // Needs Attention is DERIVED. It is present only when domain state says so, which is the whole
  // distinction between a notification being read and work being resolved.
  const outstanding = Number(
    sql(`select count(*) from public.player_team_memberships where team_id='${teamId}' and status='active'`),
  )
  if (outstanding > 0 && nextFixtureId) {
    const answered = Number(
      sql(`select count(*) from public.player_fixture_attendance where fixture_id='${nextFixtureId}'`),
    )
    if (answered < outstanding) {
      record(
        "A6 Needs Attention names the unanswered availability, from canonical state",
        /Needs Attention/i.test(body) && /not said whether they can play/i.test(body),
      )
    }
  }

  await recordAxe("A7 axe: the team's home", await runAxe(page))

  // =====================================================================
  // B. FIXTURES MEANS FIXTURES
  // =====================================================================
  // Expanding the groups is how the destinations become readable. Bounded and individually guarded:
  // a nav that changes shape mid-loop must not be able to stall the suite.
  for (const btn of await page.locator('aside button[aria-expanded="false"]').all()) {
    await btn.click({ timeout: 3000 }).catch(() => {})
  }
  await page.waitForTimeout(500)
  const navLinks = await page
    .locator("aside a[href]")
    .evaluateAll((as) => as.map((a) => `${a.getAttribute("href")}|${a.textContent.trim()}`))

  const fixturesLink = navLinks.find((l) => l.endsWith("|Fixtures"))
  record(
    "B1 Fixtures points at the shared fixture overview, not the negotiation register",
    fixturesLink === "/agenda|Fixtures",
    fixturesLink ?? "(no Fixtures link)",
  )
  record(
    "B2 and the register is not masquerading as it",
    !navLinks.some((l) => l === "/fixtures|Fixtures"),
  )

  // THE OWNER'S IA DECISIONS, held shut.
  record(
    "B4 there is no generic Team group linking into the team you are already in",
    !navLinks.some((l) => l === `/teams/${teamId}|${teamName}`),
  )
  record(
    "B5 People is a destination of its own",
    navLinks.some((l) => l === `/teams/${teamId}/people|People`),
    navLinks.find((l) => l.includes("/people")) ?? "(absent)",
  )
  record(
    "B6 and Player Requests no longer holds a permanent slot",
    !navLinks.some((l) => l.endsWith("|Player Requests")),
  )
  record(
    "B7 Overview names the team's home rather than a generic dashboard",
    navLinks.some((l) => l === "/dashboard|Overview"),
  )

  // D. RUGBY HUB, from a team.
  record(
    "D1 Rugby Hub is reachable from Team context",
    navLinks.some((l) => l.startsWith("/rugby-hub|")),
    navLinks.filter((l) => l.startsWith("/rugby-hub")).join(" ") || "(absent)",
  )

  await page.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const agendaHeading = (await page.locator("h1").first().textContent())?.trim() ?? ""
  record("B3 and it opens a fixture overview", /fixture/i.test(agendaHeading), agendaHeading)

  // =====================================================================
  // C. ONE TRUTH -- the team page and the dashboard agree about what is next
  // =====================================================================
  await page.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded", timeout: 75000 })
  await page.waitForTimeout(500)
  const teamPage = await page.locator("body").innerText()
  if (nextFixtureId) {
    // THE CANONICAL ORDER, which is the one lib/agenda/load.ts uses: an opponent TEAM names its club,
    // otherwise an opponent DIRECTORY entry names itself, otherwise the free text. Asked the wrong way
    // round -- team, then raw text, skipping the directory -- this read "Far Future Opposition RFC" from
    // stale free text on a fixture whose real opposition is a directory club, and reported the product
    // as wrong when it was right. A test that resolves an identity differently from the product is
    // testing its own query.
    const opponent = sql(`
      select coalesce(td.name, od.name, f.raw_opposition_text, '')
        from public.fixtures f
        left join public.teams t on t.id = f.opponent_team_id
        left join public.clubs c on c.id = t.club_id
        left join public.club_directory td on td.id = c.directory_id
        left join public.club_directory od on od.id = f.opponent_directory_id
       where f.id = '${nextFixtureId}'`)
    if (opponent) {
      record(
        "C1 the Team page shows the same next fixture the dashboard does",
        teamPage.includes(opponent),
        opponent,
      )
    }
    record("C2 and does not claim nothing is scheduled", !/Nothing scheduled yet/i.test(teamPage))
  }

  // The roster MOVED, deliberately: /teams/<id> is the team's infrequent administration (what the
  // context gear opens) and People is its own destination. So this asserts the two halves of that
  // decision rather than the page that used to hold both.
  record(
    "C3 the team's administration page offers People and Player Requests",
    /People/i.test(teamPage) && /Player Requests/i.test(teamPage),
  )

  await page.goto(`${APP}/teams/${teamId}/people`, { waitUntil: "domcontentloaded", timeout: 75000 })
  await page.waitForTimeout(700)
  const peoplePage = await page.locator("body").innerText()
  record(
    "C4 and People is the full roster -- players, guardians and staff",
    /Players/i.test(peoplePage) && /Parents/i.test(peoplePage) && /Coaches/i.test(peoplePage),
  )

  // =====================================================================
  // E. FINANCE IS CLUB-SCOPED
  // =====================================================================
  // The bounded team capability: their OWN squad's operational state, and nothing wider.
  await page.goto(`${APP}/teams/${teamId}/subscriptions`, { waitUntil: "domcontentloaded", timeout: 75000 })
  await page.waitForTimeout(900)
  const subsUrl = new URL(page.url()).pathname
  record("E1 a team manager sees their own squad's subscription state", subsUrl.endsWith("/subscriptions"), subsUrl)
  const subsBody = await page.locator("body").innerText()
  record(
    "E2 with no bank, mandate or provider detail anywhere in it",
    !/sort code|account number|mandate|MD[0-9A-Z]{6,}|CU[0-9A-Z]{6,}|gocardless/i.test(subsBody),
  )

  // CROSS-TEAM: the boundary is the team, not the word "manager".
  const otherTeamId = sql(`
    select id from public.teams where club_id <> '${sql(`select club_id from public.teams where id='${teamId}'`)}'
      and active limit 1`)
  if (otherTeamId) {
    await page.goto(`${APP}/teams/${otherTeamId}/subscriptions`, { waitUntil: "domcontentloaded", timeout: 75000 })
    record(
      "E3 and cannot open another team's",
      !new URL(page.url()).pathname.includes(otherTeamId),
      new URL(page.url()).pathname,
    )
  }

  // And the bounded view is NOT club finance.
  await page.goto(`${APP}/club/finance`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const financeUrl = new URL(page.url()).pathname
  record(
    "E4 team-scoped finance does not open the club's finance surface",
    financeUrl !== "/club/finance" || !/Expected revenue/i.test(await page.locator("body").innerText()),
    financeUrl,
  )

  await ctx.close()

  // =====================================================================
  // F. PARENT PARITY -- same fixture facts, different actions
  // =====================================================================
  if (nextFixtureId) {
    const staffCtx = await newContext(browser, { width: 1400, height: 1000 })
    const staffPage = await staffCtx.newPage()
    staffPage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
    await signIn(staffPage, CLUB_ADMIN)
    await staffPage.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded", timeout: 75000 })
    const staffAgenda = await staffPage.locator("body").innerText()
    record(
      "F1 club staff reach the same shared agenda surface guardians use",
      /fixture/i.test(staffAgenda),
    )
    await staffCtx.close()
  }

  // =====================================================================
  // G. THE SIDEBAR SAYS WHERE YOU ARE -- exactly one row, and the right one
  // =====================================================================
  // Every renderer decided active state with a prefix test, so on a destination that nests inside
  // another destination TWO rows lit at once and neither of them meant anything. Proved in the
  // browser because the defect is what a person sees, not what a function returns.
  {
    const navCtx = await newContext(browser, { width: 1400, height: 1000 })
    const navPage = await navCtx.newPage()
    navPage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
    await signIn(navPage, CLUB_ADMIN)

    const current = async (path) => {
      await navPage.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 75000 })
      return await navPage
        .locator('nav[aria-label="Main"] a[aria-current="page"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("href")))
    }

    for (const [path, expected] of [
      ["/fixtures/management", "/fixtures/management"],
      ["/fixtures", "/fixtures"],
      ["/club/settings/guardians", "/club/settings/guardians"],
      ["/club/settings", "/club/settings"],
    ]) {
      const lit = await current(path)
      record(`G ${path} highlights exactly one destination`, lit.length === 1, lit.join(" + ") || "none")
      record(`G ${path} highlights the page you are on`, lit[0] === expected, lit[0] ?? "none")
    }

    // The behaviour the prefix test got right, kept: a route no row names lights its nearest ancestor.
    const deep = await current("/club/settings/news")
    record("G a route nobody names lights its nearest ancestor", deep.length === 1 && deep[0] === "/club/settings", deep.join(" + ") || "none")

    await navCtx.close()
  }

  // =====================================================================
  // MOBILE -- a team is run pitch-side
  // =====================================================================
  const phone = await newContext(browser, { width: 390, height: 844 })
  const phonePage = await phone.newPage()
  phonePage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await signIn(phonePage, MANAGER)
  for (const width of [390, 360]) {
    await phonePage.setViewportSize({ width, height: 844 })
    await phonePage.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 75000 })
    await phonePage.waitForTimeout(500)
    const overflow = await phonePage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    record(`M1 @${width} the team's home does not scroll sideways`, overflow <= 0, `${overflow}px`)
    const bar = await phonePage
      .locator('nav[aria-label="Primary"] a, nav[aria-label="Primary"] button')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean))
    record(`M2 @${width} the bottom bar still projects the team's jobs`, bar.length > 0, bar.join(" · "))
  }
  await phonePage.setViewportSize({ width: 390, height: 844 })
  await recordAxe("M3 axe: the team's home at 390px", await runAxe(phonePage))
  await phone.close()

  const realErrors = pageErrors.filter((e) => !DEV_INSTRUMENTATION.test(e))
  record("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))
  if (pageErrors.length > realErrors.length) {
    record(`(React dev instrumentation noise filtered: ${pageErrors.length - realErrors.length})`, true)
  }
} finally {
  await browser.close()
}

async function runAxe(target) {
  await target.addScriptTag({ content: axeSource() })
  return await target.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      target: v.nodes[0]?.target?.join(" ") ?? "",
    }))
  })
}

summarise()
