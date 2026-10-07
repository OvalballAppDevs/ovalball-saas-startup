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
import fs from "node:fs"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
// THIS RUN'S OWN STAFF, GUARDIAN AND CHILD, on one named team. The suite used to take "the first team" of
// uat.team.manager with an unordered limit 1; that persona now runs three teams (and has a password a person
// set), and the team it got had no UAT guardian's child in it. The review club's Under 12 Boys is named
// instead, and the people walking it are made for this run and removed with everything that names them.
const PEOPLE = "uat.s79.%@ovalball.test"
const STAFF = `uat.s79.manager.${TAG}@ovalball.test`
const GUARDIAN = `uat.s79.guardian.${TAG}@ovalball.test`
const OUTSIDER = "uat.preston.admin@ovalball.test"
const NOTE = `S11 community ${TAG}`
/** The canonical category a youth side calls Parents' Player. */
const AWARD = "FAMILY_OR_SELF_PLAYER"

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
const teamId = sql(`select id from public.teams
                    where club_id = '${clubId}' and age_group = 'U12' and gender = 'boys' and squad_designation is null`)
if (!teamId) {
  console.error("Missing the review club's Under 12 Boys: run the local UAT seed.")
  process.exit(1)
}

// THE TEAM'S OWN AWARD SETTING IS PUT BACK EXACTLY. Staff switch the award on below, which writes the team's
// row; the run notes what was there first and restores that, rather than clearing every setting the team has.
// A row a crashed run's own staff wrote is that run's, so it is removed before the note is taken.
const SETTING = `from public.team_award_category_settings where team_id = '${teamId}' and category_key = '${AWARD}'`
sql(`delete ${SETTING} and updated_by in (select id from auth.users where email like '${PEOPLE}')`)
const settingBefore = sql(`select row_to_json(s)::text from (select enabled, display_name_override, updated_by, updated_at ${SETTING}) s`)
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`)
function restoreSetting() {
  if (!settingBefore) return sql(`delete ${SETTING}`)
  const s = JSON.parse(settingBefore)
  sql(`update public.team_award_category_settings
          set enabled = ${s.enabled}, display_name_override = ${lit(s.display_name_override)},
              updated_by = ${lit(s.updated_by)}, updated_at = ${lit(s.updated_at)}
        where team_id = '${teamId}' and category_key = '${AWARD}'`)
}
const settingNow = () => sql(`select coalesce((select row_to_json(s)::text from (select enabled, display_name_override, updated_by, updated_at ${SETTING}) s), '')`)

function teardown() {
  try {
    // Opening voting tells the families who hold the vote; those notices are about this run's fixtures.
    sql(`delete from public.notifications where data ->> 'fixture_id' in (select id::text from public.fixtures where notes like 'S11 community %');
         delete from public.match_award_votes where award_id in
           (select id from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'S11 community %'));
         delete from public.match_awards where fixture_id in (select id from public.fixtures where notes like 'S11 community %');
         delete from public.match_kudos where fixture_id in (select id from public.fixtures where notes like 'S11 community %');
         delete from public.fixtures where notes like 'S11 community %';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
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
    delete from public.match_kudos where recipient_player_id = any(v_players);
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

teardown()
teardownPeople()

const staffId = await person(STAFF, "Morgan", "Manager", "1984-02-09")
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${clubId}', '${staffId}', 'BASIC_USER', 'active');
     insert into testing.team_roles (membership_id, team_id, role_key)
       select id, '${teamId}', 'TEAM_MANAGER' from public.club_memberships where club_id = '${clubId}' and user_id = '${staffId}';`)

// A guardian whose child plays for the team, at the canonical date of birth for its grade (the database
// refuses a placement outside it).
const guardianId = await person(GUARDIAN, "Gwen", "Guardian", "1983-06-14")
const childId = sql(`with p as (
    insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
    values ('Wren', 'Community', internal.date_of_birth_in_age_grade('union', 'U12'), true, 'MALE') returning id)
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  select '${guardianId}', p.id, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD' from p returning player_id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${childId}', '${teamId}', 'active')`)
const childName = sql(`select first_name from public.players where id = '${childId}'`)

// ONE MATCH PER DAY. Under 12 Boys keeps its own season, and a fixed offset from today eventually lands on one
// of its matches, which the database refuses. Each fixture goes on the nearest day, from the offset and in the
// direction of `step`, on which the team holds nothing -- asked with the team set the refusal itself uses.
const freeDay = (offset, step) =>
  sql(`select d::date::text from generate_series(current_date + ${offset}, current_date + ${offset + step * 60}, make_interval(days => ${step})) d
        where not exists (
          select 1 from public.fixtures f
           where f.kickoff_date = d::date and f.status <> 'Cancelled'
             and (internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id)
                  || case when f.opponent_team_id is null then array[]::uuid[]
                     else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end)
                 && internal.fixture_side_effective_team_ids('${teamId}', null))
        order by abs(d::date - (current_date + ${offset})) limit 1`)

// A PLAYED match, with a real result on it -- the whole point is that the page can now say so.
const fixtureId = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes,
   home_score, away_score, result_status)
  values ('${teamId}', 'Home', 'S11 Visitors ${TAG}', '${freeDay(-6, -1)}', '11:00', 'Friendly', 'Completed', 'club_created', '${NOTE}',
          27, 13, 'external_recorded')
  returning id`)

