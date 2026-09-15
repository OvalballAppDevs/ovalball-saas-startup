// FAMILY AND PLAYER AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4a (Phase 2 AA.3 row 4a, J.6, N, W, AN-7, Z-12), driven through the running product with
// disposable identities and a disposable club:
//
//   a parent          adds a second child at their club: it waits for the club (the relationship is
//                     PENDING_APPROVAL and shows nothing until approved)
//   a Club Admin      sees the added child in Guardian Requests as added by the parent, approves it, and sees
//                     the pending team place with an age grade rather than a date of birth
//   a coach           sees the team's players in Match Centre by name, never with a date of birth
//   a Fixtures Sec.   does not reach the club's guardian settings and reads no guardian relationship directly
//   a Site Admin      puts a guardian relationship on hold with a reason (the child disappears for that parent,
//                     the child's other guardian is told), then lifts it
//   pictures          account pictures are private: nothing public, an adult's is signed for a signed-in
//                     person, a child's account picture is not signed for an unrelated coach
//   no team place     a guardian whose child has no team place yet is offered, and uses, the gender form and the
//                     consent switches the database allows; a coach and a Site Admin get what J.6 gives them
//   a phone           the parent's children page and the family panel fit 390px
//   every page        no page error, console error or 5xx response
//
// Everything this run creates is removed at the end, including its audit, notification and security-event history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/46-family-authority.mjs

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
  admin: { email: `uat.slice4a.admin.${TAG}@ovalball.test`, first: "Avery", surname: `Admin ${TAG}` },
  coach: { email: `uat.slice4a.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  otherCoach: { email: `uat.slice4a.othercoach.${TAG}@ovalball.test`, first: "Oakley", surname: `Othercoach ${TAG}` },
  secretary: { email: `uat.slice4a.secretary.${TAG}@ovalball.test`, first: "Sam", surname: `Secretary ${TAG}` },
  parent: { email: `uat.slice4a.parent.${TAG}@ovalball.test`, first: "Pat", surname: `Parent ${TAG}` },
  partner: { email: `uat.slice4a.partner.${TAG}@ovalball.test`, first: "Robin", surname: `Partner ${TAG}` },
  teen: { email: `uat.slice4a.teen.${TAG}@ovalball.test`, first: "Toby", surname: `Teen ${TAG}` },
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
  v_club uuid := (select id from public.clubs where slug = 'uat-slice4a-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4a.%.${tag}@ovalball.test');
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
    || array(select id from public.club_directory where normalized_key = 'uat-slice4a-${tag}');
  delete from public.notifications where user_id = any(v_people);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club);
  delete from public.guardian_player_permissions where player_id = any(v_players);
  delete from public.guardian_link_requests where club_id = v_club or requested_by_user_id = any(v_people);
  delete from public.guardians where player_id = any(v_players);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = 'uat-slice4a-${tag}';
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = v_club or player_id = any(v_players)
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
    where o.bucket_id = 'avatars' and u.email like 'uat.slice4a.%.${tag}@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)
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
  const left = one(`select (select count(*) from public.clubs where slug = 'uat-slice4a-${TAG}') + (select count(*) from auth.users where email like 'uat.slice4a.%.${TAG}@ovalball.test')
    + (select count(*) from storage.objects where bucket_id = 'avatars' and name like '%avatar-${TAG}.png')
    + (select count(*) from public.players where surname like '% ${TAG}') + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4a.%.${TAG}@ovalball.test')`)
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
// Seed
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4a.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) {
  await removeTaggedPictures(stale)
  cleanupTag(stale)
}
for (const person of Object.values(people)) await createIdentity(person)
sql(`update public.profiles set date_of_birth = (current_date - interval '14 years')::date where id = '${people.teen.id}'`)

const ids = {}
ids.directory = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four Family RUFC ${TAG}', 'Testham', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'uat-slice4a-${TAG}') returning id`)
ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.directory}', 'uat-slice4a-${TAG}', 'active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 12 Boys', 'uat-slice4a-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
ids.otherTeam = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.club}', 'Under 15 Boys', 'uat-slice4a-u15-${TAG}', 'youth', 'U15', 'boys', 'union', true) returning id`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.club}', '${people.admin.id}', 'CLUB_ADMIN', 'active'),
  ('${ids.club}', '${people.coach.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.otherCoach.id}', 'BASIC_USER', 'active'),
  ('${ids.club}', '${people.secretary.id}', 'FIXTURE_SECRETARY', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.coach.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.otherTeam}', 'coach' from public.club_memberships where club_id = '${ids.club}' and user_id = '${people.otherCoach.id}';`)
