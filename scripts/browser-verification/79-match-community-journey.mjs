// =====================================================================
// CONVERGENCE STEP 11 -- WHAT A TEAM DID TOGETHER, IN A REAL BROWSER
//
// Match Centre could not say what happened. The score lived in Fixture
// Management, the Calendar and the result confirmation flow, and the canonical
// page for a played match stayed silent -- so recognition attached to it would
// have been the most prominent thing about a finished game.
//
// This walks the played match:
//
//     staff sign in -> the played fixture -> the hero SAYS THE SCORE -> they
//     switch on the award their team runs -> open voting
//
//     a guardian reaches the same fixture -> is offered PARENTS' PLAYER by that
//     name -> votes for their own child -> reload -> the server's answer is
//     what the page shows -> gives Kudos from the fixed vocabulary
//
//     staff close voting -> the winner is named -> and the COUNT is shown to
//     staff only
//
//     an unrelated club's admin gets no community surface at all
//
// Everything it creates is removed and the removal is asserted. No persistent
// review persona is touched.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const STAFF = "uat.team.manager@ovalball.test"
const GUARDIAN = "uat.guardian.two@ovalball.test"
const OUTSIDER = "uat.preston.admin@ovalball.test"
const NOTE = `S11 community ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

/**
 * WAIT FOR THE SERVER, NOT FOR A DURATION.
 *
 * A click here starts a server action and a revalidate; `networkidle` returns before the write has
 * necessarily committed, so reading the database immediately reports the state from before the
 * click. This polls the real invariant instead, which is both faster and honest -- a sleep long
 * enough to be safe would be a sleep long enough to hide a regression.
 */
async function waitForSql(query, expected, timeoutMs = 8000) {
  const started = Date.now()
  let last = ""
  while (Date.now() - started < timeoutMs) {
    last = sql(query)
    if (last === expected) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  return last
}

const staffId = sql(`select id from auth.users where email = '${STAFF}'`)
const teamId = sql(`select ra.team_id from public.role_assignments ra
                    join public.club_memberships cm on cm.id = ra.membership_id
                    where cm.user_id = '${staffId}' and ra.state = 'ACTIVE' and ra.team_id is not null limit 1`)
if (!teamId) {
  console.error("Missing UAT team staff: run the local UAT seed.")
  process.exit(1)
}

const guardianId = sql(`select id from auth.users where email = '${GUARDIAN}'`)
const child = sql(`select p.id || '|' || p.first_name
                   from public.guardians g join public.players p on p.id = g.player_id
                   join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
                   where g.guardian_user_id = '${guardianId}' and g.status = 'active' and ptm.team_id = '${teamId}' limit 1`)
const [, childName] = child ? child.split("|") : [null, null]

function teardown() {
  try {
    sql(`delete from public.match_award_votes where award_id in
           (select id from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'S11 community %'));
         delete from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'S11 community %');
         delete from public.match_kudos where fixture_id in (select id from public.fixtures where notes like 'S11 community %');
         delete from public.team_award_category_settings where team_id = '${teamId}';
         delete from public.fixtures where notes like 'S11 community %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

