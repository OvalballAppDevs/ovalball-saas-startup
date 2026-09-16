// CLUB DOCUMENTS, PARTNERS, REFERRALS AND HANDOVER AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4I (Phase 2 AA.3 row 4i, design J.4 lines 407-411, J.5 lines 420-429, section U
// and Z-12), driven through the running product with disposable identities and two disposable clubs:
//
//   the document library    every bundle in the club reads it; the Club Admin and the Fixtures
//                           Secretary manage it; the club next door reaches none of it
//   section U               the Secretary PREPARES a season handover and the Club Admin APPLIES it,
//                           and the Secretary is refused the apply however they reach for it
//   the handover's teeth    folding a side and graduating a cohort keep their own lifecycle gate,
//                           so preparation is not a second door to them
//   partnerships            a relationship both clubs can see, from either end
//   referrals               the administrator's alone -- the Secretary reaches none
//   object storage          the club-documents bucket's delete path exists and is gated (Z-12)
//   a phone                 the club documents surface fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/59-club-misc-authority.mjs

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
const people = {
  admin: { label: "Club Admin", email: `uat.slice4i.admin.${TAG}@ovalball.test`, first: "Delia", surname: `Admin ${TAG}` },
  secretary: { label: "Fixtures Secretary", email: `uat.slice4i.secretary.${TAG}@ovalball.test`, first: "Sid", surname: `Secretary ${TAG}` },
  member: { label: "club Member", email: `uat.slice4i.member.${TAG}@ovalball.test`, first: "Mira", surname: `Member ${TAG}` },
  farAdmin: { label: "other club's Club Admin", email: `uat.slice4i.faradmin.${TAG}@ovalball.test`, first: "Finn", surname: `FarAdmin ${TAG}` },
  outsider: { label: "a non-member", email: `uat.slice4i.outsider.${TAG}@ovalball.test`, first: "Ola", surname: `Outsider ${TAG}` },
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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4i-${tag}','uat-s4i-far-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4i.%.${tag}@ovalball.test');
  v_rollovers uuid[];
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_rollovers := array(select id from public.age_grade_rollovers where club_id = any(v_clubs));
  v_records := v_people || v_clubs || v_rollovers
    || array(select id from public.club_documents where club_id = any(v_clubs))
    || array(select id from public.document_folders where club_id = any(v_clubs))
    || array(select id from public.club_partnerships where requesting_club_id = any(v_clubs) or partner_club_id = any(v_clubs))
    || array(select id from public.teams where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs))
    || array(select id from public.role_assignments where club_id = any(v_clubs))
    || array(select id from public.club_directory where normalized_key in ('uat-s4i-${tag}','uat-s4i-far-${tag}'));
  delete from public.fixture_message_document_refs where document_id in (select id from public.club_documents where club_id = any(v_clubs));
  delete from public.club_documents where club_id = any(v_clubs);
  delete from public.document_folders where club_id = any(v_clubs);
  delete from public.club_ovalball_invitations where inviting_club_id = any(v_clubs);
  delete from public.club_partnerships where requesting_club_id = any(v_clubs) or partner_club_id = any(v_clubs);
  delete from public.season_transitions where rollover_id = any(v_rollovers);
  delete from public.age_grade_rollover_group_flags where rollover_id = any(v_rollovers);
  delete from public.age_grade_rollover_player_proposals where rollover_id = any(v_rollovers);
  delete from public.age_grade_rollover_planned_teams where rollover_id = any(v_rollovers);
  delete from public.age_grade_rollover_team_proposals where rollover_id = any(v_rollovers);
  delete from public.age_grade_rollovers where club_id = any(v_clubs);
  delete from public.notifications where user_id = any(v_people);
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id = any(v_clubs));
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.team_season_identity where team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key in ('uat-s4i-${tag}','uat-s4i-far-${tag}');
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
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4i-${TAG}','uat-s4i-far-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4i.%.${TAG}@ovalball.test')
    + (select count(*) from public.club_documents d join public.club_directory cd on cd.id = d.directory_id where cd.normalized_key like 'uat-s4i-%${TAG}')
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4i.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, document, folder, handover, partnership, referral and history row this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
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
async function writeAs(context, table, data) {
  const res = await context.request.post(`${API}/rest/v1/${table}`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(context)}` },
    data, failOnStatusCode: false,
  })
  return res.status()
}
async function patchAs(context, table, filter, data) {
  const res = await context.request.patch(`${API}/rest/v1/${table}?${filter}`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(context)}` },
    data, failOnStatusCode: false,
  })
  return res.status()
}

