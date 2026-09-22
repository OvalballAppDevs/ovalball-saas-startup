// =====================================================================
// PASSWORD RECOVERY ON A PHONE, WALKED
//
// The entrance had a dead end: email and password, and no way back in for
// somebody who had forgotten the password. This is that journey, end to end,
// against a real auth server -- the link is really issued, really delivered,
// really exchanged, and really single-use.
//
//   A. THE WAY IN: Forgot your password? is on the sign-in screen and reachable.
//   B. THE REQUEST: neutral whatever the truth, and an email actually arrives.
//   C. THE LINK: honoured by the auth server, and it carries a PKCE code.
//   D. SETTING A PASSWORD: the canonical rules, shown before they are enforced.
//   E. AFTERWARDS: the new password works, the old one does not, the link
//      cannot be used twice, and MFA is untouched.
//
// Runs on Expo Web, which is the same component tree. The ONE thing it cannot
// exercise is the phone's own handoff from Mail into the app -- there is no
// iOS simulator on this machine -- so the URL that a tap would deliver is
// delivered to the app directly instead, which is the same event from the
// app's point of view. The physical-iPhone checklist covers the rest.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, record, recordAxe, summarise, axeSource } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const APP = process.env.MOBILE_URL || "http://localhost:8081"
const MAILPIT = process.env.MAILPIT_URL || "http://127.0.0.1:54324"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const TAG = Math.random().toString(36).slice(2, 8)
const EMAIL = `uat.mobile.${TAG}@ovalball.test`
const OLD_PASSWORD = `Old-Password-${TAG}-aA1!`
const NEW_PASSWORD = `Brand-New-${TAG}-zZ9!`
let userId = null

function seed() {
  userId = sql(`
    with created as (
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values (
        gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '${EMAIL}', extensions.crypt('${OLD_PASSWORD}', extensions.gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')
      returning id)
    select id from created`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${userId}', 'Recovery', 'Walker', '${EMAIL}', (current_date - interval '36 years')::date)
       on conflict (id) do nothing`)
  const club = sql(`select id from public.clubs where slug = 'ovalball-uat-rufc'`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${club}', '${userId}', 'CLUB_ADMIN', 'active')`)
}

function cleanup() {
  if (!userId) return
  sql(`delete from public.club_memberships where user_id = '${userId}'`)
  sql(`delete from public.profiles where id = '${userId}'`)
  sql(`delete from auth.users where id = '${userId}'`)
  record("cleanup: this run left nothing behind", sql(`select count(*) from auth.users where email = '${EMAIL}'`) === "0")
}

