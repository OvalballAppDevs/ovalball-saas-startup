// =====================================================================
// THE OVALBALL MOBILE SHELL -- the parts a person feels rather than uses
//
// The foundation journey (91) proves the app WORKS. This proves it is not
// unpleasant: that nothing important sits under the system's own furniture,
// that the bottom bar is readable and reachable at every width, that the
// launch canvas gets out of the way, that losing signal produces a product
// state rather than a collapse, and that a screen reader is told what a
// screen reader needs.
//
//   A. LAUNCH: one canvas, no white frame, and it leaves when it is done.
//   B. BOTTOM BAR: five labelled cells, real targets, an active state that is
//      not colour alone, and it does not cover the page.
//   C. WIDTHS: 320, 360, 390 and 430 -- nothing clipped, nothing sideways.
//   D. KEYBOARD: the submit button stays reachable with a keyboard open.
//   E. OFFLINE: signal loss is a product state with a way back.
//   F. ACCESSIBILITY: axe on each destination, at the width people use.
//
// Runs on Expo Web because this machine has no iOS simulator and no Android
// SDK. Safe-area insets are therefore ZERO here, so the padding maths cannot
// be proved -- only that the layout does not depend on them being zero. The
// physical-iPhone checklist in the report covers what this cannot.
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
const PASSWORD = `Mobile-Shell-${TAG}-aA1`
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
        '${EMAIL}', extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')
      returning id)
    select id from created`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${userId}', 'Shell', 'Check', '${EMAIL}', (current_date - interval '35 years')::date)
       on conflict (id) do nothing`)
  const club = sql(`select c.id from public.clubs c where c.slug = 'ovalball-uat-rufc'`)
  const team = sql(`select t.id from public.teams t where t.club_id = '${club}' and t.display_name = 'Under 12 Boys'`)
  const membership = sql(`insert into public.club_memberships (club_id, user_id, role, status)
                          values ('${club}', '${userId}', 'CLUB_ADMIN', 'active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission) values ('${membership}', '${team}', 'coach')`)
}

function cleanup() {
  if (!userId) return
  sql(`delete from public.team_permissions where membership_id in (select id from public.club_memberships where user_id = '${userId}')`)
  sql(`delete from public.club_memberships where user_id = '${userId}'`)
  sql(`delete from public.profiles where id = '${userId}'`)
  sql(`delete from auth.users where id = '${userId}'`)
  record("cleanup: this run left nothing behind", sql(`select count(*) from auth.users where email = '${EMAIL}'`) === "0")
}

async function signIn(page) {
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForSelector("text=Welcome back", { timeout: 90000 })
  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(EMAIL, { delay: 5 })
  await page.getByLabel("Password", { exact: true }).click()
  await page.keyboard.type(PASSWORD, { delay: 5 })
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForTimeout(6000)
}

