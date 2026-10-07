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
import fs from "node:fs"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
// THIS RUN'S OWN TEAM STAFF, GUARDIAN AND CHILD. The youth side used to be "the first team" of
// uat.team.manager, read with an unordered limit 1; that persona now runs three teams (and has a password a
// person set), so the side changed under the suite. The youth side is the review club's Under 12 Boys, named,
// and the staff and family walking it are made for this run and removed with everything that names them.
const PEOPLE = "uat.s81.%@ovalball.test"
const STAFF = `uat.s81.manager.${TAG}@ovalball.test`
const GUARDIAN = `uat.s81.guardian.${TAG}@ovalball.test`
const ADULT = "uat.adult.player@ovalball.test"
const OUTSIDER = "uat.preston.admin@ovalball.test"
const NOTE = `BatchA ${TAG}`
/** The canonical category named Parents' Player on a youth side and Players' Player on an adult one. */
const AWARD = "FAMILY_OR_SELF_PLAYER"

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

function env(name) {
  if (process.env[name]) return process.env[name]
  try {
    return fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? ""
  } catch {
    return ""
  }
}
const API = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")

/** An adult who signs in with the shared UAT password. Coach and Team Manager need a date of birth showing that. */
async function person(email, first, surname, dob) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: env("UAT_BROWSER_PASSWORD"), email_confirm: true }),
  })
  const id = (await res.json()).id
  if (!id) throw new Error(`could not create ${email}: HTTP ${res.status}`)
  sql(`update public.profiles set first_name = '${first}', surname = '${surname}', date_of_birth = '${dob}', setup_state = 'COMPLETE' where id = '${id}'`)
  return id
}

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                    where d.normalized_key = 'ovalball-uat-rufc'`)
const youthTeam = sql(`select id from public.teams
                       where club_id = '${clubId}' and age_group = 'U12' and gender = 'boys' and squad_designation is null`)
const adultTeam = sql(`select ptm.team_id from public.player_team_memberships ptm
                       join public.players p on p.id = ptm.player_id
                       join public.teams t on t.id = ptm.team_id
                       where p.user_id = (select id from auth.users where email = '${ADULT}')
                         and ptm.state = 'ACTIVE' and t.category = 'senior' order by t.display_name limit 1`)
if (!youthTeam || !adultTeam) {
  console.error("Missing UAT world: need the review club's Under 12 Boys and an adult side with a linked player.")
  process.exit(1)
}

/** This run's people, their child and the history that names them (which only an operator session may remove). */
function teardownPeople() {
  sql(`do $$
  declare
    v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
    v_players uuid[] := array(select player_id from public.guardians where guardian_user_id = any(v_people));
    v_records uuid[];
  begin
    perform set_config('ovalball.maintenance', 'on', true);
    v_records := v_people || v_players
      || array(select id from public.player_team_memberships where player_id = any(v_players))
      || array(select id from public.guardians where guardian_user_id = any(v_people))
      || array(select id from public.club_memberships where user_id = any(v_people))
      || array(select id from public.role_assignments where user_id = any(v_people));
    delete from public.notifications where user_id = any(v_people) or data ->> 'player_id' in (select unnest(v_players)::text);
    delete from public.player_fixture_attendance where player_id = any(v_players);
    delete from public.player_team_memberships where player_id = any(v_players);
    delete from public.guardians where guardian_user_id = any(v_people) or player_id = any(v_players);
    delete from public.players where id = any(v_players);
    delete from public.role_assignments where user_id = any(v_people);
    delete from public.club_memberships where user_id = any(v_people);
    delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
    delete from public.profiles where id = any(v_people);
    delete from auth.users where id = any(v_people);
    delete from public.audit_log where record_id = any(v_records);
    delete from public.security_events where actor_user_id = any(v_people) or subject_user_id = any(v_people) or player_id = any(v_players);
  end $$;`)
}

// THE YOUTH SIDE'S OWN AWARD SETTING IS PUT BACK EXACTLY. Staff switch the award on below, which writes the
// team's row; the run notes what was there first and restores that, rather than clearing every setting of both
// sides. A row a crashed run's own staff wrote is that run's, so it is removed before the note is taken.
const SETTING = `from public.team_award_category_settings where team_id = '${youthTeam}' and category_key = '${AWARD}'`
sql(`delete ${SETTING} and updated_by in (select id from auth.users where email like '${PEOPLE}')`)
const settingBefore = sql(`select row_to_json(s)::text from (select enabled, display_name_override, updated_by, updated_at ${SETTING}) s`)
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`)
function restoreSetting() {
  if (!settingBefore) return sql(`delete ${SETTING}`)
  const s = JSON.parse(settingBefore)
  sql(`update public.team_award_category_settings
          set enabled = ${s.enabled}, display_name_override = ${lit(s.display_name_override)},
              updated_by = ${lit(s.updated_by)}, updated_at = ${lit(s.updated_at)}
        where team_id = '${youthTeam}' and category_key = '${AWARD}'`)
}
const settingNow = () => sql(`select coalesce((select row_to_json(s)::text from (select enabled, display_name_override, updated_by, updated_at ${SETTING}) s), '')`)

