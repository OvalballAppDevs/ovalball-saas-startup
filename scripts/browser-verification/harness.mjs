// =====================================================================
// COMMUNICATIONS VERIFICATION HARNESS
//
// The Chrome extension cannot do two things this acceptance run needs:
// it floors the window width well above 320px (macOS enforces a minimum
// window size), and it drives ONE browser profile, so "two independent
// authenticated users" is not expressible in it.
//
// Playwright sets the CSS viewport directly rather than resizing a window,
// and gives each browser CONTEXT its own cookie jar. That is exactly the
// two missing capabilities, so it is the harness for everything the
// extension could not prove.
//
// AUTHENTICATION IS THE REAL PRODUCT PATH. The login form is submitted as
// a person would submit it, the SERVER mints the magic link (so the PKCE
// verifier cookie lands in the right browser context), and the link is
// read out of the local mail catcher. No password is typed or stored, and
// no cookie is fabricated -- the session is one the application itself
// issued.
// =====================================================================

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { chromium } from "playwright-core"
import { totpForSubmission } from "../security/totp.mjs"

export const EXE =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
export const APP = process.env.APP_URL || "http://localhost:3000"
export const MAILPIT = process.env.MAILPIT_URL || "http://127.0.0.1:54324"

export async function launch() {
  return chromium.launch({ executablePath: EXE, headless: true })
}

/**
 * One browser context = one independent cookie jar = one user. Never share
 * a context between two identities; that is the whole point of using them.
 */
export async function newContext(browser, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } })
  // The dev server compiles routes on demand and shares this machine with
  // Docker and a browser, so a cold route can genuinely take half a minute.
  // Playwright's 30s default turns that into a spurious failure that reads
  // like a product defect, which is the one thing this harness exists to
  // avoid. The wait is longer; what is being asserted is unchanged.
  context.setDefaultTimeout(60000)
  context.setDefaultNavigationTimeout(90000)
  return context
}

/**
 * Sign in through the ordinary login form, then follow the emailed link.
 *
 * The form submit matters: it is what makes the server set the PKCE
 * verifier cookie in THIS context. Fetching a link out of band and opening
 * it in a fresh context fails, which is the correct behaviour and worth
 * not working around.
 */
/**
 * SIGN IN ONCE PER IDENTITY, NOT ONCE PER SCRIPT.
 *
 * The auth server rate-limits magic links per address, and a full
 * acceptance run signs in as the same handful of people a dozen times. Past
 * the limit no email is sent at all, the helper picks up an older link, and
 * the run reports a product failure that is really a mail-rate failure.
 *
 * So a successful session's cookies are cached on disk per address and
 * replayed into later contexts. The cache is only ever TRUSTED AFTER BEING
 * VERIFIED against the product: /account must name that person, or the
 * cookies are discarded and a real sign-in happens. A stale cache can
 * therefore never silently produce a signed-out or wrong-identity run.
 */
const SESSION_CACHE = path.join(os.tmpdir(), "ovalball-uat-sessions")

function cachePath(email) {
  return path.join(SESSION_CACHE, `${email.replace(/[^a-z0-9.@-]/gi, "_")}.json`)
}

async function identityOf(page) {
  await page.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  if (/\/login/.test(page.url())) return null
  const text = await page.locator("body").innerText()
  return text.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? null
}

async function tryCachedSession(page, email) {
  const file = cachePath(email)
  if (!fs.existsSync(file)) return false
  try {
    const cookies = JSON.parse(fs.readFileSync(file, "utf8"))
    await page.context().addCookies(cookies)
  } catch {
    return false
  }
  if ((await identityOf(page)) === email) return true
  // Verified and wrong: drop it rather than leave a trap for the next run.
  await page.context().clearCookies()
  try {
    fs.unlinkSync(file)
  } catch {}
  return false
}

async function cacheSession(page, email) {
  try {
    fs.mkdirSync(SESSION_CACHE, { recursive: true })
    fs.writeFileSync(cachePath(email), JSON.stringify(await page.context().cookies()))
  } catch {}
}

