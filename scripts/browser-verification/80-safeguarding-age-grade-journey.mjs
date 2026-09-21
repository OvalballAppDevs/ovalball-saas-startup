// =====================================================================
// CONVERGENCE STEP 12 -- AGE GRADE, IN A REAL BROWSER
//
// The canonical resolvers have carried the season-based, governing-body-
// referenced age answer for months and NOTHING asked them: no file in app/,
// components/ or lib/ called resolve_player_age_grade. A coach had no way to ask
// "is this player in the right age grade for this side" except by reading a date
// of birth they should not need.
//
// This walks that, on the team where the work happens:
//
//     team staff -> their team -> see WHICH players need attention and WHY, as a
//     status and a sentence -> and never a date of birth, an age or anything
//     medical
//
//     a guardian -> the same team -> sees their own child's position in the same
//     words -> and NOT the staff attention panel
//
// Everything it creates is removed and the removal is asserted. No persistent
// review persona is mutated.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const STAFF = "uat.team.manager@ovalball.test"
const GUARDIAN = "uat.guardian.two@ovalball.test"
const OUTSIDER = "uat.preston.admin@ovalball.test"
const SURNAME = `S12Age${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const staffId = sql(`select id from auth.users where email = '${STAFF}'`)
const teamId = sql(`select ra.team_id from public.role_assignments ra
                    join public.club_memberships cm on cm.id = ra.membership_id
                    where cm.user_id = '${staffId}' and ra.state = 'ACTIVE' and ra.team_id is not null limit 1`)
if (!teamId) {
  console.error("Missing UAT team staff: run the local UAT seed.")
  process.exit(1)
}
const teamCode = sql(`select rugby_code from public.teams where id = '${teamId}'`)
const season = sql(`select internal.resolve_season_for_date('${teamCode}', current_date)::text`)

function teardown() {
  try {
    sql(`delete from public.player_team_memberships where player_id in (select id from public.players where surname like 'S12Age%');
         delete from public.players where surname like 'S12Age%';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

// A DISPOSABLE PLAYER WHO IS DELIBERATELY A SCHOOL YEAR OUT.
//
// Their date of birth is derived from the canonical cutoff for this season rather than guessed, so
// the suite does not encode a governing-body rule it has no business knowing.
const cutoff = sql(`select r.age_grade_cutoff_date::text
                    from internal.resolve_player_age_grade('${teamCode}', '${season}', date '2015-01-01') r`)
const teamGrade = sql(`select coalesce(age_group, '') from public.teams where id = '${teamId}'`)
const gradeYears = Number((teamGrade.match(/\d+/) ?? ["12"])[0])
const dob = sql(`select (date '${cutoff}' - interval '${gradeYears + 1} years')::date::text`)
const playerId = sql(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
                      values ('Ola', '${SURNAME}', date '${dob}', 'MALE') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, state) values ('${playerId}', '${teamId}', 'ACTIVE')`)

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. THE STAFF JOURNEY -- what needs attention, and why
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(`staff: ${e.message}`))
  await signIn(page, STAFF)
  await page.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const main = await page.locator("main").innerText()
  record("A1 team staff are shown age grade as something needing attention", /age grade\s*—\s*needs attention/i.test(main))
  record("A2 with the player named", new RegExp(SURNAME).test(main) || /Ola/.test(main))
  record("A3 and the reason stated in words rather than a code", /outside this age grade/i.test(main))

  // THE WHOLE POINT OF THE STATUS VOCABULARY: the evidence stays out of the coach's view.
  record("A4 and no date of birth anywhere on the page", !main.includes(dob) && !/\b\d{4}-\d{2}-\d{2}\b/.test(main), dob)
  record("A5 nor anything medical", !/medical|emergency contact|diagnos/i.test(main))

  // ONLY WHAT NEEDS ATTENTION. Asserted against what the server would return rather than against a
  // guess about the roster: a team where everybody needs a look is still correct behaviour, so the
  // invariant is that no settled player is listed and the count matches the server exactly.
  const expected = sql(`select count(*) from public.player_team_memberships ptm
                        cross join internal.team_age_grade_status('${teamId}', ptm.player_id) s
                        where ptm.team_id = '${teamId}' and ptm.state = 'ACTIVE' and s.status <> 'ELIGIBLE'`)
  const listed = (main.match(/— (Outside this age grade|Date of birth needed|Dispensation approved|Dispensation pending|Age grade not established|Season not established)/g) ?? []).length
  record("A6 the panel lists exactly the players the server says need attention",
    listed === Number(expected), `listed ${listed}, server says ${expected}`)
  record("A7 and never a player who is settled", !/—\s*Eligible/.test(main))

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
  recordAxe("axe: the team home with age grade", axe.violations)
  await ctx.close()

  // ==================================================================
  // B. THE FAMILY JOURNEY -- their own child, and not the club's list
  // ==================================================================
  const gctx = await newContext(browser, { width: 1440, height: 1100 })
  const gpage = await gctx.newPage()
  gpage.on("pageerror", (e) => pageErrors.push(`guardian: ${e.message}`))
  await signIn(gpage, GUARDIAN)
  await gpage.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
  await gpage.waitForLoadState("networkidle").catch(() => {})
  const gtext = await gpage.locator("main").innerText()

  record("B1 a guardian reaches the team", /team/i.test(gtext) && !/not authorised/i.test(gtext))
  // The staff panel is server-refused for them, so it is absent rather than hidden.
  record("B2 and is NOT shown the club's attention list", !/age grade\s*—\s*needs attention/i.test(gtext))
  record("B3 nor another family's child in an age-grade status", !new RegExp(SURNAME).test(gtext))
  record("B4 and no date of birth", !gtext.includes(dob) && !/\b\d{4}-\d{2}-\d{2}\b/.test(gtext))
  await gctx.close()

  // ==================================================================
  // C. SOMEBODY ELSE'S TEAM
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const opage = await octx.newPage()
  await signIn(opage, OUTSIDER)
  await opage.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const otext = await opage.locator("body").innerText()
  record("C1 another club's admin gets no age-grade attention for a team that is not theirs",
    !/age grade\s*—\s*needs attention/i.test(otext))
  record("C2 and no player named in one", !new RegExp(SURNAME).test(otext))
  await octx.close()

  // ==================================================================
  // D. THE PHONE -- status must not be the thing that gets hidden
  // ==================================================================
  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, STAFF)
    await m.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`D1 no horizontal overflow on the team home at ${width}px`, overflow <= 0, `${overflow}px over`)
    const text = await m.locator("main").innerText()
    record(`D2 and the attention state survives the phone at ${width}px`, /needs attention/i.test(text))
    record(`D3 still with no date of birth at ${width}px`, !text.includes(dob))
    await small.close()
  }

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record(
  "cleanup: this run's disposable player and their team place are gone",
  sql(`select count(*) from public.players where surname like 'S12Age%'`) === "0" &&
    sql(`select count(*) from public.player_team_memberships where player_id = '${playerId}'`) === "0"
)

process.exit(summarise() ? 0 : 1)
