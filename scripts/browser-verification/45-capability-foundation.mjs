// CAPABILITY AND AUTHORISATION FOUNDATION -- browser acceptance.
//
// Identity/Auth Slice 3, driven through the running product with disposable identities and clubs:
//
//   a Club Admin        Club Permissions shows each answer with where it came from; allowing a
//                       permission records a club decision under its canonical key; a decision
//                       Ovalball made is shown as restricted, with no controls to change it
//   Team Administration is never offered Team Admin on the team page; with its own session it gives
//                       Coach on its team and is refused Team Admin (the member picker itself is Club
//                       Admin-only until Slice 8 decides people visibility)
//   one identity        Club Admin at one club and a player at another: each context shows its own
//                       role, Club Permissions opens only for the club they run, and the database
//                       answers differ by the scope asked, whatever context is selected
//   a Read Only admin   Site Admin navigation renders from site capabilities (no Claims); Permission
//                       Management is read-only; a direct write to a club profile changes nothing
//   a Club Data admin   edits a club profile it does not belong to, through the explicit site capability
//   a phone             Club Permissions fits 390px
//   every page          no page error, console error or 5xx response
//
// Everything this run creates is removed at the end, including its audit and security-event history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/45-capability-foundation.mjs

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
  admin: { email: `uat.slice3.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  member: { email: `uat.slice3.member.${TAG}@ovalball.test`, first: "Morgan", surname: `Member ${TAG}` },
  teamAdmin: { email: `uat.slice3.teamadmin.${TAG}@ovalball.test`, first: "Taylor", surname: `Teamadmin ${TAG}` },
  newCoach: { email: `uat.slice3.newcoach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  multi: { email: `uat.slice3.multi.${TAG}@ovalball.test`, first: "Robin", surname: `Multi ${TAG}` },
  readOnly: { email: `uat.slice3.readonly.${TAG}@ovalball.test`, first: "Rowan", surname: `Readonly ${TAG}` },
  clubData: { email: `uat.slice3.clubdata.${TAG}@ovalball.test`, first: "Dale", surname: `Clubdata ${TAG}` },
  // decides the Site-level withhold below; never signs in
  ovalball: { email: `uat.slice3.ovalball.${TAG}@ovalball.test`, first: "Olly", surname: `Ovalball ${TAG}` },
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
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-slice3-a-${tag}', 'uat-slice3-b-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice3.%.${tag}@ovalball.test');
  v_players uuid[] := array(select id from public.players where surname like '% ${tag}');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_players || v_clubs
    || array(select id from public.teams where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs))
    || array(select id from public.role_assignments where club_id = any(v_clubs))
    || array(select id from public.capability_overrides where club_id = any(v_clubs) or user_id = any(v_people))
    || array(select id from public.site_capability_grants where user_id = any(v_people))
    || array(select id from public.site_admins where user_id = any(v_people))
    || array(select id from public.player_team_memberships where player_id = any(v_players))
    || array(select id from public.access_review_items where club_id = any(v_clubs))
    || array(select id from public.club_directory where normalized_key in ('uat-slice3-a-${tag}', 'uat-slice3-b-${tag}'));
  delete from public.capability_overrides where club_id = any(v_clubs) or user_id = any(v_people);
  delete from public.site_capability_grants where user_id = any(v_people);
  delete from public.site_admin_diagnostic_sessions where site_admin_user_id = any(v_people);
  delete from public.site_admins where user_id = any(v_people);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.access_review_items where club_id = any(v_clubs);
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.notifications where user_id = any(v_people);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key in ('uat-slice3-a-${tag}', 'uat-slice3-b-${tag}');
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = any(v_clubs)
    or metadata ->> 'membership_id' in (select unnest(v_records)::text);
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
  const left = one(`select (select count(*) from public.clubs where slug like 'uat-slice3-%-${TAG}') + (select count(*) from auth.users where email like 'uat.slice3.%.${TAG}@ovalball.test')
    + (select count(*) from public.players where surname like '% ${TAG}') + (select count(*) from public.capability_overrides o join auth.users u on u.id = o.user_id where u.email like 'uat.slice3.%')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, player, decision, history row and cached session this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", () => {
  cleanup()
  process.exit(1)
})

async function rest(pathAndQuery, { token, method = "GET", body, prefer } = {}) {
  const res = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
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
// Seed
// ---------------------------------------------------------------------------
// A crashed earlier run leaves its tagged rows behind; clear them first.
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice3.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)
const ids = {}
ids.dirA = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Three Alpha RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice3-a-${TAG}') returning id`)
ids.dirB = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Three Bravo RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice3-b-${TAG}') returning id`)
ids.clubA = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dirA}', 'uat-slice3-a-${TAG}', 'active') returning id`)
ids.clubB = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dirB}', 'uat-slice3-b-${TAG}', 'active') returning id`)
ids.teamA = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.clubA}', 'Under 12 Boys', 'uat-slice3-a-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
ids.teamB = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.clubB}', 'Under 14 Boys', 'uat-slice3-b-u14-${TAG}', 'youth', 'U14', 'boys', 'union', true) returning id`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.clubA}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.clubA}', '${people.member.id}', 'BASIC_USER', 'active'),
  ('${ids.clubA}', '${people.teamAdmin.id}', 'BASIC_USER', 'active'),
  ('${ids.clubA}', '${people.newCoach.id}', 'BASIC_USER', 'active'),
  ('${ids.clubA}', '${people.multi.id}', 'CLUB_ADMIN', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.teamA}', 'team_admin' from public.club_memberships where club_id = '${ids.clubA}' and user_id = '${people.teamAdmin.id}';
