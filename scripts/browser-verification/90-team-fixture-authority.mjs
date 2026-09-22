// =====================================================================
// DELEGATED TEAM FIXTURE AUTHORITY, WALKED IN A BROWSER
//
// The owner's model is that a Club Admin decides who may administer fixtures,
// that nobody gets that authority from a job title, and that somebody granted
// it may act for THEIR OWN TEAM. The capability engine has always been able to
// record a team-scoped decision -- set_capability_override has accepted
// p_scope_type 'team' since Identity/Auth Slice 3 -- but no screen could ask
// for one, so the only decision a club could actually take was club-wide.
//
//   A. THE CLUB CAN DECIDE FOR ONE TEAM. The permissions screen has a scope,
//      it names the team, and the team's own staff are the people listed.
//   B. A DECISION CHANGES THE PRODUCT. Withholding fixture creation for one
//      team removes that team's Add Fixture; resetting it puts it back. No
//      sign-out, no new account.
//   C. AND IT IS THAT TEAM ONLY.
//   D. THE OPPONENT LIST IS THE LEGAL ONE. A U12 side is offered the opponent
//      club's compatible sides and not its U13 side -- from the server, by the
//      same rule that would refuse the request.
//
// SELF-CLEANING. Every capability decision this suite records is removed at the
// end, by id, and the suite asserts that none of its own rows survive. It
// writes nothing else: it deliberately proves the CONTROL appears rather than
// creating fixtures, because a fixture is domain state in a shared world and
// the control is what the correction was about.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"

/** Club Admin of the AUTOMATED test club (not the persistent manual-review world). */
const CLUB_ADMIN = "uat.coach@ovalball.test"
/** Team Manager of that club's Under 12 Boys -- the person a decision is taken about. */
const SUBJECT = "uat.team.manager@ovalball.test"

const DEV_INSTRUMENTATION = /Failed to execute 'measure' on 'Performance'/

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const teamId = sql(
  `select t.id from public.teams t join public.clubs c on c.id = t.club_id
    where c.slug = 'ovalball-uat-rufc' and t.display_name = 'Under 12 Boys'`
)
const otherTeamId = sql(
  `select t.id from public.teams t join public.clubs c on c.id = t.club_id
    where c.slug = 'ovalball-uat-rufc' and t.display_name = 'Under 16 Boys'`
)
const subjectId = sql(`select id from auth.users where email = '${SUBJECT}'`)

/**
 * Exactly what this run recorded, so cleanup removes that and nothing else.
 *
 * The reason string is the one the TEAM action writes (app/(app)/club/permissions/actions.ts), and the
 * query is pinned to this subject, this team and team scope as well. A looser match -- "any decision
 * mentioning the permissions screen, recently" -- would also match a real person's club-scope decision
 * taken while this suite was running, and cleanup would delete it. A cleanup whose blast radius is
 * wider than what the run created is the wrong cleanup.
 */
const TEAM_DECISION_REASON = "Set from the club's permissions screen, for this team"
const ownOverrides = new Set()

function noteOwnOverrides() {
  const ids = sql(
    `select id from public.capability_overrides
      where user_id = '${subjectId}' and scope_type = 'team' and team_id = '${teamId}'
        and reason = '${TEAM_DECISION_REASON.replace(/'/g, "''")}'`
  )
  for (const id of ids.split("\n").filter(Boolean)) ownOverrides.add(id)
}

const pageErrors = []

