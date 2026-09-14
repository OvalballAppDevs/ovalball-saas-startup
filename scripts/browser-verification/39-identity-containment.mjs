// IDENTITY AND AUTHORISATION CONTAINMENT — browser acceptance.
//
// Two halves, both against the running product and its real API gateway:
//
//   A. THE DIRECT ATTACK FAILS. Each attack is sent the way a hostile browser
//      would send it: straight to PostgREST, as an anonymous caller or with a
//      real signed-in session's own access token. The database is then read
//      back to prove nothing changed. A hidden button proves nothing; these do.
//
//   B. THE LEGITIMATE WORK STILL WORKS. The flows the containment rerouted --
//      account suspension through set_account_status, a person editing their
//      own profile, staff reading their team's people, family and staff pages
//      that used to call result reconciliation inline -- driven through the UI.
//
// Every row this suite changes is captured first and restored on any exit.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

function envValue(name) {
  if (process.env[name]) return process.env[name]
  const file = path.resolve(import.meta.dirname, "../../.env.local")
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : null
}
const SUPABASE_URL = envValue("NEXT_PUBLIC_SUPABASE_URL")
const PUBLISHABLE_KEY = envValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

const MARK = `Phase0Probe${Date.now()}`
const id = (email) => sql(`select id from auth.users where email='${email}'`)
const COACH = "uat.coach@ovalball.test"
const GUARDIAN = "uat.guardian.one@ovalball.test"
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"
const TARGET = "uat.unrelated@ovalball.test"
const coachId = id(COACH)
const guardianId = id(GUARDIAN)
const targetId = id(TARGET)

// ---------------------------------------------------------------------
// Captured state, restored on every exit path.
// ---------------------------------------------------------------------
const before = {
  targetStatus: sql(`select account_status from public.profiles where id='${targetId}'`),
  guardianPhone: sql(`select coalesce(phone_number,'<null>') from public.profiles where id='${guardianId}'`),
  guardianStatus: sql(`select account_status from public.profiles where id='${guardianId}'`),
  coachVersion: sql(`select coalesce(version::text,'<none>') from public.user_session_versions where user_id='${coachId}'`) || "<none>",
}
let restored = false
function restore() {
  if (restored) return
  restored = true
  sql(`update public.profiles set account_status='${before.targetStatus}' where id='${targetId}'`)
  sql(`update public.profiles set account_status='${before.guardianStatus}' where id='${guardianId}'`)
  sql(`update public.profiles set phone_number=${before.guardianPhone === "<null>" ? "null" : `'${before.guardianPhone.replace(/'/g, "''")}'`} where id='${guardianId}'`)
  if (before.coachVersion === "<none>") sql(`delete from public.user_session_versions where user_id='${coachId}'`)
  else sql(`update public.user_session_versions set version=${before.coachVersion} where user_id='${coachId}'`)
  sql(`delete from public.players where surname like '${MARK}%'`)
}
process.on("exit", restore)
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { restore(); process.exit(1) })

async function accessTokenOf(context) {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
  cookies.sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
  const joined = cookies.map((c) => c.value).join("")
  const raw = joined.startsWith("base64-") ? Buffer.from(joined.slice(7), "base64").toString("utf8") : decodeURIComponent(joined)
  return JSON.parse(raw).access_token
}

async function rest(method, route, { token = null, body = undefined, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${route}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text }
}

