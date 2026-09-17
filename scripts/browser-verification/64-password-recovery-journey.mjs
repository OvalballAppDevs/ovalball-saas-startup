// =====================================================================
// SLICE 6b.1 -- LOSING YOUR PASSWORD, AND GETTING BACK IN
//
// Until this unit, /login linked to /forgot-password and /forgot-password
// was a production 404. The only Full Site Admin on the platform therefore
// had no in-product way back into their own account, with no second
// administrator able to help (AN-3). That is the hole this suite walks.
//
// It walks the whole of Phase 2 G, end to end, as a person would:
//   ask for a link -> receive it -> set a password the rules accept ->
//   arrive signed in -> and find every other session gone.
//
// And it walks the ways it is supposed to REFUSE: an address nobody holds
// must produce an answer indistinguishable from an address somebody does
// (E: "Reset request always responds 'If an account exists we've sent a
// link'"), a link already spent must not work twice, a forged one must not
// work at all, and a password that is too short or known-breached must be
// turned away by the SERVER rather than by the form.
//
// It also covers the two D.2 destinations this unit built alongside it --
// /account/setup and /account/suspended -- including the thing that makes
// a landing page dangerous: holding somebody on a page about a state they
// are not in.
//
// NEVER PRINTED: the recovery link and its token are read from the local
// mail catcher and used, and are never logged, recorded in an assertion
// detail, or written to a file. Passwords used here are invented for
// disposable local identities; no real credential is involved at any point.
//
// Disposable local identities, removed at the end. Nothing production.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, APP, MAILPIT, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const OWNER = `uat.s6b1.${TAG}@ovalball.test`
const NOBODY = `uat.s6b1.nobody.${TAG}@ovalball.test`
const NEW_STARTER = `uat.s6b1.new.${TAG}@ovalball.test`
const BENCHED = `uat.s6b1.benched.${TAG}@ovalball.test`

const OLD_PASSWORD = "Ovalball-Test-1!"
const NEW_PASSWORD = `Ovalball-Recovered-${TAG}!`
const TOO_SHORT = "Short-1!"
// Long enough, has a capital and a special character, and is in every breach
// corpus there is. It passes composition and must still be refused.
const BREACHED = "Password123!@#"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to create the disposable identities.")
  process.exit(1)
}

async function makeIdentity(email, { first, surname }) {
  const created = await fetch("http://127.0.0.1:54321/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password: OLD_PASSWORD, email_confirm: true }),
  }).then((r) => r.json())
  if (!created?.id) {
    console.error(`could not create ${email}:`, JSON.stringify(created).slice(0, 200))
    process.exit(1)
  }
  sql(`update public.profiles set first_name='${first}', surname='${surname}',
       date_of_birth=(current_date - interval '30 years')::date where id='${created.id}'`)
  return created.id
}

const ownerId = await makeIdentity(OWNER, { first: "Olive", surname: "Recovery" })
const starterId = await makeIdentity(NEW_STARTER, { first: "Nate", surname: "Starter" })
const benchedId = await makeIdentity(BENCHED, { first: "Ben", surname: "Benched" })

/**
 * Everything this suite created, removed -- and removed even when the suite
 * fails partway, because a crashed run that leaves identities behind makes
 * the NEXT run's assertions lie. Nothing is ever deleted by hand between
 * runs; the suite is responsible for its own fixtures.
 */
