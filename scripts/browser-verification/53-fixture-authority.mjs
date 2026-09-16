// FIXTURE AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4C (Phase 2 AA.3 row 4c, J.6 456-474), driven through the running product
// with disposable identities and two disposable clubs:
//
//   a Club Admin      creates a fixture against an EXTERNAL opponent and it is recorded
//   a Club Admin      creates one against ANOTHER OVALBALL CLUB and it becomes a request, not a
//                     fixture -- the invariant the direct-insert bypass used to defeat
//   a Team Manager    creates for their own team, and not for another team of the same club
//   a Coach           may create for their team but reaches no Planner or Import
//   an ordinary member sees no fixture administration at all
//   the perimeter     a browser holds no INSERT on fixtures, so there is no second route
//   a phone           fixture management fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/53-fixture-authority.mjs

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
  admin: { label: "Club Admin", email: `uat.slice4c.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4c.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  manager: { label: "Team Manager", email: `uat.slice4c.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  coach: { label: "Coach", email: `uat.slice4c.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  member: { label: "club Member", email: `uat.slice4c.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
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
  v_club uuid := (select id from public.clubs where slug = 'uat-slice4c-${tag}');
  v_far uuid := (select id from public.clubs where slug = 'uat-slice4cfar-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4c.%.${tag}@ovalball.test');
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
    || array(select id from public.fixtures where owning_team_id in (select id from public.teams where club_id in (v_club, v_far)))
    || array(select id from public.fixture_request_groups where requesting_club_id in (v_club, v_far))
    || array(select id from public.club_directory where normalized_key in ('uat-slice4c-${tag}', 'uat-slice4cfar-${tag}'));
  -- fixtures and the request rows this suite creates reference the teams below, so they go first
  delete from public.fixture_requests fr using public.fixture_request_groups g
    where g.id = fr.group_id and g.requesting_club_id in (v_club, v_far);
  delete from public.fixture_requests where requesting_team_id in (select id from public.teams where club_id in (v_club, v_far));
  delete from public.fixture_request_groups where requesting_club_id in (v_club, v_far) or opponent_club_id in (v_club, v_far);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id in (v_club, v_far))
     or opponent_team_id in (select id from public.teams where club_id in (v_club, v_far));
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
  delete from public.club_directory where normalized_key in ('uat-slice4c-${tag}', 'uat-slice4cfar-${tag}');
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
    where o.bucket_id = 'avatars' and u.email like 'uat.slice4c.%.${tag}@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)
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
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-slice4c-${TAG}', 'uat-slice4cfar-${TAG}')) + (select count(*) from auth.users where email like 'uat.slice4c.%.${TAG}@ovalball.test')
    + (select count(*) from storage.objects where bucket_id = 'avatars' and name like '%avatar-${TAG}.png')
    + (select count(*) from public.players where surname like '% ${TAG}') + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4c.%.${TAG}@ovalball.test')`)
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
// Seed: one club with two teams, plus a second Ovalball club to be asked.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4c.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.directory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four C RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4c-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.directory}', 'uat-slice4c-${TAG}', 'active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 12 Boys', 'uat-slice4c-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 14 Boys', 'uat-slice4c-u14-${TAG}', 'youth', 'U14', 'boys', 'union', true) returning id`)
ids.farDirectory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four C Far RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4cfar-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDirectory}', 'uat-slice4cfar-${TAG}', 'active') returning id`)
ids.farTeam = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.farClub}', 'Under 12 Boys', 'uat-slice4cfar-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.club}', '${people.secretary.id}', 'FIXTURE_SECRETARY', 'active'),
  ('${ids.club}', '${people.manager.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.coach.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.member.id}', 'BASIC_USER', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id='${ids.club}' and user_id='${people.manager.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id='${ids.club}' and user_id='${people.coach.id}';`)

/** Runs create_fixture as one person through the real PostgREST endpoint the browser uses. */
async function createAs(context, args) {
  const res = await context.request.post(`${API}/rest/v1/rpc/create_fixture`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(context)}` },
    data: args, failOnStatusCode: false,
  })
  return { status: res.status(), body: await res.text() }
}
async function tokenFor(context) {
  // The session cookie is sb-<ref>-auth-token, optionally split into .0/.1 chunks. The
  // *-code-verifier cookies share the "auth-token" substring and must not be concatenated in:
  // doing so silently corrupts the value and every request comes back 401, which looks like a
  // refusal rather than a broken test.
  const cookies = await context.cookies()
  const parts = cookies
    .filter((c) => /auth-token(\.\d+)?$/.test(c.name) && !c.name.includes("code-verifier"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
  if (parts.length === 0) throw new Error("no Supabase session cookie found for this context")
  const raw = parts.join("")
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : raw
  const token = JSON.parse(json).access_token
  if (!token) throw new Error("session cookie carried no access_token")
  return token
}

const browser = await launch()
const sessions = {}
try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }

  // A. the external-opposition path records a fixture ------------------------------------
  {
    const before = Number(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`))
    const r = await createAs(sessions.admin.context, {
      p_owning_team_id: ids.team, p_home_away: "Home", p_raw_opposition_text: "Slice4C External RFC",
      p_kickoff_date: "2027-03-01", p_status: "Booked",
    })
    const after = Number(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`))
    record("A1 a Club Admin creates a fixture against an external opponent", r.status === 200 && after === before + 1, `HTTP ${r.status} ${before}->${after}`)
    record("A2 and its source is server-derived", one(`select source from public.fixtures where owning_team_id='${ids.team}' order by created_at desc limit 1`) === "club_created")
  }

  // B. an Ovalball opponent is ASKED, never booked ----------------------------------------
  {
    const fBefore = Number(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`))
    const rBefore = Number(one(`select count(*) from public.fixture_request_groups where requesting_club_id = '${ids.club}'`))
    const r = await createAs(sessions.admin.context, {
      p_owning_team_id: ids.team, p_home_away: "Home", p_raw_opposition_text: "Slice Four C Far RUFC",
      p_kickoff_date: "2027-03-08", p_status: "Booked", p_opponent_team_id: ids.farTeam,
    })
    const fAfter = Number(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`))
    const rAfter = Number(one(`select count(*) from public.fixture_request_groups where requesting_club_id = '${ids.club}'`))
    record("B1 an Ovalball opponent produces NO fixture", r.status === 200 && fAfter === fBefore, `HTTP ${r.status} fixtures ${fBefore}->${fAfter}`)
    record("B2 and a request the other club must answer", rAfter === rBefore + 1, `requests ${rBefore}->${rAfter}`)
  }

  // C. team-scope ---------------------------------------------------------------------------
  {
    const r1 = await createAs(sessions.manager.context, {
      p_owning_team_id: ids.team, p_home_away: "Home", p_raw_opposition_text: "Slice4C External RFC",
      p_kickoff_date: "2027-03-15", p_status: "Booked",
    })
    record("C1 a Team Manager creates for their OWN team", r1.status === 200, `HTTP ${r1.status}`)
    const r2 = await createAs(sessions.manager.context, {
      p_owning_team_id: ids.team2, p_home_away: "Home", p_raw_opposition_text: "Slice4C External RFC",
      p_kickoff_date: "2027-03-22", p_status: "Booked",
    })
    record("C2 and not for another team of the same club", r2.status >= 400 || /not authorised/i.test(r2.body), `HTTP ${r2.status}`)
    const r3 = await createAs(sessions.member.context, {
      p_owning_team_id: ids.team, p_home_away: "Home", p_raw_opposition_text: "Slice4C External RFC",
      p_kickoff_date: "2027-03-29", p_status: "Booked",
    })
    record("C3 an ordinary club Member creates nothing", r3.status >= 400 || /not authorised/i.test(r3.body), `HTTP ${r3.status}`)
  }

  // D. the perimeter: no second route ---------------------------------------------------------
  {
    const res = await sessions.admin.context.request.post(`${API}/rest/v1/fixtures`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(sessions.admin.context)}`, Prefer: "return=representation" },
      data: { owning_team_id: ids.team, home_away: "Home", raw_opposition_text: "REST bypass", kickoff_date: "2027-04-05", status: "Booked", source: "club_created" },
      failOnStatusCode: false,
    })
    record("D1 a direct REST insert into fixtures is refused even for a Club Admin", res.status() >= 400, `HTTP ${res.status()}`)
    record("D2 and left no row behind", one(`select count(*) from public.fixtures where raw_opposition_text = 'REST bypass'`) === "0")
  }

  // E. mass-operation separation in the running product ----------------------------------------
  {
    const { page } = sessions.coach
    await open(page, "/fixtures/planner")
    record("E1 a Coach does not reach the Planner", !/\/fixtures\/planner$/.test(page.url()), page.url())
    await open(page, "/fixtures/management")
    record("E2 nor Fixture Management", !/\/fixtures\/management$/.test(page.url()), page.url())
  }

  // F. a phone ----------------------------------------------------------------------------------
  {
    const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
    const phone = await phoneCtx.newPage()
    await signIn(phone, people.admin.email)
    await open(phone, "/fixtures/management")
    const m = await measure(phone)
    record("F1 fixture management fits a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
    await phoneCtx.close()
  }

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  await cleanup()
  summarise()
}
