// ANNOUNCEMENT REPLY REALTIME (brief §17).
//
// Proves the container that migration 20270264000000 unblocked: before it,
// internal.can_access_fixture_presence_topic returned false for the 'a'
// prefix, so nobody could subscribe to an announcement's topic at all.
//
// The reply is sent through the product's own RPC as a real authenticated
// recipient, and the SENDER observes it arrive on the live channel without
// re-reading anything.

import { launch, newContext, signIn, record, summarise } from "./harness.mjs"
import { createClient as createSb } from "/Users/Devs/ovalball-saas-startup/node_modules/@supabase/supabase-js/dist/index.mjs"

const URL = "http://127.0.0.1:54321"
const KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

const browser = await launch()

async function sessionFor(email) {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await signIn(page, email)
  await page.goto(`${process.env.APP_URL || "http://localhost:3000"}/account`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const cookies = await ctx.cookies()
  const matched = cookies.filter((x) => /auth-token(\.\d+)?$/.test(x.name))
  if (matched.length === 0) {
    throw new Error(
      `No auth-token cookie for ${email}. Saw: ${cookies.map((c) => c.name).join(", ") || "(none)"}`,
    )
  }
  let raw = cookies
    .filter((x) => /auth-token(\.\d+)?$/.test(x.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => x.value)
    .join("")
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8")
  await ctx.close()
  const token = JSON.parse(raw).access_token
  const sb = createSb(URL, KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  // The REST header is not the socket's credential. A private realtime topic
  // is authorised by the token given to setAuth, and without it the join is
  // refused -- the same trap the browser hook hit.
  await sb.realtime.setAuth(token)
  return sb
}

const sender = await sessionFor("uat.coach@ovalball.test")
const recipient = await sessionFor("uat.guardian.one@ovalball.test")

// Who may this person announce as?
const { data: identities, error: idErr } = await sender.rpc("my_sender_identities")
if (idErr || !identities?.length) {
  record("§17 a sender identity is available to announce as", false, idErr?.message || "none returned")
  await browser.close()
  process.exit(1)
}
console.log("identities:", JSON.stringify(identities))
const identity =
  identities.find((i) => String(i.identity_type).toLowerCase() === "club") ?? identities[0]
const scope = String(identity.identity_type).toLowerCase() === "club" ? "club" : "team"

const { data: announcementId, error: createErr } = await sender.rpc("create_announcement", {
  p_sender_identity_type: identity.identity_type,
  p_sender_identity_id: identity.identity_id,
  p_scope: scope,
  p_scope_id: identity.identity_id,
  p_body: "QA verification announcement. Please ignore.",
  p_title: "QA verification",
  p_reply_mode: "PRIVATE_REPLY",
  p_audience_spec: null,
  p_exclude_u18: false,
})
record("§17 an announcement can be created", !createErr && !!announcementId,
  createErr?.message?.slice(0, 100) || String(announcementId))
if (createErr) {
  await browser.close()
  process.exit(1)
}

const { error: sendErr } = await sender.rpc("send_announcement", { p_announcement_id: announcementId })
record("§17 the announcement sends (fan-out)", !sendErr, sendErr?.message?.slice(0, 100) || "sent")

// The SENDER subscribes to the announcement's topic and waits.
const topic = `presence:a:${announcementId}`
let received = null
const ch = sender.channel(topic, { config: { private: true } })
ch.on("broadcast", { event: "fixture_message_inserted" }, (p) => {
  received = p
})

const status = await new Promise((resolve) => {
  ch.subscribe((s) => {
    if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "CLOSED" || s === "TIMED_OUT") resolve(s)
  })
  setTimeout(() => resolve("TIMEOUT"), 20000)
})
record("§17 the announcement topic accepts an authorised subscriber", status === "SUBSCRIBED", status)

// A real recipient replies through the product RPC.
const { error: replyErr } = await recipient.rpc("reply_to_announcement", {
  p_announcement_id: announcementId,
  p_body: `QA announcement reply ${Date.now()}`,
})
record("§17 a recipient can reply", !replyErr, replyErr?.message?.slice(0, 100) || "replied")

// Observable condition with a timeout -- never a fixed sleep as proof.
const deadline = Date.now() + 20000
while (!received && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250))
}
record("§17 the reply arrives live on the announcement channel", !!received,
  received ? JSON.stringify(received.payload).slice(0, 90) : "no broadcast within 20s")

console.log(`\nANNOUNCEMENT_ID=${announcementId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
