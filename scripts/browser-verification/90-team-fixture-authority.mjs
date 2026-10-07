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
// end, by id, and the suite asserts that none of its own rows survive. Beyond
// its own two people (removed the same way) it writes nothing else: it
// deliberately proves the CONTROL appears rather than creating fixtures, because
// a fixture is domain state in a shared world and the control is what the
// correction was about.
// =====================================================================

import { execFileSync } from "node:child_process"
import fs from "node:fs"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise, enrolAuthenticator } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)

// THIS RUN'S OWN PEOPLE. A team decision is a capability override, and an override now needs a recent
// authenticator code (internal.require_recent_aal2) -- so the acting Club Admin enrols one, through the
// product's own setup. That is never done to a persistent persona, and uat.team.manager has a password a
// person set and now runs three teams, so both the admin and the subject are made for this run.
const PEOPLE = "uat.s90.%@ovalball.test"
/** Club Admin of the AUTOMATED test club (not the persistent manual-review world), for this run only. */
const CLUB_ADMIN = `uat.s90.admin.${TAG}@ovalball.test`
/** Team Manager of that club's Under 12 Boys -- the person a decision is taken about. */
const SUBJECT = `uat.s90.manager.${TAG}@ovalball.test`

const DEV_INSTRUMENTATION = /Failed to execute 'measure' on 'Performance'/

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

