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
import fs from "node:fs"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
// THIS RUN'S OWN MANAGER, GUARDIAN AND CHILD. The suite used to sign in as uat.team.manager and
// uat.guardian.two and take "the manager's team" with an unordered limit 1. That persona now runs three teams
// (and has a password a person set), so the team it got was one where no UAT guardian had a child. Both
// journeys are now about one named team -- the review club's Under 12 Boys -- and the people walking them are
// made for this run and removed with everything that names them.
const PEOPLE = "uat.s50.%@ovalball.test"
const TEAM_MANAGER = `uat.s50.manager.${TAG}@ovalball.test`
const GUARDIAN = `uat.s50.guardian.${TAG}@ovalball.test`
const NOTE = `S10 team ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

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
const teamName = sql(`select display_name from public.teams where id = '${teamId}'`)

function teardown() {
  try {
    // The answer below tells the team's staff; those notices are about this run's fixture, so they go with it.
    sql(`delete from public.notifications where data ->> 'fixture_id' in (select id::text from public.fixtures where notes like 'S10 team %');
         delete from public.player_fixture_attendance where fixture_id in (select id from public.fixtures where notes like 'S10 team %');
         delete from public.fixtures where notes like 'S10 team %';`)
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

teardown()
teardownPeople()

const managerId = await person(TEAM_MANAGER, "Morgan", "Manager", "1984-02-09")
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${clubId}', '${managerId}', 'BASIC_USER', 'active');
     insert into testing.team_roles (membership_id, team_id, role_key)
       select id, '${teamId}', 'TEAM_MANAGER' from public.club_memberships where club_id = '${clubId}' and user_id = '${managerId}';`)

// A guardian whose child plays for that same team, so both journeys are about
// one team rather than two unrelated ones. The child's date of birth is the
// canonical one for the grade: the database refuses a placement outside it.
const guardianId = await person(GUARDIAN, "Gwen", "Guardian", "1983-06-14")
const childId = sql(`with p as (
    insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
    values ('Wren', 'Teamhome', internal.date_of_birth_in_age_grade('union', 'U12'), true, 'MALE') returning id)
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  select '${guardianId}', p.id, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD' from p returning player_id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${childId}', '${teamId}', 'active')`)
const childName = sql(`select first_name from public.players where id = '${childId}'`)

// WHAT IS NEXT, ON A REAL TEAM'S CALENDAR. Under 12 Boys keeps its own season: a fixed twelve days ahead
// landed on one of its matches (one match per day, refused) and sat behind the five things What's Next shows.
// So the fixture is on the first day from tomorrow on which the team holds no match -- asked with the team set
// the refusal itself uses.
const kickoff = sql(`select d::date::text from generate_series(current_date + 1, current_date + 60, interval '1 day') d
  where not exists (
    select 1 from public.fixtures f
     where f.kickoff_date = d::date and f.status <> 'Cancelled'
       and (internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id)
            || case when f.opponent_team_id is null then array[]::uuid[]
               else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end)
           && internal.fixture_side_effective_team_ids('${teamId}', null))
  order by d limit 1`)
const fixtureId = sql(`insert into public.fixtures
  (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source, notes)
  values ('${teamId}', 'Home', 'S10 Visitors ${TAG}', '${kickoff}', '11:00', 'Friendly', 'Booked', 'club_created', '${NOTE}')
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
    const answered = `select status from public.player_fixture_attendance
                      where fixture_id = '${fixtureId}' and player_id = '${childId}'`
    if (hasAnswer) {
      await answer.getByRole("button", { name: /^I'm Attending/ }).click()
      // Wait for the write, not for a duration: under a busy machine two seconds was sometimes not enough.
      for (let i = 0; i < 60 && sql(answered) !== "ATTENDING"; i++) await guardian.waitForTimeout(250)
    }
    const stored = sql(answered)
    record("B5 which writes the same canonical record every other surface writes",
      stored === "ATTENDING", stored || "(nothing stored)")

    await go(`/teams/${teamId}`, guardian)
    const pressed = await guardian
      .getByRole("group", { name: new RegExp(`${childName}.*${TAG}`, "i") })
      .first()
      .getByRole("button", { name: /^I'm Attending/ })
      .getAttribute("aria-pressed")
      .catch(() => null)
    record("B6 and after a reload the server's answer is what the team page shows", pressed === "true", String(pressed))
    await gctx.close()
  } else {
    record("B1 a guardian reaches the same team", false, "this run's child could not be placed on the team")
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
  teardownPeople()
}

record("cleanup: this run's fixture and every answer against it are gone",
  sql(`select count(*) from public.fixtures where notes like 'S10 team %'`) === "0" &&
    sql(`select count(*) from public.player_fixture_attendance where fixture_id = '${fixtureId}'`) === "0")
record("cleanup: this run's manager, guardian and child are gone, with every notice about the fixture",
  sql(`select count(*) from auth.users where email like '${PEOPLE}'`) === "0" &&
    sql(`select count(*) from public.players where id = '${childId}'`) === "0" &&
    sql(`select count(*) from public.notifications where data ->> 'fixture_id' = '${fixtureId}' or data ->> 'player_id' = '${childId}'`) === "0")

process.exit(summarise() ? 0 : 1)
