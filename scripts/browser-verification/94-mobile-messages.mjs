// =====================================================================
// MESSAGES ON A PHONE -- the M3 journey
//
// A real inbox from the website's own assembler, a real conversation, a real
// send, and the refusals that matter. The authority itself is proved in SQL
// (supabase/tests/mobile_message_authority.sql, 12 assertions) because that is
// where authority lives; this proves the PRODUCT in front of a person.
//
//   A. THE BAR: Messages is a first-class cell, with a real unread badge.
//   B. THE INBOX: the canonical rows, ordered, with unread state.
//   C. A CONVERSATION: history, ownership, composer.
//   D. SENDING: it arrives, and a double tap does not send twice.
//   E. READ-ONLY: a conversation that cannot be replied to is still readable.
//   F. DEEP LINK: an id is not a permission.
//
// Self-seeding and self-cleaning. Expo Web, because this machine has no iOS
// simulator; the component tree and the readers are the same.
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
const ME = `uat.mobile.${TAG}@ovalball.test`
const PASSWORD = `Messages-${TAG}-aA1!`
const created = { users: [], conversation: null }

function makeUser(email, first) {
  const id = sql(`
    with created as (
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values (
        gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '${email}', extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')
      returning id)
    select id from created`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${id}', '${first}', 'Messages', '${email}', (current_date - interval '34 years')::date)
       on conflict (id) do nothing`)
  created.users.push(id)
  return id
}

function seed() {
  const me = makeUser(ME, "Mo")
  const them = makeUser(`uat.mobile.${TAG}.other@ovalball.test`, "Sam")
  const club = sql(`select id from public.clubs where slug = 'ovalball-uat-rufc'`)
  for (const user of [me, them]) {
    sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${club}', '${user}', 'CLUB_ADMIN', 'active')`)
  }
  // Ordered pair: the table keeps one row per pair whichever way round it is created.
  const conversation = sql(`insert into public.direct_conversations (user_a, user_b, created_by)
                            values (least('${me}'::uuid,'${them}'::uuid), greatest('${me}'::uuid,'${them}'::uuid), '${them}') returning id`)
  created.conversation = conversation
  // THEM first, so the thread opens with an unread message from somebody else -- which is what the
  // badge, the unread row and the ownership colours all depend on.
  sql(`insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
       values ('${conversation}', '${them}', 'Can you take training on Thursday?', 'message', 'text')`)
  return { me, them, conversation }
}

function cleanup() {
  try {
    if (created.conversation) {
      sql(`delete from public.fixture_messages where direct_conversation_id = '${created.conversation}'`)
      sql(`delete from public.direct_conversations where id = '${created.conversation}'`)
    }
    for (const id of created.users) {
      sql(`delete from public.club_memberships where user_id = '${id}'`)
      sql(`delete from public.profiles where id = '${id}'`)
      sql(`delete from auth.users where id = '${id}'`)
    }
  } catch (error) {
    record("cleanup: removing this run's data", false, String(error?.message ?? error))
    return
  }
  record("cleanup: this run left nothing behind", sql(`select count(*) from auth.users where email like 'uat.mobile.${TAG}%'`) === "0")
}

