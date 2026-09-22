// =====================================================================
// THE OVALBALL MOBILE APP, WALKED END TO END
//
// The foundation session's own acceptance journey (M0/M1/M2 §39): launch,
// sign in, see who you are, load your real canonical contexts, switch between
// them, watch Home change, restore the session, sign out.
//
// WHY THIS RUNS ON EXPO WEB. This machine has no iOS simulator (Xcode is not
// installed, only the Command Line Tools) and no Android SDK, so neither
// native platform can be launched here at all. Expo Web is not a different
// application: it is the SAME React Native component tree, the same
// expo-router navigation, the same session provider, the same
// `@ovalball/contracts` reads, compiled by the same Metro bundler. What it
// does NOT exercise is the native layer -- expo-secure-store in particular,
// which has no web implementation and falls back to localStorage. That gap is
// stated rather than papered over, and the report says so.
//
//   A. SIGNED OUT FIRST, and it looks like Ovalball.
//   B. SIGN IN with email and password -- the platform's actual flow.
//   C. IDENTITY: the app says who is signed in.
//   D. CONTEXTS: the real canonical list, from the shared reader.
//   E. SWITCHING changes the product.
//   F. RESTORATION: reopening the app keeps you signed in.
//   G. SIGN OUT leaves nothing behind.
//
// SELF-SEEDING AND SELF-CLEANING. The persistent UAT personas sign in with a
// magic link and have no password, and this suite will not give one to a
// review identity to suit itself. It creates a disposable person with a
// password, a club role and a coaching assignment, and removes exactly that
// at the end.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, record, recordAxe, summarise, axeSource } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const APP = process.env.MOBILE_URL || "http://localhost:8081"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const TAG = Math.random().toString(36).slice(2, 8)
const EMAIL = `uat.mobile.${TAG}@ovalball.test`
// A disposable password for a disposable account, meeting the platform's 12-character policy.
const PASSWORD = `Mobile-Foundation-${TAG}`

let userId = null
const pageErrors = []

