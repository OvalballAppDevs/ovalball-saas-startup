// CLUB ADMIN AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4H (Phase 2 AA.3 row 4h, design J.3, J.4, J.5, J.13 and section S "Club Admin
// boundary"), driven through the running product with disposable identities and two disposable clubs:
//
//   a Club Admin            runs their own club: the roll, the invitations, the contact card
//   another club's Admin    reaches none of it, however they name this club's id
//   a Fixtures Secretary    sees the people but not the invitations and not the money
//   an export               needs club.reporting.export AND a reason, and leaves an event naming
//                           what left -- section S's last prohibition, which nothing enforced
//   a Full Site Admin       cannot configure this club's subscription (J.13: "Site Admins never act
//                           on club payments")
//   a phone                 the club settings surface fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/58-club-admin-authority.mjs

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
  admin: { label: "Club Admin", email: `uat.slice4h.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4h.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  member: { label: "club Member", email: `uat.slice4h.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
  farAdmin: { label: "other club's Club Admin", email: `uat.slice4h.faradmin.${TAG}@ovalball.test`, first: "Fran", surname: `FarAdmin ${TAG}` },
  outsider: { label: "a non-member", email: `uat.slice4h.outsider.${TAG}@ovalball.test`, first: "Otto", surname: `Outsider ${TAG}` },
}
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"

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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4h-${tag}','uat-s4h-far-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4h.%.${tag}@ovalball.test');
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
    || array(select id from public.club_directory where normalized_key in ('uat-s4h-${tag}','uat-s4h-far-${tag}'));
  delete from public.training_plan_schedule_rules where training_plan_id in (select id from public.training_plans where club_id = any(v_clubs));
  delete from public.training_sessions where club_id = any(v_clubs);
  delete from public.training_plans where club_id = any(v_clubs);
  delete from public.club_event_teams where event_id in (select id from public.club_events where club_id = any(v_clubs));
  delete from public.club_events where club_id = any(v_clubs);
  delete from public.invitation_teams where invitation_id in (select id from public.invitations where club_id = any(v_clubs));
  delete from public.invitations where club_id = any(v_clubs);
  delete from public.club_join_requests where club_id = any(v_clubs);
  delete from public.club_contacts where club_id = any(v_clubs);
  delete from public.team_contacts where team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.club_opponent_notes where owning_club_id = any(v_clubs);
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
  delete from public.club_directory where normalized_key in ('uat-s4h-${tag}','uat-s4h-far-${tag}');
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
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4h-${TAG}','uat-s4h-far-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4h.%.${TAG}@ovalball.test')
    + (select count(*) from public.invitations i where i.club_id in (select id from public.clubs where slug in ('uat-s4h-${TAG}','uat-s4h-far-${TAG}')))
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4h.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, membership, invitation, contact, note, notification and history row this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
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
// Seed: a club with one team and four people, plus a second club that must
// see none of it.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4h.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four H RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4h-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','uat-s4h-${TAG}','active') returning id`)
ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four H Far RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4h-far-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','uat-s4h-far-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 12 Boys','uat-s4h-u12-${TAG}','youth','U12','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}','${people.admin.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.secretary.id}','FIXTURE_SECRETARY','active'),
  ('${ids.club}','${people.member.id}','BASIC_USER','active'),
  ('${ids.farClub}','${people.farAdmin.id}','CLUB_ADMIN','active');`)

ids.contact = one(`insert into public.club_contacts (club_id, role, name, email, is_public)
  values ('${ids.club}','general','Private Desk','desk-${TAG}@ovalball.test',false) returning id`)
ids.invitation = one(`insert into public.invitations (club_id, invited_email, club_role, token, created_by, expires_at, status)
  values ('${ids.club}','invited-${TAG}@ovalball.test','FIXTURE_SECRETARY','uat-s4h-tok-${TAG}','${people.admin.id}', now() + interval '7 days','pending') returning id`)
ids.note = one(`insert into public.club_opponent_notes (owning_club_id, directory_id, notes, created_by)
  values ('${ids.club}','${ids.farDir}','private note ${TAG}','${people.admin.id}') returning id`)

const browser = await launch()
try {
  const ctx = {}
  for (const key of ["admin", "secretary", "member", "farAdmin", "outsider"]) {
    const context = watch(await newContext(browser), key)
    const page = await context.newPage()
    await signIn(page, people[key].email)
    ctx[key] = { context, page }
  }
  const siteContext = watch(await newContext(browser), "site")
  const sitePage = await siteContext.newPage()
  await signIn(sitePage, SITE_ADMIN)
  ctx.site = { context: siteContext, page: sitePage }
  const anon = await newContext(browser)

  // -------------------------------------------------------------------------
  // A. The club's own records, and the club next door
  // -------------------------------------------------------------------------
  const roll = async (key) => (await readAs(ctx[key].context, `club_memberships?club_id=eq.${ids.club}&select=id`)).rows
  record("A1 the Club Admin reads their club's roll", (await roll("admin")) >= 3, `rows=${await roll("admin")}`)
  record("A2 so does the Fixtures Secretary (J.3 line 385)", (await roll("secretary")) >= 3, `rows=${await roll("secretary")}`)
  record("A3 an ordinary member sees only their own row", (await roll("member")) === 1, `rows=${await roll("member")}`)
  record("A4 and another club's Club Admin sees none of it, naming this club's id", (await roll("farAdmin")) === 0)
  record("A5 nor does a non-member", (await roll("outsider")) === 0)

  const invites = async (key) => (await readAs(ctx[key].context, `invitations?club_id=eq.${ids.club}&select=id`)).rows
  record("A6 the Club Admin reads the club's outstanding invitations", (await invites("admin")) === 1)
  record("A7 and the Fixtures Secretary does NOT -- issuing invitations is the Club Admin's (J.3 line 387)",
    (await invites("secretary")) === 0, `rows=${await invites("secretary")}`)
  record("A8 nor another club", (await invites("farAdmin")) === 0)

  const notes = async (key) => (await readAs(ctx[key].context, `club_opponent_notes?owning_club_id=eq.${ids.club}&select=id`)).rows
  record("A9 the club's private opponent notes are its administration's", (await notes("admin")) === 1)
  record("A10 and the club they are ABOUT cannot read them", (await notes("farAdmin")) === 0)

  const contacts = async (key) => (await readAs(ctx[key].context, `club_contacts?id=eq.${ids.contact}&select=id`)).rows
  record("A11 a private club contact is visible inside the club", (await contacts("member")) === 1)
  record("A12 and not outside it", (await contacts("farAdmin")) === 0)

  // -------------------------------------------------------------------------
  // B. Attacks: the ids in the payload are not authority
  // -------------------------------------------------------------------------
  const writeInvitationAs = async (key) => {
    const res = await ctx[key].context.request.post(`${API}/rest/v1/invitations`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(ctx[key].context)}` },
      data: { club_id: ids.club, invited_email: `attack-${key}-${TAG}@ovalball.test`, club_role: "FIXTURE_SECRETARY",
              token: `uat-s4h-atk-${key}-${TAG}`, created_by: people[key].id, expires_at: new Date(Date.now() + 6e8).toISOString(), status: "pending" },
      failOnStatusCode: false,
    })
    return res.status()
  }
  record("B1 another club's Admin cannot write an invitation into this club", (await writeInvitationAs("farAdmin")) >= 400)
  record("B2 nor can the Fixtures Secretary", (await writeInvitationAs("secretary")) >= 400)
  record("B3 nor an ordinary member", (await writeInvitationAs("member")) >= 400)
  record("B4 and no invitation was created by any of them",
    one(`select count(*) from public.invitations where club_id = '${ids.club}' and invited_email like 'attack-%'`) === "0")

  // -------------------------------------------------------------------------
  // C. Section S: exporting personal data
  // -------------------------------------------------------------------------
  {
    const exportAs = async (key, reason) => await rpc(ctx[key].context, "record_club_export",
      { p_club_id: ids.club, p_kind: "player_movements", p_reason: reason, p_row_count: 4 })
    const before = Number(one(`select count(*) from public.security_events where event_type='export.generated' and club_id='${ids.club}'`))
    const refused = []
    for (const key of ["secretary", "member", "farAdmin", "outsider"]) {
      const r = await exportAs(key, `attempt ${key}`)
      if (r.status < 300) refused.push(people[key].label)
    }
    record("C1 nobody without club.reporting.export may export", refused.length === 0, refused.join(", "))
    const noReason = await exportAs("admin", "   ")
    record("C2 and the Club Admin cannot export without a reason", noReason.status >= 400, `${noReason.status}`)
    const ok = await exportAs("admin", `browser export ${TAG}`)
    const after = Number(one(`select count(*) from public.security_events where event_type='export.generated' and club_id='${ids.club}'`))
    record("C3 the Club Admin may, with a reason, and it leaves exactly one event",
      ok.status < 300 && after === before + 1, `${ok.status} events ${before} -> ${after}`)
    record("C4 which records the reason and how much left",
      one(`select reason from public.security_events where event_type='export.generated' and club_id='${ids.club}' order by occurred_at desc limit 1`) === `browser export ${TAG}`
      && one(`select metadata->>'row_count' from public.security_events where event_type='export.generated' and club_id='${ids.club}' order by occurred_at desc limit 1`) === "4")
  }

  // -------------------------------------------------------------------------
  // D. The club's money (J.13)
  // -------------------------------------------------------------------------
  {
    const configureAs = async (key) => await rpc(ctx[key].context, "configure_subscription_programme",
      { p_club_id: ids.club, p_enabled: true, p_collection_day: 1, p_platform_fee_mode: "CLUB_PAYS", p_first_payment_policy: "IMMEDIATE" })
    const bySite = await configureAs("site")
    record("D1 INTENDED CHANGE: a Full Site Admin cannot configure this club's subscription (J.13)",
      bySite.status >= 400, `${bySite.status} ${bySite.body.slice(0, 120)}`)
    const bySecretary = await configureAs("secretary")
    record("D2 nor the Fixtures Secretary", bySecretary.status >= 400, `${bySecretary.status}`)
    const byFar = await configureAs("farAdmin")
    record("D3 nor another club's Club Admin", byFar.status >= 400, `${byFar.status}`)
    const financeRead = await readAs(ctx.site.context, `platform_trials?club_id=eq.${ids.club}&select=id`)
    record("D4 while Ovalball's own platform billing stays readable to it (site.commercial.view)", financeRead.status < 400, JSON.stringify(financeRead))
  }

  // -------------------------------------------------------------------------
  // E. The product surfaces
  // -------------------------------------------------------------------------
  {
    const { status, url } = await open(ctx.admin.page, "/club/settings")
    record("E1 the Club Admin reaches club settings", status === 200 && /\/club\/settings/.test(url), `status=${status} url=${url}`)
    const memberVisit = await open(ctx.member.page, "/club/settings")
    record("E2 an ordinary member does not", !/\/club\/settings$/.test(memberVisit.url), `url=${memberVisit.url}`)
    await ctx.admin.page.setViewportSize({ width: 390, height: 844 })
    await open(ctx.admin.page, "/club/settings")
    const overflow = await ctx.admin.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record("E3 and club settings fits a 390px phone with no sideways scroll", overflow <= 1, `overflow=${overflow}px`)
    await ctx.admin.page.setViewportSize({ width: 1280, height: 900 })
    const anonInvites = await anon.request.get(`${API}/rest/v1/invitations?select=id`, { headers: { apikey: ANON_KEY }, failOnStatusCode: false })
    record("E4 and a signed-out visitor reaches no invitation at all", anonInvites.status() >= 400 || (await anonInvites.text()).replace(/\s/g, "") === "[]", `${anonInvites.status()}`)
  }

  record("I1 no page error, console error or 5xx on any surface", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  await browser.close()
  await cleanup()
  summarise()
}
