// ROLE-NEGATIVE SMOKE -- replayed server actions.
//
// Identity/Auth Slice 4 (Phase 2 AJ.1 browser 51-role-negative-smoke). A page that hides a control proves
// nothing: a server action is a public POST endpoint, and anyone who has seen its id and arguments can send it.
// So every action here is captured from the UI of the person who IS allowed to use it -- the real request the
// browser sends, with its action id, router state and serialised arguments -- and that exact request is then
// replayed from the signed-in sessions of people who are not allowed. Each refusal is judged in the database
// (nothing changed), not by what the page shows. Finally the authorised person replays the same captured request
// and the change lands, which proves the captured request was a working one and the refusals were real.
//
//   family consent           a parent's consent switch                       replayed as every other role
//   recording gender         a parent recording their child's gender          replayed as club and team staff
//   first-child decision     a Club Admin approving a parent-added child      replayed as the parent who asked
//   guardian removal         a Club Admin removing a guardian                 replayed as staff and the co-guardian
//   relationship hold        a Site Admin placing a hold (AN-7)               replayed as the club and the family
//
// Everything this run creates is removed at the end, including its audit, notification and security-event history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/51-role-negative-smoke.mjs

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP, launch, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
const API = status.API_URL
const ANON_KEY = status.ANON_KEY
const SERVICE_KEY = status.SERVICE_ROLE_KEY

const TAG = Date.now().toString(36).slice(-6)
const PREFIX = "uat.slice4neg"
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"
const people = {
  admin: { label: "Club Admin", email: `${PREFIX}.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  safeguarding: { label: "Safeguarding Officer", email: `${PREFIX}.safeguarding.${TAG}@ovalball.test`, first: "Sasha", surname: `Safeguarding ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `${PREFIX}.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  volunteer: { label: "Volunteer", email: `${PREFIX}.volunteer.${TAG}@ovalball.test`, first: "Val", surname: `Volunteer ${TAG}` },
  coach: { label: "Coach", email: `${PREFIX}.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  manager: { label: "Team Manager", email: `${PREFIX}.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  parent: { label: "Parent", email: `${PREFIX}.parent.${TAG}@ovalball.test`, first: "Pat", surname: `Parent ${TAG}` },
  partner: { label: "Co-guardian", email: `${PREFIX}.partner.${TAG}@ovalball.test`, first: "Robin", surname: `Partner ${TAG}` },
  otherParent: { label: "Parent B", email: `${PREFIX}.otherparent.${TAG}@ovalball.test`, first: "Blair", surname: `Otherparent ${TAG}` },
  // Slice 4B roster distinctions: Team Administration, staff of a DIFFERENT team, staff of a DIFFERENT club.
  teamAdmin: { label: "Team Administration", email: `${PREFIX}.teamadmin.${TAG}@ovalball.test`, first: "Taylor", surname: `Teamadmin ${TAG}` },
  otherTeamCoach: { label: "Coach of another team", email: `${PREFIX}.otherteamcoach.${TAG}@ovalball.test`, first: "Jo", surname: `Otherteamcoach ${TAG}` },
  farAdmin: { label: "Club Admin at another club", email: `${PREFIX}.faradmin.${TAG}@ovalball.test`, first: "Frankie", surname: `Faradmin ${TAG}` },
}

async function createIdentity(person) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${person.email}: HTTP ${res.status}`)
  person.id = body.id
  sql(`update public.profiles set first_name = '${person.first}', surname = '${person.surname}', setup_state = 'COMPLETE' where id = '${person.id}'`)
}

let cleaned = false
function cleanupTag(tag) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'uat-slice4neg-${tag}');
  v_far uuid := (select id from public.clubs where slug = 'uat-slice4negfar-${tag}');
  v_people uuid[] := array(select id from auth.users where email like '${PREFIX}.%.${tag}@ovalball.test');
  v_players uuid[] := array(select id from public.players where surname like '% ${tag}');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_players || coalesce(array[v_club], '{}')
    || array(select id from public.teams where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.guardians where player_id = any(v_players))
    || array(select id from public.guardian_link_requests where club_id = v_club or requested_by_user_id = any(v_people))
    || array(select id from public.guardian_player_permissions where player_id = any(v_players))
    || array(select id from public.player_team_memberships where player_id = any(v_players))
    || array(select id from public.fixtures where owning_team_id in (select id from public.teams where club_id in (v_club, v_far)))
    || array(select id from public.teams where club_id = v_far)
    || array(select id from public.club_memberships where club_id = v_far)
    || array(select id from public.role_assignments where club_id = v_far)
    || coalesce(array[v_far], '{}')
    || array(select id from public.club_directory where normalized_key in ('uat-slice4neg-${tag}', 'uat-slice4negfar-${tag}'));
  delete from public.notifications where user_id = any(v_people);
  delete from public.guardian_player_permissions where player_id = any(v_players);
  delete from public.guardian_link_requests where club_id = v_club or requested_by_user_id = any(v_people);
  delete from public.guardians where player_id = any(v_players);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id in (v_club, v_far));
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where club_id in (v_club, v_far);
  delete from public.club_memberships where club_id in (v_club, v_far);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.club_setup_state where club_id = v_far;
  delete from public.season_transitions where rollover_id in (select id from public.age_grade_rollovers where club_id in (v_club, v_far));
  delete from public.age_grade_rollover_group_flags where rollover_id in (select id from public.age_grade_rollovers where club_id in (v_club, v_far));
  delete from public.age_grade_rollover_player_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id in (v_club, v_far));
  delete from public.age_grade_rollover_planned_teams where rollover_id in (select id from public.age_grade_rollovers where club_id in (v_club, v_far));
  delete from public.age_grade_rollover_team_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id in (v_club, v_far));
  delete from public.age_grade_rollovers where club_id in (v_club, v_far);
  delete from public.club_documents where club_id in (v_club, v_far);
  delete from public.document_folders where club_id in (v_club, v_far);
  delete from public.team_season_identity where team_id in (select id from public.teams where club_id in (v_club, v_far));
  delete from public.teams where club_id in (v_club, v_far);
  delete from public.clubs where id in (v_club, v_far);
  delete from public.club_directory where normalized_key in ('uat-slice4neg-${tag}', 'uat-slice4negfar-${tag}');
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id in (v_club, v_far) or player_id = any(v_players)
    or metadata ->> 'membership_id' in (select unnest(v_records)::text) or metadata ->> 'relationship_id' in (select unnest(v_records)::text);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}
