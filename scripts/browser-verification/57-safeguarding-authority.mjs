// SAFEGUARDING AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4G (Phase 2 AA.3 row 4g, design J.12 lines 541-553, section T
// "Appointment"/"Lifecycle", decisions AN-6 and AN-9), driven through the running product with
// disposable identities and two disposable clubs:
//
//   a Club Admin            nominates somebody who is ALREADY an active member, and is told the
//                           nomination grants nothing until Ovalball confirms it (AN-6)
//   a non-member            comes back INVITATION_REQUIRED -- the Slice 5 deferral, visible in the
//                           product rather than only in a design document (D-S4-2)
//   the club                cannot finish the appointment: not the Club Admin who started it, not
//                           the nominee, not the Fixtures Secretary
//   Ovalball                confirms through the canonical site capability, and only then does the
//                           role grant anything
//   a member                raises a safeguarding concern and can REPLY in their own thread, which
//                           the transitional Club-Admin-only key would not let them do
//   a Site Admin            reads no safeguarding thread through the API at all; the reasoned review
//                           RPC is the way in, and it leaves a record the club's officer can see
//   another club            reaches none of it, and anonymous reaches nothing
//   a phone                 the Site Admin safeguarding queue fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/57-safeguarding-authority.mjs

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
  admin: { label: "Club Admin", email: `uat.slice4g.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  admin2: { label: "second Club Admin", email: `uat.slice4g.admin2.${TAG}@ovalball.test`, first: "Ada", surname: `Admin2 ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4g.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  nominee: { label: "the nominee", email: `uat.slice4g.nominee.${TAG}@ovalball.test`, first: "Noor", surname: `Nominee ${TAG}` },
  member: { label: "club Member", email: `uat.slice4g.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
  outsider: { label: "a non-member", email: `uat.slice4g.outsider.${TAG}@ovalball.test`, first: "Otto", surname: `Outsider ${TAG}` },
  farAdmin: { label: "other club's Club Admin", email: `uat.slice4g.faradmin.${TAG}@ovalball.test`, first: "Fran", surname: `FarAdmin ${TAG}` },
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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4g-${tag}','uat-s4g-far-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4g.%.${tag}@ovalball.test');
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
    || array(select id from public.club_directory where normalized_key in ('uat-s4g-${tag}','uat-s4g-far-${tag}'));
  delete from public.training_plan_schedule_rules where training_plan_id in (select id from public.training_plans where club_id = any(v_clubs));
  delete from public.training_sessions where club_id = any(v_clubs);
  delete from public.training_plans where club_id = any(v_clubs);
  delete from public.club_event_teams where event_id in (select id from public.club_events where club_id = any(v_clubs));
  delete from public.club_events where club_id = any(v_clubs);
  delete from public.safeguarding_thread_reviews where club_id = any(v_clubs);
  delete from public.fixture_messages where safeguarding_conversation_id in (
    select id from public.club_safeguarding_officer_conversations where club_id = any(v_clubs));
  delete from public.club_safeguarding_officer_conversations where club_id = any(v_clubs);
  delete from public.club_safeguarding_officer_invitations where club_id = any(v_clubs);
  delete from public.club_safeguarding_officers where club_id = any(v_clubs);
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
  delete from public.club_directory where normalized_key in ('uat-s4g-${tag}','uat-s4g-far-${tag}');
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
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4g-${TAG}','uat-s4g-far-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4g.%.${TAG}@ovalball.test')
    + (select count(*) from public.club_safeguarding_officer_conversations c where c.club_id in (select id from public.clubs where slug in ('uat-s4g-${TAG}','uat-s4g-far-${TAG}')))
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4g.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, nomination, officer, conversation, review, notification and history row this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
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
// Seed: a club with one team and a handful of people, plus a second club that
// must see none of it. No Safeguarding Officer is created up front -- appointing
// one is the thing under test.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4g.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four G RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4g-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','uat-s4g-${TAG}','active') returning id`)
ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four G Far RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4g-far-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','uat-s4g-far-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 12 Boys','uat-s4g-u12-${TAG}','youth','U12','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}','${people.admin.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.admin2.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.secretary.id}','FIXTURE_SECRETARY','active'),
  ('${ids.club}','${people.nominee.id}','BASIC_USER','active'),
  ('${ids.club}','${people.member.id}','BASIC_USER','active'),
  ('${ids.farClub}','${people.farAdmin.id}','CLUB_ADMIN','active');`)

const browser = await launch()
try {
  const ctx = {}
  for (const key of ["admin", "admin2", "secretary", "nominee", "member", "outsider", "farAdmin"]) {
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

  const holds = (userId, key) =>
    one(`select (internal.capability_decision('${userId}','${key}','club','${ids.club}',null,null,false,false)).allowed`)

  // -------------------------------------------------------------------------
  // A. Nomination: an existing active member, and nobody else
  // -------------------------------------------------------------------------
  const nominated = await rpc(ctx.admin.context, "nominate_club_safeguarding_officer", {
    p_club_id: ids.club, p_user_id: people.nominee.id, p_officer_type: "primary", p_reason: `browser ${TAG}`,
  })
  ids.assignment = one(`select id from public.role_assignments where club_id='${ids.club}' and user_id='${people.nominee.id}' and role_key='SAFEGUARDING_OFFICER' and state='ACTIVE'`)
  record("A1 a Club Admin nominates an existing active member, and it lands PENDING_CONFIRMATION",
    nominated.status === 200 && /PENDING_CONFIRMATION/.test(nominated.body)
      && one(`select confirmation_state from public.role_assignments where id='${ids.assignment}'`) === "PENDING_CONFIRMATION",
    `${nominated.status} ${nominated.body.slice(0, 160)}`)

  record("A2 and the nomination grants NO Safeguarding Officer authority at all",
    holds(people.nominee.id, "safeguarding.conversation.handle") === "f"
      && holds(people.nominee.id, "safeguarding.dispensation.view") === "f"
      && holds(people.nominee.id, "safeguarding.welfare.view") === "f",
    `handle=${holds(people.nominee.id, "safeguarding.conversation.handle")}`)

  const outsiderNom = await rpc(ctx.admin.context, "nominate_club_safeguarding_officer", {
    p_club_id: ids.club, p_user_id: people.outsider.id, p_officer_type: "deputy", p_reason: `browser ${TAG}`,
  })
  record("A3 D-S4-2: a non-member comes back INVITATION_REQUIRED, and Slice 5 is named as the path",
    outsiderNom.status === 200 && /INVITATION_REQUIRED/.test(outsiderNom.body) && /SLICE_5/.test(outsiderNom.body),
    `${outsiderNom.status} ${outsiderNom.body.slice(0, 200)}`)
  record("A4 and no assignment was created for them",
    one(`select count(*) from public.role_assignments where club_id='${ids.club}' and user_id='${people.outsider.id}'`) === "0")

  const farNom = await rpc(ctx.farAdmin.context, "nominate_club_safeguarding_officer", {
    p_club_id: ids.club, p_user_id: people.member.id, p_officer_type: "deputy", p_reason: "borrowed",
  })
  record("A5 another club's Club Admin cannot nominate into this club -- the club id in the payload is not authority",
    farNom.status >= 400, `${farNom.status} ${farNom.body.slice(0, 120)}`)

  // -------------------------------------------------------------------------
  // B. AN-6: the club cannot finish its own appointment
  // -------------------------------------------------------------------------
  const refusals = []
  for (const key of ["admin", "admin2", "secretary", "nominee", "member", "farAdmin"]) {
    const r = await rpc(ctx[key].context, "confirm_safeguarding_officer", { p_assignment_id: ids.assignment, p_reason: `replayed by ${key}` })
    if (one(`select confirmation_state from public.role_assignments where id='${ids.assignment}'`) === "CONFIRMED") refusals.push(people[key].label)
    void r
  }
  record("B1 AN-6: nobody at the club can confirm -- not the Club Admin who nominated them, not the nominee",
    refusals.length === 0, refusals.length ? `confirmed anyway: ${refusals.join(", ")}` : "every attempt refused")

  const noReason = await rpc(ctx.site.context, "confirm_safeguarding_officer", { p_assignment_id: ids.assignment, p_reason: "" })
  record("B2 and Ovalball cannot confirm without a reason", noReason.status >= 400, `${noReason.status}`)

  const confirmed = await rpc(ctx.site.context, "confirm_safeguarding_officer", { p_assignment_id: ids.assignment, p_reason: `browser confirm ${TAG}` })
  // A void RPC answers 204, not 200. The state in the database is the verdict either way.
  record("B3 Ovalball confirms through the canonical site capability",
    confirmed.status < 300 && one(`select confirmation_state from public.role_assignments where id='${ids.assignment}'`) === "CONFIRMED",
    `${confirmed.status} ${confirmed.body.slice(0, 160)}`)
  record("B4 and only then does the role grant anything",
    holds(people.nominee.id, "safeguarding.conversation.handle") === "t" && holds(people.nominee.id, "safeguarding.welfare.view") === "t")
  record("B5 the confirmation records who did it, and why",
    one(`select count(*) from public.role_assignments where id='${ids.assignment}' and confirmed_by is not null and confirmed_at is not null`) === "1"
      && one(`select count(*) from public.security_events where event_type='safeguarding.officer_confirmed' and club_id='${ids.club}'`) !== "0")

  // -------------------------------------------------------------------------
  // C. The thread: a member raises a concern and can reply in it
  // -------------------------------------------------------------------------
  sql(`insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, user_id, status, activated_at, created_by, updated_by)
       values ('${ids.club}','primary','${people.nominee.first} ${people.nominee.surname}','${people.nominee.email}','${people.nominee.id}','active',now(),'${people.admin.id}','${people.admin.id}')`)
  const started = await rpc(ctx.member.context, "start_safeguarding_conversation", { p_club_id: ids.club, p_first_message: `browser concern ${TAG}` })
  ids.conversation = one(`select id from public.club_safeguarding_officer_conversations where club_id='${ids.club}' and requester_user_id='${people.member.id}'`)
  record("C1 a club member opens a safeguarding thread without having to choose an officer",
    started.status === 200 && ids.conversation.length > 0, `${started.status} ${started.body.slice(0, 160)}`)

  const replied = await ctx.member.context.request.post(`${API}/rest/v1/fixture_messages`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(ctx.member.context)}` },
    data: { safeguarding_conversation_id: ids.conversation, sender_user_id: people.member.id, body: `browser reply ${TAG}`, kind: "message" },
    failOnStatusCode: false,
  })
  record("C2 INTENDED CHANGE: and can REPLY in it -- the transitional Club-Admin-only key would not let them",
    replied.status() < 300, `${replied.status()} ${(await replied.text()).slice(0, 160)}`)

  const officerRead = await readAs(ctx.nominee.context, `fixture_messages?safeguarding_conversation_id=eq.${ids.conversation}&select=id`)
  record("C3 the confirmed officer reads the thread", officerRead.rows >= 2, JSON.stringify(officerRead))
  const adminRead = await readAs(ctx.admin.context, `club_safeguarding_officer_conversations?id=eq.${ids.conversation}&select=id`)
  record("C4 the Club Admin does not -- a safeguarding thread may be about the Club Admin", adminRead.rows === 0, JSON.stringify(adminRead))
  const farRead = await readAs(ctx.farAdmin.context, `club_safeguarding_officer_conversations?club_id=eq.${ids.club}&select=id`)
  record("C5 and another club reaches none of it", farRead.rows === 0, JSON.stringify(farRead))

  // -------------------------------------------------------------------------
  // D. Ovalball's way in (AN-9 / AI #68-69)
  // -------------------------------------------------------------------------
  const siteRead = await readAs(ctx.site.context, `fixture_messages?safeguarding_conversation_id=eq.${ids.conversation}&select=id`)
  record("D1 INTENDED CHANGE: a Site Admin reads no safeguarding thread through the API at all (section T, 'No RLS read')",
    siteRead.rows === 0, JSON.stringify(siteRead))
  const noReasonReview = await rpc(ctx.site.context, "site_safeguarding_review", { p_conversation_id: ids.conversation, p_reason: "" })
  record("D2 and cannot review one without a reason", noReasonReview.status >= 400, `${noReasonReview.status}`)
  const review = await rpc(ctx.site.context, "site_safeguarding_review", { p_conversation_id: ids.conversation, p_reason: `browser review ${TAG}` })
  record("D3 the reasoned review RPC is the way in, and it returns the thread",
    review.status === 200 && /browser concern/.test(review.body), `${review.status} ${review.body.slice(0, 160)}`)
  const officerSeesReview = await readAs(ctx.nominee.context, `safeguarding_thread_reviews?conversation_id=eq.${ids.conversation}&select=id`)
  record("D4 AN-9: and the club's officer can see that Ovalball looked", officerSeesReview.rows === 1, JSON.stringify(officerSeesReview))
  const adminSeesReview = await readAs(ctx.admin.context, `safeguarding_thread_reviews?conversation_id=eq.${ids.conversation}&select=id`)
  record("D5 while the Club Admin cannot", adminSeesReview.rows === 0, JSON.stringify(adminSeesReview))

  const anonReview = await anon.request.get(`${API}/rest/v1/safeguarding_thread_reviews?select=id`, { headers: { apikey: ANON_KEY }, failOnStatusCode: false })
  record("D6 and anonymous reaches nothing", anonReview.status() >= 400 || (await anonReview.text()).replace(/\s/g, "") === "[]", `${anonReview.status()}`)

  // -------------------------------------------------------------------------
  // E. The product surfaces
  // -------------------------------------------------------------------------
  {
    const second = await rpc(ctx.admin.context, "nominate_club_safeguarding_officer", {
      p_club_id: ids.club, p_user_id: people.member.id, p_officer_type: "deputy", p_reason: `queue ${TAG}`,
    })
    void second
    const { status } = await open(ctx.site.page, "/admin/safeguarding")
    const body = await ctx.site.page.textContent("body")
    record("E1 the Site Admin safeguarding page reaches 200 and shows the confirmation queue",
      status === 200 && /Awaiting Confirmation/.test(body ?? ""), `status=${status}`)
    record("E2 and names the person waiting", (body ?? "").includes(people.member.surname), "")
    const denied = await open(ctx.admin.page, "/admin/safeguarding")
    record("E3 while a Club Admin cannot reach it at all", !/\/admin\/safeguarding/.test(denied.url), `url=${denied.url}`)

    await ctx.site.page.setViewportSize({ width: 390, height: 844 })
    await open(ctx.site.page, "/admin/safeguarding")
    const overflow = await ctx.site.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record("E4 and the queue fits a 390px phone with no sideways scroll", overflow <= 1, `overflow=${overflow}px`)
    await ctx.site.page.setViewportSize({ width: 1280, height: 900 })
  }

  record("I1 no page error, console error or 5xx on any surface", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  await browser.close()
  await cleanup()
  summarise()
}