/** An adult who signs in with the shared UAT password. Team Manager needs a date of birth showing that. */
async function person(email, first, surname) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: env("UAT_BROWSER_PASSWORD"), email_confirm: true }),
  })
  const id = (await res.json()).id
  if (!id) throw new Error(`could not create ${email}: HTTP ${res.status}`)
  sql(`update public.profiles set first_name = '${first}', surname = '${surname}', date_of_birth = '1984-02-09', setup_state = 'COMPLETE' where id = '${id}'`)
  return id
}

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                    where d.normalized_key = 'ovalball-uat-rufc'`)
const team = (age) =>
  sql(`select id from public.teams where club_id = '${clubId}' and age_group = '${age}' and gender = 'boys' and squad_designation is null`)
const teamId = team("U12")
const otherTeamId = team("U16")

/**
 * This run's people and the history that names them (which only an operator session may remove).
 * `decided` names decisions already removed by id, so their history goes too.
 */
function teardownPeople(decided = []) {
  sql(`do $$
  declare
    v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
    v_records uuid[];
  begin
    perform set_config('ovalball.maintenance', 'on', true);
    v_records := v_people || array[${decided.map((id) => `'${id}'`).join(", ")}]::uuid[]
      || array(select id from public.capability_overrides where user_id = any(v_people) or granted_by = any(v_people) or revoked_by = any(v_people))
      || array(select id from public.club_memberships where user_id = any(v_people))
      || array(select id from public.role_assignments where user_id = any(v_people));
    delete from public.notifications where user_id = any(v_people);
    delete from public.capability_overrides where id = any(v_records);
    delete from public.role_assignments where user_id = any(v_people);
    delete from public.club_memberships where user_id = any(v_people);
    delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
    delete from public.profiles where id = any(v_people);
    delete from auth.users where id = any(v_people);
    delete from public.audit_log where record_id = any(v_records);
    delete from public.security_events where actor_user_id = any(v_people) or subject_user_id = any(v_people);
  end $$;`)
}

teardownPeople()
const adminId = await person(CLUB_ADMIN, "Ada", "Admin")
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${clubId}', '${adminId}', 'CLUB_ADMIN', 'active')`)
const subjectId = await person(SUBJECT, "Morgan", "Manager")
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${clubId}', '${subjectId}', 'BASIC_USER', 'active');
     insert into testing.team_roles (membership_id, team_id, role_key)
       select id, '${teamId}', 'TEAM_MANAGER' from public.club_memberships where club_id = '${clubId}' and user_id = '${subjectId}';`)

/**
 * Exactly what this run recorded, so cleanup removes that and nothing else.
 *
 * The reason is now the person's own -- the screen asks for it -- so this run types its own, and the query is
 * pinned to this run's own subject, this team and team scope. A looser match would also match a real
 * person's decision taken while this suite was running, and cleanup would delete it. A cleanup whose blast
 * radius is wider than what the run created is the wrong cleanup.
 */
const TEAM_DECISION_REASON = `Suite 90 ${TAG}: not adding fixtures for this team for now`
const ownOverrides = new Set()

function noteOwnOverrides() {
  const ids = sql(
    `select id from public.capability_overrides
      where user_id = '${subjectId}' and scope_type = 'team' and team_id = '${teamId}'`
  )
  for (const id of ids.split("\n").filter(Boolean)) ownOverrides.add(id)
}

/** The live decision about this run's subject, as the database holds it. */
const deniedRows = () =>
  sql(`select count(*) from public.capability_overrides where user_id = '${subjectId}'
        and capability_key = 'fixture.fixture.create' and scope_type = 'team'
        and team_id = '${teamId}' and effect = 'deny' and status = 'active'`)

/** Waits for the server's answer rather than for a fixed time. */
async function waitForSql(read, expected, timeoutMs = 20000) {
  const started = Date.now()
  let last = ""
  while (Date.now() - started < timeoutMs) {
    last = read()
    if (last === expected) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  return last
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

  // The permissions inside a person's row. Collapsed until opened, as on the club screen. The team has other
  // staff too, so the subject's row is found by their address rather than by being the first Team Manager.
  const subjectRow = admin.locator("button").filter({ hasText: SUBJECT }).first()
  const rowFound = (await subjectRow.count()) > 0
  record("A5 the team's own staff are the people listed",
    rowFound && /Team Manager/.test(await subjectRow.innerText()), rowFound ? (await subjectRow.innerText()).replace(/\s+/g, " ") : "(not listed)")
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

  // The team context is named rather than left to whichever team role the database returns first.
  await subjCtx.addCookies([{ name: "ovalball_ctx", value: `team:${teamId}`, url: APP }])

  await subject.goto(`${APP}/agenda`, { waitUntil: "domcontentloaded", timeout: 75000 })
  const before = await subject.locator("body").innerText()
  record("B1 a team manager's fixtures page offers Add Fixture to start with", /Add Fixture/.test(before))

  // A decision needs an authenticator code from the last ten minutes, so the Club Admin sets one up through
  // the product's own enrolment (which verifies a code) and comes back to the same team and person.
  await enrolAuthenticator(admin, { email: CLUB_ADMIN, sql })
  await admin.goto(`${APP}/club/permissions?team=${teamId}`, { waitUntil: "domcontentloaded", timeout: 75000 })
  await subjectRow.waitFor({ state: "visible", timeout: 30000 })
  await subjectRow.click()

  // The Club Admin withholds it FOR THIS TEAM, through the screen's own control. A withhold opens the
  // decision's reason form (permissions-panel.tsx), and nothing is recorded until it is submitted.
  const withhold = admin
    .locator("li", { hasText: "Add Fixtures" })
    .locator('button:text-is("Withhold")')
    .first()
  const canWithhold = (await withhold.count()) > 0
  record("B2 the Club Admin has a control to withhold it for this team", canWithhold)
  if (canWithhold) {
    await withhold.click()
    const reason = admin.locator(`#permission-reason-${subjectId}`)
    await reason.waitFor({ state: "visible", timeout: 15000 })
    await reason.fill(TEAM_DECISION_REASON)
    await admin.locator("form").getByRole("button", { name: "Withhold" }).click()
    const denied = await waitForSql(deniedRows, "1")
    noteOwnOverrides()
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

    // Put it back through the screen, so the restore is proved as well as Withhold. The control that was
    // Reset is now Use Role Default, and it asks for an (optional) reason in the same form.
    const reset = admin.locator("li", { hasText: "Add Fixtures" }).locator('button:text-is("Use Role Default")').first()
    if ((await reset.count()) > 0) {
      await reset.click()
      await admin.locator(`#permission-reason-${subjectId}`).fill(`Suite 90 ${TAG}: back to the role default`)
      await admin.locator("form").getByRole("button", { name: "Use Role Default" }).click()
      await waitForSql(deniedRows, "0")
    }
    await subject.reload({ waitUntil: "domcontentloaded", timeout: 75000 })
    const restored = await subject.locator("body").innerText()
    record("B5 and Use Role Default gives it back, in the same session", /Add Fixture/.test(restored))
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
      and scope_type = 'team' and team_id = '${teamId}'`
  )
  record(`cleanup: this run left nothing behind (removed ${removed})`, residue === "0", `residue: ${residue}`)
  await browser.close()
  teardownPeople([...ownOverrides])
}

record("cleanup: this run's Club Admin and Team Manager are gone, with their memberships, roles and authenticator",
  sql(`select count(*) from auth.users where email like '${PEOPLE}'`) === "0" &&
    sql(`select count(*) from auth.mfa_factors where user_id in ('${adminId}', '${subjectId}')`) === "0")

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
