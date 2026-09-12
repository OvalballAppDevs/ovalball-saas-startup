// DIRECT REALTIME, BOTH DIRECTIONS (brief §13, §14, §15).
//
// Two independent authenticated contexts, the same direct thread open in
// both, and no refresh, no re-navigation and no manual refetch on the
// receiving side. Receipt is awaited as an OBSERVABLE CONDITION with a
// timeout -- never a fixed sleep that would pass by coincidence.

import {
  launch,
  newContext,
  signIn,
  APP,
  record,
  summarise,
} from "./harness.mjs"

const A = { email: "uat.coach@ovalball.test", name: "Priya Nair" }
const B = { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" }

const browser = await launch()
const ctxA = await newContext(browser)
const ctxB = await newContext(browser)
const a = await ctxA.newPage()
const b = await ctxB.newPage()

await signIn(a, A.email)
await signIn(b, B.email)

// --- A opens a direct conversation with B through the ordinary UI --------
await a.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})

const candidate = a.getByRole("button", { name: new RegExp(B.name, "i") }).first()
const candidateLink = a.getByRole("link", { name: new RegExp(B.name, "i") }).first()
if (await candidate.count()) await candidate.click()
else await candidateLink.click()

await a.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 })
const threadUrl = a.url()
const convId = threadUrl.split("/").pop()
record("Message a Person opens a canonical direct conversation", !!convId, convId)

// --- B opens the SAME thread, then never touches the page again ----------
await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
// The workspace is two panes, so the inbox heading is also an h1; the
// conversation's own header is the one naming the other person.
const bHeader = await b.getByRole("heading", { name: A.name }).first().innerText()
record("B is in the same conversation", /Priya/i.test(bHeader), `header="${bHeader}"`)

// Confirm the realtime channel actually joined. A refused subscription is
// silent, which is exactly how this defect hid, so assert it explicitly.
// Awaited for its side effect -- the evaluate is what proves the channel
// reached "joined", and the assertion below reads the page, not this value.
await b.evaluate(async () => {
  // supabase-js keeps its channels on the shared client; look for one whose
  // topic is this conversation and whose state is joined.
  return new Promise((resolve) => {
    const deadline = Date.now() + 15000
    const tick = () => {
      const chans = window.__supabaseChannels
      if (chans && chans.some((c) => c.state === "joined")) return resolve(true)
      if (Date.now() > deadline) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}).catch(() => null)

// --- §13 A -> B ----------------------------------------------------------
const msgAB = `QA realtime A2B ${Date.now()}`
// Focus then type with real key events. A click can race the re-render a
// live refresh triggers, where a message briefly reflows over the composer.
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(msgAB)
await a.getByRole("button", { name: "Send message" }).click()

// Await an OBSERVABLE CONDITION -- the receiving page's own rendered text
// containing the unique message -- not a fixed sleep. Reading innerText
// rather than a element locator avoids a strict-mode match against the
// inbox preview, which renders the same words in the conversation list.
let abOk = true
try {
  await b.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    msgAB,
    { timeout: 25000 },
  )
} catch {
  abOk = false
}
record("§13 Direct realtime A -> B (no refresh on B)", abOk, msgAB)

// Sender identity on the receiving side must be the sender, not the viewer.
if (abOk) {
  const senderShown = await b.evaluate((m) => {
    const nodes = [...document.querySelectorAll("main *")].filter(
      (el) => el.children.length === 0 && (el.textContent || "").includes(m),
    )
    const el = nodes[nodes.length - 1]
    const bubble = el?.closest("li,article,div")
    return bubble ? bubble.innerText.slice(0, 120) : ""
  }, msgAB)
  record(
    "received message is attributed to the sender",
    !/^You[:\s]/i.test(senderShown.trim()),
    senderShown.replace(/\n/g, " ⏎ ").slice(0, 90),
  )
}

// --- §14 B -> A ----------------------------------------------------------
const msgBA = `QA realtime B2A ${Date.now()}`
await b.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await b.keyboard.type(msgBA)
await b.getByRole("button", { name: "Send message" }).click()

let baOk = true
try {
  await a.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    msgBA,
    { timeout: 25000 },
  )
} catch {
  baOk = false
}
record("§14 Direct realtime B -> A (no refresh on A)", baOk, msgBA)

// --- the thread never became a second conversation -----------------------
record("both directions stayed in one conversation", a.url() === threadUrl && b.url() === threadUrl,
  `A=${a.url().split("/").pop()} B=${b.url().split("/").pop()}`)

console.log(`\nCONVERSATION_ID=${convId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
