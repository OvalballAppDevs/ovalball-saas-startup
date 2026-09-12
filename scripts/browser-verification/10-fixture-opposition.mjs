// FIXTURE -> MESSAGE OPPOSITION (brief §10).
//
// Regression only: this path was built in an earlier slice and has never
// been observed in a browser. A temporary cross-club fixture is required
// because the UAT database has no fixture whose opponent is an Ovalball
// team -- every setup row it creates carries the QA key below and is
// removed by 11-cleanup.mjs.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

export const QA_KEY = "QA-OPPOSITION"
const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const COACH = { email: "uat.coach@ovalball.test", name: "Priya Nair" }
const OPPONENT = { email: "uat.unrelated@ovalball.test", name: "Unrelated Visitor" }

// ---------------------------------------------------------------------
// SETUP -- the same shape supabase/tests/fixture_opposition_contacts.sql
// uses: two same-age-grade teams at different clubs, and the opposing
// club's own admin as the reachable person.
// ---------------------------------------------------------------------
const setup = sql(`
  with me as (select id from auth.users where email = 'uat.coach@ovalball.test'),
  opp as (select id from auth.users where email = 'uat.unrelated@ovalball.test'),
  myclub as (select club_id from public.club_memberships
             where user_id = (select id from me) and status = 'active' limit 1),
  pair as (
    select a.id as t1, b.id as t2, b.club_id as club2
    from public.teams a
    join public.teams b on b.display_name = a.display_name and b.club_id <> a.club_id
    where a.club_id = (select club_id from myclub)
    limit 1
  ),
  mem as (
    insert into public.club_memberships (user_id, club_id, role, status)
    select (select id from opp), (select club2 from pair), 'CLUB_ADMIN', 'active'
    on conflict do nothing returning club_id
  ),
  fx as (
    insert into public.fixtures
      (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
    select p.t1, p.t2, 'Home',
           (select display_name from public.teams where id = p.t2),
           current_date + 7, 'Booked', 'club_created'
    from pair p returning id
  )
  select (select id from fx)::text || '|' || (select club2 from pair)::text;
`)
const [fixtureId, opponentClubId] = setup.split("|")
record("§10 a cross-club fixture with an Ovalball opponent exists", !!fixtureId, fixtureId)

const browser = await launch()
const ctxA = await newContext(browser)
const ctxB = await newContext(browser)
const a = await ctxA.newPage()
const b = await ctxB.newPage()
await signIn(a, COACH.email)
await signIn(b, OPPONENT.email)

// ---------------------------------------------------------------------
// §10 the action appears on the fixture and opens the canonical thread
// ---------------------------------------------------------------------
await a.goto(`${APP}/fixtures/${fixtureId}`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})

const pageText = await a.locator("body").innerText()
record("§10 the fixture names an eligible opposition contact",
  pageText.includes(OPPONENT.name) || /message opposition/i.test(pageText),
  pageText.match(/[^\n]*[Oo]pposition[^\n]*/)?.[0]?.slice(0, 70) || "(not found)")

const action = a.getByRole("button", { name: /message opposition|message the opposition/i }).first()
const hasAction = (await action.count()) > 0
record("§10 a Message opposition action is offered", hasAction)

if (hasAction) {
  await action.click()
  await a.waitForTimeout(900)
  // One contact goes straight through; several offer a choice first.
  const pick = a.getByRole("button", { name: new RegExp(OPPONENT.name, "i") }).first()
  if (await pick.count()) await pick.click()
  await a.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {})
}

const onThread = /\/messages\/direct\/[0-9a-f-]{36}/.test(a.url())
record("§10 it opens the canonical direct conversation", onThread, a.url().replace(APP, ""))

if (!onThread) {
  await browser.close()
  process.exit(summarise() ? 0 : 1)
}

const threadUrl = a.url()
const convId = threadUrl.split("/").pop()

// ---------------------------------------------------------------------
// §10 send, and receive live on the other side
// ---------------------------------------------------------------------
await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})

const msg = `${QA_KEY} pitch question ${Date.now()}`
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(msg)
await a.getByRole("button", { name: "Send message" }).click()

let live = true
try {
  await b.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    msg,
    { timeout: 25000 },
  )
} catch {
  live = false
}
record("§10 the opposition contact receives it live, without refreshing", live, msg)

// ---------------------------------------------------------------------
// §10 unread: Messenger moves, the bell does not
// ---------------------------------------------------------------------
async function badges(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  return page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const n = (el.getAttribute("aria-label") || "").match(/(\d+)/)
      return n ? Number(n[1]) : 0
    }
    return { bell: read('[aria-label*="otification"]'), messenger: read('[aria-label*="essage"]') }
  })
}

// Read it away first so the increment is unambiguous.
await b.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
const before = await badges(b)
const second = `${QA_KEY} follow up ${Date.now()}`
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(second)
await a.getByRole("button", { name: "Send message" }).click()
await a.waitForTimeout(2500)
await b.reload({ waitUntil: "domcontentloaded" })
const after = await badges(b)

record("§10 the Messenger unread count increments",
  after.messenger !== null && after.messenger > before.messenger,
  `messenger ${before.messenger} -> ${after.messenger}`)
record("§10 the bell does not double-count it", after.bell === before.bell,
  `bell ${before.bell} -> ${after.bell}`)

// ---------------------------------------------------------------------
// §10 ONE relevant club OFF closes the capability
// ---------------------------------------------------------------------
sql(`delete from public.message_policies where club_id = '${opponentClubId}';
     insert into public.message_policies (club_id, allow_direct_messaging)
     values ('${opponentClubId}', false);`)

await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§10 one club switching DM off closes sending",
  (await a.locator('textarea[aria-label="Message"]').count()) === 0,
  "composer removed")
record("§10 and the history stays readable",
  (await a.locator("main").last().innerText()).includes(msg))

// Restore and confirm the same path reopens.
sql(`delete from public.message_policies where club_id = '${opponentClubId}';`)
await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§10 restoring the policy restores the SAME conversation",
  a.url() === threadUrl && (await a.locator('textarea[aria-label="Message"]').count()) === 1,
  convId)

console.log(`\nFIXTURE_ID=${fixtureId}\nCONVERSATION_ID=${convId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