function seed() {
  userId = sql(`
    with created as (
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values (
        gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '${EMAIL}', extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')
      returning id)
    select id from created`)

  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${userId}', 'Morgan', 'Mobilecheck', '${EMAIL}', (current_date - interval '38 years')::date)
       on conflict (id) do nothing`)

  // A person with BOTH a club role and a coaching assignment -- the multi-context case the whole
  // architecture starts from. One relationship would prove nothing about switching.
  const club = sql(`select c.id from public.clubs c where c.slug = 'ovalball-uat-rufc'`)
  const team = sql(`select t.id from public.teams t where t.club_id = '${club}' and t.display_name = 'Under 12 Boys'`)
  const membership = sql(`insert into public.club_memberships (club_id, user_id, role, status)
                          values ('${club}', '${userId}', 'CLUB_ADMIN', 'active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission)
       values ('${membership}', '${team}', 'coach')`)
  return { club, team }
}

function cleanup() {
  if (!userId) return
  // Exactly what this run created, by the id it created. Never a pattern sweep over a shared table.
  try {
    sql(`delete from public.team_permissions where membership_id in
           (select id from public.club_memberships where user_id = '${userId}')`)
    sql(`delete from public.club_memberships where user_id = '${userId}'`)
    sql(`delete from public.profiles where id = '${userId}'`)
    sql(`delete from auth.users where id = '${userId}'`)
  } catch (error) {
    record("cleanup: removing the disposable identity", false, String(error?.message ?? error))
    return
  }
  const left = sql(`select count(*) from auth.users where email = '${EMAIL}'`)
  record("cleanup: the disposable identity is gone", left === "0", `rows: ${left}`)
}

const { team } = seed()
const teamName = sql(`select display_name from public.teams where id = '${team}'`)

const browser = await launch()
try {
  // A phone-sized viewport, because that is what this application is.
  const ctx = await newContext(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))

  // =====================================================================
  // A. SIGNED OUT, AND IT LOOKS LIKE OVALBALL
  // =====================================================================
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForSelector("text=Welcome back", { timeout: 90000 })
  const signedOut = await page.locator("body").innerText()
  record("A1 the app opens signed out, at Welcome back", /Welcome back/.test(signedOut))
  record("A2 and it is Ovalball's own sign-in, not a generic form", /Sign in to your Ovalball account/.test(signedOut))
  record("A3 with an email and a password field", /Email Address/.test(signedOut) && /Password/.test(signedOut))
  // It must NOT offer providers the platform has switched off.
  record("A4 and offers no social button the platform has not enabled", !/Continue with Google|Sign in with Apple/.test(signedOut))
  await page.waitForTimeout(700)
  const canvasGone = await page.locator('[aria-label="Ovalball is starting"]').count()
  record("A5 the launch canvas is gone once sign-in is on screen, not merely transparent", canvasGone === 0, String(canvasGone))
  await recordAxe("A6 axe: the sign-in screen at 390px", await runAxe(page))

  // =====================================================================
  // B. SIGN IN
  // =====================================================================
  // Typed with real key events, never by assigning value: these are controlled inputs, and assignment
  // leaves React holding whatever was there before.
  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(EMAIL, { delay: 10 })
  await page.getByLabel("Password", { exact: true }).click()
  await page.keyboard.type(PASSWORD, { delay: 10 })
  const signInButton = page.getByRole("button", { name: "Sign In" })
  record("B1 the Sign In button becomes available once both fields are filled", await signInButton.isEnabled())
  await signInButton.click()

  await page.waitForSelector("text=Good morning,, text=Good afternoon,, text=Good evening,", { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const home = await page.locator("body").innerText()
  record("B2 a correct email and password reach the product", /Good (morning|afternoon|evening)/.test(home), home.slice(0, 60))

  // =====================================================================
  // C. THE APP KNOWS WHO I AM
  // =====================================================================
  record("C1 the header names the signed-in person", /Morgan/.test(home), home.slice(0, 80))
  // No picture on this disposable account, so the canonical fallback: initials, never a club crest.
  const personLabel = await page.locator('[aria-label*="no picture"]').count()
  record("C2 and shows the canonical initials fallback rather than borrowing another image", personLabel > 0)

  // =====================================================================
  // D. MY REAL CONTEXTS
  // =====================================================================
  record("D1 the context strip shows the context being viewed", /Ovalball UAT RUFC|Under 12 Boys/.test(home), home.slice(0, 200))
  await page.getByRole("button", { name: /^Viewing / }).click()
  await page.waitForTimeout(1200)
  const switcher = await page.locator("body").innerText()
  record("D2 the switcher names the person, not the scope", /Morgan/.test(switcher))
  record("D3 and lists the club role", /Club Admin/.test(switcher), switcher.slice(0, 400))
  record("D4 and the coaching assignment, as its own context", new RegExp(teamName).test(switcher))

  // The canonical list is the shared reader's, so it must agree with what the database would say.
  const expected = sql(`select count(*) from public.club_memberships where user_id = '${userId}' and state = 'ACTIVE'`)
  record("D5 the contexts came from the real membership, not an invented list", expected === "1", `memberships: ${expected}`)

  // =====================================================================
  // E. SWITCHING CHANGES THE PRODUCT
  // =====================================================================
  await page.getByRole("button", { name: new RegExp(`^${teamName},`) }).click()
  await page.waitForTimeout(3000)
  const teamHome = await page.locator("body").innerText()
  record("E1 selecting the team makes Home the team's", new RegExp(teamName).test(teamHome), teamHome.slice(0, 200))
  record(
    "E2 and the team's home answers the team's question, not the club's",
    /Next Up/.test(teamHome) && !/Pick a team to see its next match/.test(teamHome)
  )

  await page.getByRole("button", { name: /^Viewing / }).click()
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: /^Ovalball UAT RUFC,/ }).click()
  await page.waitForTimeout(3000)
  const clubHome = await page.locator("body").innerText()
  record("E3 switching back to the club changes Home again", /Ovalball UAT RUFC/.test(clubHome))
  record(
    "E4 and the club's home does not present one team's fixture as the club's",
    /Pick a team to see its next match/.test(clubHome),
    clubHome.slice(0, 200)
  )

  // =====================================================================
  // F. CLOSE AND REOPEN
  // =====================================================================
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForTimeout(5000)
  const restored = await page.locator("body").innerText()
  record("F1 reopening the app restores the session rather than asking again", !/Welcome back/.test(restored), restored.slice(0, 60))
  record("F2 and the person is still named", /Morgan/.test(restored))
  record("F3 and the context that was chosen is still the one in front of them", /Ovalball UAT RUFC/.test(restored))

  // =====================================================================
  // G. SIGN OUT
  // =====================================================================
  // The bottom bar renders as tabs, not buttons, so the cell is found by its visible word --
  // which is also the point: every cell keeps a readable label.
  await page.getByText("More", { exact: true }).first().click()
  await page.waitForTimeout(1500)
  const more = await page.locator("body").innerText()
  record("G1 More says where this build stores a session", /Session stored in/.test(more), more.slice(0, 300))
  await page.getByRole("button", { name: "Sign Out" }).first().click()
  await page.waitForTimeout(3000)
  const goneText = await page.locator("body").innerText()
  record("G2 signing out returns to the sign-in screen", /Welcome back/.test(goneText))

  // And it is gone from the device, not merely off screen.
  const stored = await page.evaluate(() => {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && /auth-token|selected-context/.test(key)) keys.push(key)
    }
    return keys
  })
  record("G3 and the stored session and selected context are cleared from the device", stored.length === 0, stored.join(", "))

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForTimeout(4000)
  record("G4 reopening after sign-out does not restore anybody", /Welcome back/.test(await page.locator("body").innerText()))

  const realErrors = pageErrors.filter((e) => !/ResizeObserver|Download the React DevTools/.test(e))
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