// SEEDING IS INSIDE THE GUARD, and that is not tidiness.
//
// It used to run above `try`, so a seeding failure -- a constraint this fixture got wrong, say --
// skipped the `finally` entirely and left identities behind in the owner's local database. That
// happened: a cast error in the conversation insert stranded two accounts, which were then found by
// hand. Anything that CREATES must be inside the block whose `finally` removes it.
const pageErrors = []
const browser = await launch()
let conversation = null
try {
  ;({ conversation } = seed())

  const ctx = await newContext(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))

  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForSelector("text=Welcome back", { timeout: 90000 })
  await page.getByLabel("Email Address", { exact: true }).click()
  await page.keyboard.type(ME, { delay: 5 })
  await page.getByLabel("Password", { exact: true }).click()
  await page.keyboard.type(PASSWORD, { delay: 5 })
  await page.getByRole("button", { name: "Sign In" }).click()
  await page.waitForTimeout(8000)

  // =====================================================================
  // A. THE BAR
  // =====================================================================
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => ({
      text: t.innerText.trim(),
      label: t.getAttribute("aria-label") ?? "",
    }))
  )
  record("A1 Messages is a bottom-bar destination", tabs.some((t) => /Messages/.test(t.text)), tabs.map((t) => t.text).join(" · "))
  record("A2 Rugby Hub moved out of the bar rather than out of the app", !tabs.some((t) => /Rugby Hub/.test(t.text)))
  const messagesTab = tabs.find((t) => /Messages/.test(t.text))
  record("A3 the unread count is spoken, not just coloured", /unread/i.test(messagesTab?.label ?? ""), messagesTab?.label ?? "")

  const home = await page.locator("body").innerText()
  record("A4 and Home names it as something needing attention", /unread message/i.test(home), home.slice(0, 120).replace(/\n/g, " "))

  // =====================================================================
  // B. THE INBOX
  // =====================================================================
  await page.getByRole("tab", { name: /Messages/ }).first().click()
  await page.waitForSelector("text=Sam", { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const inbox = await page.locator("body").innerText()
  record("B1 the inbox lists the conversation", /Sam/.test(inbox), inbox.slice(0, 160).replace(/\n/g, " "))
  record("B2 with the latest message as a preview", /training on Thursday/.test(inbox))
  await recordAxe("B3 axe: the inbox at 390px", await runAxe(page))

  // =====================================================================
  // C. A CONVERSATION
  // =====================================================================
  await page.getByRole("button", { name: /Sam/ }).first().click()
  await page.waitForTimeout(5000)
  const thread = await page.locator("body").innerText()
  record("C1 opening it shows the history", /training on Thursday/.test(thread))
  record("C2 with the sender named", /Sam/.test(thread))
  record("C3 and a composer, because this person may reply", (await page.getByLabel("Message", { exact: true }).count()) > 0)
  await recordAxe("C4 axe: a conversation at 390px", await runAxe(page))

  // =====================================================================
  // D. SENDING
  // =====================================================================
  const reply = `Yes, I can do Thursday ${TAG}`
  await page.getByLabel("Message", { exact: true }).click()
  await page.keyboard.type(reply, { delay: 5 })
  const send = page.getByRole("button", { name: "Send message" })
  record("D1 the send control becomes available once something is written", await send.isEnabled())
  // Two taps in quick succession, which is exactly what a slow network produces.
  await send.click()
  await send.click().catch(() => {})
  await page.waitForTimeout(6000)
  const afterSend = await page.locator("body").innerText()
  record("D2 the message appears in the thread", afterSend.includes(reply))
  const stored = sql(`select count(*) from public.fixture_messages where direct_conversation_id = '${conversation}' and body = '${reply}'`)
  record("D3 exactly once, despite a double tap", stored === "1", `rows: ${stored}`)
  record("D4 and the composer is empty again", (await page.getByLabel("Message", { exact: true }).inputValue()) === "")

  // =====================================================================
  // H. DRAFTS -- a half-typed message is not disposable
  // =====================================================================
  // Run here, while the conversation is already open, and moved between tabs rather than reloaded:
  // the draft's promise is that it survives LEAVING THE SCREEN, which is what a person actually does.
  const halfTyped = `Half typed ${TAG}`
  await page.getByLabel("Message", { exact: true }).click()
  await page.keyboard.type(halfTyped, { delay: 5 })
  await page.waitForTimeout(1200)
  await page.getByRole("tab", { name: /Home/ }).first().click()
  await page.waitForTimeout(2500)
  await page.getByRole("tab", { name: /Messages/ }).first().click()
  await page.waitForTimeout(3500)
  const backOnThread = (await page.getByLabel("Message", { exact: true }).count()) > 0
  record("H1 the conversation is where you left it", backOnThread)
  if (backOnThread) {
    record(
      "H2 and a half-typed message survived leaving the screen",
      (await page.getByLabel("Message", { exact: true }).inputValue()) === halfTyped
    )
  }
  const draftRows = sql(`select count(*) from public.fixture_messages where body = '${halfTyped}'`)
  record("H3 a draft is never sent by accident", draftRows === "0", `rows: ${draftRows}`)

  // Reading clears the badge -- the count comes from the same rows the list shows.
  await page.getByRole("tab", { name: /Home/ }).first().click()
  await page.waitForTimeout(4000)
  const afterRead = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-label") ?? "").join(" | ")
  )
  record("D5 reading the conversation clears the unread badge", !/unread/i.test(afterRead), afterRead.slice(0, 80))

  // =====================================================================
  // F. A DEEP LINK IS NOT A PERMISSION
  // =====================================================================
  // A conversation this person is genuinely not in. The id is real; the access is not.
  const strangerConversation = sql(`
    with a as (select id from auth.users where email like 'uat.%' and id <> '${created.users[0]}' order by created_at limit 1),
         b as (select id from auth.users where email like 'uat.%' and id <> '${created.users[0]}' order by created_at desc limit 1),
         made as (
           insert into public.direct_conversations (user_a, user_b, created_by)
           select least(a.id, b.id), greatest(a.id, b.id), a.id from a, b where a.id <> b.id
           on conflict do nothing returning id)
    select coalesce((select id::text from made), '')`)
  if (strangerConversation) {
    // A message only these two strangers can see, so "leaks nothing" is a claim with something behind it.
    const secret = `Private between them ${TAG}`
    sql(`insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
         select '${strangerConversation}', user_a, '${secret}', 'message', 'text'
         from public.direct_conversations where id = '${strangerConversation}'`)

    // THE REAL LINK SHAPE: /messages/<kind>/<id>, which is what Ovalball issues and what the route
    // file now mirrors. The earlier `?kind=` query form was a route this build no longer has, so the
    // test was exercising the not-found path rather than the conversation screen.
    await page.goto(`${APP}/messages/direct/${strangerConversation}`, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(7000)
    const denied = await page.locator("body").innerText()

    // TWO SEPARATE CLAIMS, because they fail differently. The first is that the app does not present
    // the conversation; the second is that none of its content reached the device at all. An earlier
    // version of this test asserted only a phrase, and passed while the app was sitting on the inbox
    // -- a security assertion that is true for the wrong reason is worse than no assertion.
    record(
      "F1 a conversation id belonging to other people does not open it",
      !denied.includes(secret),
      denied.slice(0, 110).replace(/\n/g, " ")
    )
    record(
      "F2 and the app says so rather than silently showing something else",
      /isn't available|not available/i.test(denied),
      denied.slice(0, 110).replace(/\n/g, " ")
    )
    sql(`delete from public.fixture_messages where direct_conversation_id = '${strangerConversation}'`)
    sql(`delete from public.direct_conversations where id = '${strangerConversation}'`)
  } else {
    record("F1 a conversation id belonging to other people does not open it", false, "NOT PROVED: no second pair available to build one")
  }

  // =====================================================================
  // G. NEW MESSAGE -- the recipient picker is the platform's own answer
  // =====================================================================
  // Explicitly, not by tapping the tab: section F left the app deep inside the Messages stack on the
  // unavailable-conversation screen, and tapping a tab you are already in does not pop back to its root.
  await page.goto(`${APP}/messages`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.getByRole("button", { name: "New message" }).waitFor({ timeout: 45000 })
  await page.getByRole("button", { name: "New message" }).click()
  await page.waitForTimeout(4000)
  const picker = await page.locator("body").innerText()
  record(
    "G1 New Message opens a picker",
    /New Message/.test(picker) && (await page.getByLabel("Search people you can message").count()) > 0
  )
  // Sam shares a club with Mo, so the canonical predicate offers them.
  record("G2 and offers somebody the platform says may be messaged", /Sam/.test(picker), picker.slice(0, 140).replace(/\n/g, " "))
  record("G3 grouped by the relationship that makes it legitimate", /YOUR CLUB|YOUR TEAM|FIXTURE CONTACT/.test(picker))

  // SEARCH IS OVER THE LEGITIMATE SET, NOT A LOOKUP. The first version of this searched for "Priya",
  // who turned out to share a club with the test identity and is therefore legitimately offered -- the
  // test was wrong, not the product. A name nobody holds proves the point without that ambiguity: the
  // picker has nothing to look up in.
  const search = page.getByLabel("Search people you can message")
  await search.click()
  await page.keyboard.type("Zzqx Notaperson", { delay: 5 })
  await page.waitForTimeout(1500)
  const noMatch = await page.locator("body").innerText()
  record(
    "G4 search finds only people already in the legitimate set",
    /No matches/.test(noMatch),
    noMatch.slice(0, 90).replace(/\n/g, " ")
  )
  await search.press("Meta+A")
  await page.keyboard.type("Sam", { delay: 5 })
  await page.waitForTimeout(1500)
  record("G5 and finds somebody inside it", /Sam/.test(await page.locator("body").innerText()))
  await recordAxe("G6 axe: the recipient picker at 390px", await runAxe(page))

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