function cleanup() {
  if (cleaned) return
  cleaned = true
  cleanupTag(TAG)
  for (const person of Object.values(people)) {
    try {
      fs.unlinkSync(path.join(os.tmpdir(), "ovalball-uat-sessions", `${person.email.replace(/[^a-z0-9.@-]/gi, "_")}.json`))
    } catch {}
  }
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-slice4neg-${TAG}', 'uat-slice4negfar-${TAG}')) + (select count(*) from auth.users where email like '${PREFIX}.%.${TAG}@ovalball.test')
    + (select count(*) from public.players where surname like '% ${TAG}')
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like '${PREFIX}.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, player, relationship, notification, history row and cached session this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", () => {
  cleanup()
  process.exit(1)
})

async function open(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { status: response?.status() ?? 0, url: page.url() }
}

// Server responses are watched throughout; console noise from a deliberately aborted capture is not a defect.
const serverProblems = []
function watch(context, label) {
  context.on("page", (p) => {
    p.on("response", (r) => {
      if (r.status() >= 500) serverProblems.push(`${label} HTTP ${r.status()} ${r.url().replace(APP, "")}`)
    })
  })
  return context
}

/**
 * Let the authorised person's UI build and send the server action, and take the request off the wire before it
 * reaches the server: the action id, the router state and the serialised arguments, byte for byte.
 */
async function captureAction(page, trigger) {
  let captured = null
  const handler = async (route) => {
    const request = route.request()
    const headers = request.headers()
    if (!captured && request.method() === "POST" && headers["next-action"]) {
      captured = {
        url: request.url(),
        headers: Object.fromEntries(Object.entries(headers).filter(([k]) => ["next-action", "next-router-state-tree", "content-type", "accept"].includes(k))),
        body: request.postDataBuffer() ?? Buffer.alloc(0),
      }
      await route.abort()
      return
    }
    await route.continue()
  }
  await page.route("**/*", handler)
  await trigger()
  const start = Date.now()
  while (!captured && Date.now() - start < 30000) await new Promise((r) => setTimeout(r, 100))
  await page.unroute("**/*", handler)
  if (!captured) throw new Error("the authorised UI sent no server action")
  return captured
}

/** Send a captured server action from another person's signed-in session. */
async function replay(context, captured) {
  const res = await context.request.post(captured.url, {
    headers: { ...captured.headers, origin: new URL(APP).origin },
    data: captured.body,
    maxRedirects: 0,
    failOnStatusCode: false,
  })
  return { status: res.status(), text: await res.text() }
}

/**
 * Replay as every refused person; each must leave the database exactly as it was and get no server error. Then the
 * authorised person replays the same bytes and the change must land.
 */
async function negativeSmoke(id, title, captured, { refused, authorised, state, changed }) {
  const before = one(state)
  const leaks = []
  const statuses = []
  for (const person of refused) {
    const prior = one(state)
    const res = await replay(sessions[person].context, captured)
    statuses.push(`${people[person]?.label ?? person} ${res.status}`)
    const after = one(state)
    if (after !== prior) leaks.push(`${people[person]?.label ?? person} changed ${prior} -> ${after}`)
    if (res.status >= 500) leaks.push(`${people[person]?.label ?? person} HTTP ${res.status}`)
  }
  record(`${id}a ${title}: replayed as ${refused.map((p) => people[p]?.label ?? p).join(", ")} -- refused, nothing changed`, leaks.length === 0,
    leaks.length ? leaks.join(" | ") : statuses.join(", "))
  const res = await replay(sessions[authorised].context, captured)
  const after = await (async () => {
    const start = Date.now()
    let value = one(state)
    while (!changed(value) && Date.now() - start < 15000) {
      await new Promise((r) => setTimeout(r, 200))
      value = one(state)
    }
    return value
  })()
  record(`${id}b the same captured request from ${people[authorised]?.label ?? authorised} lands (the replay was a working request)`,
    res.status < 400 && changed(after), `HTTP ${res.status} state ${before} -> ${after}`)
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like '${PREFIX}.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.directory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four Negative RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4neg-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.directory}', 'uat-slice4neg-${TAG}', 'active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 12 Boys', 'uat-slice4neg-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.club}', '${people.safeguarding.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.secretary.id}', 'FIXTURE_SECRETARY', 'active'),
  ('${ids.club}', '${people.volunteer.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.coach.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.manager.id}', 'BASIC_USER', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.coach.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.manager.id}';
insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason, confirmation_state, confirmed_at)
  select '${people.safeguarding.id}', '${ids.club}', id, 'SAFEGUARDING_OFFICER', 'ACTIVE', 'SAFEGUARDING_APPOINTMENT', '${people.admin.id}', 'role-negative smoke', 'CONFIRMED', now()
  from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.safeguarding.id}';
insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason)
  select '${people.volunteer.id}', '${ids.club}', id, 'VOLUNTEER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', '${people.admin.id}', 'role-negative smoke'
  from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.volunteer.id}';`)
// Charlie: two guardians, placed on the team. Dana: the same parent, no gender recorded yet and no team place (a
// Boys or Girls place is never given without it; family authority does not need one). Olly: Parent B's child.
ids.charlie = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Charlie', 'Family ${TAG}', (current_date - interval '11 years 3 months')::date, 'MALE') returning id`)
ids.dana = one(`insert into public.players (first_name, surname, date_of_birth) values ('Dana', 'Family ${TAG}', (current_date - interval '8 years 1 month')::date) returning id`)
ids.olly = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Olly', 'Other ${TAG}', (current_date - interval '11 years 5 months')::date, 'MALE') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.charlie}', '${ids.team}', 'active'), ('${ids.olly}', '${ids.team}', 'active');
insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values
  ('${people.parent.id}', '${ids.charlie}', 'parent', 'active'), ('${people.partner.id}', '${ids.charlie}', 'parent', 'active'),
  ('${people.parent.id}', '${ids.dana}', 'parent', 'active'), ('${people.otherParent.id}', '${ids.olly}', 'parent', 'active');`)
// Slice 4B: a second team in the same club and a second club entirely, so "wrong team" and "wrong club"
// are real places a person holds authority, not just absent rows.
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 14 Boys', 'uat-slice4neg-u14-${TAG}', 'youth', 'U14', 'boys', 'union', true) returning id`)
ids.farDirectory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four Negative Far RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4negfar-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDirectory}', 'uat-slice4negfar-${TAG}', 'active') returning id`)
ids.farTeam = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.farClub}', 'Under 12 Boys', 'uat-slice4negfar-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.teamAdmin.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.otherTeamCoach.id}', 'BASIC_USER', 'active'),
  ('${ids.farClub}', '${people.farAdmin.id}', 'CLUB_ADMIN', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'team_admin' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.teamAdmin.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team2}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.otherTeamCoach.id}';`)