export async function signIn(page, email, { attempts = 3 } = {}) {
  // A caller that resolved its address from a query can hand us "" -- the
  // field then stays empty, the submit button stays disabled, and the
  // failure reads as a broken login page rather than a broken query.
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new Error(`signIn called with an implausible address: ${JSON.stringify(email)}`)
  }
  if (await tryCachedSession(page, email)) return "cached"

  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const since = Date.now()
    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
    // Wait for hydration: the email field does not exist until the client
    // component mounts and the "Sign in with email" choice is taken.
    await page.waitForLoadState("networkidle").catch(() => {})

    const reveal = page.getByRole("button", { name: /sign in with email/i })
    await reveal.first().waitFor({ state: "visible", timeout: 15000 })
    await reveal.first().click()
    await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 15000 })

    // Type with real key events. Assigning .value on a React-controlled
    // input leaves the component holding whatever the browser autofilled,
    // and the form then submits THAT address.
    const field = page.locator('input[type="email"]').first()
    await field.click()
    await field.fill("")
    await field.type(email, { delay: 12 })

    const typed = await field.inputValue()
    if (typed !== email) {
      throw new Error(`Login field holds "${typed}", not "${email}" -- refusing to submit.`)
    }

    // Slice 6 made PASSWORD the primary method, so the form now opens asking for one and its submit
    // button stays disabled until a password is typed. This harness signs in by magic link -- that is
    // the whole point of reading the address out of the mail catcher -- so it takes the same route a
    // person without a password takes, and switches the form to the link method first.
    //
    // Clicking a disabled submit and waiting for a mail that was never requested is what this
    // otherwise looks like, and the failure reads as a broken login page rather than a changed one.
    const switchToLink = page.getByRole("button", { name: /email me a link instead/i })
    if (await switchToLink.count()) {
      await switchToLink.first().click()
    }

    const submit = page.locator('form button[type="submit"]').first()
    await submit.waitFor({ state: "visible", timeout: 15000 })
    // Switching method re-renders the form, and the submit is briefly disabled while it does. Reading
    // the flag on the very next tick therefore measured the render rather than the page: every persona
    // with a cached session skipped this path entirely, so the flake only surfaced the first time a
    // brand-new identity signed in. Wait for the state instead of sampling it.
    const enabledBy = Date.now() + 10000
    while ((await submit.isDisabled()) && Date.now() < enabledBy) {
      await page.waitForTimeout(100)
    }
    if (await submit.isDisabled()) {
      throw new Error("The sign-in submit is still disabled 10s after switching to the link method.")
    }
    await submit.click()

    let link
    try {
      link = await waitForSignInLink(email, since)
    } catch (error) {
      lastError = error
      // The auth server rate-limits magic links per address. Waiting is the
      // correct response: requesting harder produces no email at all.
      await new Promise((r) => setTimeout(r, 20000))
      continue
    }

    // The verify hop occasionally stalls; a stalled navigation is not a
    // failed sign-in, so it is retried rather than reported as one.
    try {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 })
    } catch {
      lastError = new Error(`Verify navigation stalled for ${email}`)
      await new Promise((r) => setTimeout(r, 8000))
      continue
    }
    await page.waitForLoadState("networkidle").catch(() => {})

    // PROVE THE SESSION, DO NOT ASSUME IT. A consumed or expired token
    // lands back on /login?error=link, and every later assertion in the
    // run would then be measuring a signed-out page.
    if (!/\/login/.test(page.url())) {
      await cacheSession(page, email)
      return link
    }

    lastError = new Error(`Sign-in for ${email} landed on ${page.url()}`)
    await new Promise((r) => setTimeout(r, 20000))
  }

  throw lastError ?? new Error(`Could not sign in as ${email}.`)
}

