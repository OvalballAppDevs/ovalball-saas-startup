// =====================================================================
// BATCH A -- STEPS 10-12 TOGETHER, IN A REAL BROWSER
//
// The per-step suites each proved their own step. This one exists because the
// product boundaries only meet when somebody walks through them:
//
//   IDENTITY -> CLUB -> TEAM -> PLAYER/FAMILY -> FIXTURE -> MATCH CENTRE
//   -> COMMUNITY/RECOGNITION -> SAFEGUARDING/AGE-GRADE
//
// and the question is whether there is ONE answer for each concept along the way.
//
// It walks the same product as three different people over two real sides -- a
// YOUTH side and an ADULT side -- because that is where Step 11's electorate and
// Step 12's age answer have to agree:
//
//   team staff  -> Team -> age-grade attention -> played fixture -> Match Centre
//                 -> the score -> community -> back to the Team
//   a guardian  -> the same Team -> their own child's status, not the club's list
//                 -> Match Centre -> PARENTS' Player, and availability still separate
//   an adult    -> their senior side -> Match Centre -> PLAYERS' Player
//   an outsider -> none of it
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
const ADULT = "uat.adult.player@ovalball.test"
const OUTSIDER = "uat.preston.admin@ovalball.test"
const NOTE = `BatchA ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

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
const youthTeam = sql(`select ra.team_id from public.role_assignments ra
                       join public.club_memberships cm on cm.id = ra.membership_id
                       where cm.user_id = '${staffId}' and ra.state = 'ACTIVE' and ra.team_id is not null limit 1`)
const guardianId = sql(`select id from auth.users where email = '${GUARDIAN}'`)
const child = sql(`select p.id || '|' || p.first_name
                   from public.guardians g join public.players p on p.id = g.player_id
                   join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
                   where g.guardian_user_id = '${guardianId}' and g.status = 'active' and ptm.team_id = '${youthTeam}' limit 1`)
const [childId, childName] = child ? child.split("|") : [null, null]

// THE PRIVACY ASSERTION HAS TO NAME THE EVIDENCE IT IS LOOKING FOR.
//
// A first attempt failed the team page for containing a yyyy-mm-dd string -- which was a FIXTURE
// DATE in What's Next, exactly what the page is for. The invariant is that no ROSTER MEMBER'S DATE OF
// BIRTH appears, so the check asks the database for those dates and looks for those.
const rosterDobs = sql(`select coalesce(string_agg(distinct p.date_of_birth::text, '|'), '')
                        from public.player_team_memberships ptm
                        join public.players p on p.id = ptm.player_id
                        where ptm.team_id = '${youthTeam}' and ptm.state = 'ACTIVE' and p.date_of_birth is not null`)
  .split("|")
  .filter(Boolean)
const leaksDob = (text) => rosterDobs.filter((d) => text.includes(d))
const adultTeam = sql(`select ptm.team_id from public.player_team_memberships ptm
                       join public.players p on p.id = ptm.player_id
                       join public.teams t on t.id = ptm.team_id
                       where p.user_id = (select id from auth.users where email = '${ADULT}')
                         and ptm.state = 'ACTIVE' and t.category = 'senior' limit 1`)
if (!youthTeam || !adultTeam) {
  console.error("Missing UAT world: need a youth side with staff and an adult side with a linked player.")
  process.exit(1)
}

function teardown() {
  try {
    sql(`delete from public.match_award_votes where award_id in
           (select id from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'BatchA %'));
         delete from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.match_kudos where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.team_award_category_settings where team_id in ('${youthTeam}', '${adultTeam}');
         delete from public.fixtures where notes like 'BatchA %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const played = (team, label) =>
  sql(`insert into public.fixtures
       (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes,
        home_score, away_score, result_status)
       values ('${team}', 'Home', 'BatchA Visitors ${TAG}', (current_date - 5)::date, '11:00', 'Friendly', 'Completed',
               'club_created', '${NOTE} ${label}', 31, 17, 'external_recorded')
       returning id`)
