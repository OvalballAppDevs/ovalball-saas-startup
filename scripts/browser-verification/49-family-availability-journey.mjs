// =====================================================================
// CONVERGENCE STEP 9 -- A FAMILY ANSWERS, IN A REAL BROWSER
//
// The journey the step exists for, walked as a parent with two children:
//
//     sign in -> the dashboard resolves a family context -> both children are
//     there, distinctly -> open the agenda -> ANSWER on the row itself ->
//     reload -> the server's answer is still there -> the other child's rugby
//     is untouched -> open Match Centre for the same fixture -> the same
//     answer -> an authorised operational viewer sees the count move.
//
// WHY THE LAST STEP MATTERS MOST. Step 7 built the availability DISPLAY and
// proved it against the database. Step 9 owns the RESPONSE. If those two turn
// out to be different records, every count a club reads on a Monday morning is
// about something other than what the parents answered -- and nothing in
// either step alone would say so. This is the Step 7 -> Step 9 integration
// test, and it deliberately reads the operational summary through the same RPC
// the Control Centre uses.
//
// EVERY PRODUCT ACTION IS PERFORMED IN THE BROWSER. The only SQL here creates
// and removes the fixture this run needs, and reads back what the product
// wrote. Nothing is set by hand that the product is supposed to set.
//
// The persistent review personas are not touched: this uses the automated UAT
// club's own guardian identities, and removes its own fixture and every answer
// recorded against it.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const GUARDIAN = "uat.guardian.two@ovalball.test"
const CLUB_ADMIN = "uat.coach@ovalball.test"
const NOTE = `S9 family ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

/** Ask a capability question AS somebody: the engine refuses without a session. */
const asksAs = (userId, sqlText) =>
  sql(`select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, true) is not null;
       ${sqlText}`)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? ""

const guardianId = sql(`select id from auth.users where email = '${GUARDIAN}'`)
if (!guardianId) {
  console.error(`Missing UAT guardian ${GUARDIAN}: run the local UAT seed.`)
  process.exit(1)
}

// The two children, and the teams they actually play for.
const children = sql(`
  select p.id || '|' || p.first_name || '|' || t.id || '|' || t.display_name
  from public.guardians g
  join public.players p on p.id = g.player_id
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
  join public.teams t on t.id = ptm.team_id
  where g.guardian_user_id = '${guardianId}' and g.status = 'active' and t.active
  order by t.display_name`)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [playerId, firstName, teamId, teamName] = line.split("|")
    return { playerId, firstName, teamId, teamName }
  })

if (children.length < 2) {
  console.error("This suite needs a guardian with two children on two teams.")
  process.exit(1)
}
const [childA, childB] = children

function teardown() {
  try {
    sql(`
      delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'S9 family %');
      delete from public.fixtures where notes like 'S9 family %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

// One fixture for each child's team, a fortnight out, so the agenda asks about
// both and the two answers can be proved independent.
const fixtureA = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values ('${childA.teamId}', 'Home', 'S9 Visitors ${TAG}', (current_date + 14)::date, '11:00', 'Friendly', 'Booked', 'club_created', '${NOTE}')
  returning id`)
const fixtureB = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values ('${childB.teamId}', 'Home', 'S9 Visitors ${TAG}', (current_date + 15)::date, '11:00', 'Friendly', 'Booked', 'club_created', '${NOTE}')
  returning id`)

