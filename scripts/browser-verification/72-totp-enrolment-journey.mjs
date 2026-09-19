// =====================================================================
// SETTING UP AN AUTHENTICATOR, ALL THE WAY THROUGH (Slice 6b)
//
// Reported live by the product owner, mid-enrolment: "it won't let me click the
// 'I've saved them' button it just doesn't click." The cause was
// `router.push("/dashboard")` with `router.refresh()` on the very next line --
// the refresh re-rendered the route they were still on and discarded the push.
// No navigation, no error, nothing to react to.
//
// Nothing was actually at stake: the factor is verified and the recovery codes
// are issued and hashed BEFORE that screen is drawn, which is what E4 and E5
// pin. But a dead button at the end of a security journey is exactly the sort of
// thing that makes somebody abandon it and assume MFA failed.
//
// So this walks the whole journey with a real browser and a real code computed
// from the secret the screen displays, and E7 presses the button and asserts
// where the browser SETTLES. Testing the click handler in isolation would have
// passed against the broken version.
//
// The identity and its TOTP secret are disposable and destroyed at the end.
// =====================================================================
import { execFileSync } from "node:child_process"
import { launch, newContext, APP, record, summarise } from "./harness.mjs"
import { totp } from "../security/totp.mjs"

const C = "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const EMAIL = `s6enrol.${TAG}@ovalball.test`
const PASSWORD = `Enrol!${TAG}aA9`
const sql = (q) => execFileSync("docker", ["exec","-i",C,"psql","-U","postgres","-d","postgres","-Atq","-c",q], { encoding: "utf8" }).trim()
const api = async (path, { token, body } = {}) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const created = await api("/auth/v1/admin/users", { token: process.env.SUPABASE_SERVICE_ROLE_KEY, body: { email: EMAIL, password: PASSWORD, email_confirm: true } })
const userId = created.json?.id
sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
     values ('${userId}','Enrol','Probe','${EMAIL}','1986-03-03','ACTIVE') on conflict (id) do nothing;
     select internal.refresh_account_security_state('${userId}');`)
// A relationship, so the (app) layout lets them reach /dashboard rather than /welcome.
const club = sql(`select c.id from public.clubs c join public.club_directory d on d.id=c.directory_id where d.normalized_key='ovalball-uat-rufc' limit 1`)
sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${club}','${userId}','BASIC_USER','active')`)

const b = await launch()
try {
  const ctx = await newContext(b, { width: 1280, height: 900 })
  const page = await ctx.newPage()

  // Sign in with the password form, which is the real journey.
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
  await reveal.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    await reveal.click().catch(() => {})
    if (await page.locator('input[type="password"]').first().isVisible({ timeout: 5000 }).catch(() => false)) break
  }
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.getByRole("button", { name: /^Sign In$|Continue|Sign in$/i }).first().click().catch(() => {})
  await page.waitForURL(/\/dashboard/, { timeout: 25000 }).catch(() => {})
  record("E1 a password sign-in reaches the application", new URL(page.url()).pathname === "/dashboard", new URL(page.url()).pathname)

  // Enrol through the product's own flow.
  await page.goto(`${APP}/security/enrol`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByRole("button", { name: /set up|begin|start|continue/i }).first().click().catch(() => {})
  // The secret appearing is what the start control produces; wait for that
  // rather than for a duration.
  await page
    .locator("main")
    .filter({ hasText: /[A-Z2-7]{16,}/ })
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
    .catch(() => {})

  // The secret is on screen for the person to type into their app; read it the
  // same way, then produce a code from it exactly as the app would.
  const body = await page.locator("main").innerText()
  const secret = (body.match(/\b[A-Z2-7]{16,}\b/) ?? [])[0]
  record("E2 the enrolment screen shows a secret to enter into an authenticator", Boolean(secret), secret ? `${secret.slice(0, 4)}…` : "none found")
  if (secret) {
    await page.locator('input').filter({ hasNot: page.locator('[type="hidden"]') }).first().fill(totp(secret))
    await page.getByRole("button", { name: /Verify/i }).first().click().catch(() => {})
    await page.waitForTimeout(3000)
  }
  const afterVerify = await page.locator("main").innerText()
  record("E3 verifying the code reaches the recovery-code screen", /recovery codes/i.test(afterVerify))
  record("E4 and the factor is verified in GoTrue before that screen is drawn",
    sql(`select count(*) from auth.mfa_factors where user_id='${userId}' and status='verified'`) === "1")
  record("E5 with recovery codes already issued and hashed",
    Number(sql(`select count(*) from public.account_recovery_codes where user_id='${userId}'`)) > 0)

  // THE DEFECT. Press it and see where the browser settles.
  const done = page.getByRole("button", { name: /I.ve Saved Them/i })
  record("E6 the completion control is present", (await done.count()) === 1)
  await done.click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {})
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(1200)
  record("E7 activating it settles on the dashboard -- the banked defect was that nothing happened at all",
    new URL(page.url()).pathname === "/dashboard", new URL(page.url()).pathname)
  record("E8 and the application is still usable afterwards", (await page.locator("main").innerText()).length > 100)
  record("E9 the factor is still verified after the navigation",
    sql(`select status from auth.mfa_factors where user_id='${userId}'`) === "verified")
} finally {
  const tidy = (q) => { try { sql(q) } catch {} }
  tidy(`delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id=s.id and s.user_id='${userId}'`)
  tidy(`delete from auth.mfa_challenges c using auth.mfa_factors f where c.factor_id=f.id and f.user_id='${userId}'`)
  tidy(`delete from auth.mfa_factors where user_id='${userId}'`)
  tidy(`delete from public.account_recovery_codes where user_id='${userId}'`)
  tidy(`delete from auth.sessions where user_id='${userId}'`)
  tidy(`delete from public.club_memberships where user_id='${userId}'`)
  tidy(`delete from public.security_events where actor_user_id='${userId}'`)
  tidy(`delete from public.profiles where id='${userId}'`)
  tidy(`delete from auth.identities where user_id='${userId}'`)
  tidy(`delete from auth.users where id='${userId}'`)
  record("Z the enrolment secret and its identity are destroyed",
    sql(`select count(*) from auth.mfa_factors where user_id='${userId}'`) === "0")
  await b.close()
}
summarise("TOTP enrolment completion journey")