// Slice 4C: an archived fixture on the club's own team, so the Restore action has something real
// to act on. fixtures no longer accepts a browser INSERT, so this is seeded as the owner.
ids.fixture = one(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, archived_at, archival_reason)
  values ('${ids.team}', 'Home', 'Slice4C External RFC', current_date + 40, 'Booked', 'club_created', now(), 'seeded deleted for replay test') returning id`)

ids.parentOnCharlie = one(`select id from public.guardians where guardian_user_id = '${people.parent.id}' and player_id = '${ids.charlie}'`)
ids.partnerOnCharlie = one(`select id from public.guardians where guardian_user_id = '${people.partner.id}' and player_id = '${ids.charlie}'`)

const browser = await launch()
const sessions = {}
try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }
  {
    const context = watch(await newContext(browser), "Site Admin")
    const page = await context.newPage()
    await signIn(page, SITE_ADMIN)
    await context.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
    sessions.site = { context, page }
    people.site = { label: "Site Admin" }
  }
  const everyoneBut = (...allowed) => Object.keys(sessions).filter((k) => !allowed.includes(k))

  // -------------------------------------------------------------------------
  // N1. A parent's consent switch (family.permission.manage: the child's guardian only)
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.parent
    await open(page, `/parent/players/${ids.charlie}/access`)
    const firstSwitch = page.getByRole("switch").first()
    const captured = await captureAction(page, () => firstSwitch.click())
    // The co-guardian records their own decision through the same action, so they are not a refusal case here.
    await negativeSmoke("N1", "a parent's consent switch for their child", captured, {
      refused: everyoneBut("parent", "partner"),
      authorised: "parent",
      state: `select count(*) || ':' || coalesce(string_agg(guardian_user_id::text || permission_key || granted::text, ',' order by permission_key, guardian_user_id), '') from public.guardian_player_permissions where player_id = '${ids.charlie}'`,
      changed: (v) => !v.startsWith("0:"),
    })
  }

  // -------------------------------------------------------------------------
  // N2. Recording a child's gender (player.profile.edit_protected: the guardian; never staff) -- for a child with no
  //     team place, so the capture itself proves the guardian is offered the form without one
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.parent
    await open(page, `/parent/players/${ids.dana}/details`)
    const girls = page.getByRole("radio", { name: "Girls" })
    if (!(await girls.count())) throw new Error(`no gender form for the parent: ${(await page.locator("main").innerText()).slice(0, 300)}`)
    await girls.check()
    const captured = await captureAction(page, () => page.getByRole("button", { name: /Save changes/i }).click())
    await negativeSmoke("N2", "recording a child's gender", captured, {
      refused: everyoneBut("parent", "site"),
      authorised: "parent",
      state: `select coalesce(playing_pathway, 'none') from public.players where id = '${ids.dana}'`,
      changed: (v) => v === "FEMALE",
    })
  }

  // -------------------------------------------------------------------------
  // N3. Deciding a parent-added child (family.relationship.approve; the requester never decides)
  // -------------------------------------------------------------------------
  {
    const parentToken = await accessTokenOf(sessions.parent.context)
    const added = await fetch(`${API}/rest/v1/rpc/add_child_for_guardian`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${parentToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_first_name: "Ellis", p_surname: `Family ${TAG}`, p_date_of_birth: one(`select (current_date - interval '9 years 2 months')::date`), p_club_id: ids.club, p_rugby_code: "union", p_playing_pathway: "MALE" }),
    })
    if (!added.ok) throw new Error(`could not add the child as the parent: HTTP ${added.status} ${await added.text()}`)
    ids.ellis = one(`select id from public.players where first_name = 'Ellis' and surname = 'Family ${TAG}'`)
    const { page } = sessions.admin
    await open(page, "/guardian-requests")
    const card = page.locator("li", { hasText: `Ellis Family ${TAG}` })
    const captured = await captureAction(page, () => card.getByRole("button", { name: "Approve" }).click())
    await negativeSmoke("N3", "approving a child a parent added", captured, {
      refused: ["parent", "partner", "otherParent", "coach", "manager", "secretary", "volunteer", "safeguarding"],
      authorised: "admin",
      state: `select state from public.guardians where player_id = '${ids.ellis}' and guardian_user_id = '${people.parent.id}'`,
      changed: (v) => v === "ACTIVE",
    })
  }

  // -------------------------------------------------------------------------
  // N4. A club removing a guardian (family.relationship.remove at the child's club)
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.admin
    await open(page, "/club/settings/guardians")
    const row = page.locator("li", { hasText: people.partner.email }).filter({ hasNot: page.locator("li") })
    await row.getByRole("button", { name: "Remove" }).click()
    await page.getByLabel("Reason").fill("Relationship recorded in error")
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Remove Guardian" }).click())
    await page.keyboard.press("Escape").catch(() => {})
    await negativeSmoke("N4", "a club removing a child's guardian", captured, {
      refused: ["parent", "otherParent", "coach", "manager", "secretary", "volunteer", "safeguarding"],
      authorised: "admin",
      state: `select state from public.guardians where id = '${ids.partnerOnCharlie}'`,
      changed: (v) => v === "REVOKED",
    })
  }

  // -------------------------------------------------------------------------
  // N5. A hold on a relationship (site.family.manage, AN-7: Ovalball's, never the club's or the family's)
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.site
    await open(page, `/admin/users/${people.parent.id}`)
    const row = page.locator("section", { hasText: "Family Relationships" }).locator("li", { hasText: "Charlie" })
    await row.getByRole("button", { name: "Put on Hold" }).click()
    await row.getByLabel("Reason").fill("Pause requested pending review")
    const captured = await captureAction(page, () => row.getByRole("button", { name: "Put on Hold" }).click())
    await negativeSmoke("N5", "placing a hold on a guardian relationship", captured, {
      refused: ["admin", "safeguarding", "parent", "partner", "otherParent", "coach", "manager", "secretary", "volunteer"],
      authorised: "site",
      state: `select state from public.guardians where id = '${ids.parentOnCharlie}'`,
      changed: (v) => v === "SUSPENDED",
    })
  }

  // -------------------------------------------------------------------------
  // N6. Archiving a player's place in a team (Slice 4B: team.roster.manage).
  //
  // Captured from the Team Manager, who holds team.roster.manage at THIS team, and replayed from everyone
  // else who might plausibly think they hold it: the Coach of the same team (who may read a roster and not
  // change it), the Coach of ANOTHER team in the same club, the Club Admin of ANOTHER club, the Fixtures
  // Secretary (AI #70), the Safeguarding Officer, a Volunteer, an ordinary member and the family. Each
  // refusal is judged on the row's state, not on what the page draws.
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.manager
    await open(page, `/teams/${ids.team}`)
    // Team People opens on Coaches; the roster is behind the Players tab.
    const landed = page.url()
    const buttons = (await page.locator("button").allTextContents()).map((t) => t.trim()).filter(Boolean)
    record("N6c the Team Manager reaches the team page and sees the roster tab", /\/teams\/[0-9a-f-]{36}/.test(landed),
      `url=${landed} buttons=${buttons.slice(0, 10).join("/") || "(none)"}`)
    // the tab labels carry their counts ("Players2"), so filter on the text rather than the whole name
    await page.locator("button").filter({ hasText: /^Players/ }).first().click({ timeout: 20000 })
    const row = page.locator("li", { hasText: "Charlie" }).first()
    await row.getByRole("button", { name: "Archive" }).waitFor({ timeout: 30000 })
    const captured = await captureAction(page, () => row.getByRole("button", { name: "Archive" }).click())
    await negativeSmoke("N6", "archiving a player's place in a team", captured, {
      refused: ["coach", "otherTeamCoach", "farAdmin", "secretary", "safeguarding", "volunteer", "parent", "partner", "otherParent"],
      authorised: "manager",
      state: `select state from public.player_team_memberships where player_id = '${ids.charlie}' and team_id = '${ids.team}'`,
      changed: (v) => v === "ENDED",
    })
  }

  // -------------------------------------------------------------------------
  // N7. Restoring a deleted fixture (Slice 4C: fixture.fixture.archive).
  //
  // Captured from the Club Admin, who holds it club-wide, and replayed from everyone who does not.
  // Phase 2 J.6 line 460 gives this key to CA, FS and TM, so the Coach, the Fixtures Secretary's
  // peers without it, the family and unrelated staff must all be refused. The refusal is judged on
  // the fixture's archived_at, not on what the page draws.
  // -------------------------------------------------------------------------
  {
    const { page } = sessions.admin
    await open(page, "/club/calendar/deleted-events")
    const row = page.locator("li, tr", { hasText: "Slice4C External RFC" }).first()
    await row.getByRole("button", { name: /^Restor/ }).waitFor({ timeout: 30000 })
    const captured = await captureAction(page, () => row.getByRole("button", { name: /^Restor/ }).click())
    await negativeSmoke("N7", "restoring a deleted fixture", captured, {
      refused: ["coach", "otherTeamCoach", "farAdmin", "safeguarding", "volunteer", "parent", "partner", "otherParent"],
      authorised: "admin",
      state: `select coalesce(archived_at::text, 'RESTORED') from public.fixtures where id = '${ids.fixture}'`,
      changed: (v) => v === "RESTORED",
    })
  }

  // N8. Reaching the tournament builder (Slice 4D: tournament.tournament.manage).
  //
  // This is a NO-CHANGE guard, and it is worth saying so rather than dressing it up as one of the
  // slice's intended changes. 4D swapped this route's gate from the deprecated calendar.manage key
  // onto tournament.tournament.manage (design J.8 line 490). Both are club-scope for the roles that
  // matter -- calendar.event.manage grants at club to CA and FS only, and a Team Manager holds it
  // at TEAM scope -- so the set of people who reach this page is identical before and after. The
  // test exists to keep it identical: a later widening of either key, or a slip back to a
  // team-scope check, would show up here.
  //
  // 4D's real tournament change is at the RPC, where a Team Manager who could once manage a
  // solo-entered occasion no longer can. That is not visible from this route and is covered by
  // suite 54 (C1).
  // -------------------------------------------------------------------------
  {
    const reached = async (key) => {
      const { url } = await open(sessions[key].page, "/tournaments/new")
      return /\/tournaments\/new/.test(url)
    }
    const allowed = []
    for (const key of ["admin", "secretary"]) if (await reached(key)) allowed.push(key)
    record("N8a the Club Admin and the Fixtures Secretary reach the tournament builder",
      allowed.length === 2, `reached: ${allowed.join(", ") || "none"}`)
    // The other club's Club Admin is deliberately NOT in this list. The route resolves the
    // viewer's OWN club context and asks for tournament.tournament.manage there, so a Club Admin
    // arrives at their own club's builder -- which is one identity holding authority in the scope
    // it actually has, not a leak into this club. Suite 54 covers the cross-club refusal, which is
    // where it is observable: the RPC names the club and refuses.
    const leaked = []
    for (const key of ["manager", "teamAdmin", "coach", "otherTeamCoach", "volunteer", "parent"]) {
      if (await reached(key)) leaked.push(people[key]?.label ?? key)
    }
    record("N8b and a Team Manager, Team Admin, Coach, Volunteer or parent does not -- unchanged by 4D",
      leaked.length === 0, leaked.length ? `reached: ${leaked.join(", ")}` : "all redirected")
  }

  // N9. Reaching the club settings venues surface (Slice 4E: venue.venue.manage).
  //
  // The U section's "venues RLS/RPC mismatch" closure, seen from the UI. Before 4E the venue RPCs
  // asked internal.is_club_admin while the venue RLS asked a capability CA *and* FS hold, so a
  // Fixtures Secretary could change a venue row one way and was refused the other. J.9 line 500
  // makes venue.venue.manage CA and FS, and this asserts both halves of that from the product: the
  // Secretary arrives, and the people J.9 leaves out do not.
  // -------------------------------------------------------------------------
  {
    const reached = async (key) => {
      const { url } = await open(sessions[key].page, "/club/settings")
      return /\/club\/settings/.test(url)
    }
    const allowed = []
    for (const key of ["admin", "secretary"]) if (await reached(key)) allowed.push(key)
    record("N9a the Club Admin and the Fixtures Secretary reach club settings", allowed.length === 2,
      `reached: ${allowed.join(", ") || "none"}`)
    const leaked = []
    for (const key of ["manager", "teamAdmin", "coach", "volunteer", "parent"]) {
      if (await reached(key)) leaked.push(people[key]?.label ?? key)
    }
    record("N9b and a Team Manager, Team Admin, Coach, Volunteer or parent does not", leaked.length === 0,
      leaked.length ? `reached: ${leaked.join(", ")}` : "all redirected")
  }

  // N10. Blocking someone from a club's conversations (Slice 4F: messaging.block.manage).
  //
  // J.10 line 518 makes blocking Club Admin and Safeguarding Officer, and deliberately NOT the
  // Fixtures Secretary -- blocking is moderation, not fixtures. That is one of 4F's two intended
  // changes to who may do something, so it is checked here at the RPC, which is where the boundary
  // actually is: the Messenger hides the control, but a hidden control has never refused anybody.
  // Each person sends the real request from their own signed-in session, and the verdict is the
  // block row in the database rather than what any page said.
  // -------------------------------------------------------------------------
  {
    const blockAs = async (key, target) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/block_user_from_club_messages`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_club_id: ids.club, p_user_id: people[target].id, p_reason: `slice4f replay ${TAG}` }),
      })
      return res.ok
    }
    const blocked = (target) =>
      one(`select count(*) from public.club_message_blocks where club_id = '${ids.club}' and blocked_user_id = '${people[target].id}' and lifted_at is null`) !== "0"

    const leaked = []
    for (const key of ["secretary", "manager", "teamAdmin", "coach", "volunteer", "parent"]) {
      await blockAs(key, "otherParent")
      if (blocked("otherParent")) leaked.push(people[key]?.label ?? key)
      sql(`delete from public.club_message_blocks where club_id = '${ids.club}' and blocked_user_id = '${people.otherParent.id}'`)
    }
    record("N10a INTENDED CHANGE: the Fixtures Secretary can no longer block, and nor can team staff or a parent",
      leaked.length === 0, leaked.length ? `blocked anyway: ${leaked.join(", ")}` : "every replay refused")

    const allowed = []
    for (const key of ["admin", "safeguarding"]) {
      await blockAs(key, "otherParent")
      if (blocked("otherParent")) allowed.push(people[key]?.label ?? key)
      sql(`delete from public.club_message_blocks where club_id = '${ids.club}' and blocked_user_id = '${people.otherParent.id}'`)
    }
    record("N10b INTENDED CHANGE: the Club Admin still can, and so now can the Safeguarding Officer",
      allowed.length === 2, `landed: ${allowed.join(", ") || "none"}`)
  }

  // N11. Reporting a message (Slice 4F section T: one row per report, never an overwrite).
  //
  // The defect this closed is invisible from a single report: the old shape wrote four columns onto
  // the message row, so a second person reporting the same message replaced the first person's
  // report -- and the case that needs a second report most is the one where the first was not acted
  // on. Two different people report the same message from their own sessions, and both reports have
  // to survive as their own rows.
  // -------------------------------------------------------------------------
  {
    const reportAs = async (key, messageId, reason) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/report_message`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_message_id: messageId, p_reason: reason }),
      })
      return res.ok
    }
    const fixtureId = one(`select id from public.fixtures where owning_team_id = '${ids.team}' and raw_opposition_text = 'Slice4C External RFC' limit 1`)
    const conversationId = one(`select conversation_id from public.fixtures where id = '${fixtureId}'`)
    const messageId = one(`insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind)
      values ('${fixtureId}', '${conversationId}', '${people.admin.id}', 'slice4f reportable ${TAG}', 'message') returning id`)
    const first = await reportAs("coach", messageId, `first report ${TAG}`)
    const second = await reportAs("manager", messageId, `second report ${TAG}`)
    const rows = one(`select count(*) from public.message_reports where message_id = '${messageId}'`)
    record("N11a two people reporting the same message leave two reports, not one overwriting the other",
      first && second && rows === "2", `accepted=${first}/${second} rows=${rows}`)
    const reporters = one(`select count(distinct reported_by) from public.message_reports where message_id = '${messageId}'`)
    record("N11b and each report still names the person who made it", reporters === "2", `distinct reporters: ${reporters}`)
    sql(`delete from public.message_reports where message_id = '${messageId}'`)
    sql(`delete from public.fixture_messages where id = '${messageId}'`)
  }

  // N12. Appointing a Safeguarding Officer (Slice 4G: AN-6).
  //
  // The decision AN-6 exists for is that a club cannot appoint its own Safeguarding Officer end to
  // end. Before 4G it could: nomination plus the nominee's own acceptance was treated as the
  // confirmation. So this checks the two halves that matter from the product, at the RPC, which is
  // where the boundary is: the nomination grants nothing, and the people who should not be able to
  // finish it cannot -- including the Club Admin who started it.
  // -------------------------------------------------------------------------
  {
    const rpcAs = async (key, fn, body) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return { ok: res.ok, body: await res.text() }
    }

    const nominated = await rpcAs("admin", "nominate_club_safeguarding_officer", {
      p_club_id: ids.club, p_user_id: people.volunteer.id, p_officer_type: "deputy", p_reason: `slice4g replay ${TAG}`,
    })
    const assignmentId = one(`select id from public.role_assignments
      where club_id = '${ids.club}' and user_id = '${people.volunteer.id}' and role_key = 'SAFEGUARDING_OFFICER' and state = 'ACTIVE'`)
    const pending = one(`select coalesce(confirmation_state,'-') from public.role_assignments where id = '${assignmentId}'`)
    record("N12a a Club Admin nominates an existing member, and it lands PENDING_CONFIRMATION",
      nominated.ok && pending === "PENDING_CONFIRMATION", `ok=${nominated.ok} state=${pending} ${nominated.body.slice(0, 160)}`)

    // The nomination must grant nothing. Asked of the database, for the capability that matters most.
    const holds = one(`select (internal.capability_decision('${people.volunteer.id}','safeguarding.conversation.handle','club','${ids.club}',null,null,false,false)).allowed`)
    record("N12b and it grants no Safeguarding Officer authority at all", holds === "f", `handle=${holds}`)

    const leaked = []
    for (const key of ["admin", "safeguarding", "secretary", "manager", "teamAdmin", "coach", "volunteer", "parent"]) {
      const r = await rpcAs(key, "confirm_safeguarding_officer", { p_assignment_id: assignmentId, p_reason: `replayed by ${key}` })
      if (one(`select coalesce(confirmation_state,'-') from public.role_assignments where id = '${assignmentId}'`) === "CONFIRMED") {
        leaked.push(people[key]?.label ?? key)
        sql(`update public.role_assignments set confirmation_state='PENDING_CONFIRMATION', confirmed_by=null, confirmed_at=null where id='${assignmentId}'`)
      }
      void r
    }
    record("N12c AN-6: nobody in the club can confirm it -- not even the Club Admin who nominated them",
      leaked.length === 0, leaked.length ? `confirmed anyway: ${leaked.join(", ")}` : "every replay refused")

    const bySite = await rpcAs("site", "confirm_safeguarding_officer", { p_assignment_id: assignmentId, p_reason: `slice4g site confirm ${TAG}` })
    const confirmed = one(`select coalesce(confirmation_state,'-') from public.role_assignments where id = '${assignmentId}'`)
    record("N12d while Ovalball can, through the canonical site capability",
      bySite.ok && confirmed === "CONFIRMED", `ok=${bySite.ok} state=${confirmed} ${bySite.body.slice(0, 160)}`)
    const nowHolds = one(`select (internal.capability_decision('${people.volunteer.id}','safeguarding.conversation.handle','club','${ids.club}',null,null,false,false)).allowed`)
    record("N12e and only then does the role grant anything", nowHolds === "t", `handle=${nowHolds}`)

    sql(`delete from public.notifications where data->>'assignment_id' = '${assignmentId}'`)
    sql(`delete from public.role_assignments where id = '${assignmentId}'`)
  }

  // N13. Exporting a club's personal data (Slice 4H: section S).
  //
  // Section S's last prohibition is "Export personal data without R and event". The club
  // player-movement export -- named children, the teams they moved between, their dispensation status
  // and the governing-body reference the club recorded -- asked a fixtures capability and emitted
  // nothing, so nobody could afterwards tell that a club's roll of children had been downloaded, or
  // why. record_club_export is the gate, and this replays it from every session.
  // -------------------------------------------------------------------------
  {
    const exportAs = async (key, reason) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/record_club_export`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_club_id: ids.club, p_kind: "player_movements", p_reason: reason, p_row_count: 3 }),
      })
      return res.ok
    }
    const before = one(`select count(*) from public.security_events where event_type = 'export.generated' and club_id = '${ids.club}'`)
    const leaked = []
    for (const key of ["secretary", "manager", "teamAdmin", "coach", "volunteer", "parent", "safeguarding"]) {
      if (await exportAs(key, `replayed by ${key} ${TAG}`)) leaked.push(people[key]?.label ?? key)
    }
    record("N13a only club.reporting.export may export -- not the secretary, team staff, a parent or the officer",
      leaked.length === 0, leaked.length ? `exported anyway: ${leaked.join(", ")}` : "every replay refused")

    const noReason = await exportAs("admin", "")
    record("N13b and the Club Admin cannot export without a reason", noReason === false, `ok=${noReason}`)

    const ok = await exportAs("admin", `slice4h export ${TAG}`)
    const after = one(`select count(*) from public.security_events where event_type = 'export.generated' and club_id = '${ids.club}'`)
    record("N13c while the Club Admin may, with a reason, and it leaves exactly one event",
      ok && Number(after) === Number(before) + 1, `ok=${ok} events ${before} -> ${after}`)
    const recorded = one(`select reason from public.security_events where event_type = 'export.generated' and club_id = '${ids.club}' order by occurred_at desc limit 1`)
    record("N13d carrying the reason that was given", recorded === `slice4h export ${TAG}`, `reason=${recorded}`)
    // Not deleted here. security_events is append-only (Phase 2 Y.14/Y.15) and refuses a delete
    // outright -- which is the right answer, and this run's own cleanup removes it under the
    // maintenance flag along with everything else it created.
  }

  // N14. A club's money (Slice 4H: J.13).
  //
  // J.13 leaves the site-master column EMPTY for every key that acts on a club's money and says why
  // in the table itself: "Site Admins never act on club payments". Twenty-six finance functions
  // opened with a bare is_site_admin() before this slice, so every site-admin profile could configure
  // a club's subscription. Checked here from the real Site Admin session.
  // -------------------------------------------------------------------------
  {
    const configureAs = async (key) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/configure_subscription_programme`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_club_id: ids.club, p_enabled: true, p_collection_day: 1, p_platform_fee_mode: "CLUB_PAYS", p_first_payment_policy: "IMMEDIATE" }),
      })
      return { ok: res.ok, body: (await res.text()).slice(0, 140) }
    }
    const bySite = await configureAs("site")
    record("N14a INTENDED CHANGE: a Full Site Admin cannot configure this club's subscription (J.13)",
      !bySite.ok && /not authoriz|not authoris/i.test(bySite.body), bySite.body)
    const bySecretary = await configureAs("secretary")
    record("N14b nor the Fixtures Secretary -- finance is the Club Admin's alone", !bySecretary.ok, bySecretary.body)
  }

  // -------------------------------------------------------------------------
  // N15. Preparing versus applying a season handover (Slice 4I: section U).
  //
  // A season handover moves every age group in a club up a year, and there is no undo. Section U and
  // J.5 line 427 split it: the Fixtures Secretary prepares it, the Club Admin applies it. Before this
  // slice every handover RPC asked one undivided "is this person a club admin?" question, so the
  // split existed only on paper and the Secretary held all of it. The same function also carries the
  // fold and graduate decisions behind their own lifecycle gates, which preparation must not reach.
  // -------------------------------------------------------------------------
  {
    const call = async (key, name, args) => {
      const token = await accessTokenOf(sessions[key].context)
      const res = await fetch(`${API}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
      return { ok: res.ok, body: (await res.text()).slice(0, 160) }
    }
    const season = one(`select id from public.seasons where rugby_code = 'union' and not is_regression_fixture
                        and starts_on > current_date order by starts_on limit 1`)
    const generated = await call("admin", "generate_rollover_proposal", { p_club_id: ids.club, p_rugby_code: "union", p_to_season_id: season })
    const rollover = generated.body.replace(/"/g, "").trim()
    record("N15a the Club Admin generates a season handover for their club", generated.ok && /^[0-9a-f-]{36}$/.test(rollover), generated.body)
    const proposal = one(`select id from public.age_grade_rollover_team_proposals where rollover_id = '${rollover}' limit 1`)

    const prepared = await call("secretary", "confirm_rollover_team_proposal", { p_proposal_id: proposal, p_action: "confirm" })
    record("N15b the Fixtures Secretary may PREPARE it -- confirming a progression is theirs (J.5 line 426)", prepared.ok, prepared.body)

    const graduated = await call("secretary", "confirm_rollover_team_proposal", { p_proposal_id: proposal, p_action: "graduate" })
    record("N15c but folding or graduating through it keeps its own lifecycle gate", !graduated.ok, graduated.body)

    const appliedBySecretary = await call("secretary", "apply_season_handover", { p_rollover_id: rollover })
    record("N15d INTENDED CHANGE: the Fixtures Secretary cannot APPLY it (section U)", !appliedBySecretary.ok, appliedBySecretary.body)
    const appliedByCoach = await call("coach", "apply_season_handover", { p_rollover_id: rollover })
    record("N15e nor a Coach", !appliedByCoach.ok, appliedByCoach.body)
    const appliedByFar = await call("farAdmin", "apply_season_handover", { p_rollover_id: rollover })
    record("N15f nor another club's Club Admin, naming this handover's id", !appliedByFar.ok, appliedByFar.body)
    record("N15g and nothing moved: the club's side is still U12 and the handover is unapplied",
      one(`select age_group from public.teams where id = '${ids.team}'`) === "U12"
      && one(`select coalesce(applied_at::text,'-') from public.age_grade_rollovers where id = '${rollover}'`) === "-")
  }

  record("I1 no server error on any page or replay", serverProblems.length === 0, serverProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  cleanup()
  summarise()
}

async function accessTokenOf(context) {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
  cookies.sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
  const joined = cookies.map((c) => c.value).join("")
  const raw = joined.startsWith("base64-") ? Buffer.from(joined.slice(7), "base64").toString("utf8") : decodeURIComponent(joined)
  return JSON.parse(raw).access_token
}