async function waitForSignInLink(email, since) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=5`,
    )
    if (!res.ok) continue
    const { messages = [] } = await res.json()
    const fresh = messages
      .filter((m) => new Date(m.Created).getTime() >= since - 5000)
      .sort((x, y) => new Date(y.Created) - new Date(x.Created))
    for (const m of fresh) {
      const body = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()
      const text = `${body.Text || ""} ${body.HTML || ""}`
      const match = text.match(
        /https?:\/\/[^\s"'<>]*(?:auth\/v1\/verify|auth\/callback)[^\s"'<>]*/,
      )
      if (match) return match[0].replace(/&amp;/g, "&")
    }
  }
  throw new Error(`No sign-in link for ${email} arrived in the local mail catcher.`)
}

/** Who does the APPLICATION think is signed in? Read from the product, not the cookie. */
/**
 * Enrol an authenticator through the product, and PROVE it worked.
 *
 * ONE IMPLEMENTATION, replacing the copies that lived in suites 62 and 73.
 *
 * WHY IT ASSERTS (Convergence Step 6, ledger L18). The previous versions ended
 * like this:
 *
 *     await page.getByRole("button", { name: /saved them/i })
 *       .waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
 *     if (await saved.isVisible().catch(() => false)) await saved.click()
 *     return secret
 *
 * If verification failed, the `catch` swallowed it, the immediate `isVisible()`
 * returned false, no click happened, and the helper RETURNED NORMALLY. The suite
 * then went on to perform master-control operations with no AAL2, the preamble
 * correctly refused every one, and five downstream assertions failed while the
 * one thing that had actually gone wrong was never reported. The suite then died
 * on an empty user id.
 *
 * Reproduced exactly by submitting a code the server rejects: same seven passes,
 * same five failures, same crash.
 *
 * So this now fails at the point of failure, carrying the on-screen reason, and
 * confirms a VERIFIED factor exists in GoTrue before returning — the database is
 * the ground truth, not the absence of an error on screen.
 *
 * It also resets the identity's factors first. Suites 62 and 73 are the only two
 * of the nineteen that use the shared Full Site Admin and touch MFA at all, and
 * both clean up after themselves — but an INTERRUPTED run leaves a factor
 * behind, and the next run then enrols against unexpected state. Resetting makes
 * the precondition deterministic instead of depending on the previous run having
 * finished.
 */
export async function enrolAuthenticator(page, { email, sql }) {
  if (!email || typeof sql !== "function") {
    throw new Error("enrolAuthenticator needs the identity's email and a sql() so it can prove the outcome")
  }
  const userId = sql(`select id from public.profiles where email = '${email}'`)
  if (!userId) throw new Error(`enrolAuthenticator: no profile for ${email}`)

  // Deterministic precondition, so an interrupted previous run cannot poison this one.
  sql(`delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id = s.id and s.user_id = '${userId}';
       delete from auth.mfa_challenges c using auth.mfa_factors f where c.factor_id = f.id and f.user_id = '${userId}';
       delete from auth.mfa_factors where user_id = '${userId}';
       delete from public.account_recovery_codes where user_id = '${userId}';`)

  await page.goto(`${APP}/security/enrol`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const start = page.getByRole("button", { name: /start setup|set up|begin/i }).first()
  await start.waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  if (await start.isVisible().catch(() => false)) await start.click()

  await page.locator("#totp-code").waitFor({ state: "visible", timeout: 30000 })

  // Read from the element, not from page text: the key is rendered in a
  // `break-all` mono paragraph, so innerText wraps it mid-string.
  const shown = (await page.locator("p.font-mono").first().textContent()) ?? ""
  const secret = shown.replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z2-7]{16,}$/.test(secret)) {
    throw new Error(`enrolAuthenticator: no authenticator secret was shown (got ${JSON.stringify(shown.slice(0, 40))})`)
  }

  const { code } = await totpForSubmission(secret)
  await page.locator("#totp-code").fill(code)
  await page.getByRole("button", { name: /verify & continue|verify/i }).first().click()

  const done = page.getByRole("button", { name: /saved them/i }).first()
  const reached = await done
    .waitFor({ state: "visible", timeout: 30000 })
    .then(() => true)
    .catch(() => false)

  if (!reached) {
    const onScreen = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
    throw new Error(
      `enrolAuthenticator: verification did not reach the recovery-code screen at ` +
        `${new URL(page.url()).pathname}${onScreen ? ` -- "${onScreen.slice(0, 160)}"` : " -- no error shown"}`
    )
  }

  await done.click()
  await page.waitForLoadState("networkidle").catch(() => {})

  // GROUND TRUTH. A screen without an error is not evidence that a factor exists.
  const verified = sql(`select count(*) from auth.mfa_factors where user_id = '${userId}' and status = 'verified'`)
  if (verified !== "1") {
    throw new Error(`enrolAuthenticator: expected exactly one verified factor for ${email}, found ${verified}`)
  }
  return secret
}

export async function whoAmI(page) {
  await page.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return page
    .locator("body")
    .innerText()
    .then((t) => t)
}

/**
 * Measure the viewport the way the acceptance brief demands: from inside
 * the page. A requested size that Chromium did not honour is a harness
 * failure and must not be reported as a product pass.
 */
export async function measure(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.body.scrollWidth,
    dpr: window.devicePixelRatio,
  }))
}

export async function assertViewport(page, expected, label) {
  const m = await measure(page)
  const ok = m.innerWidth === expected && m.clientWidth === expected
  return { ok, label, expected, ...m }
}

export const results = []
export function record(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`)
}
export function summarise() {
  const pass = results.filter((r) => r.ok).length
  console.log(`\n${pass}/${results.length} passed`)
  return pass === results.length
}

