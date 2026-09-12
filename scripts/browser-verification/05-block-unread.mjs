// BLOCK, UNBLOCK, REPORT, SOFT DELETE AND UNREAD (brief §23, §24, §27-§30).

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

// Open the canonical thread through the product.
await a.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
const cand = a.getByRole("button", { name: new RegExp(B.name, "i") }).first()
if (await cand.count()) await cand.click()
else await a.getByRole("link", { name: new RegExp(B.name, "i") }).first().click()
await a.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 })
const threadUrl = a.url()
const convId = threadUrl.split("/").pop()

async function send(page, text) {
  await page.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
  await page.keyboard.type(text)
  await page.getByRole("button", { name: "Send message" }).click()
  await page.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    text,
    { timeout: 20000 },
  )
}

// ---------------------------------------------------------------------
// §30 UNREAD -- Messenger badge moves, the bell does not
// ---------------------------------------------------------------------
await b.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})

async function badges(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  return page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const label = el.getAttribute("aria-label") || ""
      const n = label.match(/(\d+)/)
      return n ? Number(n[1]) : Number((el.textContent || "").trim()) || 0
    }
    return {
      bell: read('[aria-label*="otification"]'),
      messenger: read('[aria-label*="essage"]'),
    }
  })
}

const before = await badges(b)
const unreadMarker = `QA unread ${Date.now()}`
await send(a, unreadMarker)

await b.reload({ waitUntil: "domcontentloaded" })
const after = await badges(b)
record(
  "§30 a direct message raises the Messenger unread count",
  after.messenger !== null && before.messenger !== null && after.messenger > before.messenger,
  `messenger ${before.messenger} -> ${after.messenger}`,
)
record(
  "§30 the notification bell does NOT move for a direct message",
  after.bell === before.bell,
  `bell ${before.bell} -> ${after.bell}`,
)

// Reading it clears the Messenger count.
await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
await b.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
const cleared = await badges(b)
record(
  "§30 reading the thread clears the Messenger unread",
  cleared.messenger !== null && cleared.messenger < after.messenger,
  `messenger ${after.messenger} -> ${cleared.messenger}`,
)
record("§30 no phantom bell notification appeared", cleared.bell === before.bell, `bell ${cleared.bell}`)

// ---------------------------------------------------------------------
// §28 REPORT and §29 SOFT DELETE, on the shared surface
// ---------------------------------------------------------------------
await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
// The per-message actions live behind one "More actions" menu, which is
// how every other Ovalball conversation exposes them.
const menus = a.getByRole("button", { name: /More actions for the message/i })
record("§28/§29 Direct messages expose the shared per-message actions menu",
  (await menus.count()) > 0, `${await menus.count()} menu(s)`)

// Report: on a message from the OTHER person.
await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
const fromA = `QA reportable ${Date.now()}`
await send(a, fromA)
await b.reload({ waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
// Newest-at-top: the message just sent is the FIRST menu, not the last.
const bMenu = b.getByRole("button", { name: /More actions for the message from Priya/i }).first()
await bMenu.click()
const reportItem = b.getByRole("menuitem", { name: /report/i })
record("§28 Report is offered on the other person's message", (await reportItem.count()) > 0)
if (await reportItem.count()) {
  await reportItem.first().click()
  const dlg = b.getByRole("dialog", { name: /report message/i })
  record("§28 Report opens the shared report dialog", (await dlg.count()) > 0)
  await b.getByLabel("Why are you reporting this message?").fill("QA verification report")
  await dlg.getByRole("button", { name: /send report/i }).first().click()
  let ack = ""
  try {
    await b.waitForFunction(
      () => /report sent to ovalball support/i.test(document.body.innerText),
      null,
      { timeout: 15000 },
    )
    ack = (await b.locator("body").innerText()).match(/Report sent to Ovalball Support[^\n]*/i)?.[0] || ""
  } catch {
    ack = ""
  }
  record("§28 the report is acknowledged with a reference", ack.length > 0, ack.slice(0, 70))
}

// Soft delete: on A's own message.
const doomed = `QA delete me ${Date.now()}`
await send(a, doomed)
const aMenu = a.getByRole("button", { name: /More actions for the message from You/i }).first()
await aMenu.click()
const delItem = a.getByRole("menuitem", { name: /delete/i })
record("§29 Delete is offered on your own message", (await delItem.count()) > 0)
if (await delItem.count()) {
  await delItem.first().click()
  await a.getByRole("dialog", { name: /delete message/i }).getByRole("button", { name: /delete message/i }).first().click()
  await a.waitForTimeout(2500)
  const beforeReload = (await a.locator("main").last().innerText()).includes(doomed)
  await a.reload({ waitUntil: "domcontentloaded" })
  await a.waitForLoadState("networkidle").catch(() => {})
  const afterReload = (await a.locator("main").last().innerText()).includes(doomed)
  record("§29 the deleted message's text is gone for the sender", !afterReload,
    beforeReload ? "only after a reload -- the sender's own view did not update in place" : "updated in place")

  await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
  await b.waitForLoadState("networkidle").catch(() => {})
  const bText = await b.locator("main").last().innerText()
  record("§29 the other participant sees a tombstone, not the text",
    !bText.includes(doomed) && /deleted/i.test(bText),
    bText.match(/[^\n]*deleted[^\n]*/i)?.[0]?.slice(0, 60) || "")
}

// ---------------------------------------------------------------------
// §23 BLOCK
// ---------------------------------------------------------------------
const keep = `QA pre-block ${Date.now()}`
await send(a, keep)

await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
await a.getByRole("button", { name: "Block" }).click()
await a.getByRole("dialog").getByRole("button", { name: /^block$/i }).click()
await a.waitForTimeout(3000)

await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
const blockedText = await a.locator("main").last().innerText()
record("§23 blocking leaves the history readable", blockedText.includes(keep))
record("§23 blocking closes the composer",
  (await a.locator('textarea[aria-label="Message"]').count()) === 0)
record("§23 the blocking party is offered Unblock",
  (await a.getByRole("button", { name: "Unblock" }).count()) > 0)

// The blocked party must not be told.
await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})
const bBlockedText = await b.locator("main").last().innerText()
record("§23 the blocked party is not told who blocked whom",
  !/blocked/i.test(bBlockedText), bBlockedText.match(/[^\n]*(unavailable|can't|cannot)[^\n]*/i)?.[0]?.slice(0, 80) || "(neutral)")

// Candidate discovery respects the block.
await a.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§23 a blocked person is no longer offered as a candidate",
  !(await a.locator("main").last().innerText()).includes(B.name))

// Blocked People lists them.
await a.goto(`${APP}/messages/blocked`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§23 Blocked People lists the person",
  (await a.locator("main").last().innerText()).includes(B.name))

// ---------------------------------------------------------------------
// §24 UNBLOCK
// ---------------------------------------------------------------------
await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
await a.getByRole("button", { name: "Unblock" }).click()
await a.waitForTimeout(3000)

await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§24 unblocking restores the SAME conversation", a.url() === threadUrl, convId)
record("§24 the history is unchanged", (await a.locator("main").last().innerText()).includes(keep))
record("§24 sending is restored",
  (await a.locator('textarea[aria-label="Message"]').count()) === 1)

await a.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
record("§24 candidate discovery is restored",
  (await a.locator("main").last().innerText()).includes(B.name))

console.log(`\nCONVERSATION_ID=${convId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
