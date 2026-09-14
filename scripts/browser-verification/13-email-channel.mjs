// THE EMAIL CHANNEL, OFF AND ON (brief §8, §9, and §2G).
//
// `match_cancelled` is the product's ONE OPTIONAL_OPERATIONAL email event,
// which is what makes it the only event whose email a person may decline.
// Its in-app sibling `fixture_cancelled` carries mandatory_override, so the
// same cancellation must always reach them inside the product.
//
// THE RECIPIENT IS THE PERSON THE EVENT ACTUALLY EMAILS. `fixture_
// participants` resolves to the team's guardians and players, not the club
// administrator who receives the in-app notification -- so the preference
// has to be set on the mailbox being watched, or the proof is meaningless.
//
// Delivery is observed in the local mail catcher, not inferred from a queue
// row: EMAIL_PROVIDER=mailpit routes product email there and nothing leaves
// the machine.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, MAILPIT, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const RECIPIENT = { email: "uat.guardian.two@ovalball.test" }
const ACTOR = { email: "uat.team.admin@ovalball.test" }
const rId = sql(`select id from auth.users where email = '${RECIPIENT.email}';`)

// ---------------------------------------------------------------------
// ISOLATION. This suite switches the recipient's "Fixture updates by email"
// off and back on through the settings UI. That row is shared UAT state (the
// SQL suite notification_mandatory_and_preferences reads it): an earlier
// version restored it only on its happy path, crashed on fixtures it expected
// somebody else to have created, and left it off for every later run. So the
// exact row is captured before anything happens and put back on ANY exit --
// success, a failed assertion, a thrown error or a signal -- and the fixtures
// the suite cancels are its own, created here and removed afterwards.
// ---------------------------------------------------------------------
const TAG = Date.now().toString(36).slice(-6).toUpperCase()
const TOUCHED_TOPICS = ["fixture_updates"]
const preferenceRows = () =>
  sql(`select coalesce(json_agg(row_to_json(p) order by p.topic_key)::text, '[]') from public.notification_preferences p
       where p.user_id = '${rId}' and p.topic_key in (${TOUCHED_TOPICS.map((t) => `'${t}'`).join(", ")});`)
const ORIGINAL_PREFERENCES = preferenceRows()

// The actor's own team: its families include the recipient, so a
// cancellation there is one the recipient is really emailed about.
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
    `delete from public.fixture_messages where fixture_id in (${mine})`,
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

for (const [name, days] of [["Ten", 29], ["Eleven", 30]]) {
  sql(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, notes, game_type)
       values ('${TEAM}', 'Home', '${opponent(name)}', current_date + ${days}, '10:30', 'Booked', 'club_created', 'qa-notif-${TAG}', 'Friendly');`)
}

async function cancellationMailSince(sinceMs) {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + RECIPIENT.email)}&limit=30`,
  )
  if (!res.ok) return []
  const { messages = [] } = await res.json()
  return messages.filter(
    (m) => new Date(m.Created).getTime() >= sinceMs && !/sign-in link/i.test(m.Subject || ""),
  )
}

function deliveryRow(fixtureId) {
  return sql(
    `select coalesce(status, '-') || ' | ' || coalesce(suppression_reason, 'none')
     from public.email_deliveries
     where event_key = 'match_cancelled'
       and idempotency_key like 'match_cancelled:${fixtureId}%'
       and recipient_email = '${RECIPIENT.email}'
     limit 1;`,
  ) || "(no delivery row)"
}

const browser = await launch()

const ctxR = await newContext(browser)
const r = await ctxR.newPage()
await signIn(r, RECIPIENT.email)

const ctxA = await newContext(browser)
const actor = await ctxA.newPage()
await signIn(actor, ACTOR.email)