async function removeIdentities() {
  for (const id of [ownerId, starterId, benchedId]) {
    await fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
}

try {
// The three states D.2 names destinations for.
sql(`update public.profiles set setup_state='COMPLETE' where id in ('${ownerId}','${benchedId}')`)
sql(`update public.profiles set setup_state='PENDING_DETAILS' where id='${starterId}'`)
// BENCHED is suspended LATER, once it holds a session. Nothing in the product routes a suspended
// person to /account/suspended yet -- that is `requireSession` (S6-9), which is 6b.2's row and has
// zero callers today. Suspending first would therefore test 6b.2's wiring, fail, and say nothing
// about whether the page 6b.1 built is correct.

/** Is the breach service reachable from this machine right now? */
const breachServiceUp = await fetch("https://api.pwnedpasswords.com/range/5BAA6", {
  signal: AbortSignal.timeout(5000),
})
  .then((r) => r.ok)
  .catch(() => false)

/** Recorded, not asserted: something observed that the suite deliberately does not claim as a pass. */
function note(text) {
  console.log(`NOTE  ${text}`)
}

const browser = await launch()

/** React-controlled fields are typed into with real key events, never by assigning value. */
async function type(page, selector, value) {
  const f = page.locator(selector).first()
  await f.waitFor({ state: "visible", timeout: 20000 })
  await f.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(value)
}

/** The submit becomes enabled only once the challenge has produced a token. */
async function waitEnabled(page, name, timeout = 30000) {
  const btn = page.getByRole("button", { name }).first()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (!(await btn.isDisabled().catch(() => true))) return true
    await page.waitForTimeout(400)
  }
  return false
}

/**
 * The recovery link, read out of the local mail catcher.
 *
 * The return value is a URL containing a single-use recovery token. It is
 * passed straight to page.goto and never printed, never stored, and never
 * put in an assertion detail.
 */
async function recoveryLink(email, since, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=5`)
    if (!res.ok) continue
    const { messages = [] } = await res.json()
    const fresh = messages
      .filter((m) => new Date(m.Created).getTime() >= since - 5000)
      .sort((x, y) => new Date(y.Created) - new Date(x.Created))
    for (const m of fresh) {
      const body = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()
      const text = `${body.Text || ""} ${body.HTML || ""}`
      const match = text.match(/https?:\/\/[^\s"'<>]*(?:auth\/v1\/verify|auth\/callback)[^\s"'<>]*/)
      if (match) return match[0].replace(/&amp;/g, "&")
    }
  }
  return null
}

async function mailCount(email, since) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=20`)
  if (!res.ok) return 0
  const { messages = [] } = await res.json()
  return messages.filter((m) => new Date(m.Created).getTime() >= since - 5000).length
}

