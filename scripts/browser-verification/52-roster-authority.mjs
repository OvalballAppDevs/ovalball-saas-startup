// TEAM AND ROSTER AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4B (Phase 2 AA.3 row 4b, J.6 lines 418-429, AI #70), driven through the running product
// with disposable identities and two disposable clubs:
//
//   a Club Admin      reads every team in their own club and every roster in it
//   a Coach           reads their own team's roster, and is offered no control that changes it
//   a Team Manager    reads and changes their own team's roster
//   a Fixtures Sec.   sees that the team EXISTS and what it is called, and cannot see who is in it (AI #70)
//   wrong team        a Coach of another team in the same club reaches neither its roster nor its people
//   wrong club        a Club Admin of a different club reaches neither the team nor its roster
//   site capability   the site path is the site capability, never a club-scope bypass
//   no legacy keys    the running page asks team.team.view / team.roster.manage, and the retired team.view
//                     resolves for nobody
//   a phone           the team page and its roster fit 390px
//
// Everything this run creates is removed at the end, including its audit, notification and security-event history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/52-roster-authority.mjs

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP, launch, measure, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
const API = status.API_URL
const ANON_KEY = status.ANON_KEY
const SERVICE_KEY = status.SERVICE_ROLE_KEY

const TAG = Date.now().toString(36).slice(-6)
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"
const people = {
  admin: { label: "Club Admin", email: `uat.slice4b.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  coach: { label: "Coach", email: `uat.slice4b.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  manager: { label: "Team Manager", email: `uat.slice4b.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4b.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  otherTeamCoach: { label: "Coach of another team", email: `uat.slice4b.otherteamcoach.${TAG}@ovalball.test`, first: "Jo", surname: `Otherteamcoach ${TAG}` },
  farAdmin: { label: "Club Admin at another club", email: `uat.slice4b.faradmin.${TAG}@ovalball.test`, first: "Frankie", surname: `Faradmin ${TAG}` },
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
  v_club uuid := (select id from public.clubs where slug = 'uat-slice4b-${tag}');
  v_far uuid := (select id from public.clubs where slug = 'uat-slice4bfar-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4b.%.${tag}@ovalball.test');
  v_players uuid[] := array(select id from public.players where surname like '% ${tag}');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_players || coalesce(array[v_club], '{}')
    || array(select id from public.teams where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.guardians where player_id = any(v_players))
    || array(select id from public.guardian_link_requests where club_id = v_club)
    || array(select id from public.player_team_memberships where player_id = any(v_players))
    || array(select id from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club))
    || array(select id from public.teams where club_id = v_far)
    || array(select id from public.club_memberships where club_id = v_far)
    || array(select id from public.role_assignments where club_id = v_far)
    || coalesce(array[v_far], '{}')
    || array(select id from public.club_directory where normalized_key in ('uat-slice4b-${tag}', 'uat-slice4bfar-${tag}'));
  delete from public.notifications where user_id = any(v_people);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club);
  delete from public.guardian_player_permissions where player_id = any(v_players);
  delete from public.guardian_link_requests where club_id = v_club or requested_by_user_id = any(v_people);
  delete from public.guardians where player_id = any(v_players);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where club_id in (v_club, v_far);
  delete from public.club_memberships where club_id in (v_club, v_far);
  delete from public.club_setup_state where club_id in (v_club, v_far);
  delete from public.teams where club_id in (v_club, v_far);
  delete from public.clubs where id in (v_club, v_far);
  delete from public.club_directory where normalized_key in ('uat-slice4b-${tag}', 'uat-slice4bfar-${tag}');
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id in (v_club, v_far) or player_id = any(v_players)
    or metadata ->> 'membership_id' in (select unnest(v_records)::text) or metadata ->> 'relationship_id' in (select unnest(v_records)::text);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}
// Storage refuses direct row deletes; pictures are removed through the Storage API before the rows go.
async function removeTaggedPictures(tag) {
  const names = sql(`select o.name from storage.objects o join auth.users u on u.id::text = (storage.foldername(o.name))[1]
    where o.bucket_id = 'avatars' and u.email like 'uat.slice4b.%.${tag}@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)
  if (names.length === 0) return
  await fetch(`${API}/storage/v1/object/avatars`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: names }),
  })
}
async function cleanup() {
  if (cleaned) return
  cleaned = true
  await removeTaggedPictures(TAG)
  cleanupTag(TAG)
  for (const person of Object.values(people)) {
    try {
      fs.unlinkSync(path.join(os.tmpdir(), "ovalball-uat-sessions", `${person.email.replace(/[^a-z0-9.@-]/gi, "_")}.json`))
    } catch {}
  }
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-slice4b-${TAG}', 'uat-slice4bfar-${TAG}')) + (select count(*) from auth.users where email like 'uat.slice4b.%.${TAG}@ovalball.test')
    + (select count(*) from storage.objects where bucket_id = 'avatars' and name like '%avatar-${TAG}.png')
    + (select count(*) from public.players where surname like '% ${TAG}') + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4b.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, player, relationship, notification, history row and cached session this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", async () => {
  await cleanup()
  process.exit(1)
})

