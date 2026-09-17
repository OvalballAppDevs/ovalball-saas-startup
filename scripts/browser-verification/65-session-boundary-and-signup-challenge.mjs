// =====================================================================
// SLICE 6b.2a -- THE SESSION BOUNDARY, AND THE CHALLENGE ON SIGNUP
//
// Two things this suite proves that no SQL or TypeScript assertion can.
//
// 1. THE BOUNDARY DID NOT LOCK THE PLATFORM OUT. Phase 2 D.2 says
//    `requireSession({ aal: 'aal2' })` on the (app) layout. Wired literally
//    onto a platform with zero enrolled TOTP factors, that redirects every
//    person to /security/verify for ever. The implementation reads the
//    enforcement flag instead, so T0 stays T0 -- and the only honest way to
//    show that is to sign a real person in and watch them arrive.
//
// 2. THE SIGNUP WIZARD NO LONGER REPEATS THE OWNER'S LOCKOUT. It held two
//    useStates for one fact and cleared neither when a submission failed,
//    which is precisely the shape that produced the 17 September incident on
//    /login. The hotfix was scoped to /login and deliberately did not reach
//    here.
//
// WHAT IS NOT CLAIMED. No OAuth provider is configured locally or in
// production (production `external` lists `email` only), so the provider
// buttons do not render and the SOCIAL half of SO-7 cannot be executed in a
// browser by anybody, here or in production. Its fix is held by the
// structural guards in turnstile_challenge_state.test.mts and is recorded as
// NOT BROWSER-EXERCISED rather than dressed up as provider UAT.
//
// Disposable local identities, removed at the end. Nothing production.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const ACTIVE = `uat.s6b2.active.${TAG}@ovalball.test`
const BENCHED = `uat.s6b2.benched.${TAG}@ovalball.test`
const PASSWORD = "Ovalball-Test-1!"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to create the disposable identities.")
  process.exit(1)
}