/** Sign in with a password, the way suite 63 does, through the real form. */
async function signInWithPassword(page, email, password) {
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

/** Ask for a reset link for `email`, and return the confirmation panel's text. */
async function askForResetLink(page, email) {
  await page.goto(`${APP}/forgot-password`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await type(page, 'input[type="email"]', email)
  if (!(await waitEnabled(page, /Send Reset Link/i))) return null
  await page.getByRole("button", { name: /Send Reset Link/i }).first().click()
  await page.getByText(/Check your email/i).first().waitFor({ state: "visible", timeout: 30000 })
  return (await page.locator("main, body").first().innerText()).trim()
}

let ownerText = ""
let nobodyText = ""

try {
  // -------------------------------------------------------------------
  // The route that was a 404.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    const response = await page.goto(`${APP}/forgot-password`, { waitUntil: "domcontentloaded" })
    record(
      "S6B1-01 /forgot-password is a real page, not the 404 it served in production",
      (response?.status() ?? 0) === 200 && /Forgotten your password/i.test(await page.locator("body").innerText()),
      `status ${response?.status()}`,
    )

    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
    const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
    if (await reveal.isVisible().catch(() => false)) await reveal.click()
    const link = page.getByRole("link", { name: /forgot|forgotten/i }).first()
    record(
      "S6B1-02 and Sign In's forgotten-password link points at it",
      (await link.getAttribute("href").catch(() => null)) === "/forgot-password",
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // AN ADDRESS NOBODY HOLDS MUST LOOK EXACTLY LIKE ONE SOMEBODY DOES.
  //
  // This is the enumeration rule, and it is checked FIRST so that a later
  // change which makes the known-address path chattier fails here.
  // -------------------------------------------------------------------
  {
    const since = Date.now()
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    nobodyText = (await askForResetLink(page, NOBODY)) ?? ""
    record("S6B1-03 an unknown address is answered, not refused", /Check your email/i.test(nobodyText))

    await page.waitForTimeout(3000)
    record(
      "S6B1-04 and no email is sent to an address that has no account",
      (await mailCount(NOBODY, since)) === 0,
    )
    record(
      "S6B1-05 and nothing is written to security_events for an address nobody holds",
      sql(`select count(*) from public.security_events
           where event_type='password.reset_requested' and subject_user_id is null`) === "0",
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // THE JOURNEY.
  // -------------------------------------------------------------------
  {
    // A second, older session for the same person. Resetting must end it:
    // that is the entire security value of a reset, and E requires it.
    const otherCtx = await newContext(browser)
    const otherPage = await otherCtx.newPage()
    record(
      "S6B1-06 SETUP: the account has a second live session before the reset",
      await signInWithPassword(otherPage, OWNER, OLD_PASSWORD),
      `sessions=${sql(`select count(*) from auth.sessions where user_id='${ownerId}'`)}`,
    )

    const since = Date.now()
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    ownerText = (await askForResetLink(page, OWNER)) ?? ""

    // The comparison the enumeration rule actually rests on: the same words,
    // differing only where the address the visitor typed is echoed back.
    const strip = (t, addr) => t.replace(addr, "<address>").replace(/\s+/g, " ").trim()
    record(
      "S6B1-07 the answer for a real account is word-for-word the answer for an unknown one",
      ownerText !== "" && strip(ownerText, OWNER) === strip(nobodyText, NOBODY),
    )

    record(
      "S6B1-08 the request left a password.reset_requested event",
      sql(`select count(*) from public.security_events
           where event_type='password.reset_requested' and subject_user_id='${ownerId}'`) === "1",
    )

    const link = await recoveryLink(OWNER, since)
    // The link is never printed. Its presence is the fact; its contents are a
    // single-use credential.
    record("S6B1-09 a recovery email arrives (link withheld from this log by design)", Boolean(link))
    if (!link) throw new Error("no recovery link arrived; the rest of the journey cannot be walked")

    // Opened in the SAME context that asked, because PKCE's verifier cookie
    // lives there. That is correct behaviour, not an obstacle to work around.
    await page.goto(link, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B1-10 the link lands on Set A New Password",
      new URL(page.url()).pathname === "/account/reset-password",
      new URL(page.url()).pathname,
    )

    // -- the server is the authority, not the form --
    await type(page, 'input[type="password"]', TOO_SHORT)
    await page.getByRole("button", { name: /Save New Password/i }).first().click()
    await page.waitForTimeout(2500)
    const shortError = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
    record(
      "S6B1-11 a password under 12 characters is refused, and says so",
      /at least 12 characters/i.test(shortError),
      shortError.slice(0, 100),
    )

    if (breachServiceUp) {
      await type(page, 'input[type="password"]', BREACHED)
      await page.getByRole("button", { name: /Save New Password/i }).first().click()
      await page.waitForTimeout(6000)
      const breachError = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
      record(
        "S6B1-12 a password that passes composition but appears in a known breach is still refused",
        /known data breach/i.test(breachError),
        breachError.slice(0, 100),
      )
    } else {
      note(
        "S6B1-12 NOT EXERCISED: api.pwnedpasswords.com was unreachable from this machine, so the " +
          "breached-password refusal could not be walked in the browser. It is NOT claimed as passing. " +
          "The composition rules and the fail-closed-in-production branch are held by lib/auth/password-policy.ts.",
      )
    }

    // -- and now the one that should work --
    await type(page, 'input[type="password"]', NEW_PASSWORD)
    await page.getByRole("button", { name: /Save New Password/i }).first().click()
    const arrived = await page
      .waitForURL((u) => !u.pathname.startsWith("/account/reset-password"), { timeout: 40000 })
      .then(() => true)
      .catch(() => false)
    const landing = new URL(page.url()).pathname
    // /welcome is a legitimate landing, not a failure: the app shell sends anybody with no club
    // membership and no canonical family relationship there, and a disposable identity has neither.
    // What matters is that the reset ended INSIDE the product on a real session, rather than back on
    // a login or recovery page -- so the assertion names the authenticated destinations and refuses
    // the unauthenticated ones instead of insisting on one route.
    record(
      "S6B1-13 POSITIVE CONTROL: a password the rules accept completes the reset and lands inside the product",
      arrived && ["/dashboard", "/welcome", "/security/verify"].includes(landing),
      landing,
    )
    record(
      "S6B1-13b and the session survived the reset -- revoking the others did not revoke this one",
      sql(`select count(*) from auth.sessions where user_id='${ownerId}'`) !== "0",
    )
    record(
      "S6B1-14 completing it left a password.reset_completed event",
      sql(`select count(*) from public.security_events
           where event_type='password.reset_completed' and subject_user_id='${ownerId}'`) === "1",
    )
    record(
      "S6B1-15 and the account no longer carries a forced reset, with a password_set_at recorded",
      sql(`select coalesce(must_reset_password,true)::text || ':' || (password_set_at is not null)::text
           from public.account_security_state where user_id='${ownerId}'`) === "false:true",
    )

    // -- every other session is gone --
    record(
      "S6B1-16 the older session was revoked: one session remains, the recovering one",
      sql(`select count(*) from auth.sessions where user_id='${ownerId}'`) === "1",
    )
    await otherPage.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
    await otherPage.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B1-17 and the browser holding it is signed out of the product, not merely stale",
      /\/login/.test(otherPage.url()),
      new URL(otherPage.url()).pathname,
    )
    await otherCtx.close()

    // -- a spent link is spent --
    await page.goto(link, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B1-18 the same recovery link cannot be used a second time",
      !/\/account\/reset-password/.test(new URL(page.url()).pathname + new URL(page.url()).search) &&
        /\/login|\/forgot-password|\/dashboard/.test(new URL(page.url()).pathname),
      new URL(page.url()).pathname,
    )
    await ctx.close()

    // -- and a link nobody issued is not a link --
    const fresh = await newContext(browser)
    const forged = await fresh.newPage()
    await forged.goto(`${APP}/auth/callback?code=not-a-real-recovery-code&next=%2Faccount%2Freset-password`, {
      waitUntil: "domcontentloaded",
    })
    await forged.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B1-19 a forged recovery code does not produce a password form",
      new URL(forged.url()).pathname === "/login",
      new URL(forged.url()).pathname,
    )
    await forged.goto(`${APP}/account/reset-password`, { waitUntil: "domcontentloaded" })
    await forged.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6B1-20 and the reset page itself refuses anybody arriving without a recovery session",
      new URL(forged.url()).pathname === "/forgot-password",
      new URL(forged.url()).pathname + new URL(forged.url()).search,
    )
    await fresh.close()

    // -- the new password is the password --
    const proof = await newContext(browser)
    const proofPage = await proof.newPage()
    record(
      "S6B1-21 POSITIVE CONTROL: the recovered account signs in with the new password",
      await signInWithPassword(proofPage, OWNER, NEW_PASSWORD),
    )
    await proof.close()
  }

  // -------------------------------------------------------------------
  // THE OTHER TWO D.2 DESTINATIONS.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    record("S6B1-22 SETUP: a part-set-up account can sign in", await signInWithPassword(page, NEW_STARTER, OLD_PASSWORD))

    await page.goto(`${APP}/account/setup`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const setupText = await page.locator("body").innerText()
    record(
      "S6B1-23 /account/setup is a real page and names both remaining steps",
      new URL(page.url()).pathname === "/account/setup" &&
        /Choose a password/i.test(setupText) &&
        /Set up an authenticator/i.test(setupText),
      new URL(page.url()).pathname,
    )
    await ctx.close()
  }

  {
    // ---------------------------------------------------------------
    // WHAT ACTUALLY HAPPENS TO A SUSPENDED PERSON -- which is not what
    // Phase 2 D.2 describes, and that difference is the finding.
    //
    // D.2 names "/account/suspended" as a destination, which presumes the
    // person keeps a session and is shown a page. The live session layer
    // (lib/supabase/middleware.ts, via proxy.ts) implements something
    // stronger: it re-reads profiles.account_status on EVERY request, and
    // the moment it reads "suspended" it signs the session out and sends
    // them to /login?reason=suspended. There is no read-only grace period
    // and no waiting for the session to expire.
    //
    // So /account/suspended is not reachable today, and this suite does not
    // pretend otherwise. It asserts the behaviour the product has, which is
    // a defensible one and already explains itself; the route 6b.1 built
    // remains for 6b.2 to route to IF the owner decides D.2's weaker
    // behaviour is the one they want. That is a product decision and is
    // recorded as such rather than made here.
    // ---------------------------------------------------------------
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    record("S6B1-24 SETUP: the account signs in while still active", await signInWithPassword(page, BENCHED, OLD_PASSWORD))
    sql(`update public.profiles set account_state='SUSPENDED', state_reason='Slice 6b.1 disposable fixture'
         where id='${benchedId}'`)

    await page.goto(`${APP}/account/suspended`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const url = new URL(page.url())
    const text = await page.locator("body").innerText()
    record(
      "S6B1-25 a suspension takes effect on the very next request: the session is ended, not merely limited",
      url.pathname === "/login" && url.searchParams.get("reason") === "suspended",
      url.pathname + url.search,
    )
    record(
      "S6B1-26 and the person is told their account is suspended rather than left at a bare sign-in form",
      /suspended/i.test(text),
    )
    record(
      "S6B1-26b without repeating the reason an administrator recorded against them",
      !/disposable fixture/i.test(text),
    )
    record(
      "S6B1-26c and the session really is gone, not just redirected away from",
      sql(`select count(*) from auth.sessions where user_id='${benchedId}'`) === "0",
    )
    note(
      "FINDING for the owner, not a defect: Phase 2 D.2 names /account/suspended as a destination, which " +
        "presumes a suspended person keeps a session. The live session layer instead ENDS the session on " +
        "the next request and explains it on /login. 6b.1 does not change that policy -- the session layer " +
        "is 6b.2, the high-lockout-risk unit -- and does not claim S6-8 closed. The route exists and its " +
        "own guard is exercised by S6B1-28; nothing routes to it yet.",
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // NEITHER LANDING MAY HOLD SOMEBODY IN A STATE THEY ARE NOT IN.
  //
  // A page that redirects to a page that redirects back is how a lockout is
  // built by accident, so the redirect is followed and counted.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    await signInWithPassword(page, OWNER, NEW_PASSWORD)

    for (const [route, label] of [
      ["/account/setup", "S6B1-27"],
      ["/account/suspended", "S6B1-28"],
    ]) {
      let hops = 0
      const count = () => (hops += 1)
      page.on("framenavigated", count)
      await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle").catch(() => {})
      await page.waitForTimeout(2000)
      page.off("framenavigated", count)
      const at = new URL(page.url()).pathname
      record(
        `${label} a set-up, active account is sent on from ${route} instead of being held there, and does not loop`,
        at !== route && ["/dashboard", "/welcome", "/security/verify"].includes(at) && hops <= 4,
        `landed ${at} after ${hops} navigations`,
      )
    }
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // 320px. Recovery is what somebody does on a phone, at a bad moment.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser, { width: 320, height: 720 })
    const page = await ctx.newPage()
    await page.goto(`${APP}/forgot-password`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await type(page, 'input[type="email"]', OWNER)
    record("S6B1-29 the security check completes at 320px", await waitEnabled(page, /Send Reset Link/i))
    const m = await page.evaluate(() => ({ w: window.innerWidth, s: document.body.scrollWidth }))
    record(
      "S6B1-30 and /forgot-password does not scroll sideways at 320px",
      m.w === 320 && m.s <= 320,
      `inner=${m.w} scroll=${m.s}`,
    )
    await ctx.close()
  }
} finally {
  await browser.close()
}

} finally {
  await removeIdentities()
}

record(
  "S6B1-31 the suite removed every identity it created",
  sql(`select count(*) from auth.users where email like 'uat.s6b1.%${TAG}@ovalball.test'`) === "0",
)

process.exit(summarise() ? 0 : 1)
