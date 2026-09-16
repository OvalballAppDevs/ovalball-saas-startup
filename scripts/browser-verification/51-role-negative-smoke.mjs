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