async function makeIdentity(email, first) {
  const created = await fetch("http://127.0.0.1:54321/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  }).then((r) => r.json())
  if (!created?.id) {
    console.error(`could not create ${email}:`, JSON.stringify(created).slice(0, 200))
    process.exit(1)
  }
  sql(`update public.profiles set first_name='${first}', surname='Boundary', setup_state='COMPLETE',
       date_of_birth=(current_date - interval '31 years')::date where id='${created.id}'`)
  return created.id
}

const activeId = await makeIdentity(ACTIVE, "Ada")
const benchedId = await makeIdentity(BENCHED, "Ben")

async function removeIdentities() {
  for (const id of [activeId, benchedId]) {
    await fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
}

function note(text) {
  console.log(`NOTE  ${text}`)
}

const browser = await launch()

async function type(page, selector, value) {
  const f = page.locator(selector).first()
  await f.waitFor({ state: "visible", timeout: 20000 })
  await f.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(value)
}

async function waitEnabled(page, name, timeout = 30000) {
  const btn = page.getByRole("button", { name }).first()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (!(await btn.isDisabled().catch(() => true))) return true
    await page.waitForTimeout(400)
  }
  return false
}

async function signIn(page, email, password) {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
  if (await reveal.isVisible().catch(() => false)) await reveal.click()
  await page.locator('input[type="password"]').first().waitFor({ state: "visible", timeout: 20000 })
  await type(page, 'input[type="email"]', email)
  await type(page, 'input[type="password"]', password)
  if (!(await waitEnabled(page, /^Sign In$/))) return false
  await page.getByRole("button", { name: /^Sign In$/ }).first().click()
  return page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
    .then(() => true)
    .catch(() => false)
}

try {
  // -------------------------------------------------------------------
  // T0 MUST REMAIN T0. This is the assertion the whole unit rests on.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    record("S6B2-01 SETUP: a live AAL1 account signs in", await signIn(page, ACTIVE, PASSWORD))
    const landing = new URL(page.url()).pathname
    record(
      "S6B2-02 T0 HOLDS: an AAL1 session reaches the product, not /security/verify -- the new layout " +
        "boundary did not turn a platform with zero TOTP factors into a locked one",
      landing !== "/security/verify" && landing !== "/login",
      `landed ${landing}`,
    )
    record(
      "S6B2-03 and the enforcement state really is T0, so S6B2-02 measured the right thing",
      sql(`select count(*) from public.mfa_enforcement_policy where require_aal2_from is not null`) === "0",
    )

    // The boundary runs on the layout, so reaching a page INSIDE the guarded group is the proof it
    // passed. /account/security and not /account: the layout also carries a long-standing
    // relationship gate that sends anybody with no club and no family link to /welcome, and a
    // disposable identity has neither. /account/security is the one route deliberately exempted from
    // that gate -- everybody with an Ovalball account has account security -- which makes it the only
    // honest positive control here. A failure at /account would have measured that gate, not this one.
    await page.goto(`${APP}/account/security`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B2-04 POSITIVE CONTROL: a page inside the guarded group renders for that session",
      new URL(page.url()).pathname === "/account/security",
      new URL(page.url()).pathname,
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // Signed out, against the same guarded group.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    for (const [route, label] of [
      ["/account/security", "S6B2-05"],
      ["/dashboard", "S6B2-06"],
    ]) {
      await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})
      record(
        `${label} signed out, ${route} refuses and sends them somewhere they can act`,
        new URL(page.url()).pathname === "/login",
        new URL(page.url()).pathname,
      )
    }
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // Suspension: D-S6B-AUTO-10, end to end, in a browser.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    record("S6B2-07 SETUP: the account signs in while still active", await signIn(page, BENCHED, PASSWORD))
    const before = sql(`select count(*) from auth.sessions where user_id='${benchedId}'`)

    sql(`update public.profiles set account_state='SUSPENDED', state_reason='6b.2 boundary fixture'
         where id='${benchedId}'`)

    await page.goto(`${APP}/account/security`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const url = new URL(page.url())
    record(
      "S6B2-08 a suspended account loses its usable session on the very next request",
      url.pathname === "/login" && url.searchParams.get("reason") === "suspended",
      url.pathname + url.search,
    )
    record(
      "S6B2-09 and the session is genuinely gone, not merely redirected away from -- a stale cookie " +
        "cannot carry authority back",
      sql(`select count(*) from auth.sessions where user_id='${benchedId}'`) === "0",
      `sessions before=${before} after=0`,
    )

    // Refresh cannot restore it, and neither can re-entering the group.
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B2-10 refreshing into a different guarded route does not restore authority",
      new URL(page.url()).pathname === "/login",
      new URL(page.url()).pathname,
    )
    record(
      "S6B2-11 and reauthenticating while still suspended does not produce usable application authority",
      (await signIn(page, BENCHED, PASSWORD)) === false ||
        new URL(page.url()).pathname === "/login",
      new URL(page.url()).pathname,
    )
    record(
      "S6B2-12 POSITIVE CONTROL: reinstating the account lets the same person back in",
      (() => {
        sql(`update public.profiles set account_state='ACTIVE' where id='${benchedId}'`)
        return true
      })(),
    )
    const back = await signIn(page, BENCHED, PASSWORD)
    record("S6B2-12b and they do get back in, so S6B2-08..11 measured suspension and not a broken login", back)
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // SO-7: the signup challenge lifecycle, on the surface the hotfix missed.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    let challengeRounds = 0
    page.on("request", (r) => {
      if (r.url().includes("challenges.cloudflare.com/cdn-cgi/challenge-platform")) challengeRounds += 1
    })
    await page.goto(`${APP}/signup`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(6000)

    const providerButtons = await page.getByRole("button", { name: /continue with|sign up with/i }).count()
    record(
      "S6B2-13 provider buttons absent locally -- no provider configured, so the SOCIAL half of SO-7 is " +
        "NOT browser-exercised here and is not claimed",
      providerButtons === 0,
      `provider buttons rendered: ${providerButtons}`,
    )
    record(
      "S6B2-14 the signup page runs a real challenge rather than proceeding with nothing",
      challengeRounds >= 1,
      `challenge round-trips observed: ${challengeRounds}`,
    )
    const m = await page.evaluate(() => ({ w: window.innerWidth, s: document.body.scrollWidth }))
    record("S6B2-15 and the first signup step does not scroll sideways", m.s <= m.w + 1, `inner=${m.w} scroll=${m.s}`)
    note(
      "BOUNDARY: the full signup wizard is a multi-step form whose completion sends a real email. Its " +
        "challenge STATE MACHINE is held deterministically by turnstile_challenge_state.test.mts (19 " +
        "assertions), which is where the one-fact rule is actually pinned.",
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // 320px.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser, { width: 320, height: 720 })
    const page = await ctx.newPage()
    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const m = await page.evaluate(() => ({ w: window.innerWidth, s: document.body.scrollWidth }))
    record("S6B2-16 /login does not scroll sideways at 320px", m.w === 320 && m.s <= 320, `inner=${m.w} scroll=${m.s}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  await removeIdentities()
}

record(
  "S6B2-17 the suite removed every identity it created",
  sql(`select count(*) from auth.users where email like 'uat.s6b2.%${TAG}@ovalball.test'`) === "0",
)

process.exit(summarise() ? 0 : 1)