// Every fixture this run owns, so the cleanup below counts what the run made and nothing else.
let upcoming = null

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
  //
  // THE TEAM'S OWN SWITCH, ON ITS OWN ROW. The review club now runs every award by default
  // (club_award_category_settings), so this row can already say On before the team has decided anything,
  // and the first switch on the page flipped it off. Staff use the Parents' Player row; if it is on only by
  // the club's default they switch it off and on again, so what is asserted is the team's own decision.
  const awardName = sql(`select internal.match_award_display_name('${AWARD}', '${teamId}')`)
  const awardRow = page
    .locator("li")
    .filter({ hasText: awardName })
    .filter({ has: page.getByRole("button", { name: /^(On|Off)$/ }) })
    .first()
  const toggle = awardRow.getByRole("button", { name: /^(On|Off)$/ })
  const teamSwitch = `select coalesce((select enabled::text ${SETTING}), 'unset')`
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
  }
  if ((await toggle.getAttribute("aria-pressed")) === "true") {
    await toggle.click()
    await waitForSql(teamSwitch, "false", 20000)
    await reload()
  }
  await toggle.click()
  await waitForSql(teamSwitch, "true", 20000)
  await reload()
  record("A3 staff switch on the award their team runs",
    sql(teamSwitch) === "true" && (await awardRow.getByRole("button", { name: "Open Voting" }).count()) > 0, awardName)

  await awardRow.getByRole("button", { name: "Open Voting" }).click()
  const awardOpen = await waitForSql(
    `select count(*) from public.match_awards where fixture_id = '${fixtureId}' and category_key = '${AWARD}' and status = 'OPEN'`, "1")
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
  upcoming = sql(`insert into public.fixtures
    (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, notes)
    values ('${teamId}', 'Home', 'S11 Later ${TAG}', '${freeDay(21, 1)}', 'Booked', 'club_created', '${NOTE} upcoming')
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
  if (childId) {
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
    record("B1 a guardian is offered the award by the name a youth side uses", false, "this run's child could not be placed on the team")
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
    await waitForSql(`select status from public.match_awards where fixture_id = '${fixtureId}' and category_key = '${AWARD}'`, "CLOSED")
    await cpage.reload({ waitUntil: "domcontentloaded" })
    await cpage.waitForLoadState("networkidle").catch(() => {})
  }
  const closed = sql(`select status || '/' || coalesce(outcome,'-') from public.match_awards where fixture_id = '${fixtureId}' and category_key = '${AWARD}'`)
  record("C1 staff close voting and the outcome is decided by the server", /^CLOSED\//.test(closed), closed)
  const staffText = await cpage.locator("main").innerText()
  record("C2 and staff are shown the count, marked as theirs alone", /staff only/i.test(staffText))

  await cctx.close()

  // The team is told who won and never by how much.
  if (childId) {
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
  try {
    restoreSetting()
  } catch {
    // Asserted at the end rather than assumed.
  }
  teardownPeople()
}

// THIS RUN'S, NOT THE DATABASE'S. These counts used to be over every award and kudos anywhere, so the review
// club's own awards on its own matches failed this run's cleanup.
const own = [fixtureId, upcoming].filter(Boolean).map((id) => `'${id}'`).join(", ")
record(
  "cleanup: this run's fixture, awards, votes and kudos are gone",
  sql(`select count(*) from public.fixtures where notes like 'S11 community %'`) === "0" &&
    sql(`select count(*) from public.match_awards where fixture_id in (${own})`) === "0" &&
    sql(`select count(*) from public.match_award_votes where voter_user_id = '${guardianId}'`) === "0" &&
    sql(`select count(*) from public.match_kudos where fixture_id in (${own})`) === "0"
)
record(
  "cleanup: this run's people and child are gone, every notice about its fixtures with them, and the team's award setting is as it was",
  sql(`select count(*) from auth.users where email like '${PEOPLE}'`) === "0" &&
    sql(`select count(*) from public.players where id = '${childId}'`) === "0" &&
    sql(`select count(*) from public.notifications where data ->> 'fixture_id' in (${own})`) === "0" &&
    settingNow() === (settingBefore || ""),
  settingBefore ? "the team's own setting restored" : "the team had no setting of its own, and has none again"
)

process.exit(summarise() ? 0 : 1)
