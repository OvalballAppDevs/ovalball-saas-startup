// MANDATORY TRAINING CANCELLATION (brief §6).
//
// `calendar_training_updates` is an optional topic; `training_session_
// cancelled` carries mandatory_override, so switching the topic off must
// still deliver the cancellation. The same shape as the fixture case, on a
// different topic -- which is the point: the override is per EVENT, not a
// special case bolted onto fixtures.
//
// Training Centre architecture is not touched. Its existing cancellation
// dialog is used exactly as a coach would use it.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const ACTOR = { email: "uat.coach@ovalball.test" }   // Club Admin

const sessionId = sql(
  "select id from public.training_sessions where notes = 'QA-NOTIF training session' limit 1;",
)
const week = sql(
  `select to_char(date_trunc('week', session_date), 'YYYY-MM-DD')
   from public.training_sessions where id = '${sessionId}';`,
)

const browser = await launch()
const ctx = await newContext(browser)
const page = await ctx.newPage()
await signIn(page, ACTOR.email)

// The recipients of a training cancellation are the team's families. Read
// them from the product's own notification history rather than guessing.
function cancellationNotifications(sinceIso) {
  return sql(
    `select count(*) from public.notifications
     where type = 'training_session_cancelled' and created_at > '${sinceIso}';`,
  )
}

/**
 * The recipient of a training cancellation is a FAMILY, not a club
 * administrator -- a guardian reaches a team through their child, not
 * through club_memberships, so a membership query finds nobody.
 *
 * Resolved through the SAME predicate the notifier uses
 * (internal.player_contact_eligibility over the session's team roster), so
 * the person whose preference is switched off is provably one of the people
 * the event will try to reach.
 */
const recipientEmail = sql(`
  select u.email
  from internal.player_contact_eligibility(
    (select array_agg(ptm.player_id)
     from public.player_team_memberships ptm
     join public.training_sessions ts on ts.team_id = ptm.team_id
     where ts.id = '${sessionId}' and ptm.status = 'active')
  ) e
  join auth.users u on u.id = e.user_id
  order by u.email
  limit 1;
`)
record("§6 a real training-cancellation recipient was identified",
  /@/.test(recipientEmail), recipientEmail || "(none)")

// ISOLATION. The recipient's "Calendar and training updates" row is shared
// UAT state, switched off below through the settings UI. Capture it exactly
// and put it back on ANY exit, not only when every step before the restore
// succeeds.
const recipientId = sql(`select id from auth.users where email = '${recipientEmail}';`)
const preferenceRow = () =>
  sql(`select coalesce(json_agg(row_to_json(p))::text, '[]') from public.notification_preferences p
       where p.user_id = '${recipientId}' and p.topic_key = 'calendar_training_updates';`)
const ORIGINAL_PREFERENCE = preferenceRow()
function restorePreference() {
  sql(`begin;
    delete from public.notification_preferences where user_id = '${recipientId}' and topic_key = 'calendar_training_updates';
    insert into public.notification_preferences select * from json_populate_recordset(null::public.notification_preferences, '${ORIGINAL_PREFERENCE}'::json);
    commit;`)
}
let restored = false
// A write already in flight when the run is stopped can land after the first
// restore, so the exit path restores, waits, and restores again.
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
process.on("exit", () => {
  if (restored) return
  restored = true
  try {
    restorePreference()
    pauseSync(3000)
    restorePreference()
  } catch (e) {
    console.error("preference restore failed:", e)
  }
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130))

const ctxR = await newContext(browser)
const r = await ctxR.newPage()
await signIn(r, recipientEmail)
await r.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
await r.waitForLoadState("networkidle").catch(() => {})

const label = "Calendar and training updates in app"
const sw = r.getByRole("switch", { name: label })
let switched = true
if ((await sw.getAttribute("aria-checked")) !== "false") {
  await sw.click()
  try {
    await r.waitForFunction(
      (l) =>
        document.querySelector(`[role="switch"][aria-label="${l}"]`)?.getAttribute("aria-checked") ===
        "false",
      label,
      { timeout: 15000 },
    )
  } catch {
    switched = false
  }
}
record("§6 'Calendar and training updates' switched off in the settings UI", switched, recipientEmail)

