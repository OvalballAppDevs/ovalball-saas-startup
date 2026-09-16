// MESSAGING AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4F (Phase 2 AA.3 row 4f, design J.10 lines 511-523, section T "Reports"),
// driven through the running product with disposable identities and two disposable clubs:
//
//   two different people    report the SAME message, and BOTH reports survive as their own rows --
//                           the overwrite section T forbids, tested through the real RPC
//   a Safeguarding Officer  reads the club report queue; a Club Admin does NOT, because a report
//                           may be about a Club Admin
//   a Fixtures Secretary    may no longer block someone from a club's conversations, and an SO now
//                           may -- 4F's two intended changes
//   another club            reaches none of this club's conversations
//   anonymous               reads no report at all
//   a phone                 the Messenger surface fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/56-messaging-authority.mjs

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
  admin: { label: "Club Admin", email: `uat.slice4f.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4f.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  manager: { label: "Team Manager", email: `uat.slice4f.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  manager2: { label: "other Team Manager", email: `uat.slice4f.manager2.${TAG}@ovalball.test`, first: "Max", surname: `Manager2 ${TAG}` },
  member: { label: "club Member", email: `uat.slice4f.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
  farAdmin: { label: "other club's Club Admin", email: `uat.slice4f.faradmin.${TAG}@ovalball.test`, first: "Fran", surname: `FarAdmin ${TAG}` },
  coach: { label: "Coach", email: `uat.slice4f.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  officer: { label: "Safeguarding Officer", email: `uat.slice4f.officer.${TAG}@ovalball.test`, first: "Sasha", surname: `Officer ${TAG}` },
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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4f-${tag}','uat-s4f-far-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4f.%.${tag}@ovalball.test');
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
    || array(select id from public.club_directory where normalized_key in ('uat-s4f-${tag}','uat-s4f-far-${tag}'));
  delete from public.training_plan_schedule_rules where training_plan_id in (select id from public.training_plans where club_id = any(v_clubs));
  delete from public.training_sessions where club_id = any(v_clubs);
  delete from public.training_plans where club_id = any(v_clubs);
  delete from public.club_event_teams where event_id in (select id from public.club_events where club_id = any(v_clubs));
  delete from public.club_events where club_id = any(v_clubs);
  delete from public.message_reports where message_id in (
    select id from public.fixture_messages
    where fixture_id in (select id from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs)))
       or team_conversation_id in (select id from public.teams where club_id = any(v_clubs)));
  delete from public.fixture_messages
   where fixture_id in (select id from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs)))
      or team_conversation_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.club_message_blocks where club_id = any(v_clubs);
  delete from public.team_conversations where team_id in (select id from public.teams where club_id = any(v_clubs));
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
  delete from public.club_directory where normalized_key in ('uat-s4f-${tag}','uat-s4f-far-${tag}');
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
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4f-${TAG}','uat-s4f-far-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4f.%.${TAG}@ovalball.test')
    + (select count(*) from public.message_reports r join public.fixture_messages m on m.id = r.message_id where m.body like '%${TAG}%')
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4f.%.${TAG}@ovalball.test')`)
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
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4f.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four F RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4f-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','uat-s4f-${TAG}','active') returning id`)
ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four F Far RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4f-far-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','uat-s4f-far-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 12 Boys','uat-s4f-u12-${TAG}','youth','U12','boys','union',true) returning id`)
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 13 Boys','uat-s4f-u13-${TAG}','youth','U13','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}','${people.admin.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.secretary.id}','FIXTURE_SECRETARY','active'),
  ('${ids.club}','${people.manager.id}','BASIC_USER','active'),
  ('${ids.club}','${people.manager2.id}','BASIC_USER','active'),
  ('${ids.club}','${people.member.id}','BASIC_USER','active'),
  ('${ids.club}','${people.coach.id}','BASIC_USER','active'),
  ('${ids.club}','${people.officer.id}','BASIC_USER','active'),
  ('${ids.farClub}','${people.farAdmin.id}','CLUB_ADMIN','active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id='${ids.club}' and user_id='${people.manager.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team2}', 'manager' from public.club_memberships where club_id='${ids.club}' and user_id='${people.manager2.id}';`)

sql(`insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id='${ids.club}' and user_id='${people.coach.id}';`)

// A Safeguarding Officer using the role Slice 2 ALREADY models -- role_assignments carries
// confirmation_state and the SAFEGUARDING_OFFICER constraint. No 4G nomination, confirmation or
// invitation surface is created or needed; locked decision D-S4-2 is untouched.
ids.officerMembership = one(`select id from public.club_memberships where club_id='${ids.club}' and user_id='${people.officer.id}'`)
sql(`insert into public.role_assignments (club_id, user_id, membership_id, role_key, state, source, confirmation_state, granted_by)
  values ('${ids.club}','${people.officer.id}','${ids.officerMembership}','SAFEGUARDING_OFFICER','ACTIVE','LEGACY_BACKFILL','CONFIRMED','${people.admin.id}')`)

ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
  and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
const fixtureRow = sql(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values ('${ids.team}','Home','Slice Four F External RFC',current_date+20,'Booked','club_created','${ids.season}') returning id || ' ' || conversation_id`).trim()
;[ids.fixture, ids.conversation] = fixtureRow.split(/\s+/)
ids.message = one(`insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind)
  values ('${ids.fixture}','${ids.conversation}','${people.coach.id}','Slice Four F message ${TAG}','message') returning id`)

const browser = await launch()
const sessions = {}
try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }

  // A. section T: ONE ROW PER REPORT -------------------------------------------------------
  {
    const r1 = await rpc(sessions.manager.context, "report_message", { p_message_id: ids.message, p_reason: "reported by the manager" })
    record("A1 the Team Manager reports a message", r1.status < 400, `HTTP ${r1.status} ${r1.body.slice(0, 120)}`)
    const r2 = await rpc(sessions.admin.context, "report_message", { p_message_id: ids.message, p_reason: "reported by the club admin" })
    record("A2 and a SECOND person reports the same message", r2.status < 400, `HTTP ${r2.status}`)
    record("A3 both reports exist as their own rows -- no overwrite (section T)",
      one(`select count(*) from public.message_reports where message_id = '${ids.message}'`) === "2")
    record("A4 and the first reporter's reason was not replaced",
      one(`select count(distinct reason) from public.message_reports where message_id = '${ids.message}'`) === "2")
    const r3 = await rpc(sessions.coach.context, "report_message", { p_message_id: ids.message, p_reason: "my own message" })
    record("A5 you cannot report your own message", r3.status >= 400, `HTTP ${r3.status}`)
    const r4 = await rpc(sessions.farAdmin.context, "report_message", { p_message_id: ids.message, p_reason: "not mine to see" })
    record("A6 nor one in a conversation you cannot reach", r4.status >= 400, `HTTP ${r4.status}`)
  }

  // B. the club queue is the Safeguarding Officer's ------------------------------------------
  {
    const so = await rpc(sessions.officer.context, "club_message_reports", { p_club_id: ids.club })
    record("B1 the Safeguarding Officer reads the club report queue", so.status < 400, `HTTP ${so.status}`)
    record("B2 and sees both reports", (JSON.parse(so.body) ?? []).length === 2, so.body.slice(0, 120))
    const ca = await rpc(sessions.admin.context, "club_message_reports", { p_club_id: ids.club })
    record("B3 a Club Admin does NOT -- a report may be about a Club Admin", ca.status >= 400, `HTTP ${ca.status}`)
    const fs = await rpc(sessions.secretary.context, "club_message_reports", { p_club_id: ids.club })
    record("B4 nor the Fixtures Secretary", fs.status >= 400, `HTTP ${fs.status}`)
    const far = await rpc(sessions.farAdmin.context, "club_message_reports", { p_club_id: ids.club })
    record("B5 nor another club", far.status >= 400, `HTTP ${far.status}`)
  }

  // C. blocking: 4F's two intended changes -----------------------------------------------------
  {
    const fs = await rpc(sessions.secretary.context, "block_user_from_club_messages", { p_club_id: ids.club, p_user_id: people.member.id, p_reason: "fs attempt" })
    record("C1 INTENDED CHANGE: the Fixtures Secretary may no longer block", fs.status >= 400, `HTTP ${fs.status}`)
    record("C2 and nobody was blocked", one(`select count(*) from public.club_message_blocks where club_id='${ids.club}'`) === "0")
    const so = await rpc(sessions.officer.context, "block_user_from_club_messages", { p_club_id: ids.club, p_user_id: people.member.id, p_reason: "so block" })
    record("C3 INTENDED CHANGE: the Safeguarding Officer may", so.status < 400, `HTTP ${so.status} ${so.body.slice(0, 100)}`)
    record("C4 and the block landed", one(`select count(*) from public.club_message_blocks where club_id='${ids.club}'`) === "1")
    sql(`delete from public.club_message_blocks where club_id = '${ids.club}'`)
  }

  // D. the report row perimeter ------------------------------------------------------------------
  {
    const mine = await readAs(sessions.manager.context, `message_reports?message_id=eq.${ids.message}&select=id`)
    record("D1 a reporter reads their own report", mine.rows === 1, `HTTP ${mine.status} rows ${mine.rows}`)
    const soRows = await readAs(sessions.officer.context, `message_reports?message_id=eq.${ids.message}&select=id`)
    record("D2 the Safeguarding Officer reads both", soRows.rows === 2, `rows ${soRows.rows}`)
    const member = await readAs(sessions.member.context, `message_reports?message_id=eq.${ids.message}&select=id`)
    record("D3 an uninvolved member reads none", member.rows === 0, `rows ${member.rows}`)
    const anon = await fetch(`${API}/rest/v1/message_reports?select=id&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
    record("D4 an anonymous caller is refused outright", anon.status >= 400, `HTTP ${anon.status}`)
    const direct = await sessions.officer.context.request.post(`${API}/rest/v1/message_reports`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(sessions.officer.context)}` },
      data: { message_id: ids.message, club_id: ids.club, reported_by: people.officer.id, reason: "direct write" }, failOnStatusCode: false,
    })
    record("D5 a direct REST insert of a report is refused -- every report is an RPC", direct.status() >= 400, `HTTP ${direct.status()}`)
  }

  // E. conversation access: the Site Admin blanket read is gone ----------------------------------
  {
    const far = await readAs(sessions.farAdmin.context, `fixture_messages?id=eq.${ids.message}&select=id`)
    record("E1 another club reads none of this club's fixture conversation", far.rows === 0, `rows ${far.rows}`)
    const co = await readAs(sessions.coach.context, `fixture_messages?id=eq.${ids.message}&select=id`)
    record("E2 while the team's Coach does", co.rows === 1, `rows ${co.rows}`)
    const soRead = await readAs(sessions.officer.context, `fixture_messages?id=eq.${ids.message}&select=id`)
    record("E3 and the Safeguarding Officer does NOT -- a report queue is not a licence to read conversations", soRead.rows === 0, `rows ${soRead.rows}`)
  }

  // F. a phone ------------------------------------------------------------------------------------
  {
    const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
    const phone = await phoneCtx.newPage()
    await signIn(phone, people.admin.email)
    await open(phone, "/messages")
    const m = await measure(phone)
    record("F1 Messenger fits a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
    await phoneCtx.close()
  }

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  await cleanup()
  summarise()
}
