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
    if (await submit.isDisabled()) {
      throw new Error("The sign-in submit is disabled after switching to the link method.")
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
