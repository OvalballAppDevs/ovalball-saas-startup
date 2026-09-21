// =====================================================================
// CONVERGENCE STEP 10 -- A TEAM IS A PLACE, IN A REAL BROWSER
//
// Step 0 recorded the Team page as administrative and barely reachable: it
// showed a name, a settings form, a roster editor and a join code. It could not
// answer the two questions anybody opens a team page to ask -- what am I to
// this team, and what is happening next -- and a parent could not tell from it
// that they were a parent.
//
// This walks the staff journey and the family journey over the same team:
//
//     a Team Manager signs in -> reaches their team -> sees what they are to it
//     -> sees what is next -> opens a fixture -> Match Centre -> comes back to
//     THE TEAM rather than to a fixture list -> and cannot reach the mass
//     fixture tools from any of it.
//
//     a guardian reaches the same team through their child -> sees the child
//     named on the badge -> answers on the row -> the server's answer survives
//     a reload.
//
// Everything it creates is removed and the removal is asserted. No persistent
// review persona is touched.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const TEAM_MANAGER = "uat.team.manager@ovalball.test"
const GUARDIAN = "uat.guardian.two@ovalball.test"
const NOTE = `S10 team ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const managerId = sql(`select id from auth.users where email = '${TEAM_MANAGER}'`)
const teamId = sql(`select ra.team_id from public.role_assignments ra
                    join public.club_memberships cm on cm.id = ra.membership_id
                    where cm.user_id = '${managerId}' and ra.state = 'ACTIVE' and ra.team_id is not null limit 1`)
if (!teamId) {
  console.error("Missing UAT team staff: run the local UAT seed.")
  process.exit(1)
}
const teamName = sql(`select display_name from public.teams where id = '${teamId}'`)

// A guardian whose child plays for that same team, so both journeys are about
// one team rather than two unrelated ones.
const guardianId = sql(`select id from auth.users where email = '${GUARDIAN}'`)
const child = sql(`select p.id || '|' || p.first_name
                   from public.guardians g join public.players p on p.id = g.player_id
                   join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
                   where g.guardian_user_id = '${guardianId}' and g.status = 'active' and ptm.team_id = '${teamId}' limit 1`)
const [childId, childName] = child ? child.split("|") : [null, null]

function teardown() {
  try {
    sql(`delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'S10 team %');
         delete from public.fixtures where notes like 'S10 team %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const fixtureId = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values ('${teamId}', 'Home', 'S10 Visitors ${TAG}', (current_date + 12)::date, '11:00', 'Friendly', 'Booked', 'club_created', '${NOTE}')
  returning id`)

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. THE STAFF JOURNEY
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  await signIn(page, TEAM_MANAGER)

  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  await go(`/teams/${teamId}`)
  const teamText = await page.locator("main").innerText()
  record("A1 a Team Manager reaches their own team", page.url().includes(teamId), page.url().replace(APP, ""))
  record("A2 and the page names the team", new RegExp(teamName.slice(0, 12), "i").test(teamText), teamName)
  record("A3 it says what they ARE to it -- the question the page could not answer before",
    /Team Manager/i.test(teamText), teamText.replace(/\s+/g, " ").slice(0, 160))
  record("A4 and what is next, rather than only a settings form",
    /what.s next/i.test(teamText) && new RegExp(`S10 Visitors ${TAG}`, "i").test(teamText))

  // The fixture, and back again to THE TEAM.
  await page.getByText(`S10 Visitors ${TAG}`).first().click()
  await page.waitForURL(/\/fixtures\/[0-9a-f-]+/, { timeout: 30000 }).catch(() => {})
  record("A5 the fixture opens the canonical Match Centre", page.url().includes(fixtureId), page.url().replace(APP, ""))

  const back = page.locator("main a").filter({ hasText: /Team/i }).first()
  const backHref = (await back.count()) > 0 ? await back.getAttribute("href") : null
  record("A6 whose back link returns to THIS team, not to a fixture list",
    (backHref ?? "").includes(`/teams/${teamId}`), backHref ?? "(no back link)")

  // Team authority is not club authority.
  for (const path of ["/fixtures/planner", "/fixtures/import", "/fixtures/competitions/new"]) {
    await go(path)
    record(`A7 a Team Manager reaching ${path} from team authority is refused`,
      !new URL(page.url()).pathname.startsWith(path), new URL(page.url()).pathname)
  }

  await go(`/teams/${teamId}`)
  await page.addScriptTag({ content: axeSource() })
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
  recordAxe("axe: the team home", violations)
  await ctx.close()

  // ==================================================================
  // B. THE FAMILY JOURNEY OVER THE SAME TEAM
  // ==================================================================
  if (childId) {
    const gctx = await newContext(browser, { width: 1440, height: 1100 })
    const guardian = await gctx.newPage()
    guardian.on("pageerror", (e) => pageErrors.push(String(e)))
    await signIn(guardian, GUARDIAN)
    await go(`/teams/${teamId}`, guardian)
    const familyText = await guardian.locator("main").innerText()

    record("B1 a guardian reaches the same team", guardian.url().includes(teamId), guardian.url().replace(APP, ""))
    record("B2 and is shown as a Parent/Guardian, not as the player",
      /Parent\/Guardian/i.test(familyText) && !/^Player$/im.test(familyText),
      familyText.replace(/\s+/g, " ").slice(0, 160))
    record("B3 with the child named, so two children in one team are distinguishable",
      new RegExp(childName, "i").test(familyText), childName)

    const answer = guardian.getByRole("group", { name: new RegExp(`${childName}.*${TAG}`, "i") }).first()
    const hasAnswer = (await answer.count()) > 0
    record("B4 and the answer is offered on the team's own row", hasAnswer)
    if (hasAnswer) {
      await answer.getByRole("button", { name: /^Can Attend/ }).click()
      await guardian.waitForTimeout(2000)
    }
    const stored = sql(`select status from public.player_fixture_attendance
                        where fixture_id = '${fixtureId}' and player_id = '${childId}'`)
    record("B5 which writes the same canonical record every other surface writes",
      stored === "ATTENDING", stored || "(nothing stored)")

    await go(`/teams/${teamId}`, guardian)
    const pressed = await guardian
      .getByRole("group", { name: new RegExp(`${childName}.*${TAG}`, "i") })
      .first()
      .getByRole("button", { name: /^Can Attend/ })
      .getAttribute("aria-pressed")
      .catch(() => null)
    record("B6 and after a reload the server's answer is what the team page shows", pressed === "true", String(pressed))
    await gctx.close()
  } else {
    record("B1 a guardian reaches the same team", false, "no UAT guardian has a child in this team")
  }

  // ==================================================================
  // C. THE PHONE
  // ==================================================================
  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, TEAM_MANAGER)
    await m.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`C1 no horizontal overflow on the team home at ${width}px`, overflow <= 0, `${overflow}px over`)
    const stillThere = await m.locator("main").innerText()
    record(`C2 and the phone keeps what is next rather than hiding it at ${width}px`,
      /what.s next/i.test(stillThere))
    await small.close()
  }

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record("cleanup: this run's fixture and every answer against it are gone",
  sql(`select count(*) from public.fixtures where notes like 'S10 team %'`) === "0" &&
    sql(`select count(*) from public.player_fixture_attendance where fixture_id = '${fixtureId}'`) === "0")

process.exit(summarise() ? 0 : 1)