// The switch is optimistic: aria-checked flips before the server action has
// written anything. A preference counts as set only once the stored row says
// so -- otherwise a write still in flight can land after the teardown has put
// the original back, and leave the row changed after all. No row means the
// product default, which is on for both channels.
const PREFERENCE_COLUMN = {
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
  if ((await sw.getAttribute("aria-checked")) === String(on)) return storedAs(label, on)
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

async function cancelFixtureViaUI(opponentText, reason) {
  const week = sql(
    `select to_char(date_trunc('week', kickoff_date), 'YYYY-MM-DD')
     from public.fixtures where raw_opposition_text = '${opponentText}';`,
  )
  await actor.goto(`${APP}/calendar?week=${week}`, { waitUntil: "domcontentloaded" })
  await actor.waitForLoadState("networkidle").catch(() => {})
  await actor.getByRole("button", { name: new RegExp(opponentText) }).first().click()
  await actor.getByRole("button", { name: "Cancel Fixture" }).first().click()
  await actor.getByLabel("Reason for Cancellation").fill(reason)
  await actor
    .getByRole("dialog", { name: /cancel fixture/i })
    .getByRole("button", { name: /confirm cancellation/i })
    .click()
  await actor.waitForTimeout(8000)
  return sql(`select status from public.fixtures where raw_opposition_text = '${opponentText}';`)
}

// =====================================================================
// §8 EMAIL OFF
// =====================================================================
record("§8 'Fixture updates by email' switched off in the settings UI",
  await setPreference("Fixture updates by email", false))
// Proves the teardown on a failure path: with this set, the run dies here,
// with the preference switched off, and must still leave it as it found it.
if (process.env.QA_ISOLATION_PROOF_THROW) throw new Error("QA_ISOLATION_PROOF_THROW: failing on purpose after switching the preference off")

const base1 = Date.now()
const status1 = await cancelFixtureViaUI(opponent("Ten"), "QA-NOTIF email off check")
record("§8 the fixture is cancelled through the product UI", status1 === "Cancelled", status1)

const fixture4 = sql(`select id from public.fixtures where raw_opposition_text = '${opponent("Ten")}';`)

// Give any email the same window the ON case gets, so "none arrived" means
// none arrived rather than "not yet".
await new Promise((res) => setTimeout(res, 12000))
const mailOff = await cancellationMailSince(base1)
record("§8 no cancellation email reaches the recipient while the channel is off",
  mailOff.length === 0, mailOff.map((m) => m.Subject).join(", ") || "none")

// AND FOR THE RIGHT REASON. An empty mailbox proves nothing on its own --
// a missing EMAIL_FROM_ADDRESS produces exactly the same silence. The two
// are distinguishable in the delivery ledger: a configuration problem
// CLAIMS a delivery and then records it suppressed with a reason, whereas
// an opted-out person is removed from the recipient list before any
// delivery is claimed, so no row exists for them at all.
const row4 = deliveryRow(fixture4)
record("§8 the opt-out removes the person before a delivery is even claimed",
  row4 === "(no delivery row)", row4)

// And the send genuinely happened -- somebody who had NOT opted out of the
// same cancellation did receive it. Without this, "no email" could just
// mean "no email was sent to anyone".
const othersOnSameEvent = sql(
  `select count(*) from public.email_deliveries
   where event_key = 'match_cancelled'
     and idempotency_key like 'match_cancelled:${fixture4}%'
     and status = 'sent';`,
)
record("§8 the same cancellation still emailed the recipients who had not opted out",
  Number(othersOnSameEvent) > 0, `${othersOnSameEvent} other recipient(s) emailed`)

// =====================================================================
// §9 EMAIL ON
// =====================================================================
record("§9 'Fixture updates by email' switched on in the settings UI",
  await setPreference("Fixture updates by email", true))

const base2 = Date.now()
const status2 = await cancelFixtureViaUI(opponent("Eleven"), "QA-NOTIF email on check")
record("§9 the second fixture is cancelled through the product UI", status2 === "Cancelled", status2)

let mailOn = []
for (let i = 0; i < 40 && mailOn.length === 0; i++) {
  await new Promise((res) => setTimeout(res, 1000))
  mailOn = await cancellationMailSince(base2)
}
record("§9 the cancellation email IS delivered once the channel is on",
  mailOn.length > 0,
  mailOn.map((m) => `"${m.Subject}" at ${m.Created}`).join(" | ") || "no email within 40s")

const fixture5 = sql(`select id from public.fixtures where raw_opposition_text = '${opponent("Eleven")}';`)
const row5 = deliveryRow(fixture5)
record("§9 the delivery is recorded as sent", /^sent/i.test(row5), row5)

// §2G the classification's own promise: the in-app half is mandatory and
// therefore unaffected by anything done to the email channel.
const inApp = sql(
  `select count(*) from public.notifications
   where type = 'fixture_cancelled' and (data ->> 'fixture_id') in ('${fixture4}', '${fixture5}');`,
)
record("§2G the mandatory in-app cancellation is independent of the email channel",
  Number(inApp) >= 2, `${inApp} fixture_cancelled notification(s) across both cancellations`)

await browser.close()
teardown()
tornDown = true
record("isolation: the recipient's preference row is exactly as it was before the run", preferenceRows() === ORIGINAL_PREFERENCES)
record("isolation: this run's fixtures are gone", sql(`select count(*) from public.fixtures where notes = 'qa-notif-${TAG}'`) === "0")
process.exit(summarise() ? 0 : 1)
