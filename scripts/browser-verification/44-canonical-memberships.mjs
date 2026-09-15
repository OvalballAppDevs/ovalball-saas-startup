// CANONICAL MEMBERSHIPS, ROLES AND FAMILY RELATIONSHIPS -- browser acceptance.
//
// Identity/Auth Slice 2, driven through the running product as the people
// who use it, with disposable identities and a disposable club:
//
//   a Club Admin     approves one join request and declines another (a
//                    reason is required); changes a member's club role;
//                    removes a member (a reason is required); assigns and
//                    removes a team Coach, with no View Only choice; cannot
//                    demote themselves as the last Club Admin; cannot
//                    revive a removed membership through the API
//   two guardians    one asks for another adult to be added; the club cannot
//                    approve until that adult accepts on their own page;
//                    then the club approves and the relationship is ACTIVE
//   a Site Admin     removal needs a reason; a removed member is re-admitted
//                    as a NEW membership, never by switching the old one on
//   a phone          People with its join-request queue fits 390px
//   every page       no page error, console error or 5xx response
//
// Everything this run creates is removed at the end, including the audit and
// security-event history of its disposable identities.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/44-canonical-memberships.mjs

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
  admin: { email: `uat.slice2.admin.${TAG}@ovalball.test`, first: "Alex", surname: `Admin ${TAG}` },
  member: { email: `uat.slice2.member.${TAG}@ovalball.test`, first: "Morgan", surname: `Member ${TAG}` },
  helper: { email: `uat.slice2.helper.${TAG}@ovalball.test`, first: "Harper", surname: `Helper ${TAG}` },
  joiner: { email: `uat.slice2.joiner.${TAG}@ovalball.test`, first: "Jordan", surname: `Joiner ${TAG}` },
  decliner: { email: `uat.slice2.decliner.${TAG}@ovalball.test`, first: "Dana", surname: `Decliner ${TAG}` },
  parent: { email: `uat.slice2.parent.${TAG}@ovalball.test`, first: "Pat", surname: `Parent ${TAG}` },
  added: { email: `uat.slice2.added.${TAG}@ovalball.test`, first: "Ari", surname: `Added ${TAG}` },
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
function cleanup() {
  if (cleaned) return
  cleaned = true
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'uat-slice2-${TAG}');
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice2.%.${TAG}@ovalball.test');
  v_players uuid[] := array(select id from public.players where surname = 'Child ${TAG}');
  v_records uuid[];
begin
  -- audit_log and security_events are append-only; a local test operator
  -- session may remove its own disposable history only through maintenance.
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_players
    || array(select id from public.clubs where id = v_club)
    || array(select id from public.teams where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.club_join_requests where club_id = v_club)
    || array(select id from public.guardian_link_requests where club_id = v_club)
    || array(select id from public.guardians where player_id = any(v_players))
    || array(select id from public.player_team_memberships where player_id = any(v_players))
    || array(select id from public.access_review_items where club_id = v_club)
    || array(select id from public.club_directory where normalized_key = 'uat-slice2-${TAG}');
  delete from public.guardian_link_requests where club_id = v_club;
  delete from public.guardians where player_id = any(v_players);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.access_review_items where club_id = v_club;
  delete from public.club_join_requests where club_id = v_club;
  delete from public.role_assignments where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.notifications where user_id = any(v_people) or data ->> 'club_id' = v_club::text;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = 'uat-slice2-${TAG}';
  delete from public.security_events where subject_user_id = any(v_people) or club_id = v_club or player_id = any(v_players)
    or metadata ->> 'membership_id' in (select unnest(v_records)::text);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  -- Removing the people writes their profiles' own deletion history last.
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
  // The harness caches each identity's session on disk; these identities no
  // longer exist, so neither should their cached cookies.
  for (const person of Object.values(people)) {
    try {
      fs.unlinkSync(path.join(os.tmpdir(), "ovalball-uat-sessions", `${person.email.replace(/[^a-z0-9.@-]/gi, "_")}.json`))
    } catch {}
  }
  const left = one(`select (select count(*) from public.clubs where slug = 'uat-slice2-${TAG}') + (select count(*) from auth.users where email like 'uat.slice2.%.${TAG}@ovalball.test') + (select count(*) from public.players where surname = 'Child ${TAG}')`)
  const cached = fs.existsSync(path.join(os.tmpdir(), "ovalball-uat-sessions"))
    ? fs.readdirSync(path.join(os.tmpdir(), "ovalball-uat-sessions")).filter((f) => f.includes(`.${TAG}@`)).length
    : 0
  record("Z1 cleanup: every club, identity, player, history row and cached session this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", () => {
  cleanup()
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

/**
 * Poll the database for the outcome an action must produce. The database is
 * the authority; a confirmation line on screen is not, because a Server
 * Action's refresh can replace it within a few hundred milliseconds (a
 * decided join request leaves the queue, a removed person leaves the list,
 * a revoked card moves into the collapsed "revoked memberships" section).
 * Waiting for that transient text is what made one run abort on a timeout.
 */
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

/** Every page error, console error and 5xx response, from every page this run opens. */
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

const membershipOf = (person, extra = "") =>
  one(`select id from public.club_memberships where club_id = (select id from public.clubs where slug = 'uat-slice2-${TAG}') and user_id = '${person.id}' ${extra} order by created_at desc limit 1`)

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
for (const person of Object.values(people)) await createIdentity(person)
const ids = {}
ids.directory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Two RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice2-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.directory}', 'uat-slice2-${TAG}', 'active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 12 Boys', 'uat-slice2-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.club}', '${people.member.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.helper.id}', 'BASIC_USER', 'active');
insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values
  ('${ids.club}', '${people.joiner.id}', 'Volunteer'),
  ('${ids.club}', '${people.decliner.id}', 'Coach');`)
ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Charlie', 'Child ${TAG}', (current_date - interval '11 years 6 months')::date, 'MALE') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.player}', '${ids.team}', 'active');
insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${people.parent.id}', '${ids.player}', 'parent', 'active');`)