const childDob = one(`select (current_date - interval '11 years 3 months')::date`)
ids.child = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Charlie', 'Family ${TAG}', '${childDob}', 'MALE') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.child}', '${ids.team}', 'active');
insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${people.parent.id}', '${ids.child}', 'parent', 'active'), ('${people.partner.id}', '${ids.child}', 'parent', 'active');`)
ids.parentRelationship = one(`select id from public.guardians where guardian_user_id = '${people.parent.id}' and player_id = '${ids.child}'`)
// a 14-year-old with their own login, on the other team, with an account picture
ids.teenPlayer = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Toby', 'Teen ${TAG}', (current_date - interval '14 years')::date, 'MALE', '${people.teen.id}') returning id`)
sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${ids.teenPlayer}', '${ids.otherTeam}', 'active');`)
// a minor with no team place yet and no recorded gender, whose parent is an ACTIVE guardian (Phase 2 J.6: family
// authority derives from the child, not from a team place or club membership)
ids.unplaced = one(`insert into public.players (first_name, surname, date_of_birth) values ('Riley', 'Unplaced ${TAG}', (current_date - interval '10 years 2 months')::date) returning id`)
sql(`insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${people.parent.id}', '${ids.unplaced}', 'parent', 'active');`)
const season = one(`select id from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between starts_on and ends_on order by starts_on limit 1`)
ids.fixture = one(`insert into public.fixtures (owning_team_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id)
  values ('${ids.team}', 'Visitors RFC', current_date + 10, '10:30', 'Home', 'Booked', ${season ? `'${season}'` : "null"}) returning id`)