// A PLAYED match, with a real result on it -- the whole point is that the page can now say so.
const fixtureId = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes,
   home_score, away_score, result_status)
  values ('${teamId}', 'Home', 'S11 Visitors ${TAG}', (current_date - 6)::date, '11:00', 'Friendly', 'Completed', 'club_created', '${NOTE}',
          27, 13, 'external_recorded')
  returning id`)

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. THE STAFF JOURNEY -- the score, then the award
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(`staff: ${e.message}`))
  await signIn(page, STAFF)
  await page.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const heroText = await page.locator("section").first().innerText()
  record("A1 the hero of a played match says the score", /27\s*[–-]\s*13/.test(heroText), heroText.slice(0, 80).replace(/\n/g, " / "))

  const main = page.locator("main")
  record("A2 and the match is followed by what the team did together", /after the match/i.test(await main.innerText()))

  // The team has to run the award before it can be opened -- the switch is the team's decision.
  const toggle = page.getByRole("button", { name: /^(On|Off)$/ }).first()
  await toggle.click()
  await waitForSql(`select count(*) from public.team_award_category_settings where team_id = '${teamId}' and enabled`, "1")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("A3 staff switch on the award their team runs", (await page.getByRole("button", { name: "Open Voting" }).count()) > 0)

  await page.getByRole("button", { name: "Open Voting" }).first().click()
  const awardOpen = await waitForSql(`select count(*) from public.match_awards where fixture_id = '${fixtureId}' and status = 'OPEN'`, "1")
  record("A4 opening voting is a server decision, and the record is the proof", awardOpen === "1", `${awardOpen} open award(s)`)

  // axe on the surface this step changed.
  await page.addScriptTag({ content: axeSource() })
  const axe = await page.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        target: v.nodes[0]?.target?.join(" ") ?? "",
      })),
    }
  })
  // THE ONE DECLARED PRE-EXISTING VIOLATION IS NOT THIS STEP'S.
  //
  // The shell unread badge is L22, declared in the harness and owned by the shell. Measured on this
  // same page with the community panel absent (an upcoming fixture), the page's violations are
  // identical -- so nothing here is Step 11's. The suite runs the WCAG rule sets, as every other
  // suite does; the Beta badge's `region` finding is axe best-practice rather than WCAG and is
  // therefore out of this contract's scope, not hidden by it.
  recordAxe("axe: the played Match Centre", axe.violations)

  // AN UPCOMING MATCH CENTRE MUST NOT LOOK LIKE A POST-MATCH AWARDS PAGE.
  const upcoming = sql(`insert into public.fixtures
    (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, notes)
    values ('${teamId}', 'Home', 'S11 Later ${TAG}', (current_date + 21)::date, 'Booked', 'club_created', '${NOTE} upcoming')
    returning id`)
  await page.goto(`${APP}/fixtures/${upcoming}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const upcomingText = await page.locator("main").innerText()
  record("A5 a match that has not been played offers no recognition at all",
    !/after the match/i.test(upcomingText) && !/Open Voting|Give Kudos/i.test(upcomingText))
  record("A6 and says VS rather than a score it does not have", /\bVS\b/.test(upcomingText))

  await ctx.close()

  // ==================================================================
  // B. THE FAMILY JOURNEY -- named by what it is, and it persists
  // ==================================================================
  if (child) {
    const gctx = await newContext(browser, { width: 1440, height: 1100 })
    const gpage = await gctx.newPage()
    gpage.on("pageerror", (e) => pageErrors.push(`guardian: ${e.message}`))
    await signIn(gpage, GUARDIAN)
    await gpage.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
    await gpage.waitForLoadState("networkidle").catch(() => {})

    const gtext = await gpage.locator("main").innerText()
    // A YOUTH SIDE CALLS IT PARENTS' PLAYER. On an adult side the same canonical category is
    // Players' Player; the electorate, not the label, is what actually changes.
    record("B1 a guardian is offered the award by the name a youth side uses", /Parents. Player/i.test(gtext), gtext.match(/Parents.{0,10}Player/i)?.[0] ?? "not found")

    const choice = gpage.getByRole("button", { name: new RegExp(`^${childName}`) }).first()
    const offered = (await choice.count()) > 0
    record("B2 with their own side's players to choose between", offered)

    if (offered) {
      await choice.click()
      const voteCount = `select count(*) from public.match_award_votes v
                         join public.match_awards a on a.id = v.award_id
                         where a.fixture_id = '${fixtureId}' and v.voter_user_id = '${guardianId}'`
      const voted = await waitForSql(voteCount, "1")
      record("B3 and the vote is written to the canonical record", voted === "1", `${voted} vote(s)`)

      await gpage.reload({ waitUntil: "domcontentloaded" })
      await gpage.waitForLoadState("networkidle").catch(() => {})
      const pressed = await gpage
        .getByRole("button", { name: new RegExp(`^${childName}`) })
        .first()
        .getAttribute("aria-pressed")
        .catch(() => null)
      record("B4 after a reload the server's answer is what the page shows", pressed === "true", String(pressed))

      // ONE PERSON, ONE VOTE, through the UI as well as the constraint.
      await gpage.getByRole("button", { name: new RegExp(`^${childName}`) }).first().click()
      const afterSecond = await waitForSql(voteCount, "0")
      record("B5 pressing their own choice again takes it back rather than voting twice", afterSecond === "0", `${afterSecond} vote(s)`)
      await gpage.getByRole("button", { name: new RegExp(`^${childName}`) }).first().click()
      await waitForSql(voteCount, "1")
    }

    // Kudos: a fixed positive vocabulary, chosen not written.
    const playerSelect = gpage.locator("select").first()
    const kindSelect = gpage.locator("select").nth(1)
    if ((await playerSelect.count()) > 0 && (await kindSelect.count()) > 0) {
      const playerValue = await playerSelect.locator("option").nth(1).getAttribute("value")
      const kindValue = await kindSelect.locator("option").nth(1).getAttribute("value")
      await playerSelect.selectOption(playerValue)
      await kindSelect.selectOption(kindValue)
      await gpage.getByRole("button", { name: "Give Kudos" }).click()
      const kudos = await waitForSql(`select count(*) from public.match_kudos where fixture_id = '${fixtureId}' and removed_at is null`, "1")
      record("B6 kudos is chosen from a fixed positive vocabulary and recorded", kudos === "1", `${kudos} kudos`)
    } else {
      record("B6 kudos is chosen from a fixed positive vocabulary and recorded", false, "no kudos control offered")
    }
    await gctx.close()
  } else {
    record("B1 a guardian is offered the award by the name a youth side uses", false, "no UAT guardian has a child in this team")
  }

  // ==================================================================
  // C. CLOSING IT -- the winner to the team, the count to staff
  // ==================================================================
  const cctx = await newContext(browser, { width: 1440, height: 1100 })
  const cpage = await cctx.newPage()
  cpage.on("pageerror", (e) => pageErrors.push(`close: ${e.message}`))
  await signIn(cpage, STAFF)
  await cpage.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
  await cpage.waitForLoadState("networkidle").catch(() => {})
  const closeButton = cpage.getByRole("button", { name: "Close Voting" }).first()
  if ((await closeButton.count()) > 0) {
    await closeButton.click()
    await waitForSql(`select status from public.match_awards where fixture_id = '${fixtureId}' limit 1`, "CLOSED")
    await cpage.reload({ waitUntil: "domcontentloaded" })
    await cpage.waitForLoadState("networkidle").catch(() => {})
  }
  const closed = sql(`select status || '/' || coalesce(outcome,'-') from public.match_awards where fixture_id = '${fixtureId}' limit 1`)
  record("C1 staff close voting and the outcome is decided by the server", /^CLOSED\//.test(closed), closed)
  const staffText = await cpage.locator("main").innerText()
  record("C2 and staff are shown the count, marked as theirs alone", /staff only/i.test(staffText))

  await cctx.close()

  // The team is told who won and never by how much.
  if (child) {
    const vctx = await newContext(browser, { width: 1440, height: 1100 })
    const vpage = await vctx.newPage()
    await signIn(vpage, GUARDIAN)
    await vpage.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
    await vpage.waitForLoadState("networkidle").catch(() => {})
    const familyText = await vpage.locator("main").innerText()
    record("C3 the family is told who won", new RegExp(childName, "i").test(familyText))
    record("C4 and never by how many votes", !/staff only/i.test(familyText) && !/\d+ votes?/i.test(familyText))
    await vctx.close()
  }

  // ==================================================================
  // D. SOMEBODY ELSE'S MATCH
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const opage = await octx.newPage()
  await signIn(opage, OUTSIDER)
  await opage.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const outsiderText = await opage.locator("body").innerText()
  record("D1 an unrelated club's admin is offered no community surface on somebody else's match",
    !/after the match/i.test(outsiderText) || !/Give Kudos|Open Voting/i.test(outsiderText))
  await octx.close()

  // ==================================================================
  // E. THE PHONE
  // ==================================================================
  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, STAFF)
    await m.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`E1 no horizontal overflow on the played Match Centre at ${width}px`, overflow <= 0, `${overflow}px over`)
    const text = await m.locator("main").innerText()
    record(`E2 and the phone keeps both the score and the recognition at ${width}px`,
      /27\s*[–-]\s*13/.test(text) && /after the match/i.test(text))
    await small.close()
  }

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record(
  "cleanup: this run's fixture, awards, votes and kudos are gone",
  sql(`select count(*) from public.fixtures where notes like 'S11 community %'`) === "0" &&
    sql(`select count(*) from public.match_awards`) === "0" &&
    sql(`select count(*) from public.match_kudos`) === "0"
)

process.exit(summarise() ? 0 : 1)