insert into public.site_admins (user_id, status, admin_role) values ('${people.readOnly.id}', 'active', 'read_only'), ('${people.clubData.id}', 'active', 'club_data'), ('${people.ovalball.id}', 'active', 'full');`)
ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Robin', 'Multi ${TAG}', (current_date - interval '15 years')::date, 'MALE', '${people.multi.id}') returning id`)
// The multi-role person is an adult who also plays for Club B's U14s (age grade irrelevant to authority here).
sql(`update public.players set date_of_birth = (current_date - interval '30 years')::date where id = '${ids.player}';
insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.player}', '${ids.teamB}', 'active');
insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, effect, status, granted_by, granted_level, reason)
  values ('${people.member.id}', 'fixture.fixture.cancel', 'club', '${ids.clubA}', 'deny', 'active', '${people.ovalball.id}', 'SITE', 'Ovalball decision for acceptance');`)

const browser = await launch()
try {
  // -------------------------------------------------------------------------
  // A. Club Admin: Club Permissions with provenance
  // -------------------------------------------------------------------------
  const adminCtx = watch(await newContext(browser), "admin")
  await adminCtx.addCookies([{ name: "ovalball_ctx", value: `club:${ids.clubA}`, url: APP }])
  const admin = await adminCtx.newPage()
  await signIn(admin, people.admin.email)
  let page = await open(admin, "/club/permissions")
  record("A1 Club Admin: Club Permissions lists the club's people", page.status < 400 && !page.broken && page.body.includes(people.member.surname), `HTTP ${page.status}`)

  const memberCard = admin.locator("div.rounded-lg", { hasText: people.member.surname }).first()
  await memberCard.getByRole("button", { name: new RegExp(people.member.surname) }).click()
  const row = (card, label) => card.locator("li").filter({ has: admin.getByText(label, { exact: true }) })
  const editRow = row(memberCard, "Edit Fixtures")
  const cancelRow = row(memberCard, "Cancel Fixtures")
  const viewRow = row(memberCard, "View Fixtures")
  await editRow.waitFor()
  record("A2 each answer shows where it came from: from their role, not from their role, restricted by Ovalball",
    /From their role/.test(await viewRow.innerText()) && /Not from their role/.test(await editRow.innerText()) && /Restricted by Ovalball/.test(await cancelRow.innerText()),
    `${(await viewRow.innerText()).split("\n").slice(-1)} | ${(await cancelRow.innerText()).split("\n").slice(-2).join(" ")}`)
  record("A3 a decision Ovalball made offers the club no controls, and says why",
    (await cancelRow.getByRole("button", { name: "Allow" }).count()) === 0 && /can only be changed by Ovalball/.test(await cancelRow.innerText()))

  await editRow.getByRole("button", { name: "Allow" }).click()
  await until("the club allow", `select effect || '|' || granted_level from public.capability_overrides where user_id = '${people.member.id}' and capability_key = 'fixture.fixture.edit' and status = 'active'`, "grant|CLUB")
  await admin.waitForTimeout(800)
  page = await open(admin, "/club/permissions")
  await admin.locator("div.rounded-lg", { hasText: people.member.surname }).first().getByRole("button", { name: new RegExp(people.member.surname) }).click()
  const editRowAfter = row(admin.locator("div.rounded-lg", { hasText: people.member.surname }).first(), "Edit Fixtures")
  record("A4 allowing records a CLUB decision under the canonical key, with its event, and the row now reads Granted",
    /Allowed · Granted/.test(await editRowAfter.innerText())
      && one(`select count(*) from public.security_events where event_type = 'override.granted' and subject_user_id = '${people.member.id}' and actor_user_id = '${people.admin.id}'`) === "1",
    (await editRowAfter.innerText()).replace(/\n/g, " | "))

  const phone = watch(await newContext(browser, { width: 390, height: 844 }), "admin phone")
  await phone.addCookies([...(await adminCtx.cookies())])
  const phonePage = await phone.newPage()
  page = await open(phonePage, "/club/permissions")
  const m = await measure(phonePage)
  record("A5 phone: Club Permissions fits 390px with no sideways scroll", page.status < 400 && m.scrollWidth <= m.innerWidth, JSON.stringify(m))
  await phone.close()

  // -------------------------------------------------------------------------
  // B. Team Administration assigns a Coach on its own team
  // -------------------------------------------------------------------------
  const taCtx = watch(await newContext(browser), "team admin")
  await taCtx.addCookies([{ name: "ovalball_ctx", value: `team:${ids.teamA}`, url: APP }])
  const ta = await taCtx.newPage()
  await signIn(ta, people.teamAdmin.email)
  page = await open(ta, `/teams/${ids.teamA}`)
  const roleSelect = ta.getByLabel("Role in this team")
  const optionLabels = await roleSelect.locator("option").allInnerTexts()
  record("B1 Team Administration sees the team's people with Coach and Manager to give, never Team Admin",
    page.status < 400 && !page.broken && optionLabels.includes("Coach") && !optionLabels.includes("Team Admin"), optionLabels.join(","))
  // The member picker is fed by the club member directory, which only Club Admins and Site Admins read
  // (people visibility is Slice 8). Team Administration's new authority is exercised with its own signed-in
  // session against the same RPC the Assign button calls.
  const taToken = await accessTokenOf(taCtx)
  const membershipOfNewCoach = one(`select id from public.club_memberships where user_id = '${people.newCoach.id}' and club_id = '${ids.clubA}'`)
  const assigned = await rest("rpc/set_team_access", { token: taToken, method: "POST", body: { p_membership_id: membershipOfNewCoach, p_team_id: ids.teamA, p_permission: "coach" } })
  await until("the coach assignment", `select source from public.role_assignments where user_id = '${people.newCoach.id}' and team_id = '${ids.teamA}' and role_key = 'COACH' and state = 'ACTIVE'`, "TEAM_ADMIN_ASSIGNMENT")
  record("B2 with their own session, Team Administration gives Coach on their team, recorded as a Team Admin assignment", assigned.status < 300, `HTTP ${assigned.status}`)
  const forged = await rest("rpc/set_team_access", { token: taToken, method: "POST", body: { p_membership_id: membershipOfNewCoach, p_team_id: ids.teamA, p_permission: "team_admin" } })
  record("B3 the API refuses Team Admin from Team Administration too, and nothing changed",
    forged.status >= 400 && one(`select count(*) from public.role_assignments where user_id = '${people.newCoach.id}' and role_key = 'TEAM_ADMINISTRATION'`) === "0", `HTTP ${forged.status}`)

  // -------------------------------------------------------------------------
  // C. One identity, two legitimate contexts
  // -------------------------------------------------------------------------
  const multiCtx = watch(await newContext(browser), "multi")
  await multiCtx.addCookies([{ name: "ovalball_ctx", value: `club:${ids.clubA}`, url: APP }])
  const multi = await multiCtx.newPage()
  await signIn(multi, people.multi.email)
  page = await open(multi, "/club/permissions")
  record("C1 as Club Admin of Alpha, Club Permissions opens for Alpha", page.status < 400 && page.url.includes("/club/permissions") && /Slice Three Alpha/.test(page.body), page.url.replace(APP, ""))
  await multiCtx.addCookies([{ name: "ovalball_ctx", value: `player:${ids.teamB}`, url: APP }])
  page = await open(multi, "/dashboard")
  const playerContextBody = page.body
  page = await open(multi, "/club/permissions")
  record("C2 switched to their Bravo player context, the interface is the player's and Club Permissions does not open",
    /Player/.test(playerContextBody) && !page.url.includes("/club/permissions"), page.url.replace(APP, ""))
  const multiToken = await accessTokenOf(multiCtx)
  const alpha = await rest("rpc/my_capabilities", { token: multiToken, method: "POST", body: { p_scope_type: "club", p_club_id: ids.clubA } })
  const bravo = await rest("rpc/my_capabilities", { token: multiToken, method: "POST", body: { p_scope_type: "club", p_club_id: ids.clubB } })
  const bravoTeam = await rest("rpc/my_capabilities", { token: multiToken, method: "POST", body: { p_scope_type: "team", p_club_id: ids.clubB, p_team_id: ids.teamB } })
  const allowed = (r, key) => JSON.parse(r.text).some((row) => row.capability_key === key && row.allowed)
  record("C3 whatever context is selected, the database answers by scope: Club Admin at Alpha only; player at Bravo's team only",
    allowed(alpha, "people.capability.manage") && !allowed(bravo, "people.capability.manage") && !allowed(bravo, "fixture.fixture.edit")
      && allowed(bravoTeam, "fixture.fixture.view") && !allowed(bravoTeam, "fixture.fixture.edit"),
    `alpha manage=${allowed(alpha, "people.capability.manage")} bravo manage=${allowed(bravo, "people.capability.manage")} bravo team view=${allowed(bravoTeam, "fixture.fixture.view")}`)

  // -------------------------------------------------------------------------
  // D. Read Only and Club Data Site Admins
  // -------------------------------------------------------------------------
  const roCtx = watch(await newContext(browser), "read only")
  await roCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  const ro = await roCtx.newPage()
  await signIn(ro, people.readOnly.email)
  page = await open(ro, "/admin/permissions")
  const nav = await ro.locator("nav").first().innerText().catch(() => "")
  record("D1 Read Only: Site Admin navigation comes from site capabilities (Club Management yes, Claims no)",
    page.status < 400 && /Club Management/.test(page.body) && !/\bClaims\b/.test(nav), nav.replace(/\n/g, ", ").slice(0, 160))
  const groupControls = await ro.locator("main").getByRole("button").allInnerTexts()
  record("D2 Read Only: Permission Management is read-only (no new, edit, deactivate or delete controls on the groups)",
    /Permission Management/.test(page.body) && /Club Admin/.test(page.body) && !groupControls.some((b) => /New permission group|^Edit$|Deactivate|Reactivate|Delete/.test(b.trim())),
    `buttons in main: ${groupControls.map((b) => b.trim()).filter(Boolean).join(", ") || "none"}`)
  const roToken = await accessTokenOf(roCtx)
  const roWrite = await rest(`clubs?id=eq.${ids.clubA}`, { token: roToken, method: "PATCH", body: { bio: "read only write" }, prefer: "return=representation" })
  record("D3 Read Only: a direct write to a club profile changes nothing",
    roWrite.text.trim() === "[]" && one(`select coalesce(bio, '') from public.clubs where id = '${ids.clubA}'`) !== "read only write", `HTTP ${roWrite.status} ${roWrite.text.slice(0, 40)}`)

  const dataCtx = watch(await newContext(browser), "club data")
  await dataCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  const data = await dataCtx.newPage()
  await signIn(data, people.clubData.email)
  page = await open(data, `/admin/clubs/${ids.dirB}`)
  await data.getByRole("tab", { name: "Ovalball profile" }).click()
  await data.locator("#profile-bio").fill(`Profile kept by Ovalball ${TAG}`)
  await data.getByRole("button", { name: "Save profile" }).click()
  await until("the Club Data profile edit", `select bio from public.clubs where id = '${ids.clubB}'`, `Profile kept by Ovalball ${TAG}`)
  record("D4 Club Data admin edits a club profile it does not belong to, through site.clubs.profile.manage", true)

  record("H1 no page error, console error or 5xx on any page this run opened", pageProblems.length === 0, pageProblems.slice(0, 5).join(" || "))
} catch (e) {
  record("ABORT the run stopped before finishing", false, String(e?.message ?? e).split("\n")[0])
} finally {
  await browser.close()
  cleanup()
}
process.exit(summarise() ? 0 : 1)