// Account pictures: an adult's and the teenager's, uploaded as the service would store them.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
async function uploadAvatar(person) {
  const objectPath = `${person.id}/avatar-${TAG}.png`
  const res = await fetch(`${API}/storage/v1/object/avatars/${objectPath}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/png", "x-upsert": "true" },
    body: png,
  })
  if (!res.ok) throw new Error(`avatar upload failed: HTTP ${res.status}`)
  sql(`update public.profiles set avatar_storage_path = '${objectPath}' where id = '${person.id}'`)
  return objectPath
}
ids.adminAvatar = await uploadAvatar(people.admin)
ids.teenAvatar = await uploadAvatar(people.teen)

const browser = await launch()
try {
  // -------------------------------------------------------------------------
  // A. A parent adds a second child: it waits for the club
  // -------------------------------------------------------------------------
  const parentCtx = watch(await newContext(browser), "parent")
  const parent = await parentCtx.newPage()
  await signIn(parent, people.parent.email)
  let page = await open(parent, "/parent/children")
  record("A1 the parent's children page lists their child", page.status < 400 && !page.broken && page.body.includes("Charlie"), `HTTP ${page.status}`)

  await parent.getByLabel("First Name").first().fill("Morgan")
  await parent.getByLabel("Surname").first().fill(`Family ${TAG}`)
  await parent.getByLabel("Date of Birth").first().fill(one(`select to_char(current_date - interval '9 years 2 months', 'YYYY-MM-DD')`))
  await parent.getByLabel("Gender").first().selectOption("MALE")
  const clubField = parent.getByLabel("Club").first()
  if (await clubField.count()) {
    await clubField.fill(`Slice Four Family RUFC ${TAG}`.slice(0, 18))
    await parent.getByRole("button", { name: new RegExp(`Slice Four Family RUFC ${TAG}`) }).click()
  }
  await parent.getByRole("button", { name: "Continue" }).first().click()
  await parent.getByRole("button", { name: "Confirm Team" }).click()
  await parent.getByText("Waiting for Your Club").waitFor({ timeout: 30000 })
  const addedChild = one(`select id from public.players where first_name = 'Morgan' and surname = 'Family ${TAG}'`)
  record("A2 the added child waits for the club: the relationship is PENDING_APPROVAL and the parent is told so",
    Boolean(addedChild) && one(`select state from public.guardians where player_id = '${addedChild}' and guardian_user_id = '${people.parent.id}'`) === "PENDING_APPROVAL", addedChild ? "created" : "no player")
  page = await open(parent, "/parent/children")
  const pendingSection = parent.locator("section", { hasText: "Awaiting Verification" })
  record("A3 until then the child is shown only as a request, not as a linked child",
    (await pendingSection.getByText(`Morgan Family ${TAG}`).count()) === 1 && !(await parent.locator("li", { hasText: "Morgan" }).filter({ has: parent.getByRole("button", { name: /Add another guardian/i }) }).count()),
    "")
  const parentToken = await accessTokenOf(parentCtx)
  const directRead = await rest(`players?select=id,date_of_birth&id=eq.${addedChild}`, { token: parentToken })
  record("A4 PENDING_APPROVAL confers nothing: the parent cannot read the added child's record directly",
    directRead.status === 200 && directRead.text.trim() === "[]", `HTTP ${directRead.status} ${directRead.text.slice(0, 60)}`)

  // -------------------------------------------------------------------------
  // B. The Club Admin approves it; C. the guardian settings show an age grade, not a date of birth
  // -------------------------------------------------------------------------
  const adminCtx = watch(await newContext(browser), "club admin")
  const admin = await adminCtx.newPage()
  await signIn(admin, people.admin.email)
  page = await open(admin, "/club/settings/guardians")
  const addedDob = one(`select date_of_birth from public.players where id = '${addedChild}'`)
  record("C1 the club's guardian settings list the team's players by name, never by date of birth",
    page.status < 400 && page.body.includes(`Charlie Family ${TAG}`) && !page.body.includes(addedDob) && !page.body.includes(childDob), `HTTP ${page.status}`)

  page = await open(admin, "/guardian-requests")
  const card = admin.locator("li", { hasText: `Morgan Family ${TAG}` })
  record("B1 Guardian Requests shows the child as added by this parent", (await card.getByText("Added by this parent").count()) === 1, `cards=${await card.count()}`)
  await card.getByRole("button", { name: "Approve" }).click()
  await until("the club's approval", `select state from public.guardians where player_id = '${addedChild}' and guardian_user_id = '${people.parent.id}'`, "ACTIVE")
  page = await open(parent, "/parent/children")
  record("B2 once approved the parent sees the child as theirs", page.body.includes("Morgan"), "")

  // -------------------------------------------------------------------------
  // D. A coach sees the team in Match Centre by name, never by date of birth
  // -------------------------------------------------------------------------
  const coachCtx = watch(await newContext(browser), "coach")
  const coach = await coachCtx.newPage()
  await signIn(coach, people.coach.email)
  page = await open(coach, `/fixtures/${ids.fixture}`)
  record("D1 the coach's Match Centre names the team's players", page.status < 400 && !page.broken && page.body.includes("Charlie"), `HTTP ${page.status}`)
  record("D2 and shows no date of birth", !page.body.includes(childDob), "")
  const coachToken = await accessTokenOf(coachCtx)
  const coachBase = await rest(`players?select=id,date_of_birth&id=eq.${ids.child}`, { token: coachToken })
  const coachView = await rest(`player_staff_view?select=id,first_name,age_grade&id=eq.${ids.child}`, { token: coachToken })
  record("D3 directly, the coach reads no player row but the staff projection (names and age grade only)",
    coachBase.text.trim() === "[]" && coachView.text.includes("Charlie") && !coachView.text.includes("date_of_birth"), `base ${coachBase.text.slice(0, 20)} / view ${coachView.status}`)

  // -------------------------------------------------------------------------
  // E. The Fixtures Secretary does not read the family graph
  // -------------------------------------------------------------------------
  const fsCtx = watch(await newContext(browser), "fixtures secretary")
  const fsPage = await fsCtx.newPage()
  await signIn(fsPage, people.secretary.email)
  page = await open(fsPage, "/club/settings/guardians")
  record("E1 the Fixtures Secretary is not given the club's guardian settings", !page.url.includes("/club/settings/guardians"), page.url.replace(APP, ""))
  const fsToken = await accessTokenOf(fsCtx)
  const fsGuardians = await rest(`guardians?select=id&player_id=eq.${ids.child}`, { token: fsToken })
  const fsDirectory = await rest("rpc/get_team_guardian_directory", { token: fsToken, method: "POST", body: { p_team_id: ids.team } })
  record("E2 directly, the Fixtures Secretary reads no guardian relationship and an empty guardian directory",
    fsGuardians.text.trim() === "[]" && fsDirectory.text.trim() === "[]", `guardians ${fsGuardians.text.slice(0, 20)} / directory ${fsDirectory.text.slice(0, 20)}`)
  await fsCtx.close()

  // -------------------------------------------------------------------------
  // F. A Site Admin puts a relationship on hold, then lifts it
  // -------------------------------------------------------------------------
  const siteCtx = watch(await newContext(browser), "site admin")
  const site = await siteCtx.newPage()
  await signIn(site, SITE_ADMIN)
  await siteCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  page = await open(site, `/admin/users/${people.parent.id}`)
  const familySection = site.locator("section", { hasText: "Family Relationships" })
  const row = familySection.locator("li", { hasText: "Charlie" })
  record("F1 the Site Admin sees the person's family relationships", page.status < 400 && (await row.count()) === 1, `HTTP ${page.status}`)
  await row.getByRole("button", { name: "Put on Hold" }).click()
  const holdButton = row.getByRole("button", { name: "Put on Hold" })
  const disabledWithoutReason = await holdButton.isDisabled()
  await row.getByLabel("Reason").fill("Club safeguarding officer asked Ovalball to pause access")
  await holdButton.click()
  await until("the hold", `select state from public.guardians where id = '${ids.parentRelationship}'`, "SUSPENDED")
  record("F2 a hold needs a reason and is recorded with it",
    disabledWithoutReason && one(`select suspension_reason from public.guardians where id = '${ids.parentRelationship}'`) === "Club safeguarding officer asked Ovalball to pause access", `disabled without reason: ${disabledWithoutReason}`)
  record("F3 the child's other guardian is told (FR-5)",
    one(`select count(*) from public.notifications where user_id = '${people.partner.id}' and type = 'guardian_relationship_changed' and data ->> 'event' = 'guardian.suspended'`) === "1", "")
  page = await open(parent, "/parent/children")
  record("F4 while on hold the parent no longer sees the child", !page.body.includes("Charlie"), "")

  page = await open(site, `/admin/users/${people.parent.id}`)
  const heldRow = site.locator("section", { hasText: "Family Relationships" }).locator("li", { hasText: "Charlie" })
  await heldRow.getByRole("button", { name: "Lift Hold" }).click()
  await heldRow.getByLabel("Reason").fill("Reviewed with the club; access restored")
  await heldRow.getByRole("button", { name: "Lift Hold" }).click()
  await until("the hold being lifted", `select state from public.guardians where id = '${ids.parentRelationship}'`, "ACTIVE")
  page = await open(parent, "/parent/children")
  record("F5 lifting the hold restores what the relationship allows", page.body.includes("Charlie"), "")
  const siteAdminId = one(`select id from auth.users where email = '${SITE_ADMIN}'`)
  record("F6 the hold and its lifting are security events attributed to the Site Admin",
    one(`select count(*) from public.security_events where event_type in ('guardian.suspended', 'guardian.restored') and subject_user_id = '${people.parent.id}' and actor_user_id = '${siteAdminId}'`) === "2", "")
  const adminToken = await accessTokenOf(adminCtx)
  const clubHold = await rest("rpc/transition_guardian_relationship", { token: adminToken, method: "POST", body: { p_guardian_id: ids.parentRelationship, p_to_state: "SUSPENDED", p_reason: "club tries a hold" } })
  record("F7 a Club Admin calling the hold directly is refused (holds are Ovalball's, AN-7)",
    clubHold.status === 403 && one(`select state from public.guardians where id = '${ids.parentRelationship}'`) === "ACTIVE", `HTTP ${clubHold.status}`)
  await siteCtx.close()

  // -------------------------------------------------------------------------
  // G. Account pictures are private
  // -------------------------------------------------------------------------
  const anonPublic = await fetch(`${API}/storage/v1/object/public/avatars/${ids.adminAvatar}`)
  record("G1 an account picture is not publicly reachable", anonPublic.status >= 400, `HTTP ${anonPublic.status}`)
  const adultSigned = await signStorage("avatars", ids.adminAvatar, coachToken)
  record("G2 an adult's account picture is signed for a signed-in person", adultSigned.status === 200 && adultSigned.text.includes("signedURL"), `HTTP ${adultSigned.status}`)
  const teenForCoach = await signStorage("avatars", ids.teenAvatar, coachToken)
  const otherCoachCtx = watch(await newContext(browser), "other coach")
  const otherCoach = await otherCoachCtx.newPage()
  await signIn(otherCoach, people.otherCoach.email)
  const teenForTheirCoach = await signStorage("avatars", ids.teenAvatar, await accessTokenOf(otherCoachCtx))
  record("G3 a 14-year-old's account picture is not signed for a coach of another team, and is for their own team's coach",
    teenForCoach.status >= 400 && teenForTheirCoach.status === 200, `other team ${teenForCoach.status} / own team ${teenForTheirCoach.status}`)
  page = await open(admin, "/account")
  const accountImg = await admin.locator("img[src*='/object/sign/avatars/']").count()
  record("G4 the account page shows the person's own picture through a signed URL", accountImg >= 1, `signed images=${accountImg}`)
  await otherCoachCtx.close()

  // -------------------------------------------------------------------------
  // H. A phone
  // -------------------------------------------------------------------------
  const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
  const phone = await phoneCtx.newPage()
  await signIn(phone, people.parent.email)
  page = await open(phone, "/parent/children")
  let m = await measure(phone)
  record("H1 the parent's children page fits a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
  const sitePhoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "site phone")
  const sitePhone = await sitePhoneCtx.newPage()
  await signIn(sitePhone, SITE_ADMIN)
  await sitePhoneCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  page = await open(sitePhone, `/admin/users/${people.parent.id}`)
  m = await measure(sitePhone)
  record("H2 the Site Admin family panel fits a 390px phone", (await sitePhone.getByRole("heading", { name: "Family Relationships" }).count()) === 1 && m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
  await phoneCtx.close()
  await sitePhoneCtx.close()

  // -------------------------------------------------------------------------
  // J. A guardian whose child has no team place yet
  // -------------------------------------------------------------------------
  // A deliberate refusal renders the not-found page, whose console output is expected, so this one look is taken
  // from a session outside the page-problem watch; the refusal itself is asserted.
  const coachRefusalCtx = await newContext(browser)
  const coachRefusal = await coachRefusalCtx.newPage()
  await signIn(coachRefusal, people.coach.email)
  page = await open(coachRefusal, `/parent/players/${ids.unplaced}/details`)
  record("J1 a coach is not offered another family's gender form (no team place, no relationship)",
    page.status === 404 && (await coachRefusal.getByRole("radio", { name: "Girls" }).count()) === 0, `HTTP ${page.status}`)
  await coachRefusalCtx.close()
  page = await open(parent, `/parent/players/${ids.unplaced}/details`)
  const unplacedGirls = parent.getByRole("radio", { name: "Girls" })
  record("J2 the guardian is offered the gender form for a child with no team place", page.status < 400 && (await unplacedGirls.count()) === 1, `HTTP ${page.status}`)
  if (await unplacedGirls.count()) {
    await unplacedGirls.check()
    await parent.getByRole("button", { name: /Save changes/i }).click()
    await until("the guardian's gender answer", `select coalesce(playing_pathway, 'none') from public.players where id = '${ids.unplaced}'`, "FEMALE")
  }
  record("J3 and recording it lands, once", one(`select playing_pathway from public.players where id = '${ids.unplaced}'`) === "FEMALE", "")
  page = await open(parent, `/parent/players/${ids.unplaced}/details`)
  record("J4 once recorded the form is gone (set once)", (await parent.getByRole("radio", { name: "Girls" }).count()) === 0 && page.body.includes("Recorded as Girls"), "")
  page = await open(parent, `/parent/players/${ids.unplaced}/access`)
  const consentSwitches = await parent.getByRole("switch").count()
  record("J5 the guardian gets the consent switches for the unplaced child", page.status < 400 && consentSwitches > 0, `switches=${consentSwitches}`)
  const siteDetailsCtx = watch(await newContext(browser), "site admin details")
  const siteDetails = await siteDetailsCtx.newPage()
  await signIn(siteDetails, SITE_ADMIN)
  await siteDetailsCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  sql(`update public.players set playing_pathway = null where id = '${ids.unplaced}'`)
  page = await open(siteDetails, `/parent/players/${ids.unplaced}/details`)
  record("J6 Ovalball may complete a missing gender here (site.users.identity.correct), as the database allows",
    (await siteDetails.getByRole("radio", { name: "Girls" }).count()) === 1, `HTTP ${page.status}`)
  page = await open(siteDetails, `/parent/players/${ids.unplaced}/access`)
  record("J7 but never changes a child's consent settings (family.permission.manage is never an administrator's)",
    (await siteDetails.getByRole("switch").count()) === 0 && page.body.includes("guardian can change these settings"), `HTTP ${page.status}`)
  await siteDetailsCtx.close()

  await parentCtx.close()
  await adminCtx.close()
  await coachCtx.close()

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  await browser.close()
  await cleanup()
  summarise()
}