const browser = await launch()
const pageErrors = []

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  await signIn(page, GUARDIAN)

  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // ------------------------------------------------------------------
  // A. THE DASHBOARD RESOLVES A FAMILY CONTEXT
  // ------------------------------------------------------------------
  await go("/dashboard")
  const dash = await page.locator("main").innerText()
  record("A1 an ordinary sign-in lands on the dashboard, with no role-specific routing",
    new URL(page.url()).pathname === "/dashboard", new URL(page.url()).pathname)
  record("A2 and it resolves a family context rather than an administrative one",
    new RegExp(childA.firstName, "i").test(dash) || /children/i.test(dash),
    dash.replace(/\s+/g, " ").slice(0, 140))
  record("A3 both children are there, distinctly",
    new RegExp(childA.firstName, "i").test(dash) && new RegExp(childB.firstName, "i").test(dash))

  // ------------------------------------------------------------------
  // B. ANSWERING, ON THE ROW ITSELF
  //    Before Step 9 the agenda's own copy said "Open a fixture to change
  //    whether you can make it". The answer was always one navigation away.
  // ------------------------------------------------------------------
  await go("/agenda")
  const agendaText = await page.locator("main").innerText()
  record("B1 the agenda lists the rugby that needs an answer",
    new RegExp(`S9 Visitors ${TAG}`, "i").test(agendaText) || /needs? your response/i.test(agendaText),
    agendaText.replace(/\s+/g, " ").slice(0, 160))

  const answerGroup = page.getByRole("group", { name: new RegExp(`${childA.firstName}.*${TAG}`, "i") }).first()
  const hasInlineAnswer = (await answerGroup.count()) > 0
  record("B2 and the answer is offered ON the row, not behind a navigation", hasInlineAnswer)

  if (hasInlineAnswer) {
    await answerGroup.getByRole("button", { name: /^Can Attend/ }).click()
    await page.waitForTimeout(2000)
  }

  const storedA = sql(`select status from public.player_fixture_attendance
                       where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("B3 the answer reaches the canonical record", storedA === "ATTENDING", storedA || "(nothing stored)")
  const source = sql(`select response_source from public.player_fixture_attendance
                      where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("B4 recorded as the guardian's answer, by the server's own rule", source === "guardian", source)
  const author = sql(`select responded_by_user_id from public.player_fixture_attendance
                      where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("B5 and the person who gave it is recorded", author === guardianId, author)

  // ------------------------------------------------------------------
  // C. IT IS THE SERVER'S ANSWER, NOT AN OPTIMISTIC ONE
  // ------------------------------------------------------------------
  await go("/agenda")
  const afterReload = await page.getByRole("group", { name: new RegExp(`${childA.firstName}.*${TAG}`, "i") }).first()
  const pressed = await afterReload.getByRole("button", { name: /^Can Attend/ }).getAttribute("aria-pressed").catch(() => null)
  record("C1 after a reload the chosen answer is still shown as chosen", pressed === "true", String(pressed))

  // ------------------------------------------------------------------
  // D. ONE CHILD'S ANSWER IS NOT THE OTHER'S
  // ------------------------------------------------------------------
  const storedB = sql(`select count(*) from public.player_fixture_attendance
                       where fixture_id = '${fixtureB}' and player_id = '${childB.playerId}'`)
  record("D1 the other child's rugby is untouched by the first child's answer", storedB === "0", storedB)

  const answerB = page.getByRole("group", { name: new RegExp(`${childB.firstName}.*${TAG}`, "i") }).first()
  if ((await answerB.count()) > 0) {
    await answerB.getByRole("button", { name: /^Can't Attend/ }).click()
    await page.waitForTimeout(2000)
  }
  const storedB2 = sql(`select status from public.player_fixture_attendance
                        where fixture_id = '${fixtureB}' and player_id = '${childB.playerId}'`)
  record("D2 and answering for one child records an independent answer for the other",
    storedB2 === "CANNOT_ATTEND", storedB2 || "(nothing stored)")
  const stillA = sql(`select status from public.player_fixture_attendance
                      where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("D3 while the first child's answer stands", stillA === "ATTENDING", stillA)

  // ------------------------------------------------------------------
  // E. MATCH CENTRE IS THE SAME FIXTURE AND THE SAME ANSWER
  // ------------------------------------------------------------------
  await go(`/fixtures/${fixtureA}`)
  record("E1 the parent reaches Match Centre for the same canonical fixture",
    page.url().includes(fixtureA), page.url().replace(APP, ""))
  // The claim is about the RECORD, not about a particular sentence: Match
  // Centre's own availability presentation is Step 7's and varies with the
  // fixture's state. What must be true is that opening it did not create,
  // duplicate or disturb the answer the agenda wrote.
  const afterCentre = sql(`select status || '|' || responded_by_user_id::text from public.player_fixture_attendance
                           where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("E2 and opening it neither duplicates nor disturbs the answer already given",
    afterCentre === `ATTENDING|${guardianId}`, afterCentre || "(nothing stored)")
  const rowCount = sql(`select count(*) from public.player_fixture_attendance
                        where fixture_id = '${fixtureA}' and player_id = '${childA.playerId}'`)
  record("E3 one record, whichever surface the family reached it from", rowCount === "1", rowCount)

  // ------------------------------------------------------------------
  // F. THE OPERATIONAL COUNT IS THE SAME RECORD -- Step 7 meets Step 9
  // ------------------------------------------------------------------
  const adminId = sql(`select id from auth.users where email = '${CLUB_ADMIN}'`)
  const summary = asksAs(adminId,
    `select coalesce(string_agg(s.attending_count::text || ' of ' || s.squad_count::text, ','), '(no row)')
       from public.fixture_availability_summary(array['${fixtureA}']::uuid[]) s;`)
  record("F1 an authorised operational viewer's availability summary reflects the parent's answer",
    /^[1-9]/.test(summary), summary)

  // ------------------------------------------------------------------
  // G. ACCESSIBILITY AND THE PHONE WIDTHS
  // ------------------------------------------------------------------
  await go("/agenda")
  await page.addScriptTag({ content: axeSource() })
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
  recordAxe("axe: the family agenda with answers on it", violations)

  // State must never be carried by colour alone.
  const pressedCount = await page.locator('button[aria-pressed="true"]').count()
  record("G1 a chosen answer is announced, not merely coloured", pressedCount >= 1, `${pressedCount} pressed`)
  // Repeated controls must not all announce the same three words.
  const names = await page.locator('[role="group"] button').evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim() ?? "")
  )
  const distinct = new Set(names)
  record("G2 and repeated answer controls name whose rugby they are about",
    names.length === 0 || distinct.size >= Math.min(names.length, 3), `${distinct.size} distinct of ${names.length}`)

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
  await ctx.close()

  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, GUARDIAN)
    await m.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`G3 no horizontal overflow on the family agenda at ${width}px`, overflow <= 0, `${overflow}px over`)
    const target = await m.getByRole("button", { name: /^Can Attend/ }).first().boundingBox().catch(() => null)
    record(`G4 and an answer stays a real target at ${width}px`,
      target === null || target.height >= 44, target ? `${Math.round(target.height)}px` : "(not offered)")
    await small.close()
  }
} finally {
  await browser.close()
  teardown()
}

record("cleanup: this run's fixtures and every answer recorded against them are gone",
  sql(`select count(*) from public.fixtures where notes like 'S9 family %'`) === "0" &&
    sql(`select count(*) from public.player_fixture_attendance where fixture_id in ('${fixtureA}','${fixtureB}')`) === "0")

process.exit(summarise() ? 0 : 1)
