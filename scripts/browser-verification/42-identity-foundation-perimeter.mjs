// IDENTITY FOUNDATION + DATABASE/API PERIMETER -- browser acceptance.
//
// Identity/Auth Slice 1, driven through the running product and its real API
// gateway, never a hidden button:
//
//   signed out          public pages render; admin pages send you to sign in;
//                       the API refuses admin, member and private-column reads
//   a new identity      created through GoTrue itself: exactly one profile,
//                       holding a place for details, no authority; signing in
//                       keeps them out of the app until they finish
//   a member            dashboard and account load; admin data comes back
//                       empty; protected profile columns cannot be written
//   a Club Admin        People, teams and the club's own page still load
//   a Site Admin        Club Management and Users still list what they list;
//                       suspending and restoring a person who has not given
//                       their details works through the Users page and records
//                       its security events, attributed to the Site Admin
//   history             audit_log and security_events cannot be written,
//                       rewritten or deleted through the API by anon, a
//                       member, a Full Site Admin or the server key
//
// Everything this run creates is removed at the end, whatever happens --
// except the audit and security-event history it generated, which is
// append-only by design and names only disposable identifiers.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/42-identity-foundation-perimeter.mjs

import { execFileSync } from "node:child_process"

import { APP, launch, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
const API = status.API_URL
const ANON_KEY = status.ANON_KEY
const SERVICE_KEY = status.SERVICE_ROLE_KEY

const TAG = Date.now().toString(36).slice(-6)
const NEW_EMAIL = `uat.slice1.newcomer.${TAG}@ovalball.test`
const PENDING_EMAIL = `uat.slice1.pending.${TAG}@ovalball.test`
const created = { userId: null, pendingId: null }

async function removeIdentity(id) {
  await fetch(`${API}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }).catch(() => {})
  try {
    sql(`delete from auth.users where id = '${id}'`)
  } catch {}
}

async function cleanup() {
  for (const key of ["userId", "pendingId"]) {
    if (created[key]) {
      await removeIdentity(created[key])
      created[key] = null
    }
  }
}
process.on("SIGINT", async () => { await cleanup(); process.exit(1) })

async function rest(pathAndQuery, { token = null, method = "GET", body, profile, key = ANON_KEY } = {}) {
  const res = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(profile ? { "Accept-Profile": profile, "Content-Profile": profile } : {}),
    },
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

async function renders(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const body = await page.locator("body").innerText()
  return { status: response?.status() ?? 0, url: page.url(), broken: /Application error|Something went wrong|permission denied/i.test(body), body }
}

const browser = await launch()
try {
  // ---------------------------------------------------------------------
  // Signed out
  // ---------------------------------------------------------------------
  const anonCtx = await newContext(browser)
  const anon = await anonCtx.newPage()
  const clubSlug = one(`select c.slug from public.clubs c where c.status = 'active' and c.slug is not null order by c.created_at limit 1`)
  const competitionSlug = one(`select slug from public.competitions where active order by created_at limit 1`)
  for (const route of ["/", "/login", "/signup", "/clubs", `/club/${clubSlug}`, `/club/${clubSlug}/news`, `/competitions/${competitionSlug}`, "/public-fixtures", "/contact", "/invite/not-a-real-token"]) {
    const r = await renders(anon, route)
    record(`A1 signed out: ${route} renders`, r.status < 400 && !r.broken, `HTTP ${r.status}`)
  }
  for (const route of ["/admin/users", "/admin/clubs", "/dashboard", "/people"]) {
    const r = await renders(anon, route)
    record(`A2 signed out: ${route} sends you to sign in`, /\/login/.test(r.url), r.url.replace(APP, ""))
  }

  const adminOverview = await rest("admin_club_overview?select=directory_id&limit=1")
  record("A3 the API refuses admin_club_overview to anonymous callers", adminOverview.status === 401 || adminOverview.status === 403, `HTTP ${adminOverview.status}`)
  const notes = await rest("competition_matches?select=notes&limit=1")
  const syncError = await rest("competition_matches?select=sync_error&limit=1")
  const publicMatch = await rest("competition_matches?select=id,match_date,status,home_score,away_score&limit=1")
  record("A4 the API refuses competition_matches.notes and sync_error anonymously", [401, 403].includes(notes.status) && [401, 403].includes(syncError.status), `HTTP ${notes.status} / ${syncError.status}`)
  record("A5 the public Competition Match fields still come back anonymously", publicMatch.status === 200, `HTTP ${publicMatch.status}`)
  const directoryNotes = await rest("club_directory?select=notes,official_email&limit=1")
  const directoryName = await rest("club_directory?select=name&limit=1")
  record("A6 anonymous callers read a directory club's name but not its notes or official email", [401, 403].includes(directoryNotes.status) && directoryName.status === 200, `HTTP ${directoryNotes.status} / ${directoryName.status}`)
  const profiles = await rest("profiles?select=id&limit=1")
  record("A7 profiles are not readable anonymously", [401, 403].includes(profiles.status), `HTTP ${profiles.status}`)
  const internal = await rest("rpc/is_site_admin", { method: "POST", body: {}, profile: "internal" })
  record("A8 the internal schema is not reachable through the API", internal.status === 406, `HTTP ${internal.status}`)
  const truncateLike = await rest("fixtures", { method: "POST", body: { raw_opposition_text: "anon" } })
  record("A9 anonymous writes are refused before row security is even consulted", [401, 403].includes(truncateLike.status), `HTTP ${truncateLike.status}`)
  await anonCtx.close()

  // ---------------------------------------------------------------------
  // A brand-new identity, created by GoTrue itself
  // ---------------------------------------------------------------------
  const createRes = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: NEW_EMAIL, email_confirm: true }),
  })
  const createdUser = await createRes.json()
  created.userId = createdUser.id ?? null
  record("B1 GoTrue created a disposable identity", createRes.status < 300 && Boolean(created.userId), `HTTP ${createRes.status}`)

  const profileRow = sql(`select count(*) || '|' || coalesce(max(setup_state), '') || '|' || coalesce(max(account_state), '') || '|' || coalesce(max(email), '') from public.profiles where id = '${created.userId}'`)
  const [count, setupState, accountState, profileEmail] = profileRow.split("|")
  record("B2 the new identity has exactly one profile, holding a place for its details, with the identity's email",
    count === "1" && setupState === "PENDING_DETAILS" && accountState === "ACTIVE" && profileEmail === NEW_EMAIL, profileRow.replace(NEW_EMAIL, "<email>"))
  const authority = one(`select (select count(*) from public.club_memberships where user_id = '${created.userId}')
    + (select count(*) from public.site_admins where user_id = '${created.userId}')
    + (select count(*) from public.guardians where guardian_user_id = '${created.userId}')
    + (select count(*) from public.players where user_id = '${created.userId}')`)
  record("B3 the new profile carries no club, team, player, parent or Site Admin authority", authority === "0", `${authority} relationship rows`)

  const newCtx = await newContext(browser)
  const newcomer = await newCtx.newPage()
  await signIn(newcomer, NEW_EMAIL)
  await newcomer.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await newcomer.waitForLoadState("networkidle").catch(() => {})
  const landed = newcomer.url().replace(APP, "")
  record("B4 an identity that has not given its details is kept out of the app (sent to signup or the welcome page)", /\/signup|\/welcome/.test(landed), landed)
  const newToken = await accessTokenOf(newCtx)
  const selfState = await rest(`profiles?id=eq.${created.userId}`, { token: newToken, method: "PATCH", body: { setup_state: "COMPLETE", account_state: "ACTIVE" } })
  record("B5 the newcomer cannot mark their own profile complete or change its state through the API", [401, 403].includes(selfState.status), `HTTP ${selfState.status}`)
  const ownEvents = await rest("security_events?select=event_type,subject_user_id,actor_user_id", { token: newToken })
  const ownRows = ownEvents.status === 200 ? JSON.parse(ownEvents.text) : []
  record("B6a the newcomer reads their own user.created event through the API, and no one else's",
    ownRows.some((e) => e.event_type === "user.created" && e.actor_user_id === null) && ownRows.every((e) => e.subject_user_id === created.userId),
    `HTTP ${ownEvents.status} rows=${ownRows.length}`)
  await newCtx.close()
  await cleanup()
  record("B6 the disposable identity and its profile are gone",
    one(`select count(*) from public.profiles where email = '${NEW_EMAIL}'`) === "0" && one(`select count(*) from auth.users where email = '${NEW_EMAIL}'`) === "0", "cleaned")

  // ---------------------------------------------------------------------
  // A member
  // ---------------------------------------------------------------------
  const memberCtx = await newContext(browser)
  const member = await memberCtx.newPage()
  await signIn(member, "uat.guardian.one@ovalball.test")
  for (const route of ["/dashboard", "/account", "/agenda"]) {
    const r = await renders(member, route)
    record(`C1 member: ${route} renders`, r.status < 400 && !r.broken && !/\/login/.test(r.url), `HTTP ${r.status}`)
  }
  const memberToken = await accessTokenOf(memberCtx)
  const memberOverview = await rest("admin_club_overview?select=directory_id,notes&limit=5", { token: memberToken })
  record("C2 a member's session gets no administrative club data", memberOverview.status === 200 && memberOverview.text.trim() === "[]", `HTTP ${memberOverview.status} ${memberOverview.text.slice(0, 40)}`)
  const memberId = one(`select id from auth.users where email = 'uat.guardian.one@ovalball.test'`)
  const stateWrite = await rest(`profiles?id=eq.${memberId}`, { token: memberToken, method: "PATCH", body: { account_state: "SUSPENDED" } })
  const emailWrite = await rest(`profiles?id=eq.${memberId}`, { token: memberToken, method: "PATCH", body: { email: "someone-else@ovalball.test" } })
  record("C3 a member cannot write account state or email through the API", [401, 403].includes(stateWrite.status) && [401, 403].includes(emailWrite.status), `HTTP ${stateWrite.status} / ${emailWrite.status}`)
  record("C4 the member's profile is unchanged", one(`select account_state || '|' || email from public.profiles where id = '${memberId}'`) === "ACTIVE|uat.guardian.one@ovalball.test", "unchanged")
  const memberEvents = await rest("security_events?select=subject_user_id&limit=200", { token: memberToken })
  const memberSubjects = memberEvents.status === 200 ? [...new Set(JSON.parse(memberEvents.text).map((e) => e.subject_user_id))] : null
  record("C5 a member reads only their own security events", memberSubjects !== null && memberSubjects.every((id) => id === memberId), `HTTP ${memberEvents.status} subjects=${memberSubjects?.length ?? "?"}`)
  const memberAuditRows = await rest("audit_log?select=id&limit=5", { token: memberToken })
  const memberForge = await rest("security_events", { token: memberToken, method: "POST", body: { event_type: "account.restored", subject_user_id: memberId, actor_user_id: memberId } })
  const memberAuditForge = await rest("audit_log", { token: memberToken, method: "POST", body: { table_name: "profiles", record_id: memberId, action: "update", changed_by: memberId } })
  record("C6 a member reads no audit history and cannot write an audit row or a security event",
    memberAuditRows.status === 200 && memberAuditRows.text.trim() === "[]" && [401, 403].includes(memberForge.status) && [401, 403].includes(memberAuditForge.status),
    `HTTP ${memberAuditRows.status} ${memberAuditRows.text.slice(0, 20)} / ${memberForge.status} / ${memberAuditForge.status}`)
  await memberCtx.close()

  // ---------------------------------------------------------------------
  // A Club Admin
  // ---------------------------------------------------------------------
  const adminCtx = await newContext(browser)
  const clubAdmin = await adminCtx.newPage()
  await signIn(clubAdmin, "uat.coach@ovalball.test")
  const ownSlug = one(`select c.slug from public.club_memberships cm join public.clubs c on c.id = cm.club_id join auth.users u on u.id = cm.user_id where u.email = 'uat.coach@ovalball.test' and cm.role = 'CLUB_ADMIN' and cm.status = 'active' limit 1`)
  for (const route of ["/people", "/teams", "/fixtures", "/calendar", `/club/${ownSlug}`]) {
    const r = await renders(clubAdmin, route)
    record(`D1 Club Admin: ${route} renders`, r.status < 400 && !r.broken && !/\/login/.test(r.url), `HTTP ${r.status}`)
  }
  await adminCtx.close()

  // ---------------------------------------------------------------------
  // A Site Admin
  // ---------------------------------------------------------------------
  const siteCtx = await newContext(browser)
  const site = await siteCtx.newPage()
  await signIn(site, "uat.fullsiteadmin@ovalball.test")
  await siteCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  const clubsPage = await renders(site, "/admin/clubs")
  const directoryTotal = Number(one(`select count(*) from public.club_directory`))
  record("E1 Site Admin: Club Management renders its club list", clubsPage.status < 400 && !clubsPage.broken && directoryTotal > 0 && /RUFC|RFC|RLFC|Club/i.test(clubsPage.body), `HTTP ${clubsPage.status}`)
  const siteToken = await accessTokenOf(siteCtx)
  const siteOverview = await rest("admin_club_overview?select=directory_id&limit=5", { token: siteToken })
  record("E2 a Site Admin's session still reads admin_club_overview", siteOverview.status === 200 && JSON.parse(siteOverview.text).length > 0, `HTTP ${siteOverview.status}`)
  const usersPage = await renders(site, "/admin/users")
  record("E3 Site Admin: Users renders", usersPage.status < 400 && !usersPage.broken, `HTTP ${usersPage.status}`)

  // ---------------------------------------------------------------------
  // Site Admin suspends and restores a person who has not given their
  // details, through the Users page; each change records its event
  // ---------------------------------------------------------------------
  const siteAdminId = one(`select id from auth.users where email = 'uat.fullsiteadmin@ovalball.test'`)
  const pendingRes = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: PENDING_EMAIL, email_confirm: true }),
  })
  created.pendingId = (await pendingRes.json()).id ?? null
  const pendingId = created.pendingId
  const eventsFor = (type) => one(`select count(*) || '|' || coalesce(string_agg(distinct actor_user_id::text, ','), '') from public.security_events where subject_user_id = '${pendingId}' and event_type = '${type}'`)
  record("F1 a GoTrue-created identity starts PENDING_DETAILS and records user.created with no actor",
    one(`select setup_state from public.profiles where id = '${pendingId}'`) === "PENDING_DETAILS" && eventsFor("user.created") === "1|", eventsFor("user.created"))

  const personPage = await renders(site, `/admin/users/${pendingId}`)
  await site.getByRole("button", { name: "Suspend account" }).click()
  await site.getByRole("button", { name: "Confirm Suspend" }).click()
  await site.getByRole("button", { name: "Reactivate Account" }).waitFor({ timeout: 30000 })
  record("F2 Site Admin suspends a PENDING_DETAILS person from the Users page; the database holds SUSPENDED",
    personPage.status < 400 && !personPage.broken && one(`select account_state from public.profiles where id = '${pendingId}'`) === "SUSPENDED", `HTTP ${personPage.status}`)
  record("F3 the suspension recorded exactly one account.suspended event, attributed to the Site Admin", eventsFor("account.suspended") === `1|${siteAdminId}`, eventsFor("account.suspended").replace(siteAdminId, "<site admin>"))

  await site.getByRole("button", { name: "Reactivate Account" }).click()
  await site.getByRole("button", { name: "Suspend account" }).waitFor({ timeout: 30000 })
  record("F4 reactivating restores ACTIVE and records account.restored, attributed to the Site Admin",
    one(`select account_state from public.profiles where id = '${pendingId}'`) === "ACTIVE" && eventsFor("account.restored") === `1|${siteAdminId}`, eventsFor("account.restored").replace(siteAdminId, "<site admin>"))
  const auditActor = one(`select count(*) filter (where actor_user_id = '${siteAdminId}') || '|' || count(*) from public.audit_log where table_name = 'profiles' and record_id = '${pendingId}' and action = 'update'`)
  record("F5 the audit rows for both changes name the Site Admin as actor, derived from the session", auditActor === "2|2", auditActor)
  const reloaded = await renders(site, `/admin/users/${pendingId}`)
  record("F6 the person's page still renders its audit history after the changes", reloaded.status < 400 && !reloaded.broken && /Record updated/.test(reloaded.body), `HTTP ${reloaded.status}`)

  // ---------------------------------------------------------------------
  // History cannot be written or rewritten through the API by anyone
  // ---------------------------------------------------------------------
  const siteEvents = await rest(`security_events?select=event_type&subject_user_id=eq.${pendingId}`, { token: siteToken })
  record("F7 a Full Site Admin can read the person's security events", siteEvents.status === 200 && JSON.parse(siteEvents.text).length >= 3, `HTTP ${siteEvents.status}`)
  const anyAudit = one(`select id from public.audit_log where table_name = 'profiles' and record_id = '${pendingId}' order by changed_at limit 1`)
  const anyEvent = one(`select id from public.security_events where subject_user_id = '${pendingId}' order by id limit 1`)
  const attempts = {
    "site admin PATCH audit_log": await rest(`audit_log?id=eq.${anyAudit}`, { token: siteToken, method: "PATCH", body: { after: {} } }),
    "site admin DELETE audit_log": await rest(`audit_log?id=eq.${anyAudit}`, { token: siteToken, method: "DELETE" }),
    "site admin PATCH security_events": await rest(`security_events?id=eq.${anyEvent}`, { token: siteToken, method: "PATCH", body: { reason: "rewritten" } }),
    "site admin DELETE security_events": await rest(`security_events?id=eq.${anyEvent}`, { token: siteToken, method: "DELETE" }),
    "site admin POST security_events": await rest("security_events", { token: siteToken, method: "POST", body: { event_type: "account.restored", subject_user_id: pendingId } }),
    "service key DELETE audit_log": await rest(`audit_log?id=eq.${anyAudit}`, { token: SERVICE_KEY, key: SERVICE_KEY, method: "DELETE" }),
    "service key PATCH audit_log": await rest(`audit_log?id=eq.${anyAudit}`, { token: SERVICE_KEY, key: SERVICE_KEY, method: "PATCH", body: { after: {} } }),
    "service key POST audit_log": await rest("audit_log", { token: SERVICE_KEY, key: SERVICE_KEY, method: "POST", body: { table_name: "profiles", record_id: pendingId, action: "update" } }),
    "service key DELETE security_events": await rest(`security_events?id=eq.${anyEvent}`, { token: SERVICE_KEY, key: SERVICE_KEY, method: "DELETE" }),
    "service key POST security_events": await rest("security_events", { token: SERVICE_KEY, key: SERVICE_KEY, method: "POST", body: { event_type: "account.restored", subject_user_id: pendingId } }),
    "anon GET security_events": await rest("security_events?select=id&limit=1"),
    "anon POST audit_log": await rest("audit_log", { method: "POST", body: { table_name: "profiles", record_id: pendingId, action: "update" } }),
    "anon DELETE audit_log": await rest(`audit_log?id=eq.${anyAudit}`, { method: "DELETE" }),
  }
  const notRefused = Object.entries(attempts).filter(([, r]) => ![401, 403].includes(r.status)).map(([k, r]) => `${k} -> ${r.status}`)
  record("F8 anon, a Full Site Admin and the server key are all refused every audit/security-event write, rewrite and delete", notRefused.length === 0, notRefused.join("; ") || `${Object.keys(attempts).length} attempts refused`)
  const intact = one(`select (select count(*) from public.audit_log where id = '${anyAudit}') || '|' || (select coalesce(reason, '') from public.security_events where id = ${anyEvent}) || '|' || (select count(*) from public.security_events where subject_user_id = '${pendingId}')`)
  record("F9 the history rows attacked are unchanged and no forged event was added", intact === "1||3", intact)
  await siteCtx.close()
} finally {
  await cleanup()
  await browser.close()
  summarise()
}
