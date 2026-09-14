// OPTIONAL vs MANDATORY NOTIFICATIONS IN THE PRODUCT
// (brief §4, §5).
//
// Every preference is changed through the real settings UI, every event is
// triggered through the real product path, and every assertion is scoped to
// rows created AFTER a recorded baseline for ONE named recipient -- never a
// global count.
//
// The pairing that matters: `fixture_updates` is an optional topic whose
// `fixture_cancelled` type carries mandatory_override, so switching the
// topic off must still deliver the cancellation in the product.
//
// The email half (§8, §9: `match_cancelled` is OPTIONAL_OPERATIONAL, so
// switching the email off must stop it and switching it on must send it) is
// proved in 13-email-channel.mjs, on a person the event actually emails. It
// used to be asserted here against the Club Admin's mailbox, but
// `match_cancelled` goes to the fixture's participant families
// (public.fixture_notification_recipients), never to a Club Admin, so "no
// email while off" proved nothing and "email once on" could never pass.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const R = { email: "uat.coach@ovalball.test", name: "Priya Nair" }      // recipient
const ACTOR = { email: "uat.team.admin@ovalball.test" }                  // cancels fixtures
const SENDER = { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" }

const rId = sql(`select id from auth.users where email = '${R.email}';`)

// ---------------------------------------------------------------------
// ISOLATION. This suite switches the recipient's notification preferences
// off and back on through the settings UI. Those rows are shared UAT state:
// an earlier version restored them only on its happy path, crashed on
// fixtures it expected somebody else to have created, and left uat.coach's
// Fixture updates switched off for every later run. So the exact rows are
// captured before anything happens and put back on ANY exit -- success, a
// failed assertion, a thrown error or a signal -- and the fixtures the
// suite cancels are its own, created here and removed afterwards.
// ---------------------------------------------------------------------
const TAG = Date.now().toString(36).slice(-6).toUpperCase()
const TOUCHED_TOPICS = ["messages", "fixture_updates"]
const preferenceRows = () =>
  sql(`select coalesce(json_agg(row_to_json(p) order by p.topic_key)::text, '[]') from public.notification_preferences p
       where p.user_id = '${rId}' and p.topic_key in (${TOUCHED_TOPICS.map((t) => `'${t}'`).join(", ")});`)
const ORIGINAL_PREFERENCES = preferenceRows()

const TEAM = sql(`select tp.team_id from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id
  where cm.user_id = (select id from auth.users where email = '${ACTOR.email}') and tp.permission = 'team_admin' limit 1;`)
const opponent = (name) => `QA-NOTIF Opponent ${name} ${TAG}`
function teardown() {
  const mine = `select id from public.fixtures where notes = 'qa-notif-${TAG}'`
  const steps = [
    // Preferences first: they are the state other suites read.
    `begin;
     delete from public.notification_preferences where user_id = '${rId}' and topic_key in (${TOUCHED_TOPICS.map((t) => `'${t}'`).join(", ")});
     insert into public.notification_preferences select * from json_populate_recordset(null::public.notification_preferences, '${ORIGINAL_PREFERENCES}'::json);
     commit;`,
    `delete from public.notifications where data ->> 'fixture_id' in (select id::text from (${mine}) f)`,
    `delete from public.email_deliveries d using (${mine}) f where d.event_key = 'match_cancelled' and d.idempotency_key like 'match_cancelled:' || f.id || '%'`,
    `delete from public.fixture_messages where fixture_id in (${mine}) or body like 'QA-NOTIF optional ${TAG}%'`,
    `delete from public.player_fixture_attendance where fixture_id in (${mine})`,
    `delete from public.fixture_conversation_participants where fixture_id in (${mine})`,
    `delete from public.fixture_conversation_subscriptions where fixture_id in (${mine})`,
    `delete from public.fixtures where notes = 'qa-notif-${TAG}'`,
  ]
  for (const step of steps) {
    try {
      sql(step)
    } catch (e) {
      console.error("teardown step failed:", String(e).slice(0, 300))
    }
  }
}
let tornDown = false
// A write already in flight when the run is stopped can land after the first
// restore, so the exit path restores, waits, and restores again.
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
process.on("exit", () => {
  if (tornDown) return
  tornDown = true
  try {
    teardown()
    pauseSync(3000)
    teardown()
  } catch (e) {
    console.error("teardown failed:", e)
  }
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130))

for (const [name, days] of [["Two", 22]]) {
  sql(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
       values ('${TEAM}', 'Home', '${opponent(name)}', current_date + ${days}, '10:30', 'Booked', 'club_created', 'qa-notif-${TAG}', 'Friendly');`)
}

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


const browser = await launch()
const ctxR = await newContext(browser)
const r = await ctxR.newPage()
await signIn(r, R.email)

/** Set one preference switch through the settings UI and confirm it stuck. */
// The switch is optimistic: aria-checked flips before the server action has
// written anything. A preference counts as set only once the stored row says
// so -- otherwise a write still in flight can land after the teardown has put
// the original back, and leave the row changed after all. No row means the
// product default, which is on for both channels.
const PREFERENCE_COLUMN = {
  "Messages in app": ["messages", "in_app_enabled"],
  "Fixture updates in app": ["fixture_updates", "in_app_enabled"],
  "Fixture updates by email": ["fixture_updates", "email_enabled"],
}
async function storedAs(label, on) {
  const [topic, column] = PREFERENCE_COLUMN[label]
  for (let i = 0; i < 30; i++) {
    const stored = sql(`select coalesce((select ${column}::text from public.notification_preferences
      where user_id = '${rId}' and topic_key = '${topic}'), 'true');`)
    if (stored === String(on)) return true
    await new Promise((res) => setTimeout(res, 500))
  }
  return false
}

async function setPreference(label, on) {
  await r.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await r.waitForLoadState("networkidle").catch(() => {})
  const sw = r.getByRole("switch", { name: label })
  const now = (await sw.getAttribute("aria-checked")) === "true"
  if (now === on) return storedAs(label, on)
  await sw.click()
  try {
    await r.waitForFunction(
      ([l, want]) =>
        document.querySelector(`[role="switch"][aria-label="${l}"]`)?.getAttribute("aria-checked") ===
        String(want),
      [label, on],
      { timeout: 15000 },
    )
  } catch {
    return false
  }
  return storedAs(label, on)
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

const optionalMsg = `QA-NOTIF optional ${TAG} ${Date.now()}`
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
// §5 A MANDATORY CANCELLATION ARRIVES ANYWAY
// =====================================================================
record("§5 'Fixture updates in app' switched off", await setPreference("Fixture updates in app", false))
// Proves the teardown on a failure path: with this set, the run dies here,
// with the preference switched off, and must still leave it as it found it.
if (process.env.QA_ISOLATION_PROOF_THROW) throw new Error("QA_ISOLATION_PROOF_THROW: failing on purpose after switching preferences off")

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

const t1 = dbNow()
const status1 = await cancelFixtureViaUI(opponent("Two"), "QA-NOTIF mandatory delivery check")
record("§5 the fixture is cancelled through the product UI", status1 === "Cancelled", status1)

const mandatoryNotifs = notificationsSince("fixture_cancelled", t1)
record("§5 the MANDATORY cancellation still arrives with the topic off",
  mandatoryNotifs >= 1, `${mandatoryNotifs} fixture_cancelled row(s)`)

const destination = sql(
  `select coalesce(data ->> 'fixture_id', '(none)') from public.notifications
   where user_id = '${rId}' and type = 'fixture_cancelled' and created_at > '${t1}' limit 1;`,
)
const expectedFixture = sql(
  `select id from public.fixtures where raw_opposition_text = '${opponent("Two")}';`,
)
record("§5 the notification points at the fixture that was cancelled",
  destination === expectedFixture, `${destination}`)

record("§5 'Fixture updates in app' switched back on", await setPreference("Fixture updates in app", true))

await browser.close()
teardown()
tornDown = true
record("isolation: the recipient's preference rows are exactly as they were before the run", preferenceRows() === ORIGINAL_PREFERENCES)
record("isolation: this run's fixtures are gone", sql(`select count(*) from public.fixtures where notes = 'qa-notif-${TAG}'`) === "0")
process.exit(summarise() ? 0 : 1)