async function recoveryLinkFor(address) {
  const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(address)}`)).json()
  if (!search.messages?.length) return null
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json()
  const body = message.Text || message.HTML || ""
  return (body.match(/https?:\/\/[^\s"'<>]+/g) || [])[0] ?? null
}

seed()
const pageErrors = []
const browser = await launch()
try {
  const ctx = await newContext(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))

  // =====================================================================
  // A. THE WAY IN
  // =====================================================================
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForSelector("text=Welcome back", { timeout: 90000 })
  await page.waitForTimeout(900)
  const forgot = page.getByRole("button", { name: "Forgot your password?" })
  record("A1 the sign-in screen offers a way back in", (await forgot.count()) > 0)
  const box = await forgot.first().boundingBox()
  record("A2 and it is a real touch target, not a web-sized link", (box?.height ?? 0) >= 44, `${Math.round(box?.height ?? 0)}pt`)
  await forgot.first().click()
  await page.waitForTimeout(1200)
  const ask = await page.locator("body").innerText()
  record("A3 it opens Ovalball's own recovery screen", /Forgot your password\?/.test(ask))
  record("A4 which still looks like the app, not a generic form", /Send Reset Link/.test(ask) && /Back to Sign In/.test(ask))
  await recordAxe("A5 axe: the recovery request screen at 390px", await runAxe(page))

  // =====================================================================
  // B. THE REQUEST
  // =====================================================================
  // An address with no account must be answered exactly as one with an account.
  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(`nobody.${TAG}@ovalball.test`, { delay: 5 })
  await page.getByRole("button", { name: "Send Reset Link" }).click()
  await page.waitForTimeout(3500)
  const unknownAnswer = await page.locator("body").innerText()
  record("B1 an address with no account gets the neutral answer", /If an Ovalball account exists/.test(unknownAnswer), unknownAnswer.slice(0, 70).replace(/\n/g, " "))

  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2500)
  await page.getByRole("button", { name: "Forgot your password?" }).first().click()
  await page.waitForTimeout(1200)
  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(EMAIL, { delay: 5 })
  await page.getByRole("button", { name: "Send Reset Link" }).click()
  await page.waitForTimeout(4000)
  const knownAnswer = await page.locator("body").innerText()
  record("B2 an address WITH an account gets the identical answer", /If an Ovalball account exists/.test(knownAnswer))

  // =====================================================================
  // C. THE LINK
  // =====================================================================
  const link = await recoveryLinkFor(EMAIL)
  record("C1 a recovery email is actually delivered", Boolean(link), link ? link.slice(0, 60) : "(none)")
  const redirectTo = decodeURIComponent((link?.match(/redirect_to=([^&"]+)/) || [])[1] ?? "")
  record("C2 and the auth server honours where it should come back to", redirectTo.length > 0, redirectTo)

  // Follow the verify link the way the phone's browser would.
  const verified = await fetch(link, { redirect: "manual" })
  const location = verified.headers.get("location") ?? ""
  const code = (location.match(/[?&]code=([^&]+)/) || [])[1] ?? null
  record("C3 following it yields a single-use PKCE code", Boolean(code))

  // THE HANDOFF a phone performs: the link's destination delivers the code to the app. On a device
  // this is Mail -> Safari -> Ovalball; here the app is handed the same URL, which is the same event.
  await page.goto(`${APP}/auth/recovery?code=${encodeURIComponent(code ?? "")}`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(6000)
  const setScreen = await page.locator("body").innerText()
  record("C4 the app opens on Set a new password", /Set a new password/.test(setScreen), setScreen.slice(0, 80).replace(/\n/g, " "))
  record("C5 and it does NOT drop the person into the product", !/Good (morning|afternoon|evening)/.test(setScreen))

  // =====================================================================
  // D. SETTING A PASSWORD
  // =====================================================================
  record("D1 the rules are shown before they are enforced", /At least 12 characters/.test(setScreen) && /One capital letter/.test(setScreen))
  await page.getByLabel("New Password", { exact: true }).click()
  await page.keyboard.type("short", { delay: 5 })
  await page.waitForTimeout(600)
  record("D2 a weak password cannot even be submitted", !(await page.getByRole("button", { name: "Save New Password" }).isEnabled()))

  await page.getByLabel("New Password", { exact: true }).press("Meta+A")
  await page.keyboard.type(NEW_PASSWORD, { delay: 5 })
  await page.getByLabel("Confirm New Password", { exact: true }).click()
  await page.keyboard.type(`${NEW_PASSWORD}-different`, { delay: 5 })
  await page.waitForTimeout(600)
  record("D3 a mismatch cannot be submitted either", !(await page.getByRole("button", { name: "Save New Password" }).isEnabled()))

  await page.getByLabel("Confirm New Password", { exact: true }).press("Meta+A")
  await page.keyboard.type(NEW_PASSWORD, { delay: 5 })
  await page.waitForTimeout(600)
  record("D4 a password meeting the rules can be saved", await page.getByRole("button", { name: "Save New Password" }).isEnabled())
  await recordAxe("D5 axe: the set-password screen at 390px", await runAxe(page))
  await page.getByRole("button", { name: "Save New Password" }).click()
  await page.waitForTimeout(6000)
  const done = await page.locator("body").innerText()
  record("D6 and it is accepted", /Password updated/.test(done), done.slice(0, 80).replace(/\n/g, " "))
  record("D7 which says plainly that two-factor security is untouched", /two-factor/i.test(done))

  // =====================================================================
  // E. AFTERWARDS
  // =====================================================================
  const replay = await fetch(link, { redirect: "manual" })
  const replayLocation = replay.headers.get("location") ?? ""
  record("E1 the recovery link cannot be used a second time", /error|otp_expired|invalid/i.test(replayLocation), replayLocation.slice(0, 70))

  await page.getByRole("button", { name: "Continue to Sign In" }).click()
  await page.waitForTimeout(4000)
  record("E2 and it returns to sign-in rather than carrying on authenticated", /Welcome back/.test(await page.locator("body").innerText()))

  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(EMAIL, { delay: 5 })
  await page.getByLabel("Password", { exact: true }).click()
  await page.keyboard.type(OLD_PASSWORD, { delay: 5 })
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForTimeout(4000)
  record("E3 the OLD password no longer works", /incorrect/i.test(await page.locator("body").innerText()))

  await page.getByLabel("Password", { exact: true }).press("Meta+A")
  await page.keyboard.type(NEW_PASSWORD, { delay: 5 })
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForTimeout(7000)
  record("E4 and the new one does", /Good (morning|afternoon|evening)/.test(await page.locator("body").innerText()))

  const realErrors = pageErrors.filter((e) => !/ResizeObserver|DevTools|Failed to fetch|NetworkError/i.test(e))
  record("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))
  await ctx.close()
} finally {
  cleanup()
  await browser.close()
}

async function runAxe(target) {
  await target.addScriptTag({ content: axeSource() })
  return await target.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
}

summarise()