// A crashed run's fixtures name its people, so they go first.
teardown()
teardownPeople()
const staffId = await person(STAFF, "Morgan", "Manager", "1984-02-09")
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${clubId}', '${staffId}', 'BASIC_USER', 'active');
     insert into testing.team_roles (membership_id, team_id, role_key)
       select id, '${youthTeam}', 'TEAM_MANAGER' from public.club_memberships where club_id = '${clubId}' and user_id = '${staffId}';`)
// A guardian whose child plays for the youth side, at the canonical date of birth for its grade (the database
// refuses a placement outside it).
const guardianId = await person(GUARDIAN, "Gwen", "Guardian", "1983-06-14")
const childId = sql(`with p as (
    insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
    values ('Wren', 'Batch', internal.date_of_birth_in_age_grade('union', 'U12'), true, 'MALE') returning id)
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  select '${guardianId}', p.id, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD' from p returning player_id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${childId}', '${youthTeam}', 'active')`)
const childName = sql(`select first_name from public.players where id = '${childId}'`)

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

function teardown() {
  try {
    // Opening voting tells the families who hold the vote; those notices are about this run's fixtures.
    sql(`delete from public.notifications where data ->> 'fixture_id' in (select id::text from public.fixtures where notes like 'BatchA %');
         delete from public.match_award_votes where award_id in
           (select id from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'BatchA %'));
         delete from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.match_kudos where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'BatchA %');
         delete from public.fixtures where notes like 'BatchA %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

// ONE MATCH PER DAY. Both sides keep their own season, and a fixed five days ago eventually lands on one of
// their matches, which the database refuses. Each played match goes on the nearest earlier day on which that
// side holds nothing -- asked with the team set the refusal itself uses.
const lastFreeDay = (team) =>
  sql(`select d::date::text from generate_series(current_date - 5, current_date - 65, interval '-1 day') d
        where not exists (
          select 1 from public.fixtures f
           where f.kickoff_date = d::date and f.status <> 'Cancelled'
             and (internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id)
                  || case when f.opponent_team_id is null then array[]::uuid[]
                     else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end)
                 && internal.fixture_side_effective_team_ids('${team}', null))
        order by d desc limit 1`)