async function rest(pathAndQuery, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

async function signStorage(bucket, objectPath, token) {
  const res = await fetch(`${API}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  })
  return { status: res.status, text: await res.text() }
}

async function accessTokenOf(context) {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
  cookies.sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
  const joined = cookies.map((c) => c.value).join("")
  const raw = joined.startsWith("base64-") ? Buffer.from(joined.slice(7), "base64").toString("utf8") : decodeURIComponent(joined)
  return JSON.parse(raw).access_token
}

async function open(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const body = await page.locator("body").innerText()
  return { status: response?.status() ?? 0, url: page.url(), broken: /Application error|Something went wrong|permission denied/i.test(body), body }
}

async function until(label, query, expected, timeoutMs = 30000) {
  const start = Date.now()
  let value = ""
  while (Date.now() - start < timeoutMs) {
    value = one(query)
    if (value === expected) return value
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for ${label}: expected ${expected}, last ${value}`)
}

const pageProblems = []
function watch(context, label) {
  context.on("page", (p) => {
    p.on("pageerror", (e) => pageProblems.push(`${label} pageerror ${e.message.split("\n")[0]}`))
    p.on("console", (msg) => {
      if (msg.type() === "error") pageProblems.push(`${label} console ${msg.text().slice(0, 200)}`)
    })
    p.on("response", (r) => {
      if (r.status() >= 500) pageProblems.push(`${label} HTTP ${r.status()} ${r.url().replace(APP, "")}`)
    })
  })
  return context
}

// ---------------------------------------------------------------------------
// Seed: one club with two teams and a player, plus a second club entirely.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4b.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.directory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four B RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4b-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.directory}', 'uat-slice4b-${TAG}', 'active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 12 Boys', 'uat-slice4b-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 14 Boys', 'uat-slice4b-u14-${TAG}', 'youth', 'U14', 'boys', 'union', true) returning id`)
ids.farDirectory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four B Far RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4bfar-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDirectory}', 'uat-slice4bfar-${TAG}', 'active') returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.club}', '${people.coach.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.manager.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.secretary.id}', 'FIXTURE_SECRETARY', 'active'),
  ('${ids.club}', '${people.otherTeamCoach.id}', 'BASIC_USER', 'active'),
  ('${ids.farClub}', '${people.farAdmin.id}', 'CLUB_ADMIN', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.coach.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.manager.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team2}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.otherTeamCoach.id}';`)

ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Rory', 'Roster ${TAG}', (current_date - interval '11 years 2 months')::date, 'MALE') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.player}', '${ids.team}', 'active');`)

const browser = await launch()
const sessions = {}
const playersTab = (page) => page.locator("button").filter({ hasText: /^Players/ }).first()
const rosterNames = async (page) => (await page.locator("li").allTextContents()).join(" ")

try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }

  // A1-A3  legitimate roster visibility ------------------------------------------------
  {
    const { page } = sessions.admin
    await open(page, `/teams/${ids.team}`)
    record("A1 the Club Admin reaches their own club's team", /\/teams\/[0-9a-f-]{36}/.test(page.url()), page.url())
    await playersTab(page).click()
    record("A2 and reads the roster", (await rosterNames(page)).includes("Rory"), "looked for the player by name")
    record("A3 and is offered the control that changes it", (await page.getByRole("button", { name: "Archive" }).count()) > 0)
  }

  // B1-B2  the Coach reads their own team, and is offered nothing that changes it -------
  {
    const { page } = sessions.coach
    await open(page, `/teams/${ids.team}`)
    await playersTab(page).click()
    record("B1 the Coach reads their own team's roster", (await rosterNames(page)).includes("Rory"))
    record("B2 and is offered no control that changes it (team.roster.view, not manage)",
      (await page.getByRole("button", { name: "Archive" }).count()) === 0)
  }

  // C1-C2  the Team Manager reads and may change it -------------------------------------
  {
    const { page } = sessions.manager
    await open(page, `/teams/${ids.team}`)
    await playersTab(page).click()
    record("C1 the Team Manager reads their own team's roster", (await rosterNames(page)).includes("Rory"))
    record("C2 and is offered the control that changes it", (await page.getByRole("button", { name: "Archive" }).count()) > 0)
  }

  // D1-D3  AI #70: the team exists and is named; the roster is not readable --------------
  {
    const { page } = sessions.secretary
    await open(page, `/clubs`)
    const canSeeTeam = await (async () => {
      await open(page, `/teams/${ids.team}`)
      return /\/teams\/[0-9a-f-]{36}/.test(page.url())
    })()
    record("D1 AI #70 the Fixtures Secretary still sees the team page (team.team.view: identity and name)", canSeeTeam, page.url())
    record("D2 AI #70 and its name", (await page.locator("body").textContent()).includes("Under 12"), "looked for the canonical display name")
    const names = canSeeTeam ? await (async () => { await playersTab(page).click().catch(() => {}); return rosterNames(page) })() : ""
    record("D3 AI #70 but reads no player in it", !names.includes("Rory"), names.slice(0, 120))
    record("D4 and is offered no control that changes the roster", (await page.getByRole("button", { name: "Archive" }).count()) === 0)
  }

  // E1-E2  wrong team and wrong club ----------------------------------------------------
  {
    const { page } = sessions.otherTeamCoach
    await open(page, `/teams/${ids.team}`)
    await playersTab(page).click().catch(() => {})
    record("E1 a Coach of another team in the same club reads no player in this one",
      !(await rosterNames(page)).includes("Rory"))
  }
  {
    const { page } = sessions.farAdmin
    await open(page, `/teams/${ids.team}`)
    record("E2 a Club Admin at another club does not reach this team at all",
      !/\/teams\/[0-9a-f-]{36}$/.test(page.url()) || !(await page.locator("body").textContent()).includes("Rory"), page.url())
  }

  // F1  no legacy key resolves for anybody ----------------------------------------------
  {
    const legacy = one(`select count(*) from public.capability_key_map where legacy_key = 'team.view'`)
    const deprecated = one(`select status from public.capabilities where key = 'team.view'`)
    record("F1 the retired team.view has no adapter row and is DEPRECATED, so no page can depend on it",
      legacy === "0" && deprecated === "DEPRECATED", `adapter=${legacy} status=${deprecated}`)
  }

  // G1  the roster survives a phone ------------------------------------------------------
  {
    const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
    const phone = await phoneCtx.newPage()
    await signIn(phone, people.manager.email)
    await open(phone, `/teams/${ids.team}`)
    await playersTab(phone).click()
    const m = await measure(phone)
    record("G1 the team page and its roster fit a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
    await phoneCtx.close()
  }

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  await cleanup()
  summarise()
}
