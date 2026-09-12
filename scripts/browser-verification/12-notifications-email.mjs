// OPTIONAL vs MANDATORY NOTIFICATIONS, AND THE EMAIL CHANNEL
// (brief §4, §5, §8, §9).
//
// Every preference is changed through the real settings UI, every event is
// triggered through the real product path, and every assertion is scoped to
// rows created AFTER a recorded baseline for ONE named recipient -- never a
// global count.
//
// The pairing that matters: `fixture_updates` is an optional topic whose
// `fixture_cancelled` type carries mandatory_override, while its
// `match_cancelled` EMAIL is classified OPTIONAL_OPERATIONAL. So switching
// the topic off must still deliver the cancellation in the product, and
// switching the email off must still stop the email. One cancellation
// proves both halves.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, MAILPIT, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const R = { email: "uat.coach@ovalball.test", name: "Priya Nair" }      // recipient
const ACTOR = { email: "uat.team.admin@ovalball.test" }                  // cancels fixtures
const SENDER = { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" }

const rId = sql(`select id from auth.users where email = '${R.email}';`)

/** Notifications of one type for ONE person since a recorded moment. */
function notificationsSince(type, isoTime) {
  return Number(
    sql(
      `select count(*) from public.notifications
       where user_id = '${rId}' and type = '${type}' and created_at > '${isoTime}';`,
    ),
  )
}

function dbNow() {
  return sql("select now()::text;")
}

async function mailSince(toAddress, sinceMs) {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + toAddress)}&limit=30`,
  )
  if (!res.ok) return []
  const { messages = [] } = await res.json()
  return messages.filter((m) => new Date(m.Created).getTime() >= sinceMs)
}

const browser = await launch()
const ctxR = await newContext(browser)
const r = await ctxR.newPage()
await signIn(r, R.email)

/** Set one preference switch through the settings UI and confirm it stuck. */
async function setPreference(label, on) {
  await r.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await r.waitForLoadState("networkidle").catch(() => {})
  const sw = r.getByRole("switch", { name: label })
  const now = (await sw.getAttribute("aria-checked")) === "true"
  if (now === on) return true
  await sw.click()
  try {
    await r.waitForFunction(
      ([l, want]) =>
        document.querySelector(`[role="switch"][aria-label="${l}"]`)?.getAttribute("aria-checked") ===
        String(want),
      [label, on],
      { timeout: 15000 },
    )
    return true
  } catch {
    return false
  }
}

// =====================================================================
// §4 AN OPTIONAL NOTIFICATION, SWITCHED OFF, DOES NOT ARRIVE
// =====================================================================
record("§4 'Messages in app' can be switched off in the settings UI",
  await setPreference("Messages in app", false))

const t0 = dbNow()

// Real product path: another adult sends a direct message.
const ctxS = await newContext(browser)
const s = await ctxS.newPage()
await signIn(s, SENDER.email)
await s.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await s.waitForLoadState("networkidle").catch(() => {})
const cand = s.getByRole("button", { name: new RegExp(R.name, "i") }).first()
if (await cand.count()) await cand.click()
else await s.getByRole("link", { name: new RegExp(R.name, "i") }).first().click()
await s.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 })

const optionalMsg = `QA-NOTIF optional ${Date.now()}`
await s.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await s.keyboard.type(optionalMsg)
await s.getByRole("button", { name: "Send message" }).click()
await s.waitForFunction(
  (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
  optionalMsg,
  { timeout: 20000 },
)

const optionalNotifs = notificationsSince("new_direct_message", t0)
record("§4 the optional notification is suppressed while the topic is off",
  optionalNotifs === 0, `${optionalNotifs} new_direct_message row(s)`)

// The MESSAGE itself is untouched -- only the notification was declined.
const stillDelivered = Number(
  sql(`select count(*) from public.fixture_messages where body = '${optionalMsg}';`),
)
record("§4 the message itself still exists -- only the notification was declined",
  stillDelivered === 1, `${stillDelivered} message row(s)`)

record("§4 'Messages in app' restored", await setPreference("Messages in app", true))

// =====================================================================
// §5 + §8 A MANDATORY CANCELLATION ARRIVES ANYWAY, AND ITS OPTIONAL
//          EMAIL DOES NOT
// =====================================================================
record("§5 'Fixture updates in app' switched off", await setPreference("Fixture updates in app", false))
record("§8 'Fixture updates by email' switched off", await setPreference("Fixture updates by email", false))

const ctxA = await newContext(browser)
const actor = await ctxA.newPage()
await signIn(actor, ACTOR.email)

/** Cancel one fixture through the calendar's own Cancel Fixture dialog. */
async function cancelFixtureViaUI(opponentText, reason) {
  const row = sql(
    // date_trunc('week', ...) is Monday-based in Postgres; hand-rolled dow
    // arithmetic lands on the wrong week for a Sunday fixture.
    `select to_char(date_trunc('week', kickoff_date), 'YYYY-MM-DD')
     from public.fixtures where raw_opposition_text = '${opponentText}';`,
  )
  await actor.goto(`${APP}/calendar?week=${row}`, { waitUntil: "domcontentloaded" })
  await actor.waitForLoadState("networkidle").catch(() => {})

  await actor.getByRole("button", { name: new RegExp(opponentText) }).first().click()
  await actor.getByRole("button", { name: "Cancel Fixture" }).first().click()
  await actor.getByLabel("Reason for Cancellation").fill(reason)
  // The dialog's own confirm, which is deliberately NOT called "Cancel
  // Fixture" -- in a cancellation dialog that word would be ambiguous.
  await actor
    .getByRole("dialog", { name: /cancel fixture/i })
    .getByRole("button", { name: /confirm cancellation/i })
    .click()
  await actor.waitForTimeout(6000)
  return sql(`select status from public.fixtures where raw_opposition_text = '${opponentText}';`)
}

const mailBase1 = Date.now()
const t1 = dbNow()
const status1 = await cancelFixtureViaUI("QA-NOTIF Opponent Two", "QA-NOTIF mandatory delivery check")
record("§5 the fixture is cancelled through the product UI", status1 === "Cancelled", status1)

const mandatoryNotifs = notificationsSince("fixture_cancelled", t1)
record("§5 the MANDATORY cancellation still arrives with the topic off",
  mandatoryNotifs >= 1, `${mandatoryNotifs} fixture_cancelled row(s)`)

const destination = sql(
  `select coalesce(data ->> 'fixture_id', '(none)') from public.notifications
   where user_id = '${rId}' and type = 'fixture_cancelled' and created_at > '${t1}' limit 1;`,
)
const expectedFixture = sql(
  "select id from public.fixtures where raw_opposition_text = 'QA-NOTIF Opponent Two';",
)
record("§5 the notification points at the fixture that was cancelled",
  destination === expectedFixture, `${destination}`)

const mailAfterOff = await mailSince(R.email, mailBase1)
const cancelMailOff = mailAfterOff.filter((m) => !/sign-in link/i.test(m.Subject || ""))
record("§8 no optional cancellation email is sent while email is off",
  cancelMailOff.length === 0,
  cancelMailOff.map((m) => m.Subject).join(", ") || "none",
)

// =====================================================================
// §9 THE SAME EVENT, EMAIL SWITCHED BACK ON
// =====================================================================
record("§9 'Fixture updates by email' switched on", await setPreference("Fixture updates by email", true))

const mailBase2 = Date.now()
const t2 = dbNow()
const status2 = await cancelFixtureViaUI("QA-NOTIF Opponent Three", "QA-NOTIF email delivery check")
record("§9 the second fixture is cancelled through the product UI", status2 === "Cancelled", status2)

// Observable condition with a timeout -- never a fixed sleep as the proof.
let cancelMailOn = []
for (let i = 0; i < 30 && cancelMailOn.length === 0; i++) {
  await new Promise((res) => setTimeout(res, 1000))
  cancelMailOn = (await mailSince(R.email, mailBase2)).filter(
    (m) => !/sign-in link/i.test(m.Subject || ""),
  )
}
record("§9 the optional email IS delivered once the channel is on",
  cancelMailOn.length > 0,
  cancelMailOn.map((m) => `${m.Created} "${m.Subject}"`).join(" | ") || "no email within 30s",
)

// The in-app half is unaffected by the email switch.
const mandatoryNotifs2 = notificationsSince("fixture_cancelled", t2)
record("§9 the in-app mandatory notification is independent of the email channel",
  mandatoryNotifs2 >= 1, `${mandatoryNotifs2} fixture_cancelled row(s)`)

// Restore the recipient's preferences to the UAT baseline.
record("§9 'Fixture updates in app' restored", await setPreference("Fixture updates in app", true))

await browser.close()
process.exit(summarise() ? 0 : 1)