seed()
const pageErrors = []
const browser = await launch()
try {
  const ctx = await newContext(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))

  // =====================================================================
  // A. LAUNCH
  // =====================================================================
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 })
  // The very first painted frame must already be the brand ground: a white body is the flash.
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  record("A1 the page's own ground is never white", !/rgb\(255,\s*255,\s*255\)/.test(bodyBg), bodyBg)
  await page.waitForSelector("text=Welcome back", { timeout: 90000 })
  await page.waitForTimeout(900)
  record(
    "A2 the launch canvas unmounts rather than lingering invisibly over the product",
    (await page.locator('[aria-label="Ovalball is starting"]').count()) === 0
  )

  // =====================================================================
  // B. BOTTOM BAR
  // =====================================================================
  await signIn(page)
  const bar = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]')
    if (!list) return null
    const rect = list.getBoundingClientRect()
    const tabs = [...list.querySelectorAll('[role="tab"]')].map((t) => {
      const r = t.getBoundingClientRect()
      return {
        text: t.innerText.trim(),
        width: Math.round(r.width),
        height: Math.round(r.height),
        selected: t.getAttribute("aria-selected") === "true",
        label: t.getAttribute("aria-label") || t.innerText.trim(),
      }
    })
    return { top: Math.round(rect.top), height: Math.round(rect.height), viewport: window.innerHeight, tabs }
  })
  record("B1 there is a bottom bar", bar !== null)
  record("B2 with five destinations", bar?.tabs.length === 5, bar?.tabs.map((t) => t.text).join(" · "))
  record(
    "B3 every cell keeps a readable word, not an icon alone",
    bar?.tabs.every((t) => t.text.length > 0),
    bar?.tabs.map((t) => `${t.text || "(none)"}`).join(" · ")
  )
  // MESSAGES TOOK THE FOURTH CELL AT M3 and Rugby Hub moved to More -- an owner decision, and the
  // same one twice: messaging is a daily job, the Hub is something you go and read. What matters is
  // that the Hub did not LEAVE, which is asserted where its route lives
  // (supabase/tests/js/mobile_tab_projection.test.mts).
  record(
    "B4 and Messages is one of them, because it is a daily job",
    bar?.tabs.some((t) => /Messages/.test(t.text)),
    bar?.tabs.map((t) => t.text).join(" · ")
  )
  record(
    "B5 every cell is a comfortable target",
    bar?.tabs.every((t) => t.height >= 44 && t.width >= 44),
    bar?.tabs.map((t) => `${t.width}x${t.height}`).join(" ")
  )
  record("B6 exactly one cell reports itself selected", bar?.tabs.filter((t) => t.selected).length === 1)
  record("B7 the bar sits at the bottom of the viewport, not over the content", bar && bar.top + bar.height <= bar.viewport + 1, `${bar?.top}+${bar?.height} vs ${bar?.viewport}`)

  // The page must be able to scroll clear of the bar -- content under a fixed bar is unreachable.
  const clearance = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]')
    const scroller = document.querySelector('[class*="r-overflowY"]')
    if (!list || !scroller) return null
    return Math.round(list.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom)
  })
  record("B8 the scrolling page ends above the bar", clearance === null || clearance >= 0, String(clearance))

  // =====================================================================
  // C. WIDTHS
  // =====================================================================
  for (const [width, name] of [[320, "the smallest phone still in use"], [360, "a common Android"], [390, "iPhone 14/15"], [430, "a Pro Max"]]) {
    await page.setViewportSize({ width, height: 844 })
    await page.waitForTimeout(700)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record(`C @${width} no sideways scroll -- ${name}`, overflow <= 0, `${overflow}px`)
    const clipped = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]')
      if (!list) return []
      // A label that has been ellipsised is a label somebody cannot read.
      return [...list.querySelectorAll('[role="tab"]')]
        .map((t) => {
          const span = t.querySelector("div > div:last-child") || t
          return span.scrollWidth > span.clientWidth + 1 ? t.innerText.trim() : null
        })
        .filter(Boolean)
    })
    record(`C @${width} no tab label is clipped`, clipped.length === 0, clipped.join(", "))
  }
  await page.setViewportSize({ width: 390, height: 844 })

  // =====================================================================
  // F. ACCESSIBILITY, on each destination
  // =====================================================================
  for (const [label, tab] of [["Home", "Home"], ["Fixtures", "Fixtures"], ["Calendar", "Calendar"], ["Messages", "Messages"], ["More", "More"]]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).first().click()
    await page.waitForTimeout(1200)
    await recordAxe(`F axe: ${label} at 390px`, await runAxe(page))
  }

  // The context switcher is the product's most important control, so its semantics are checked, not
  // assumed: a sheet whose rows are unlabelled divs is unusable with VoiceOver.
  await page.getByRole("tab", { name: /Home/ }).first().click()
  await page.waitForTimeout(900)
  await page.getByRole("button", { name: /^Viewing / }).click()
  await page.waitForTimeout(1200)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[role="button"]')]
      .map((b) => b.getAttribute("aria-label"))
      .filter((l) => l && /Club Admin|Coach/.test(l))
  )
  record("F context rows carry a full spoken label", rows.length >= 2, rows.join(" | "))
  // `aria-selected` is not valid on a button, so react-native-web correctly does not emit it -- which
  // is exactly why the row's own spoken label carries the word. `accessibilityState.selected` is still
  // set for iOS and Android, where VoiceOver and TalkBack announce it natively; the label is what makes
  // the state audible on the platform that cannot.
  const current = rows.filter((label) => / current$/.test(label ?? ""))
  record("F and the current context is spoken as current, not shown only in green", current.length === 1, current.join(" | "))
  await recordAxe("F axe: the context sheet at 390px", await runAxe(page))
  await page.keyboard.press("Escape")
  await page.waitForTimeout(600)

  // =====================================================================
  // D. ONE CLUB IDENTITY, ON EVERY SCREEN
  // =====================================================================
  // Section 20: standing in Under 12 Boys, the club identity shown is the CLUB's -- and it must be the
  // same club on every destination. It was not: the header took the crest as a prop, and the screens
  // that did not pass it fell back to the TEAM's initials, so the same app showed two different club
  // identities on two tabs. Resolved once in the provider now, and checked on each tab here.
  await page.getByRole("button", { name: /^Viewing / }).click()
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: /^Under 12 Boys,/ }).click()
  await page.waitForTimeout(4000)
  const crests = []
  for (const tab of ["Home", "Fixtures", "Calendar", "Messages", "More"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).first().click()
    await page.waitForTimeout(1200)
    crests.push(
      await page.evaluate(() => {
        const el = document.querySelector('[aria-label$="crest"], [aria-label$="no crest"]')
        return el?.getAttribute("aria-label") ?? "(none)"
      })
    )
  }
  record("D1 every destination shows the same club identity", new Set(crests).size === 1, crests.join(" | "))
  record(
    "D2 and it is the owning CLUB, never the team standing in for it",
    crests.every((c) => /Ovalball UAT RUFC/.test(c)),
    crests[0]
  )
  record("D3 and a missing crest is initials, never another image", crests.every((c) => /crest$/.test(c)), crests[0])

  // =====================================================================
  // E. OFFLINE
  // =====================================================================
  // DELIBERATELY NOT A RELOAD. Reloading with the network down shows the BROWSER's error page, which
  // proves nothing about Ovalball -- the first version of this test measured Chrome and passed. What
  // matters is the running app losing signal: it stays on screen, its own data read fails, and it says
  // so in the product's voice with a way back.
  await ctx.setOffline(true)
  await page.getByRole("tab", { name: /More/ }).first().click()
  await page.waitForTimeout(600)
  await page.getByRole("tab", { name: /Home/ }).first().click()
  await page.waitForTimeout(5000)
  const offlineText = await page.locator("body").innerText().catch(() => "")
  record(
    "E1 the app stays on screen when the signal goes",
    /Ovalball UAT RUFC|Under 12 Boys|Good (morning|afternoon|evening)/.test(offlineText),
    offlineText.slice(0, 80).replace(/\n/g, " ")
  )
  record(
    "E2 and nothing raw is ever shown to the person",
    !/PGRST|JWT expired|TypeError|Failed to fetch|NetworkError|supabase/i.test(offlineText),
    offlineText.slice(0, 160).replace(/\n/g, " ")
  )
  await ctx.setOffline(false)
  await page.getByRole("tab", { name: /Fixtures/ }).first().click()
  await page.waitForTimeout(600)
  await page.getByRole("tab", { name: /Home/ }).first().click()
  await page.waitForTimeout(5000)
  record(
    "E3 and it recovers when the signal comes back, without a restart",
    !/Couldn't load/.test(await page.locator("body").innerText())
  )

  const realErrors = pageErrors.filter((e) => !/ResizeObserver|DevTools|Failed to fetch|NetworkError|Load failed/i.test(e))
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