// The switch is optimistic, so aria-checked flips before the server action
// has written anything. Wait for the stored ROW -- reading it immediately
// reports "no row" and blames the product for the test's own impatience.
let storedOff = "no row"
for (let i = 0; i < 20 && storedOff !== "false"; i++) {
  await new Promise((res) => setTimeout(res, 500))
  storedOff = sql(`
    select coalesce((select in_app_enabled::text from public.notification_preferences
     where user_id = (select id from auth.users where email = '${recipientEmail}')
       and topic_key = 'calendar_training_updates'), 'no row');
  `)
}
record("§6 the preference is actually stored as off", storedOff === "false", storedOff)

// ---------------------------------------------------------------------
// Cancel the session through Training's own dialog
// ---------------------------------------------------------------------
const before = sql("select now()::text;")

await page.goto(`${APP}/calendar?week=${week}&kind=training`, { waitUntil: "domcontentloaded" })
await page.waitForLoadState("networkidle").catch(() => {})

// The week board renders a mobile and a desktop tile; only one is visible,
// and "Schedule Training" in the header must not be mistaken for a session.
const sessionButton = page
  .locator("button:visible")
  .filter({ hasText: /Training/ })
  .filter({ hasNotText: "Schedule Training" })
  .first()
await sessionButton.click()
await page.waitForTimeout(1500)

const cancelControl = page.getByRole("button", { name: "Cancel This Training Session" }).first()
record("§6 the training session offers a cancellation control", (await cancelControl.count()) > 0)
await cancelControl.click()
// Targeted by id: "Reason for Cancellation" is also the fixture dialog's
// label, and a by-label lookup can resolve to the wrong one.
await page.locator("#cancel-reason").waitFor({ state: "visible", timeout: 15000 })
await page.locator("#cancel-reason").fill("QA-NOTIF mandatory training cancellation")
// Confirm is disabled until the reason is non-empty, so wait for the state
// the fill produces rather than racing it.
const confirm = page.getByRole("button", { name: "Confirm Cancellation" })
await confirm.waitFor({ state: "visible", timeout: 15000 })
await page.waitForFunction(
  () =>
    ![...document.querySelectorAll("button")].some(
      (b) => b.textContent?.trim() === "Confirm Cancellation" && b.disabled,
    ),
  null,
  { timeout: 15000 },
)
await confirm.click()
await page.waitForTimeout(7000)

const status = sql(`select status from public.training_sessions where id = '${sessionId}';`)
record("§6 the session is cancelled through the product UI", /cancel/i.test(status), status)

const delivered = cancellationNotifications(before)
record("§6 the MANDATORY training cancellation is still delivered with the topic off",
  Number(delivered) >= 1, `${delivered} training_session_cancelled notification(s)`)

const toThisRecipient = sql(`
  select count(*) from public.notifications
  where type = 'training_session_cancelled'
    and created_at > '${before}'
    and user_id = (select id from auth.users where email = '${recipientEmail}');
`)
record("§6 it reached the very person who switched the topic off",
  Number(toThisRecipient) >= 1, `${toThisRecipient} row(s) for ${recipientEmail}`)

// Restore the recipient's preference.
await r.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
await r.waitForLoadState("networkidle").catch(() => {})
const sw2 = r.getByRole("switch", { name: label })
if ((await sw2.getAttribute("aria-checked")) !== "true") await sw2.click()
await r.waitForTimeout(2500)
record("§6 the preference is switched back on in the settings UI",
  (await sw2.getAttribute("aria-checked")) === "true")

await browser.close()
restorePreference()
restored = true
record("isolation: the recipient's preference row is exactly as it was before the run", preferenceRow() === ORIGINAL_PREFERENCE)
process.exit(summarise() ? 0 : 1)