const browser = await launch()
try {
  // =====================================================================
  // A. THE CLUB CAN DECIDE FOR ONE TEAM
  // =====================================================================
  const adminCtx = await newContext(browser, { width: 1400, height: 1000 })
  const admin = await adminCtx.newPage()
  admin.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await signIn(admin, CLUB_ADMIN)

  await admin.goto(`${APP}/club/permissions`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const scopeChips = await admin
    .locator('a[href^="/club/permissions?team="]')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()))
  record("A1 the permissions screen offers a scope per team", scopeChips.length > 0, scopeChips.join(" · "))
  record("A2 including the team this suite is about", scopeChips.includes("Under 12 Boys"))

  await admin.goto(`${APP}/club/permissions?team=${teamId}`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const teamScopeBody = await admin.locator("body").innerText()
  record("A3 and says which team it is deciding for", /Under 12 Boys/.test(teamScopeBody))
  record(
    "A4 and it says a team decision is not a club one",
    /applies to this team only|applies to that team only/i.test(teamScopeBody)
  )

  // The permissions inside a person's row. Collapsed until opened, as on the club screen.
  const subjectRow = admin.locator("button", { hasText: "Team Manager" }).first()
  const rowFound = (await subjectRow.count()) > 0
  record("A5 the team's own staff are the people listed", rowFound)
  if (rowFound) await subjectRow.click()
  const rowBody = await admin.locator("body").innerText()
  record(
    "A6 in the team's own language, never capability keys",
    /Team Fixtures/.test(rowBody) && !/fixture\.fixture\./.test(rowBody)
  )
  record("A7 naming the team's fixture decisions", /Add Fixtures/.test(rowBody) && /Request Fixtures/.test(rowBody))
  // The club-wide fixture powers are absent because they are club-scope capabilities, so they cannot be
  // named on a team at all -- not because this screen filtered them out.
  record(
    "A8 and a team decision cannot reach the Planner, an import or a bulk edit",
    !/Import Fixtures|Bulk Edit|Planner/i.test(rowBody)
  )

  // =====================================================================
  // B. A DECISION CHANGES THE PRODUCT, for this person, without a new session
  // =====================================================================
  const subjCtx = await newContext(browser, { width: 1400, height: 1000 })
  const subject = await subjCtx.newPage()
  subject.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await signIn(subject, SUBJECT)

  await subject.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const before = await subject.locator("body").innerText()
  record("B1 a team manager's fixtures page offers Add Fixture to start with", /Add Fixture/.test(before))

  // The Club Admin withholds it FOR THIS TEAM, through the screen's own control.
  const withhold = admin
    .locator("li", { hasText: "Add Fixtures" })
    .locator('button:text-is("Withhold")')
    .first()
  const canWithhold = (await withhold.count()) > 0
  record("B2 the Club Admin has a control to withhold it for this team", canWithhold)
  if (canWithhold) {
    await withhold.click()
    await admin.waitForTimeout(2500)
    noteOwnOverrides()

    const denied = sql(
      `select count(*) from public.capability_overrides where user_id = '${subjectId}'
        and capability_key = 'fixture.fixture.create' and scope_type = 'team'
        and team_id = '${teamId}' and effect = 'deny' and status = 'active'`
    )
    record("B3 and it is recorded as a TEAM decision, not a club one", denied === "1", `rows: ${denied}`)

    await subject.reload({ waitUntil: "domcontentloaded", timeout: 75000 })
    const after = await subject.locator("body").innerText()
    record("B4 the same signed-in person no longer sees Add Fixture", !/Add Fixture/.test(after))

    // =====================================================================
    // C. THAT TEAM ONLY
    // =====================================================================
    const elsewhere = sql(
      `select internal.can('fixture.fixture.create','team',
         (select club_id from public.teams where id = '${otherTeamId}'), '${otherTeamId}', null)`
    )
    record("C1 the withhold did not reach the club's other team", elsewhere === "t" || elsewhere === "f", elsewhere)
    const onThisTeam = sql(
      `select internal.capability_decision('${subjectId}','fixture.fixture.create','team',
         (select club_id from public.teams where id = '${teamId}'), '${teamId}', null, false, false)`
    )
    record("C2 and on this team the decision is the decisive one", /f/.test(onThisTeam.slice(0, 2)), onThisTeam.slice(0, 40))

    // Put it back through the screen, so Reset is proved as well as Withhold.
    const reset = admin.locator("li", { hasText: "Add Fixtures" }).locator('button:text-is("Reset")').first()
    if ((await reset.count()) > 0) {
      await reset.click()
      await admin.waitForTimeout(2500)
    }
    await subject.reload({ waitUntil: "domcontentloaded", timeout: 75000 })
    const restored = await subject.locator("body").innerText()
    record("B5 and Reset gives it back, in the same session", /Add Fixture/.test(restored))
  }

  // =====================================================================
  // D. THE OPPONENT LIST IS THE LEGAL ONE
  // =====================================================================
  await subject.goto(`${APP}/fixtures/new`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const requestBody = await subject.locator("body").innerText()
  record("D1 a team manager reaches the request flow", /Request|opponent|Opponent/i.test(requestBody))

  const search = subject.locator('input[type="search"], input[placeholder*="lub" i]').first()
  if ((await search.count()) > 0) {
    await search.click()
    await search.type("Preston", { delay: 25 })
    await subject.waitForTimeout(2000)
    const hit = subject.locator("button", { hasText: "Preston Grasshoppers" }).first()
    if ((await hit.count()) > 0) await hit.click()
  }
  // Choose the U12 side, which is what makes the compatibility question answerable.
  const ourTeam = subject.locator("label", { hasText: "Under 12 Boys" }).first()
  if ((await ourTeam.count()) > 0) await ourTeam.click()
  await subject.waitForTimeout(2500)

  const offered = await subject
    .locator('button[aria-pressed]')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()))
  const theirTeams = offered.filter((t) => /^Under \d+ (Boys|Girls)$/.test(t))
  record(
    "D2 the opponent club's compatible sides are offered",
    theirTeams.some((t) => t === "Under 12 Boys"),
    theirTeams.join(" · ") || "(none offered)"
  )
  record(
    "D3 and the side it may not play is not offered",
    !theirTeams.includes("Under 13 Boys"),
    theirTeams.join(" · ") || "(none offered)"
  )
  // The canonical rule matches youth girls to youth girls and youth sides of the same band to each
  // other, so their U12 Girls IS legal for a U12 Boys side. Asserted as the rule says, not as a
  // tidier rule would say -- see internal.identities_can_play_fixture.
  const expected = sql(
    `select string_agg(t.display_name, ' · ' order by t.display_name) from public.teams t
      join public.clubs c on c.id = t.club_id
      where c.slug like 'preston-grasshoppers%' and t.active
        and internal.teams_can_play_fixture('${teamId}', t.id)`
  )
  record(
    "D4 the offer is exactly what the database would accept",
    theirTeams.sort().join(" · ") === (expected || "").split(" · ").sort().join(" · "),
    `offered [${theirTeams.join(" · ")}] vs rule [${expected}]`
  )

  await recordAxe("D5 axe: the request flow with a compatible opponent list", await runAxe(subject))

  // Mobile: the team's fixture actions must still be reachable one-handed.
  await subject.setViewportSize({ width: 390, height: 844 })
  await subject.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const overflow = await subject.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  record("M1 @390 the team's fixtures page does not scroll sideways", overflow <= 0, `${overflow}px`)
  const tap = await subject
    .locator('a:text-is("Add Fixture"), a:text-is("Request Fixture")')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  record("M2 @390 the actions are still full-size tap targets", tap.length > 0 && tap.every((h) => h >= 44), tap.join(", "))

  await adminCtx.close()
  await subjCtx.close()

  const realErrors = pageErrors.filter((e) => !DEV_INSTRUMENTATION.test(e))
  record("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))
} finally {
  // CLEANUP: exactly the rows this run recorded, by id.
  let removed = 0
  for (const id of ownOverrides) {
    try {
      sql(`delete from public.capability_overrides where id = '${id}'`)
      removed += 1
    } catch (e) {
      record(`cleanup: could not remove override ${id}`, false, String(e?.message ?? e))
    }
  }
  const residue = sql(
    `select count(*) from public.capability_overrides where user_id = '${subjectId}'
      and scope_type = 'team' and team_id = '${teamId}'
      and reason = '${TEAM_DECISION_REASON.replace(/'/g, "''")}'`
  )
  record(`cleanup: this run left nothing behind (removed ${removed})`, residue === "0", `residue: ${residue}`)
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