const browser = await launch()
try {
  // -------------------------------------------------------------------------
  // A. Club Admin: join requests
  // -------------------------------------------------------------------------
  const adminCtx = watch(await newContext(browser), "admin")
  const admin = await adminCtx.newPage()
  await signIn(admin, people.admin.email)
  let page = await open(admin, "/people")
  record("A1 Club Admin: People renders with a Join Requests queue naming both people who asked",
    page.status < 400 && !page.broken && /Join Requests/i.test(page.body) && page.body.includes(people.joiner.surname) && page.body.includes(people.decliner.surname), `HTTP ${page.status}`)

  const queue = admin.locator('section[aria-labelledby="join-requests-heading"]')
  const joinerRow = queue.locator("li", { hasText: people.joiner.surname })
  await joinerRow.getByRole("button", { name: "Approve" }).click()
  await until("the join request to be approved", `select status from public.club_join_requests where requesting_user_id = '${people.joiner.id}'`, "approved")
  await joinerRow.waitFor({ state: "detached", timeout: 30000 })
  record("A2 approving a request makes that same membership ACTIVE, as a Member only, and closes the request",
    one(`select cm.state || '|' || j.status || '|' || (select string_agg(role_key, ',') from public.role_assignments where membership_id = cm.id and state = 'ACTIVE')
         from public.club_memberships cm join public.club_join_requests j on j.id = cm.source_request_id where cm.user_id = '${people.joiner.id}'`) === "ACTIVE|approved|MEMBER",
    `${one(`select state from public.club_memberships where user_id = '${people.joiner.id}'`)}; request left the queue`)

  const declinerRow = queue.locator("li", { hasText: people.decliner.surname })
  await declinerRow.getByRole("button", { name: "Decline" }).click()
  const declineButton = declinerRow.getByRole("button", { name: "Decline Request" })
  const disabledWithoutReason = await declineButton.isDisabled()
  await declinerRow.getByLabel("Reason for Declining").fill("Not known to the club")
  await declineButton.click()
  await until("the join request to be declined", `select status from public.club_join_requests where requesting_user_id = '${people.decliner.id}'`, "rejected")
  await declinerRow.waitFor({ state: "detached", timeout: 30000 })
  record("A3 declining needs a reason; the membership is DECLINED and holds no role",
    disabledWithoutReason && one(`select state || '|' || (select count(*) from public.role_assignments where membership_id = cm.id) from public.club_memberships cm where cm.user_id = '${people.decliner.id}'`) === "DECLINED|0",
    `disabled without reason: ${disabledWithoutReason}`)

  // -------------------------------------------------------------------------
  // B. Club Admin: club role and removal
  // -------------------------------------------------------------------------
  page = await open(admin, "/people")
  const helperRow = admin.locator("li", { hasText: people.helper.surname })
  await helperRow.getByLabel(/Club-wide role for/).selectOption("FIXTURE_SECRETARY")
  let helperRole = ""
  for (let i = 0; i < 40 && helperRole !== "FIXTURE_SECRETARY"; i++) {
    await admin.waitForTimeout(250)
    helperRole = one(`select role from public.club_memberships where id = '${membershipOf(people.helper)}'`)
  }
  record("B1 changing a member's club role records a Fixtures Secretary role assignment",
    helperRole === "FIXTURE_SECRETARY" && one(`select count(*) from public.role_assignments where membership_id = '${membershipOf(people.helper)}' and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE' and source = 'CLUB_ADMIN_ASSIGNMENT'`) === "1", helperRole)

  const memberRow = admin.locator("li", { hasText: people.member.surname })
  await memberRow.getByRole("button", { name: "Remove" }).click()
  const dialog = admin.getByRole("dialog")
  const removeButton = dialog.getByRole("button", { name: "Remove Access" })
  const removeDisabled = await removeButton.isDisabled()
  await dialog.getByLabel("Reason for Removal").fill("Stepped down from the committee")
  await removeButton.click()
  const memberMs = membershipOf(people.member)
  await until("the membership to be removed", `select state from public.club_memberships where id = '${memberMs}'`, "REVOKED")
  await memberRow.waitFor({ state: "detached", timeout: 30000 })
  record("B2 removal needs a reason; the membership is REVOKED with that reason and every role ended",
    removeDisabled && one(`select state || '|' || revocation_reason || '|' || (select count(*) from public.role_assignments where membership_id = cm.id and state <> 'REVOKED') from public.club_memberships cm where id = '${memberMs}'`) === "REVOKED|Stepped down from the committee|0",
    `disabled without reason: ${removeDisabled}`)

  // -------------------------------------------------------------------------
  // C. Club Admin: team roles
  // -------------------------------------------------------------------------
  page = await open(admin, `/teams/${ids.team}`)
  const roleOptions = await admin.getByLabel("Role in this team").locator("option").allInnerTexts()
  record("C1 the team role choice offers Team Admin, Coach and Manager, and no View Only",
    roleOptions.join(",") === "Team Admin,Coach,Manager", roleOptions.join(","))
  await admin.getByLabel("Club member").selectOption({ label: `${people.joiner.first} ${people.joiner.surname}` })
  await admin.getByLabel("Role in this team").selectOption("coach")
  await admin.getByRole("button", { name: "Assign", exact: true }).click()
  const coachRow = admin.locator("li", { hasText: people.joiner.surname })
  await coachRow.waitFor({ timeout: 30000 })
  const joinerMs = membershipOf(people.joiner)
  record("C2 assigning a member as Coach creates a COACH role assignment on that team",
    one(`select count(*) from public.role_assignments where membership_id = '${joinerMs}' and team_id = '${ids.team}' and role_key = 'COACH' and state = 'ACTIVE'`) === "1", "")
  await coachRow.getByRole("button", { name: "Remove" }).click()
  let open2 = "1"
  for (let i = 0; i < 40 && open2 !== "0"; i++) {
    await admin.waitForTimeout(250)
    open2 = one(`select count(*) from public.role_assignments where membership_id = '${joinerMs}' and team_id = '${ids.team}' and state <> 'REVOKED'`)
  }
  record("C3 removing them from the team revokes that team role", open2 === "0", `open=${open2}`)

  // -------------------------------------------------------------------------
  // D. Nothing removed comes back; the last Club Admin stays
  // -------------------------------------------------------------------------
  const adminToken = await accessTokenOf(adminCtx)
  const patch = await rest(`club_memberships?id=eq.${memberMs}`, { token: adminToken, method: "PATCH", body: { status: "active" } })
  const revive = await rest("rpc/transition_club_membership", { token: adminToken, method: "POST", body: { p_membership_id: memberMs, p_to_state: "ACTIVE", p_reason: "come back" } })
  const viewWrite = await rest("team_permissions", { token: adminToken, method: "POST", body: { membership_id: memberMs, team_id: ids.team, permission: "team_admin" } })
  record("D1 a Club Admin cannot revive a removed membership: direct write refused, transition refused, legacy team write refused",
    [401, 403].includes(patch.status) && revive.status === 400 && /cannot be switched back on/.test(revive.text) && [401, 403].includes(viewWrite.status)
      && one(`select state from public.club_memberships where id = '${memberMs}'`) === "REVOKED",
    `PATCH ${patch.status} / RPC ${revive.status} / view ${viewWrite.status}`)
  const adminMs = membershipOf(people.admin)
  const demote = await rest("rpc/set_primary_club_role", { token: adminToken, method: "POST", body: { p_membership_id: adminMs, p_role: "BASIC_USER" } })
  record("D2 the only Club Admin cannot demote themselves",
    demote.status === 400 && /without a Club Admin/.test(demote.text) && one(`select role from public.club_memberships where id = '${adminMs}'`) === "CLUB_ADMIN", `HTTP ${demote.status}`)

  // -------------------------------------------------------------------------
  // E. Another guardian: requested, accepted by that adult, approved by the club
  // -------------------------------------------------------------------------
  const parentCtx = watch(await newContext(browser), "parent")
  const parent = await parentCtx.newPage()
  await signIn(parent, people.parent.email)
  page = await open(parent, "/parent/children")
  await parent.getByRole("button", { name: "Add another guardian" }).click()
  await parent.getByLabel("Their Email Address").fill(people.added.email)
  await parent.getByRole("button", { name: /Send request/i }).click()
  await until("the guardian request to be created", `select count(*) from public.guardian_link_requests where requested_by_user_id = '${people.parent.id}'`, "1")
  const request = one(`select id from public.guardian_link_requests where requested_by_user_id = '${people.parent.id}' order by created_at desc limit 1`)
  record("E1 the parent asks for another adult; a relationship opens awaiting approval and grants nothing",
    one(`select state from public.guardians where guardian_user_id = '${people.added.id}' and player_id = '${ids.player}'`) === "PENDING_APPROVAL", request ? "request created" : "no request")

  page = await open(admin, "/guardian-requests")
  const requestCard = admin.locator("li", { hasText: "Waiting for" }).filter({ hasText: people.added.email })
  const approveBefore = requestCard.getByRole("button", { name: "Approve" })
  record("E2 the club sees the request waiting for that adult, and cannot approve it yet",
    (await requestCard.count()) === 1 && (await approveBefore.isDisabled()), `cards=${await requestCard.count()}`)

  const addedCtx = watch(await newContext(browser), "added")
  const added = await addedCtx.newPage()
  await signIn(added, people.added.email)
  // Someone with no child or club yet lands on the welcome page, which is
  // where the request has to be answerable.
  page = await open(added, "/dashboard")
  const askCard = added.locator("li", { hasText: "asked to be recognised as a guardian" })
  record("E3 the added adult, with no relationship yet, sees the request where they land, with Accept and Decline",
    (await askCard.count()) === 1 && (await askCard.getByRole("button", { name: "Decline" }).count()) === 1, `${page.url.replace(APP, "")} cards=${await askCard.count()}`)
  await askCard.getByRole("button", { name: "Accept" }).click()
  await until("the added adult's acceptance", `select coalesce(subject_response, '') from public.guardian_link_requests where requested_by_user_id = '${people.parent.id}'`, "ACCEPTED")
  // The refreshed welcome page states the accepted request; this line is the
  // settled state, not a transient confirmation.
  await added.getByText("Accepted. Waiting").waitFor({ timeout: 30000 })
  record("E4 accepting records their answer and still grants nothing",
    one(`select r.subject_response || '|' || g.state from public.guardian_link_requests r join public.guardians g on g.id = r.relationship_id where r.id = '${request}'`) === "ACCEPTED|PENDING_APPROVAL", "")

  page = await open(admin, "/guardian-requests")
  const readyCard = admin.locator("li", { hasText: people.added.email })
  await readyCard.getByRole("button", { name: "Approve" }).click()
  let guardianState = ""
  for (let i = 0; i < 40 && guardianState !== "ACTIVE"; i++) {
    await admin.waitForTimeout(250)
    guardianState = one(`select state from public.guardians where guardian_user_id = '${people.added.id}' and player_id = '${ids.player}'`)
  }
  record("E5 after acceptance the club approves, and the same relationship is ACTIVE with the approver recorded",
    guardianState === "ACTIVE" && one(`select approved_by from public.guardians where guardian_user_id = '${people.added.id}' and player_id = '${ids.player}'`) === people.admin.id, guardianState)
  page = await open(added, "/parent/children")
  record("E6 the added adult now sees the child", page.body.includes("Charlie"), page.url.replace(APP, ""))
  await parentCtx.close()
  await addedCtx.close()

  // -------------------------------------------------------------------------
  // F. Site Admin: removal with a reason, re-admission as a new membership
  // -------------------------------------------------------------------------
  const siteCtx = watch(await newContext(browser), "site admin")
  const site = await siteCtx.newPage()
  await signIn(site, SITE_ADMIN)
  await siteCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  page = await open(site, `/admin/clubs/${ids.directory}`)
  await site.getByRole("tab", { name: "Users & roles" }).click()
  const helperCard = site.locator("div.rounded-lg", { hasText: people.helper.email }).last()
  await helperCard.getByRole("button", { name: "Revoke access" }).click()
  const confirm = helperCard.getByRole("button", { name: "Confirm" })
  const confirmDisabled = await confirm.isDisabled()
  await helperCard.getByLabel(/Reason for Revoking/).fill("Club asked Support to remove this account")
  const helperMs = membershipOf(people.helper)
  await confirm.click()
  await until("the Site Admin's removal", `select state from public.club_memberships where id = '${helperMs}'`, "REVOKED")
  // The card now lives in the collapsed revoked section: open it and read the
  // settled page rather than the badge's first few hundred milliseconds.
  page = await open(site, `/admin/clubs/${ids.directory}`)
  await site.getByRole("tab", { name: "Users & roles" }).click()
  await site.getByText(/revoked membership/).click()
  const revokedHelperCard = site.locator("details div.rounded-lg", { hasText: people.helper.email }).last()
  const revokedBadge = await revokedHelperCard.getByText("Revoked", { exact: true }).isVisible()
  record("F1 a Site Admin's removal needs a reason, is recorded with it, and the person is listed as revoked",
    confirmDisabled && revokedBadge && one(`select revocation_reason from public.club_memberships where id = '${helperMs}'`) === "Club asked Support to remove this account",
    `disabled without reason: ${confirmDisabled}; listed as revoked: ${revokedBadge}`)

  const memberCard = site.locator("div.rounded-lg", { hasText: people.member.email }).last()
  await memberCard.getByRole("button", { name: "Re-admit" }).click()
  const readmit = memberCard.getByRole("button", { name: "Re-admit as Member" })
  const readmitDisabled = await readmit.isDisabled()
  await memberCard.getByLabel("Reason for Re-admitting").fill("Returned to the committee; confirmed by the club")
  await readmit.click()
  await until("the re-admission", `select count(*) from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.member.id}' and state = 'ACTIVE'`, "1")
  const memberRows = one(`select string_agg(state, ',' order by created_at) from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.member.id}'`)
  record("F2 re-admission needs a reason and creates a NEW membership as Member; the removed one stays REVOKED",
    readmitDisabled && memberRows === "REVOKED,ACTIVE"
      && one(`select string_agg(ra.role_key, ',') from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id where cm.user_id = '${people.member.id}' and cm.state = 'ACTIVE' and ra.state = 'ACTIVE'`) === "MEMBER",
    memberRows)
  const siteAdminId = one(`select id from auth.users where email = '${SITE_ADMIN}'`)
  record("F3 the re-admission is a membership.granted event attributed to the Site Admin, with its reason",
    one(`select count(*) from public.security_events where event_type = 'membership.granted' and subject_user_id = '${people.member.id}' and actor_user_id = '${siteAdminId}' and reason like 'Returned to the committee%'`) === "1", "")
  await siteCtx.close()

  // -------------------------------------------------------------------------
  // G. A phone
  // -------------------------------------------------------------------------
  sql(`insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values ('${ids.club}', '${people.decliner.id}', 'Coach, again')`)
  const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
  const phone = await phoneCtx.newPage()
  await signIn(phone, people.admin.email)
  page = await open(phone, "/people")
  const m = await measure(phone)
  record("G1 People and its join-request queue fit a 390px phone without sideways scrolling",
    m.innerWidth === 390 && m.scrollWidth <= 390 && /Join Requests/i.test(page.body), `inner=${m.innerWidth} scroll=${m.scrollWidth}`)
  await phoneCtx.close()
  await adminCtx.close()
  record("H1 no page error, console error or server error on any page this run opened", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | ") || "none")
} catch (error) {
  // An abort must never read as a clean run: say where it stopped.
  record("ABORT the run stopped before completing its checks", false, error.message.split("\n")[0])
} finally {
  try {
    cleanup()
  } finally {
    await browser.close()
  }
  process.exitCode = summarise() ? 0 : 1
}