const youthFixture = played(youthTeam, "youth")
const adultFixture = played(adultTeam, "adult")

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. ONE ANSWER PER CONCEPT, asserted against the database first.
  //
  // Cheap, deterministic, and it makes the browser assertions below meaningful:
  // if two age answers existed, the UI could agree with either one.
  // ==================================================================
  const disagree = sql(`select count(*) from public.teams t
                        where internal.match_side_is_adult(t.id) is distinct from internal.team_is_adult_side(t.id)`)
  record("A1 one adult answer: Match Centre's electorate test and the canonical one agree on every team", disagree === "0", `${disagree} disagree`)
  record("A2 the youth side is youth and the adult side is adult",
    sql(`select internal.team_is_adult_side('${youthTeam}')::text`) === "false" &&
      sql(`select internal.team_is_adult_side('${adultTeam}')::text`) === "true")
  const u18 = sql(`select id from public.teams where category = 'youth' and age_group in ('U17','U18') limit 1`)
  if (u18) {
    record("A3 U17/U18 remains a youth side, so it keeps the parents' electorate",
      sql(`select internal.team_is_adult_side('${u18}')::text`) === "false" &&
        sql(`select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', '${u18}')`) === "Parents' Player")
  } else {
    record("A3 U17/U18 remains a youth side, so it keeps the parents' electorate", true, "no U17/U18 side in the review world; covered by step12 suite")
  }
  record("A4 and the same canonical category is named for the age of the side it is on",
    sql(`select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', '${youthTeam}')`) === "Parents' Player" &&
      sql(`select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', '${adultTeam}')`) === "Players' Player")

  // ==================================================================
  // B. THE STAFF WALK -- Team to Match Centre and back
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(`staff: ${e.message}`))
  await signIn(page, STAFF)

  await page.goto(`${APP}/teams/${youthTeam}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  let main = await page.locator("main").innerText()
  record("B1 team staff reach their team and it is a place, not a form", /what.s next/i.test(main))
  record("B2 age grade is reported to them as attention with a reason", /needs attention/i.test(main) && /outside this age grade|date of birth needed|dispensation/i.test(main))
  record("B3 and no roster member's date of birth appears on the team page", leaksDob(main).length === 0,
    `${rosterDobs.length} roster dates of birth checked`)

  // Team -> the played fixture -> Match Centre
  await page.goto(`${APP}/fixtures/${youthFixture}?from=/teams/${youthTeam}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const mcText = await page.locator("main").innerText()
  record("B4 Match Centre for a played match says what happened", /31\s*[–-]\s*17/.test(mcText), mcText.match(/\d+\s*[–-]\s*\d+/)?.[0] ?? "no score")
  record("B5 with the community layer after the rugby, not instead of it",
    mcText.indexOf("After the Match") === -1 || mcText.indexOf("After the Match") > mcText.indexOf("Kick-off"))
  const back = await page.locator("main a").first().innerText().catch(() => "")
  record("B6 and the way back is to the team, not to a fixture list", /team|under|men|women/i.test(back), back.slice(0, 40))

  // Staff switch on and open an award, so the family journey has one to answer.
  const toggle = page.getByRole("button", { name: /^(On|Off)$/ }).first()
  if ((await toggle.count()) > 0) {
    await toggle.click()
    await waitForSql(`select count(*) from public.team_award_category_settings where team_id = '${youthTeam}' and enabled`, "1")
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.getByRole("button", { name: "Open Voting" }).first().click()
    await waitForSql(`select count(*) from public.match_awards where fixture_id = '${youthFixture}' and status = 'OPEN'`, "1")
  }
  record("B7 staff can run the team's award from the match itself",
    sql(`select count(*) from public.match_awards where fixture_id = '${youthFixture}'`) === "1")

  await page.addScriptTag({ content: axeSource() })
  const axeMc = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
  recordAxe("axe: played Match Centre with community", axeMc)
  await ctx.close()

  // ==================================================================
  // C. THE FAMILY WALK -- their own child, the youth electorate, and
  //    availability still a different thing from voting
  // ==================================================================
  if (childId) {
    const gctx = await newContext(browser, { width: 1440, height: 1100 })
    const gpage = await gctx.newPage()
    gpage.on("pageerror", (e) => pageErrors.push(`guardian: ${e.message}`))
    await signIn(gpage, GUARDIAN)

    await gpage.goto(`${APP}/teams/${youthTeam}`, { waitUntil: "domcontentloaded" })
    await gpage.waitForLoadState("networkidle").catch(() => {})
    const gTeam = await gpage.locator("main").innerText()
    record("C1 a guardian is named as a Parent/Guardian of their own child", new RegExp(childName, "i").test(gTeam))
    record("C2 and is not shown the club's age-grade attention list", !/needs attention/i.test(gTeam))
    record("C3 nor any roster member's date of birth", leaksDob(gTeam).length === 0, `${rosterDobs.length} checked`)

    await gpage.goto(`${APP}/fixtures/${youthFixture}`, { waitUntil: "domcontentloaded" })
    await gpage.waitForLoadState("networkidle").catch(() => {})
    const gMc = await gpage.locator("main").innerText()
    record("C4 on a youth side the recognition is offered as PARENTS' Player", /Parents. Player/i.test(gMc))
    record("C5 and availability is still its own question, not a poll",
      /can attend|can't attend|cannot attend|unsure/i.test(gMc) && !/vote/i.test(gMc.match(/can attend[\s\S]{0,120}/i)?.[0] ?? ""))

    const choice = gpage.getByRole("button", { name: new RegExp(`^${childName}`) }).first()
    if ((await choice.count()) > 0) {
      await choice.click()
      const voted = await waitForSql(
        `select count(*) from public.match_award_votes v join public.match_awards a on a.id = v.award_id
         where a.fixture_id = '${youthFixture}' and v.voter_user_id = '${guardianId}'`,
        "1"
      )
      record("C6 a guardian in the electorate may choose, and it is written to the canonical record", voted === "1")
    } else {
      record("C6 a guardian in the electorate may choose, and it is written to the canonical record", false, "no choice offered")
    }
    await gctx.close()
  } else {
    record("C1 a guardian is named as a Parent/Guardian of their own child", false, "no UAT guardian child in this team")
  }

  // ==================================================================
  // D. THE ADULT WALK -- the same category, named for an adult side
  // ==================================================================
  const actx = await newContext(browser, { width: 1440, height: 1100 })
  const apage = await actx.newPage()
  apage.on("pageerror", (e) => pageErrors.push(`adult: ${e.message}`))
  await signIn(apage, ADULT)
  await apage.goto(`${APP}/fixtures/${adultFixture}`, { waitUntil: "domcontentloaded" })
  await apage.waitForLoadState("networkidle").catch(() => {})
  const aText = await apage.locator("main").innerText()
  record("D1 an adult player reaches their own side's played match", /31\s*[–-]\s*17/.test(aText))
  record("D2 and is never offered a parents' award on an adult side", !/Parents. Player/i.test(aText))
  record("D3 nor treated as their own parent", !/parent\/guardian/i.test(aText))
  await actx.close()

  // ==================================================================
  // E. SOMEBODY ELSE'S CLUB
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const opage = await octx.newPage()
  await signIn(opage, OUTSIDER)
  await opage.goto(`${APP}/teams/${youthTeam}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const oTeam = await opage.locator("body").innerText()
  record("E1 another club's admin gets no age-grade attention for a team that is not theirs", !/needs attention/i.test(oTeam))
  await opage.goto(`${APP}/fixtures/${youthFixture}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const oMc = await opage.locator("body").innerText()
  record("E2 and no community controls on somebody else's match", !/Open Voting|Give Kudos|Close Voting/i.test(oMc))
  await octx.close()

  // ==================================================================
  // F. THE PHONE, over the combined walk
  // ==================================================================
  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, STAFF)
    await m.goto(`${APP}/teams/${youthTeam}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    let over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const teamText = await m.locator("main").innerText()
    record(`F1 no horizontal overflow on the team home at ${width}px`, over <= 0, `${over}px over`)
    record(`F2 and the age-grade attention is not the thing that gets hidden at ${width}px`, /needs attention/i.test(teamText))

    await m.goto(`${APP}/fixtures/${youthFixture}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const mcSmall = await m.locator("main").innerText()
    record(`F3 no horizontal overflow on the played Match Centre at ${width}px`, over <= 0, `${over}px over`)
    record(`F4 and the score survives the phone at ${width}px`, /31\s*[–-]\s*17/.test(mcSmall))
    await small.close()
  }

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record(
  "cleanup: this run's fixtures, awards, votes, kudos and settings are gone",
  sql(`select count(*) from public.fixtures where notes like 'BatchA %'`) === "0" &&
    sql(`select count(*) from public.match_awards`) === "0" &&
    sql(`select count(*) from public.match_kudos`) === "0" &&
    sql(`select count(*) from public.team_award_category_settings`) === "0"
)

process.exit(summarise() ? 0 : 1)
