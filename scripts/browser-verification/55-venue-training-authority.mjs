// VENUE AND TRAINING AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4E (Phase 2 AA.3 row 4e, design J.9 lines 496-507), driven through the
// running product with disposable identities and two disposable clubs:
//
//   a Fixtures Secretary   manages a venue through the RPC -- the U section's "venues RLS/RPC
//                          mismatch", which used to let the RLS allow what the RPC refused
//   a Team Manager         manages their own team's training and not another team's
//   an ordinary Member     sees club events but NOT training sessions, which is 4E's intended
//                          narrowing: a training session says where named children will be
//   another club           reads none of this club's venues, which venues_select = true allowed
//   anonymous              reads no venue row at all, only the public_venues projection
//   a phone                the club settings surface fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/55-venue-training-authority.mjs

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
const people = {
  admin: { label: "Club Admin", email: `uat.slice4e.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4e.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  manager: { label: "Team Manager", email: `uat.slice4e.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  manager2: { label: "other Team Manager", email: `uat.slice4e.manager2.${TAG}@ovalball.test`, first: "Max", surname: `Manager2 ${TAG}` },
  member: { label: "club Member", email: `uat.slice4e.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
  farAdmin: { label: "other club's Club Admin", email: `uat.slice4e.faradmin.${TAG}@ovalball.test`, first: "Fran", surname: `FarAdmin ${TAG}` },
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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4e-${tag}','uat-s4e-far-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4e.%.${tag}@ovalball.test');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_clubs
    || array(select id from public.training_plans where club_id = any(v_clubs))
    || array(select id from public.training_sessions where club_id = any(v_clubs))
    || array(select id from public.venues where club_id = any(v_clubs))
    || array(select id from public.club_pitches where club_id = any(v_clubs))
    || array(select id from public.club_events where club_id = any(v_clubs))
    || array(select id from public.teams where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs))
    || array(select id from public.role_assignments where club_id = any(v_clubs))
    || array(select id from public.club_directory where normalized_key in ('uat-s4e-${tag}','uat-s4e-far-${tag}'));
  delete from public.training_plan_schedule_rules where training_plan_id in (select id from public.training_plans where club_id = any(v_clubs));
  delete from public.training_sessions where club_id = any(v_clubs);
  delete from public.training_plans where club_id = any(v_clubs);
  delete from public.club_event_teams where event_id in (select id from public.club_events where club_id = any(v_clubs));
  delete from public.club_events where club_id = any(v_clubs);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.club_pitches where club_id = any(v_clubs);
  delete from public.venues where club_id = any(v_clubs);
  delete from public.notifications where user_id = any(v_people);
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id = any(v_clubs));
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key in ('uat-s4e-${tag}','uat-s4e-far-${tag}');
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = any(v_clubs);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}
async function cleanup() {
  if (cleaned) return
  cleaned = true
  cleanupTag(TAG)
  for (const person of Object.values(people)) {
    try { fs.unlinkSync(path.join(os.tmpdir(), "ovalball-uat-sessions", `${person.email.replace(/[^a-z0-9.@-]/gi, "_")}.json`)) } catch {}
  }
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4e-${TAG}','uat-s4e-far-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4e.%.${TAG}@ovalball.test')
    + (select count(*) from public.venues where slug like 'uat-s4e-%-${TAG}')
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4e.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, venue, plan, session, event, notification and history row this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", async () => { await cleanup(); process.exit(1) })

const pageProblems = []
function watch(context, label) {
  context.on("page", (p) => {
    p.on("pageerror", (e) => pageProblems.push(`${label} pageerror ${e.message.split("\n")[0]}`))
    p.on("console", (msg) => { if (msg.type() === "error") pageProblems.push(`${label} console ${msg.text().slice(0, 200)}`) })
    p.on("response", (r) => { if (r.status() >= 500) pageProblems.push(`${label} HTTP ${r.status()} ${r.url().replace(APP, "")}`) })
  })
  return context
}

async function tokenFor(context) {
  const parts = (await context.cookies())
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

async function rpc(context, name, args) {
  const res = await context.request.post(`${API}/rest/v1/rpc/${name}`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(context)}` },
    data: args, failOnStatusCode: false,
  })
  return { status: res.status(), body: await res.text() }
}
async function readAs(context, pathAndQuery) {
  const res = await context.request.get(`${API}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${await tokenFor(context)}` }, failOnStatusCode: false,
  })
  const text = await res.text()
  try { return { status: res.status(), rows: JSON.parse(text).length } } catch { return { status: res.status(), rows: -1, text } }
}

