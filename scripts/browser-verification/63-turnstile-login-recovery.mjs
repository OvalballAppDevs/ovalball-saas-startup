// =====================================================================
// SLICE 6b -- THE LOGIN THE SECURITY CHECK USED TO BLOCK
//
// A production incident: the established Full Site Admin could not sign in.
// Every attempt answered "We couldn't complete the security check", with a
// correct password, and the request never reached Supabase at all.
//
// The login page kept two variables for one fact -- the single-use Turnstile
// token, and a boolean saying the visitor had cleared the challenge -- and
// the password failure branch cleared only the token. The submit button is
// gated on the boolean, so it stayed enabled and every retry posted `null`.
// The server refused, fail-closed and correctly. The visitor was locked out
// by a flag that outlived the token it stood for.
//
// This suite walks the exact sequence that produced it: a wrong password,
// then the right one. It is the whole point of the suite, so it is the
// first thing it does.
//
// Turnstile runs for real here, using Cloudflare's own published
// always-passes TEST keys, so the state machine under test is the one
// production runs rather than a fail-open stand-in. What is NOT claimed:
// this does not exercise a genuine Cloudflare human challenge, and it is
// not provider UAT for Google.
//
// Disposable local identity, removed at the end. Nothing production.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const EMAIL = `uat.s6b.${TAG}@ovalball.test`
const RIGHT = "Ovalball-Test-1!"
const WRONG = "Ovalball-Wrong-9!"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

// A disposable identity with a known password, created through GoTrue's admin
// API so no real credential is ever involved.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required to create the disposable identity.")
  process.exit(1)
}
const created = await fetch("http://127.0.0.1:54321/auth/v1/admin/users", {
  method: "POST",
  headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: RIGHT, email_confirm: true }),
}).then((r) => r.json())
if (!created?.id) {
  console.error("could not create the disposable identity:", JSON.stringify(created).slice(0, 200))
  process.exit(1)
}
sql(`update public.profiles set first_name='Six', surname='Bee', setup_state='COMPLETE',
     date_of_birth=(current_date - interval '30 years')::date where id='${created.id}'`)

const browser = await launch()

/** Types into a React-controlled field with real key events, never by assigning value. */
async function type(page, selector, value) {
  const f = page.locator(selector).first()
  await f.waitFor({ state: "visible", timeout: 20000 })
  await f.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type(value)
}

async function openPasswordForm(page) {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
  if (await reveal.isVisible().catch(() => false)) await reveal.click()
  await page.locator('input[type="password"]').first().waitFor({ state: "visible", timeout: 20000 })
}

/** The Sign In button becomes enabled only once the challenge has produced a token. */
async function waitForChallenge(page, timeout = 30000) {
  const btn = page.getByRole("button", { name: /^Sign In$/ }).first()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (!(await btn.isDisabled().catch(() => true))) return true
    await page.waitForTimeout(400)
  }
  return false
}

