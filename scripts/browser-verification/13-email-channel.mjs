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

async function setPreference(label, on) {
  await r.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
  await r.waitForLoadState("networkidle").catch(() => {})
  const sw = r.getByRole("switch", { name: label })
  if ((await sw.getAttribute("aria-checked")) === String(on)) return true
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

const base1 = Date.now()
const status1 = await cancelFixtureViaUI("QA-NOTIF Opponent Ten", "QA-NOTIF email off check")
record("§8 the fixture is cancelled through the product UI", status1 === "Cancelled", status1)

const fixture4 = sql("select id from public.fixtures where raw_opposition_text = 'QA-NOTIF Opponent Ten';")

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
const status2 = await cancelFixtureViaUI("QA-NOTIF Opponent Eleven", "QA-NOTIF email on check")
record("§9 the second fixture is cancelled through the product UI", status2 === "Cancelled", status2)

let mailOn = []
for (let i = 0; i < 40 && mailOn.length === 0; i++) {
  await new Promise((res) => setTimeout(res, 1000))
  mailOn = await cancellationMailSince(base2)
}
record("§9 the cancellation email IS delivered once the channel is on",
  mailOn.length > 0,
  mailOn.map((m) => `"${m.Subject}" at ${m.Created}`).join(" | ") || "no email within 40s")

const fixture5 = sql("select id from public.fixtures where raw_opposition_text = 'QA-NOTIF Opponent Eleven';")
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
process.exit(summarise() ? 0 : 1)