// =====================================================================
// ACCESSIBILITY: ONE DECLARED BASELINE, SHARED, SHRINK-ONLY
//
// Convergence Step 6 recorded two pre-existing serious colour-contrast
// violations and required that the baseline never silently grow. One of them
// is in the APPLICATION SHELL -- the unread badge on the notification bell and
// the messages popover -- which means it is present on every authenticated
// page in the product. Four fixture suites were therefore failing on it twelve
// times over, for one defect that belongs to neither of them.
//
// Each suite declaring it separately would be four copies of a waiver, which
// is how a baseline stops being one thing anybody can count. So the shell's
// known violations live here, once, and every suite's axe reporting goes
// through the same classifier.
//
// WHAT THIS IS NOT. It is not a suppression. A declared violation is still
// printed on every run, as a NOTE, naming the element -- and the runner echoes
// NOTE lines into the release output, so it reaches the report rather than the
// scrollback. It stops a known, owned, already-reported defect from failing
// suites that did not cause it and cannot fix it.
//
// THE ROOT CAUSE, since it is short and worth writing down: both badges set
// `bg-pitch-600 text-white` directly. app/globals.css already knows that pair
// measures about 3.1:1 and already solved it site-wide, by making
// `--primary-foreground` dark ink on that same green -- these two components
// simply predate, and bypass, that decision. It is a token change, not a
// redesign. It is NOT made here: Step 7 does not own the shell, and expanding
// scope into it would be exactly the drift this programme exists to stop.
// =====================================================================

/**
 * Known serious violations that belong to the application shell rather than to
 * any surface under test. Matched on rule id AND on a distinctive fragment of
 * the element selector, so declaring "color-contrast on the unread badge"
 * cannot quietly excuse a colour-contrast failure somewhere else on the page.
 *
 * SHRINK-ONLY. Entries come out when the defect is fixed. Adding one is a
 * deliberate act that has to be argued for in a convergence report.
 */
export const SHELL_PRE_EXISTING_VIOLATIONS = [
  {
    rule: "color-contrast",
    // The unread count on the notification bell and the messages popover.
    // app/(app)/notification-bell.tsx, app/(app)/messages-popover.tsx.
    selectorIncludes: "-top-0\\.5",
    owner: "app shell unread badge (notification-bell.tsx / messages-popover.tsx)",
  },
]

function matchesDeclared(violation, declared) {
  return declared.some((d) => d.rule === violation.id && String(violation.target ?? "").includes(d.selectorIncludes))
}

/**
 * Split an axe result into what this run introduced and what was already
 * declared. `extra` lets a suite declare a violation specific to a surface it
 * does not own, in the same shape.
 */
export function classifyAxeViolations(violations, extra = []) {
  const declared = [...SHELL_PRE_EXISTING_VIOLATIONS, ...extra]
  const serious = (violations ?? []).filter((v) => v.impact === "critical" || v.impact === "serious")
  return {
    serious,
    introduced: serious.filter((v) => !matchesDeclared(v, declared)),
    known: serious.filter((v) => matchesDeclared(v, declared)),
    total: (violations ?? []).length,
  }
}

/** Record an axe result: a suite fails on what it introduced, and reports what it did not. */
export function recordAxe(name, violations, extra = []) {
  const { introduced, known, total } = classifyAxeViolations(violations, extra)
  record(
    name,
    introduced.length === 0,
    introduced.length
      ? introduced.map((v) => `${v.id}(${v.nodes}) ${v.target}`).join(" | ").slice(0, 170)
      : `${total} total, ${known.length} pre-existing and declared, 0 introduced`,
  )
  for (const v of known) {
    console.log(`NOTE  declared pre-existing ${v.id} x${v.nodes} on ${name} -- ${v.target}`.slice(0, 220))
  }
  return introduced.length === 0
}