try {
  // -------------------------------------------------------------------
  // THE INCIDENT SEQUENCE
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    // Capture what each attempt actually sends. Proving the SECOND attempt
    // carries a DIFFERENT token is the real assertion: a momentary disabled
    // button is timing-dependent, but a replayed token is the defect itself.
    const submittedBodies = []
    let challengeRounds = 0
    page.on("request", (r) => {
      const u = r.url()
      if (r.method() === "POST" && u.includes("/login")) {
        const body = r.postData()
        if (body) submittedBodies.push(body)
      }
      // Each widget mount runs its own challenge round-trip against
      // Cloudflare. Counting them is how a FRESH challenge is observed: the
      // token VALUE cannot show it, because the published test key returns
      // the same dummy string every time by design.
      if (u.includes("challenges.cloudflare.com/cdn-cgi/challenge-platform")) challengeRounds += 1
    })
    await openPasswordForm(page)
    await type(page, 'input[type="email"]', EMAIL)
    await type(page, 'input[type="password"]', WRONG)

    record("S6B-01 the challenge completes and Sign In becomes available", await waitForChallenge(page))

    await page.getByRole("button", { name: /^Sign In$/ }).first().click()
    await page.waitForTimeout(4000)
    const firstError = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")

    // The wrong password must be refused AS a wrong password -- not disguised
    // as a failed security check, which is what the incident looked like.
    record(
      "S6B-02 a wrong password is refused as a credential failure, not a security-check failure",
      /email or password is incorrect/i.test(firstError),
      firstError.slice(0, 120),
    )

    record("S6B-03 a fresh challenge re-enables Sign In without a reload", await waitForChallenge(page))

    // Now the correct password, on the SAME page, with no reload. This is the
    // journey the owner could not complete.
    await type(page, 'input[type="password"]', RIGHT)
    await waitForChallenge(page)
    await page.getByRole("button", { name: /^Sign In$/ }).first().click()

    const landed = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
      .then(() => true)
      .catch(() => false)
    const finalError = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
    record(
      "S6B-05 POSITIVE CONTROL: the correct password now signs in on the same page, no reload",
      landed,
      landed ? `landed on ${new URL(page.url()).pathname}` : `still on /login :: ${finalError.slice(0, 120)}`,
    )
    record(
      "S6B-06 and the security-check message never appeared for a correct password",
      !/security check/i.test(finalError),
      finalError.slice(0, 120),
    )

    const sessions = sql(`select count(*) from auth.sessions where user_id='${created.id}'`)
    record("S6B-07 a real session was created", Number(sessions) >= 1, `sessions=${sessions}`)

    // F: NO ATTEMPT EVER CARRIES AN EMPTY TOKEN.
    //
    // This is the defect stated directly. Before the fix the second attempt
    // posted `null`, because the token had been cleared while the page still
    // believed the visitor was verified, and the server refused it
    // fail-closed with the security-check message. Both attempts carrying a
    // token is the thing that was broken.
    //
    // The token's VALUE cannot distinguish fresh from replayed here: the
    // published always-passes test key issues the same dummy string every
    // time. A fresh challenge is evidenced instead by the widget having run
    // another round-trip against Cloudflare after the failure, and
    // deterministically by supabase/tests/js/turnstile_challenge_state.test.mts,
    // which is where the invariant is actually held still.
    // No /g flag: RegExp.test with /g carries lastIndex between calls, so the
    // second body would be tested from halfway through and miss. That cost a
    // run here and is worth the line of comment.
    const dummy = /XXXX\.DUMMY\.TOKEN\.XXXX|0\.[A-Za-z0-9_-]{20,}/
    const withToken = submittedBodies.filter((b) => dummy.test(b)).length
    record(
      "S6B-08 both attempts carried a token -- neither posted the null the incident produced",
      submittedBodies.length >= 2 && withToken === submittedBodies.length,
      `submissions: ${submittedBodies.length}; carrying a token: ${withToken}`,
    )
    record(
      "S6B-08b and the widget ran a further challenge after the failure, so the second token was freshly issued",
      challengeRounds >= 2,
      `challenge round-trips observed: ${challengeRounds}`,
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // The provider buttons share the same challenge.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(6000)
    // No provider is configured locally, so the buttons are absent. Recorded
    // as the observable boundary rather than claimed as provider UAT.
    const providerButtons = await page.getByRole("button", { name: /continue with|sign in with apple/i }).count()
    record(
      "S6B-09 provider buttons absent locally — no provider configured, so this is NOT provider UAT",
      providerButtons === 0,
      `provider buttons rendered: ${providerButtons}`,
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // 320px: the challenge must not strand a phone.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser, { width: 320, height: 720 })
    const page = await ctx.newPage()
    await openPasswordForm(page)
    await type(page, 'input[type="email"]', EMAIL)
    await type(page, 'input[type="password"]', RIGHT)
    record("S6B-10 the challenge completes at 320px", await waitForChallenge(page))
    const m = await page.evaluate(() => ({ w: window.innerWidth, s: document.body.scrollWidth }))
    record("S6B-11 and the page does not scroll sideways", m.w === 320 && m.s <= 320, `inner=${m.w} scroll=${m.s}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}

sql(`do $$
declare v uuid := '${created.id}';
begin
  perform set_config('ovalball.maintenance', 'on', true);
  delete from public.security_events where subject_user_id = v or actor_user_id = v;
  delete from public.audit_log where record_id = v or changed_by = v or actor_user_id = v;
  delete from public.account_security_state where user_id = v;
  delete from public.profiles where id = v;
  delete from auth.users where id = v;
  delete from public.audit_log where record_id = v;
end $$;`)
record("S6B-12 the suite removed the identity it created", sql(`select count(*) from auth.users where id='${created.id}'`) === "0")

process.exit(summarise() ? 0 : 1)