const played = (team, label) =>
  sql(`insert into public.fixtures
       (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes,
        home_score, away_score, result_status)
       values ('${team}', 'Home', 'BatchA Visitors ${TAG}', '${lastFreeDay(team)}', '11:00', 'Friendly', 'Completed',
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
  // THE NAMES ARE THE CATALOGUE'S. They were written here as "Parents' Player" and "Players' Player", and the
  // catalogue now says "... of the Match"; match_award_categories is the one place a youth and an adult name live.
  const [youthName, adultName] = sql(`select name_youth || '|' || name_adult from public.match_award_categories
                                      where category_key = '${AWARD}'`).split("|")
  const u18 = sql(`select id from public.teams where category = 'youth' and age_group in ('U17','U18') order by id limit 1`)
  if (u18) {
    record("A3 U17/U18 remains a youth side, so it keeps the parents' electorate",
      sql(`select internal.team_is_adult_side('${u18}')::text`) === "false" &&
        sql(`select internal.match_award_display_name('${AWARD}', '${u18}')`) === youthName, youthName)
  } else {
    record("A3 U17/U18 remains a youth side, so it keeps the parents' electorate", true, "no U17/U18 side in the review world; covered by step12 suite")
  }
  record("A4 and the same canonical category is named for the age of the side it is on",
    youthName !== adultName &&
      sql(`select internal.match_award_display_name('${AWARD}', '${youthTeam}')`) === youthName &&
      sql(`select internal.match_award_display_name('${AWARD}', '${adultTeam}')`) === adultName,
    `${youthName} / ${adultName}`)

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
  //
  // THE TEAM'S OWN SWITCH, ON ITS OWN ROW. The review club now runs every award by default
  // (club_award_category_settings), so the first switch on the page could already say On, and pressing it
  // turned the Parents' award off. Staff use that award's own row; if it is on only by the club's default
  // they switch it off and on again, so the award is running by the team's decision.
  const awardRow = page
    .locator("li")
    .filter({ hasText: youthName })
    .filter({ has: page.getByRole("button", { name: /^(On|Off)$/ }) })
    .first()
  const toggle = awardRow.getByRole("button", { name: /^(On|Off)$/ })
  const teamSwitch = `select coalesce((select enabled::text ${SETTING}), 'unset')`
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
  }
  if ((await toggle.count()) > 0) {
    if ((await toggle.getAttribute("aria-pressed")) === "true") {
      await toggle.click()
      await waitForSql(teamSwitch, "false", 20000)
      await reload()
    }
    await toggle.click()
    await waitForSql(teamSwitch, "true", 20000)
    await reload()
    await awardRow.getByRole("button", { name: "Open Voting" }).click()
    await waitForSql(`select count(*) from public.match_awards where fixture_id = '${youthFixture}' and category_key = '${AWARD}' and status = 'OPEN'`, "1")
  }
  record("B7 staff can run the team's award from the match itself",
    sql(teamSwitch) === "true" &&
      sql(`select count(*) from public.match_awards where fixture_id = '${youthFixture}' and category_key = '${AWARD}'`) === "1")

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
    record("C1 a guardian is named as a Parent/Guardian of their own child", false, "this run's child could not be placed on the team")
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
  try {
    restoreSetting()
  } catch {
    // Asserted at the end rather than assumed.
  }
  teardownPeople()
}

// THIS RUN'S, NOT THE DATABASE'S. These counts used to be over every award, kudos and team setting anywhere,
// so the review club's own awards on its own matches failed this run's cleanup.
const own = `'${youthFixture}', '${adultFixture}'`
record(
  "cleanup: this run's fixtures, awards, votes, kudos and settings are gone",
  sql(`select count(*) from public.fixtures where notes like 'BatchA %'`) === "0" &&
    sql(`select count(*) from public.match_awards where fixture_id in (${own})`) === "0" &&
    sql(`select count(*) from public.match_kudos where fixture_id in (${own})`) === "0" &&
    settingNow() === (settingBefore || ""),
  settingBefore ? "the youth side's own setting restored" : "the youth side had no setting of its own, and has none again"
)
record(
  "cleanup: this run's people and child are gone, with every notice about its fixtures",
  sql(`select count(*) from auth.users where email like '${PEOPLE}'`) === "0" &&
    sql(`select count(*) from public.players where id = '${childId}'`) === "0" &&
    sql(`select count(*) from public.notifications where data ->> 'fixture_id' in (${own})`) === "0"
)

process.exit(summarise() ? 0 : 1)