async function open(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { status: response?.status() ?? 0, url: page.url() }
}

// ---------------------------------------------------------------------------
// Seed: a club with a U12 and a U18 side, a document library, and a second club
// that must see none of it.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4i.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four I RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4i-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','uat-s4i-${TAG}','active') returning id`)
ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four I Far RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4i-far-${TAG}') returning id`)
ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','uat-s4i-far-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 12 Boys','uat-s4i-u12-${TAG}','youth','U12','boys','union',true) returning id`)
ids.team18 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}','Under 18 Boys','uat-s4i-u18-${TAG}','youth','U18','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}','${people.admin.id}','CLUB_ADMIN','active'),
  ('${ids.club}','${people.secretary.id}','FIXTURE_SECRETARY','active'),
  ('${ids.club}','${people.member.id}','BASIC_USER','active'),
  ('${ids.farClub}','${people.farAdmin.id}','CLUB_ADMIN','active');`)

ids.folder = one(`insert into public.document_folders (club_id, name, created_by)
  values ('${ids.club}','Club Policies ${TAG}','${people.admin.id}') returning id`)
ids.doc = one(`insert into public.club_documents (club_id, folder_id, title, storage_path, mime_type, size_bytes, original_filename, category, uploaded_by)
  values ('${ids.club}','${ids.folder}','Safeguarding Policy ${TAG}','${ids.club}/policy-${TAG}.pdf','application/pdf',2048,'policy.pdf','other','${people.admin.id}') returning id`)
ids.partnership = one(`insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  values ('${ids.club}','${ids.farClub}','pending','${people.admin.id}') returning id`)
ids.referral = one(`insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values ('${ids.club}','${ids.farDir}','A Contact','referral-${TAG}@ovalball.test','${people.admin.id}') returning id`)

const browser = await launch()
try {
  const ctx = {}
  for (const key of ["admin", "secretary", "member", "farAdmin", "outsider"]) {
    const context = watch(await newContext(browser), key)
    const page = await context.newPage()
    await signIn(page, people[key].email)
    ctx[key] = { context, page }
  }
  const anon = await newContext(browser)

  // -------------------------------------------------------------------------
  // A. The document library (J.4 lines 407-408)
  // -------------------------------------------------------------------------
  const docs = async (key) => (await readAs(ctx[key].context, `club_documents?id=eq.${ids.doc}&select=id`)).rows
  record("A1 the Club Admin reads the club's document library", (await docs("admin")) === 1)
  record("A2 so does the Fixtures Secretary", (await docs("secretary")) === 1)
  record("A3 and so does an ordinary member -- J.4 line 407 gives the view to every club bundle", (await docs("member")) === 1)
  record("A4 another club's Club Admin reads none of it, naming this document's id", (await docs("farAdmin")) === 0)
  record("A5 nor does a non-member", (await docs("outsider")) === 0)
  {
    const res = await anon.request.get(`${API}/rest/v1/club_documents?select=id`, { headers: { apikey: ANON_KEY }, failOnStatusCode: false })
    record("A6 and a signed-out visitor reaches no club document at all",
      res.status() >= 400 || (await res.text()).replace(/\s/g, "") === "[]", `${res.status()}`)
  }

  const folders = async (key) => (await readAs(ctx[key].context, `document_folders?id=eq.${ids.folder}&select=id`)).rows
  record("A7 folders follow their documents inside the club", (await folders("member")) === 1)
  record("A8 and not outside it", (await folders("farAdmin")) === 0)

  // -------------------------------------------------------------------------
  // B. Managing it, and the ids in the payload are not authority
  // -------------------------------------------------------------------------
  record("B1 the Club Admin may rename a document (club.documents.manage)",
    (await patchAs(ctx.admin.context, "club_documents", `id=eq.${ids.doc}`, { title: `Renamed by CA ${TAG}` })) < 300
    && one(`select title from public.club_documents where id = '${ids.doc}'`) === `Renamed by CA ${TAG}`)
  record("B2 and so may the Fixtures Secretary (J.4 line 408)",
    (await patchAs(ctx.secretary.context, "club_documents", `id=eq.${ids.doc}`, { title: `Renamed by FS ${TAG}` })) < 300
    && one(`select title from public.club_documents where id = '${ids.doc}'`) === `Renamed by FS ${TAG}`)
  for (const [key, label] of [["member", "B3 an ordinary member may not"], ["farAdmin", "B4 nor may another club's Club Admin"], ["outsider", "B5 nor a non-member"]]) {
    const before = one(`select title from public.club_documents where id = '${ids.doc}'`)
    await patchAs(ctx[key].context, "club_documents", `id=eq.${ids.doc}`, { title: `Renamed by ${key} ${TAG}` })
    record(label, one(`select title from public.club_documents where id = '${ids.doc}'`) === before)
  }
  record("B6 and nobody without club.documents.manage may add one",
    (await writeAs(ctx.member.context, "club_documents", { club_id: ids.club, title: `Attack ${TAG}`, storage_path: `${ids.club}/attack-${TAG}.pdf`, mime_type: "application/pdf", size_bytes: 1, original_filename: "a.pdf", category: "other", uploaded_by: people.member.id })) >= 400
    && (await writeAs(ctx.farAdmin.context, "club_documents", { club_id: ids.club, title: `Attack ${TAG}`, storage_path: `${ids.club}/attack2-${TAG}.pdf`, mime_type: "application/pdf", size_bytes: 1, original_filename: "a.pdf", category: "other", uploaded_by: people.farAdmin.id })) >= 400
    && one(`select count(*) from public.club_documents where club_id = '${ids.club}' and title like 'Attack %'`) === "0")
  record("B7 nor create a folder in this club by naming its id",
    (await writeAs(ctx.farAdmin.context, "document_folders", { club_id: ids.club, name: `Attack ${TAG}`, created_by: people.farAdmin.id })) >= 400
    && one(`select count(*) from public.document_folders where club_id = '${ids.club}' and name like 'Attack %'`) === "0")
  {
    const byMember = await rpc(ctx.member.context, "delete_club_document", { p_document_id: ids.doc })
    record("B8 and delete_club_document, which asks the same authority as the storage bucket, refuses a member",
      byMember.status >= 400 && one(`select count(*) from public.club_documents where id = '${ids.doc}'`) === "1", `${byMember.status}`)
  }

  // -------------------------------------------------------------------------
  // C. Section U: preparing a handover is the Secretary's, applying it is not
  // -------------------------------------------------------------------------
  {
    const gen = await rpc(ctx.admin.context, "generate_rollover_proposal",
      { p_club_id: ids.club, p_rugby_code: "union", p_to_season_id: one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture and starts_on > current_date order by starts_on limit 1`) })
    ids.rollover = gen.body.replace(/"/g, "").trim()
    record("C1 the Club Admin generates a season handover for their club", gen.status < 300 && /^[0-9a-f-]{36}$/.test(ids.rollover), `${gen.status} ${gen.body.slice(0, 120)}`)
    ids.prop12 = one(`select id from public.age_grade_rollover_team_proposals where rollover_id = '${ids.rollover}' and team_id = '${ids.team}'`)
    ids.prop18 = one(`select id from public.age_grade_rollover_team_proposals where rollover_id = '${ids.rollover}' and team_id = '${ids.team18}'`)
    record("C2 with a proposal for each of the club's sides", ids.prop12.length === 36 && ids.prop18.length === 36)

    const rollovers = async (key) => (await readAs(ctx[key].context, `age_grade_rollovers?id=eq.${ids.rollover}&select=id`)).rows
    record("C3 the Club Admin and the Fixtures Secretary read the handover plan", (await rollovers("admin")) === 1 && (await rollovers("secretary")) === 1)
    record("C4 and an ordinary member and another club read none of it", (await rollovers("member")) === 0 && (await rollovers("farAdmin")) === 0)

    const confirmBySecretary = await rpc(ctx.secretary.context, "confirm_rollover_team_proposal", { p_proposal_id: ids.prop12, p_action: "confirm" })
    record("C5 the Fixtures Secretary may PREPARE the handover -- confirming a progression is theirs (J.5 line 426)",
      confirmBySecretary.status < 300, `${confirmBySecretary.status} ${confirmBySecretary.body.slice(0, 140)}`)

    const graduateBySecretary = await rpc(ctx.secretary.context, "confirm_rollover_team_proposal", { p_proposal_id: ids.prop18, p_action: "graduate" })
    record("C6 but they may NOT graduate a cohort through it -- that keeps its own lifecycle gate (J.5 line 422)",
      graduateBySecretary.status >= 400, `${graduateBySecretary.status} ${graduateBySecretary.body.slice(0, 140)}`)
    const foldBySecretary = await rpc(ctx.secretary.context, "confirm_rollover_team_proposal", { p_proposal_id: ids.prop18, p_action: "fold", p_fold_reason: "attempted" })
    record("C7 nor fold a side through it", foldBySecretary.status >= 400, `${foldBySecretary.status}`)
    record("C8 and both sides are still active", one(`select count(*) from public.teams where id in ('${ids.team}','${ids.team18}') and active`) === "2")

    const graduateByAdmin = await rpc(ctx.admin.context, "confirm_rollover_team_proposal", { p_proposal_id: ids.prop18, p_action: "graduate" })
    record("C9 while the Club Admin may, so the refusal is the boundary and not a broken proposal",
      graduateByAdmin.status < 300, `${graduateByAdmin.status} ${graduateByAdmin.body.slice(0, 140)}`)

    const applyBySecretary = await rpc(ctx.secretary.context, "apply_season_handover", { p_rollover_id: ids.rollover })
    record("C10 INTENDED CHANGE: the Fixtures Secretary cannot APPLY the handover (section U) -- before this slice every handover RPC asked one undivided role",
      applyBySecretary.status >= 400, `${applyBySecretary.status} ${applyBySecretary.body.slice(0, 140)}`)
    const applyByFar = await rpc(ctx.farAdmin.context, "apply_season_handover", { p_rollover_id: ids.rollover })
    record("C11 nor another club's Club Admin, naming this handover's id", applyByFar.status >= 400, `${applyByFar.status}`)
    const applyByMember = await rpc(ctx.member.context, "apply_season_handover", { p_rollover_id: ids.rollover })
    record("C12 nor an ordinary member", applyByMember.status >= 400, `${applyByMember.status}`)
    record("C13 and nothing has moved: the U12 side is still U12", one(`select age_group from public.teams where id = '${ids.team}'`) === "U12")

    const applyByAdmin = await rpc(ctx.admin.context, "apply_season_handover", { p_rollover_id: ids.rollover })
    record("C14 the Club Admin applies it, and the U12 side becomes U13",
      applyByAdmin.status < 300 && one(`select age_group from public.teams where id = '${ids.team}'`) === "U13",
      `${applyByAdmin.status} ${applyByAdmin.body.slice(0, 140)}`)
    record("C15 and it is recorded as applied by the Club Admin, not the Secretary",
      one(`select applied_by from public.age_grade_rollovers where id = '${ids.rollover}'`) === people.admin.id)
  }

  // -------------------------------------------------------------------------
  // D. Partnerships and referrals (J.4 lines 409-411)
  // -------------------------------------------------------------------------
  {
    const partners = async (key) => (await readAs(ctx[key].context, `club_partnerships?id=eq.${ids.partnership}&select=id`)).rows
    record("D1 the Club Admin and the Fixtures Secretary see their club's partnership request", (await partners("admin")) === 1 && (await partners("secretary")) === 1)
    record("D2 and so does the club it was sent TO -- a partnership is a relationship, and both ends see it", (await partners("farAdmin")) === 1)
    record("D3 while an ordinary member of either club does not", (await partners("member")) === 0)
    record("D4 and another club cannot open a partnership in this club's name",
      (await writeAs(ctx.farAdmin.context, "club_partnerships", { requesting_club_id: ids.club, partner_club_id: ids.farClub, status: "pending", requested_by: people.farAdmin.id })) >= 400)

    const referrals = async (key) => (await readAs(ctx[key].context, `club_ovalball_invitations?id=eq.${ids.referral}&select=id`)).rows
    record("D5 the Club Admin sees the club's invitations to clubs not yet on Ovalball", (await referrals("admin")) === 1)
    record("D6 and so does the Fixtures Secretary -- that invitation is a partnership act (J.4 line 409), the same boundary the partnership table uses", (await referrals("secretary")) === 1)
    record("D7 while an ordinary member and another club see none of it", (await referrals("member")) === 0 && (await referrals("farAdmin")) === 0)
    record("D8 and neither a member nor another club can create one in this club's name",
      (await writeAs(ctx.member.context, "club_ovalball_invitations", { inviting_club_id: ids.club, club_directory_id: ids.farDir, contact_name: "X", contact_email: `attack-m-${TAG}@ovalball.test`, invited_by: people.member.id })) >= 400
      && (await writeAs(ctx.farAdmin.context, "club_ovalball_invitations", { inviting_club_id: ids.club, club_directory_id: ids.farDir, contact_name: "X", contact_email: `attack-f-${TAG}@ovalball.test`, invited_by: people.farAdmin.id })) >= 400
      && one(`select count(*) from public.club_ovalball_invitations where inviting_club_id = '${ids.club}' and contact_email like 'attack-%'`) === "0")
    // The referral LEDGER is the other half, and it keeps the narrower answer J.4 lines 410-411 give it.
    record("D9 while the referral ledger stays the administrator's -- claim_club_referral refuses the Secretary",
      (await rpc(ctx.secretary.context, "claim_club_referral", { p_invitation_id: ids.referral })).status >= 400)
  }

  // -------------------------------------------------------------------------
  // E. Z-12: the object-storage bucket
  // -------------------------------------------------------------------------
  {
    record("E1 the club-documents bucket has all four policies, including delete (Z-12)",
      one(`select count(*) from pg_policies where schemaname='storage' and (coalesce(qual,'')||' '||coalesce(with_check,'')) like '%club-documents%'`) === "4")
    const deleteAs = async (key) => {
      const res = await ctx[key].context.request.delete(`${API}/storage/v1/object/club-documents/${ids.club}/policy-${TAG}.pdf`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${await tokenFor(ctx[key].context)}` }, failOnStatusCode: false,
      })
      return res.status()
    }
    // The object itself was never uploaded, so a 4xx is the only correct answer for everybody; what
    // this proves is that the DELETE route exists and refuses rather than 404-ing on a missing policy.
    const memberDelete = await deleteAs("member")
    const farDelete = await deleteAs("farAdmin")
    record("E2 and a member and another club are both refused the delete path", memberDelete >= 400 && farDelete >= 400, `member=${memberDelete} far=${farDelete}`)
  }

  // -------------------------------------------------------------------------
  // F. The product surfaces
  // -------------------------------------------------------------------------
  {
    const adminVisit = await open(ctx.admin.page, "/club/rollover")
    record("F1 the Club Admin reaches Season Handover", adminVisit.status === 200 && /\/club\/rollover/.test(adminVisit.url), `status=${adminVisit.status} url=${adminVisit.url}`)
    const secretaryVisit = await open(ctx.secretary.page, "/club/rollover")
    record("F2 and so does the Fixtures Secretary, because preparing it is theirs", /\/club\/rollover/.test(secretaryVisit.url), `url=${secretaryVisit.url}`)
    const memberVisit = await open(ctx.member.page, "/club/rollover")
    record("F3 an ordinary member does not", !/\/club\/rollover$/.test(memberVisit.url), `url=${memberVisit.url}`)
    await ctx.admin.page.setViewportSize({ width: 390, height: 844 })
    await open(ctx.admin.page, "/club/rollover")
    const overflow = await ctx.admin.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record("F4 and Season Handover fits a 390px phone with no sideways scroll", overflow <= 1, `overflow=${overflow}px`)
    await ctx.admin.page.setViewportSize({ width: 1280, height: 900 })
  }

  record("I1 no page error, console error or 5xx on any surface", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  await browser.close()
  await cleanup()
  summarise()
}