async function open(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { status: response?.status() ?? 0, url: page.url() }
}

// ---------------------------------------------------------------------------
// Seed: a club with two teams, a venue, a pitch, a club event and a training
// plan; plus a second club that must see none of it.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4e.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four E RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4e-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','uat-s4e-${TAG}','active') returning id`)
ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four E Far RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4e-far-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','uat-s4e-far-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 12 Boys','uat-s4e-u12-${TAG}','youth','U12','boys','union',true) returning id`)
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 13 Boys','uat-s4e-u13-${TAG}','youth','U13','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}','${people.admin.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.secretary.id}','FIXTURE_SECRETARY','active'),
  ('${ids.club}','${people.manager.id}','BASIC_USER','active'),
  ('${ids.club}','${people.manager2.id}','BASIC_USER','active'),
  ('${ids.club}','${people.member.id}','BASIC_USER','active'),
  ('${ids.farClub}','${people.farAdmin.id}','CLUB_ADMIN','active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id='${ids.club}' and user_id='${people.manager.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team2}', 'manager' from public.club_memberships where club_id='${ids.club}' and user_id='${people.manager2.id}';`)

ids.venue = one(`insert into public.venues (club_id, name, slug, active) values ('${ids.club}','Slice Four E Park ${TAG}','uat-s4e-park-${TAG}',true) returning id`)
ids.pitch = one(`insert into public.club_pitches (club_id, venue_id, display_name, active) values ('${ids.club}','${ids.venue}','Pitch 1',true) returning id`)
ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
  and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
ids.event = one(`insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, is_club_wide, created_by)
  values ('${ids.club}','Slice Four E Open Day ${TAG}',current_date+20,current_date+20,'${ids.venue}',true,'${people.admin.id}') returning id`)
ids.plan = one(`insert into public.training_plans (club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id, created_by)
  values ('${ids.club}','${ids.team}','${ids.season}','SEASON','${ids.venue}','${ids.pitch}','${people.admin.id}') returning id`)
ids.session = one(`insert into public.training_sessions (club_id, team_id, training_plan_id, session_date, start_time, duration_minutes)
  values ('${ids.club}','${ids.team}','${ids.plan}',current_date+7,'18:00',60) returning id`)

const browser = await launch()
const sessions = {}
try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }

  // A. the U closure: the Fixtures Secretary manages a venue through the RPC ------------------
  {
    const r = await rpc(sessions.secretary.context, "update_venue", { p_id: ids.venue, p_name: `FS Renamed ${TAG}`, p_address: null, p_postcode: null, p_directions: null })
    record("A1 INTENDED CHANGE: the Fixtures Secretary renames a venue through the RPC", r.status < 400, `HTTP ${r.status} ${r.body.slice(0, 120)}`)
    record("A2 and the rename landed", one(`select name from public.venues where id = '${ids.venue}'`) === `FS Renamed ${TAG}`)
    const r2 = await rpc(sessions.manager.context, "update_venue", { p_id: ids.venue, p_name: "TM Renamed", p_address: null, p_postcode: null, p_directions: null })
    record("A3 a Team Manager cannot", r2.status >= 400, `HTTP ${r2.status}`)
    const r3 = await rpc(sessions.farAdmin.context, "update_venue", { p_id: ids.venue, p_name: "Far Renamed", p_address: null, p_postcode: null, p_directions: null })
    record("A4 nor another club's Club Admin", r3.status >= 400, `HTTP ${r3.status}`)
    record("A5 and the name is unchanged by either", one(`select name from public.venues where id = '${ids.venue}'`) === `FS Renamed ${TAG}`)
  }

  // B. venue reads are club-scoped ------------------------------------------------------------
  {
    const mine = await readAs(sessions.member.context, `venues?id=eq.${ids.venue}&select=id`)
    record("B1 a club Member reads their own club's venue", mine.rows === 1, `HTTP ${mine.status} rows ${mine.rows}`)
    const theirs = await readAs(sessions.farAdmin.context, `venues?id=eq.${ids.venue}&select=id`)
    record("B2 INTENDED CHANGE: another club's Club Admin reads none of it", theirs.rows === 0, `HTTP ${theirs.status} rows ${theirs.rows}`)
  }

  // C. training visibility narrows; club events do not ----------------------------------------
  {
    const mgr = await readAs(sessions.manager.context, `training_sessions?id=eq.${ids.session}&select=id`)
    record("C1 the team's Manager reads their training session", mgr.rows === 1, `rows ${mgr.rows}`)
    const mem = await readAs(sessions.member.context, `training_sessions?id=eq.${ids.session}&select=id`)
    record("C2 INTENDED CHANGE: an ordinary club Member does not", mem.rows === 0, `rows ${mem.rows}`)
    const mem2 = await readAs(sessions.member.context, `club_events?id=eq.${ids.event}&select=id`)
    record("C3 but the same Member DOES read a club event -- a club event is not a child's timetable", mem2.rows === 1, `rows ${mem2.rows}`)
    const other = await readAs(sessions.manager2.context, `training_sessions?id=eq.${ids.session}&select=id`)
    record("C4 and another team's Manager reads none of it", other.rows === 0, `rows ${other.rows}`)
  }

  // D. training management binds to the team ---------------------------------------------------
  {
    const r = await rpc(sessions.manager2.context, "cancel_training_session", { p_session_id: ids.session, p_reason: "not mine" })
    record("D1 another team's Manager cannot cancel this team's session", r.status >= 400, `HTTP ${r.status}`)
    record("D2 and the session is not cancelled", one(`select coalesce(cancelled_at::text,'LIVE') from public.training_sessions where id = '${ids.session}'`) === "LIVE")
    const r2 = await rpc(sessions.member.context, "cancel_training_session", { p_session_id: ids.session, p_reason: "nope" })
    record("D3 nor can an ordinary Member", r2.status >= 400, `HTTP ${r2.status}`)
  }

  // E. the anonymous perimeter, in both directions ----------------------------------------------
  {
    const anonVenues = await fetch(`${API}/rest/v1/venues?select=id,name&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
    record("E1 an anonymous read of the venues table is refused", anonVenues.status >= 400, `HTTP ${anonVenues.status}`)
    const anonTraining = await fetch(`${API}/rest/v1/training_plans?select=id&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
    record("E2 as is an anonymous read of training plans", anonTraining.status >= 400, `HTTP ${anonTraining.status}`)
    const anonProjection = await fetch(`${API}/rest/v1/public_venues?id=eq.${ids.venue}&select=id,name`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
    const rows = JSON.parse(await anonProjection.text())
    record("E3 while public_venues DOES serve the name anonymously -- a public fixture has to say where it is", rows.length === 1 && rows[0].name === `FS Renamed ${TAG}`, `HTTP ${anonProjection.status} ${JSON.stringify(rows).slice(0, 120)}`)
  }

  // F. a phone ------------------------------------------------------------------------------------
  {
    const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
    const phone = await phoneCtx.newPage()
    await signIn(phone, people.admin.email)
    await open(phone, "/club/settings")
    const m = await measure(phone)
    record("F1 club settings fits a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
    await phoneCtx.close()
  }

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  await cleanup()
  summarise()
}
