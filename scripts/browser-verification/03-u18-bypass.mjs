// §20 second half: the smallest ordinary bypass. A person who is not
// offered a candidate in the UI must also be refused when the underlying
// action is submitted directly -- the UI is a convenience, the server is
// the authority.
//
// No child information is read or displayed here: the test submits an id
// and asserts a refusal.

import { launch, newContext, signIn, record, summarise } from "./harness.mjs"
import { createClient as createSb } from "/Users/Devs/ovalball-saas-startup/node_modules/@supabase/supabase-js/dist/index.mjs"

const URL = "http://127.0.0.1:54321"
const KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

const browser = await launch()

async function tokenFor(email) {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await signIn(page, email)
  const cookies = await ctx.cookies()
  const parts = cookies
    .filter((x) => /auth-token(\.\d+)?$/.test(x.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  let raw = parts.map((x) => x.value).join("")
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8")
  await ctx.close()
  return JSON.parse(raw).access_token
}

const u18Token = await tokenFor("uat.player.self@ovalball.test")
const coachToken = await tokenFor("uat.coach@ovalball.test")

function clientWith(token) {
  return createSb(URL, KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
}

// Who the U18 would try to reach. Resolved from the coach's own session so
// the test never reads the child's records to obtain it.
const coachSb = clientWith(coachToken)
const { data: coachUser } = await coachSb.auth.getUser()
const coachId = coachUser?.user?.id

const u18Sb = clientWith(u18Token)
const { data: u18User } = await u18Sb.auth.getUser()
const u18Id = u18User?.user?.id

// 1. The U18 submits the open-conversation action directly.
const { data: openData, error: openErr } = await u18Sb.rpc("open_direct_conversation", {
  p_other_user_id: coachId,
})
record(
  "§20 U18 submitting open_direct_conversation directly is REFUSED",
  !!openErr && !openData,
  openErr ? openErr.message.slice(0, 110) : `returned ${JSON.stringify(openData)}`,
)

// 2. And the reverse: an adult may not open one TO a U18 either.
const { data: revData, error: revErr } = await coachSb.rpc("open_direct_conversation", {
  p_other_user_id: u18Id,
})
record(
  "§20 an adult opening a conversation TO a U18 is REFUSED",
  !!revErr && !revData,
  revErr ? revErr.message.slice(0, 110) : `returned ${JSON.stringify(revData)}`,
)

// 3. The candidate RPC the picker itself uses returns nothing for the U18.
const { data: cands } = await u18Sb.rpc("my_direct_message_candidates")
record(
  "§20 the candidate source returns nobody for a U18",
  Array.isArray(cands) && cands.length === 0,
  `${Array.isArray(cands) ? cands.length : "?"} candidates`,
)

await browser.close()
process.exit(summarise() ? 0 : 1)