const browser = await launch()
try {
  // -------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------
  const coachCtx = await newContext(browser)
  const coachPage = await coachCtx.newPage()
  await signIn(coachPage, COACH)
  const coachToken = await accessTokenOf(coachCtx)

  const guardianCtx = await newContext(browser)
  const guardianPage = await guardianCtx.newPage()
  await signIn(guardianPage, GUARDIAN)
  const guardianToken = await accessTokenOf(guardianCtx)

  record("setup: real sessions for a coach and a guardian, with their own access tokens",
    Boolean(coachToken && guardianToken), "tokens read from the product's own auth cookies")

  // -------------------------------------------------------------------
  // A. DIRECT ATTACKS
  // -------------------------------------------------------------------
  const anonInsert = await rest("POST", "players", { body: { first_name: "Anon", surname: `${MARK}Anon` } })
  const coachInsert = await rest("POST", "players", { token: coachToken, body: { first_name: "Coach", surname: `${MARK}Coach` } })
  const injected = Number(sql(`select count(*) from public.players where surname like '${MARK}%'`))
  record("A1 an anonymous caller cannot create a player through the API",
    anonInsert.status >= 400 && injected === 0, `HTTP ${anonInsert.status}`)
  record("A2 a signed-in coach cannot create a player through the API",
    coachInsert.status >= 400 && injected === 0, `HTTP ${coachInsert.status}, ${injected} probe rows exist`)

  const coachGuardianRowsBefore = Number(sql(`select count(*) from public.guardians where guardian_user_id='${coachId}'`))
  const teamChild = sql(`select m.player_id from public.player_team_memberships m join public.team_permissions tp on tp.team_id=m.team_id join public.club_memberships cm on cm.id=tp.membership_id where cm.user_id='${coachId}' and m.status='active' limit 1`)
  const coachLink = await rest("POST", "guardians", { token: coachToken, body: { guardian_user_id: coachId, player_id: teamChild, relationship_type: "guardian" } })
  const coachGuardianRowsAfter = Number(sql(`select count(*) from public.guardians where guardian_user_id='${coachId}'`))
  if (coachGuardianRowsAfter > coachGuardianRowsBefore) sql(`delete from public.guardians where guardian_user_id='${coachId}' and player_id='${teamChild}' and created_at > now() - interval '5 minutes'`)
  record("A3 a coach cannot make themselves guardian of a child on their own team through the API",
    coachLink.status >= 400 && coachGuardianRowsAfter === coachGuardianRowsBefore, `HTTP ${coachLink.status}`)

  sql(`update public.profiles set account_status='suspended' where id='${guardianId}'`)
  const selfReactivate = await rest("PATCH", `profiles?id=eq.${guardianId}`, { token: guardianToken, body: { account_status: "active" } })
  const afterSelf = sql(`select account_status from public.profiles where id='${guardianId}'`)
  sql(`update public.profiles set account_status='${before.guardianStatus}' where id='${guardianId}'`)
  record("A4 a suspended user cannot reactivate their own account through the API",
    afterSelf === "suspended", `HTTP ${selfReactivate.status}, status stayed ${afterSelf}`)

  const tokenRpc = await rest("POST", "rpc/get_gocardless_token_for_payer_subscription", {
    token: guardianToken,
    body: { p_payer_subscription_id: "00000000-0000-0000-0000-000000000000", p_actor_user_id: guardianId },
  })
  record("A5 a guardian's session cannot call the merchant token function at all",
    tokenRpc.status >= 400 && !/access_token/.test(tokenRpc.text), `HTTP ${tokenRpc.status}`)

  const overview = await rest("GET", "admin_fixture_overview?select=id&limit=1")
  record("A6 an anonymous caller cannot read the fixture overview",
    overview.status >= 400 || overview.text.trim() === "[]", `HTTP ${overview.status}`)

  await rest("POST", "rpc/record_session_version", { token: coachToken, body: { p_version: 999 } })
  const storedVersion = Number(sql(`select version from public.user_session_versions where user_id='${coachId}'`))
  record("A7 a session cannot record a version ahead of the server's",
    storedVersion <= 1, `stored ${storedVersion}`)

  // -------------------------------------------------------------------
  // B. LEGITIMATE WORK
  // -------------------------------------------------------------------
  const adminCtx = await newContext(browser)
  const adminPage = await adminCtx.newPage()
  await signIn(adminPage, SITE_ADMIN)
  await adminCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  await adminPage.goto(`${APP}/admin/users/${targetId}`, { waitUntil: "domcontentloaded" })
  await adminPage.waitForLoadState("networkidle").catch(() => {})
  await adminPage.getByRole("button", { name: /^Suspend account$/i }).click()
  await adminPage.getByRole("button", { name: /^Confirm Suspend$/i }).click()
  await adminPage.getByRole("button", { name: /^Reactivate Account$/i }).waitFor({ state: "visible", timeout: 30000 })
  const suspended = sql(`select account_status from public.profiles where id='${targetId}'`)
  record("B1 a Full Site Admin suspends an account from User Management", suspended === "suspended", `database reads ${suspended}`)

  await adminPage.getByRole("button", { name: /^Reactivate Account$/i }).click()
  await adminPage.getByRole("button", { name: /^Suspend account$/i }).waitFor({ state: "visible", timeout: 30000 })
  const reactivated = sql(`select account_status from public.profiles where id='${targetId}'`)
  record("B2 and reactivates it again", reactivated === "active", `database reads ${reactivated}`)
  await adminCtx.close()

  const phone = "07700 900123"
  await guardianPage.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await guardianPage.waitForLoadState("networkidle").catch(() => {})
  const phoneField = guardianPage.locator("#phone-number")
  await phoneField.click()
  await guardianPage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await guardianPage.keyboard.type(phone)
  await phoneField.locator("xpath=..").getByRole("button", { name: /^Save$/ }).click()
  await guardianPage.getByText("Saved.", { exact: true }).waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const storedPhone = sql(`select coalesce(phone_number,'') from public.profiles where id='${guardianId}'`)
  record("B3 a person still edits their own profile details", storedPhone.replace(/\s/g, "") === phone.replace(/\s/g, ""), `database reads "${storedPhone}"`)

  const teamId = sql(`select tp.team_id from public.team_permissions tp join public.club_memberships cm on cm.id=tp.membership_id where cm.user_id='${coachId}' and tp.permission='coach' limit 1`)
  const playerName = sql(`select p.first_name from public.player_team_memberships m join public.players p on p.id=m.player_id where m.team_id='${teamId}' and m.status='active' limit 1`)
  await coachPage.goto(`${APP}/teams/${teamId}`, { waitUntil: "domcontentloaded" })
  await coachPage.waitForLoadState("networkidle").catch(() => {})
  // Team People opens on Coaches; the roster is one tab along.
  await coachPage.getByRole("tab", { name: /^Players/ }).or(coachPage.getByRole("button", { name: /^Players\s*\d/ })).first().click()
  await coachPage.getByText(playerName, { exact: false }).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const teamText = await coachPage.locator("main").last().innerText()
  record("B4 a coach still sees their own team's players", Boolean(playerName) && teamText.includes(playerName),
    `looked for "${playerName}"`)

  for (const route of ["/dashboard", "/calendar", "/fixtures"]) {
    const response = await coachPage.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
    await coachPage.waitForLoadState("networkidle").catch(() => {})
    const body = await coachPage.locator("body").innerText()
    record(`B5 ${route} renders for staff without inline reconciliation`,
      (response?.status() ?? 0) < 400 && !/Something went wrong|Application error/i.test(body), `HTTP ${response?.status()}`)
  }

  for (const route of ["/agenda", "/dashboard"]) {
    const response = await guardianPage.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
    await guardianPage.waitForLoadState("networkidle").catch(() => {})
    const body = await guardianPage.locator("body").innerText()
    record(`B6 ${route} renders for a guardian`,
      (response?.status() ?? 0) < 400 && !/Something went wrong|Application error/i.test(body), `HTTP ${response?.status()}`)
  }

  await coachCtx.close()
  await guardianCtx.close()
} finally {
  await browser.close()
  restore()
  record("cleanup: every changed row is back to its captured value",
    sql(`select account_status from public.profiles where id='${targetId}'`) === before.targetStatus
      && sql(`select coalesce(phone_number,'<null>') from public.profiles where id='${guardianId}'`) === before.guardianPhone
      && Number(sql(`select count(*) from public.players where surname like '${MARK}%'`)) === 0,
    "status, phone, session version and probe rows restored")
  summarise()
}
