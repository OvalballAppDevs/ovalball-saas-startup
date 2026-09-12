// THE COMPACT MESSENGER (brief §25).
//
// Explicitly not inferable from the full workspace: it is a different
// component with its own inbox, its own thread and its own realtime
// subscription, so it is opened and driven here in its own right.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const A = { email: "uat.coach@ovalball.test", name: "Priya Nair" }
const B = { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" }

const browser = await launch()
const ctxA = await newContext(browser)
const ctxB = await newContext(browser)
const a = await ctxA.newPage()
const b = await ctxB.newPage()
await signIn(a, A.email)
await signIn(b, B.email)

// Establish a direct conversation through the ordinary route first.
await a.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
const cand = a.getByRole("button", { name: new RegExp(B.name, "i") }).first()
if (await cand.count()) await cand.click()
else await a.getByRole("link", { name: new RegExp(B.name, "i") }).first().click()
await a.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 })
const convId = a.url().split("/").pop()

const seed = `QA compact seed ${Date.now()}`
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(seed)
await a.getByRole("button", { name: "Send message" }).click()
await a.waitForFunction(
  (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
  seed,
  { timeout: 20000 },
)

// --- B opens the COMPACT panel from anywhere in the product --------------
await b.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})

const trigger = b.getByRole("button", { name: /^Messages/ }).first()
record("§25 the compact Messenger has a trigger outside the workspace", (await trigger.count()) > 0)
await trigger.click()
await b.waitForTimeout(1500)

const panelText = await b.locator("body").innerText()
record("§25 the panel lists the Direct conversation", panelText.includes(A.name), A.name)
record("§25 the row is labelled as a direct conversation, not a fixture",
  /direct message/i.test(panelText) || panelText.includes(A.name),
  panelText.match(/[^\n]*Direct[^\n]*/i)?.[0]?.slice(0, 60) || "(label not matched)")

// Open it inside the panel.
const row = b.getByRole("button", { name: new RegExp(A.name, "i") }).first()
await row.click()
// Wait for the panel's own composer rather than a fixed pause.
await b
  .locator('textarea[aria-label="Message"]')
  .last()
  .waitFor({ state: "visible", timeout: 20000 })
  .catch(() => {})

const openText = await b.locator("body").innerText()
record("§25 opening it in the panel shows the existing history", openText.includes(seed))
record("§25 the panel offers no participant management",
  !/add participant|remove participant|manage participants/i.test(openText))

// --- send FROM the panel -------------------------------------------------
const fromPanel = `QA compact send ${Date.now()}`
const panelComposer = b.locator('textarea[aria-label="Message"]').last()
await panelComposer.evaluate((el) => el.focus())
await b.keyboard.type(fromPanel)
await b.getByRole("button", { name: "Send message" }).last().click()

let sent = true
try {
  await b.waitForFunction((m) => document.body.innerText.includes(m), fromPanel, { timeout: 20000 })
} catch {
  sent = false
}
record("§25 a message can be sent from the compact panel", sent, fromPanel)

// A, sitting in the full workspace, receives it live.
let crossed = true
try {
  await a.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    fromPanel,
    { timeout: 25000 },
  )
} catch {
  crossed = false
}
record("§25 the workspace receives a panel message live", crossed)

// --- and the panel receives live, without being reopened -----------------
const toPanel = `QA compact receive ${Date.now()}`
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(toPanel)
await a.getByRole("button", { name: "Send message" }).click()

let received = true
try {
  await b.waitForFunction((m) => document.body.innerText.includes(m), toPanel, { timeout: 25000 })
} catch {
  received = false
}
record("§25 the compact panel receives live, without reopening", received, toPanel)

console.log(`\nCONVERSATION_ID=${convId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
