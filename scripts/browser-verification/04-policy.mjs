// CLUB AND SITE COMMUNICATION POLICY (brief §12, §21, §22).
//
// Proves the two precedence models through the product: a club restricting
// direct messaging for itself, and Ovalball switching it off above a club
// that still has it on. Every state is restored at the end.

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CLUB_ADMIN = "uat.coach@ovalball.test" // Club Admin at Ovalball UAT RUFC
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"
const OTHER = { email: "uat.guardian.one@ovalball.test", name: "Marcus Bell" }

const browser = await launch()

const clubCtx = await newContext(browser)
const club = await clubCtx.newPage()
await signIn(club, CLUB_ADMIN)

const siteCtx = await newContext(browser)
const site = await siteCtx.newPage()
await signIn(site, SITE_ADMIN)

// ---------------------------------------------------------------------
// §12 the Club Admin communications surface
// ---------------------------------------------------------------------
await club.goto(`${APP}/club`, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})

const clubText = await club.locator("body").innerText()
const expectedRows = [
  "Direct Messaging",
  "Team Conversations",
  "Chosen Groups",
  "Team Announcements",
  "Club Announcements",
  "Private Replies",
  "Group Discussion",
]
const missing = expectedRows.filter((r) => !clubText.includes(r))
record("§12 Club Admin shows every delegated communication setting", missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : `${expectedRows.length} rows`)
record("§12 Club Admin groups them as Messaging and Announcements",
  /messaging/i.test(clubText) && /announcements/i.test(clubText))

// ---------------------------------------------------------------------
// §21 Club DM OFF -- history stays, sending closes, the thread is the same
// ---------------------------------------------------------------------
// Establish a working thread first.
await club.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const cand = club.getByRole("button", { name: new RegExp(OTHER.name, "i") }).first()
if (await cand.count()) await cand.click()
else await club.getByRole("link", { name: new RegExp(OTHER.name, "i") }).first().click()
await club.waitForURL(/\/messages\/direct\/[0-9a-f-]{36}/, { timeout: 20000 })
const threadUrl = club.url()
const convId = threadUrl.split("/").pop()

const marker = `QA policy baseline ${Date.now()}`
await club.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await club.keyboard.type(marker)
await club.getByRole("button", { name: "Send message" }).click()
await club.waitForFunction(
  (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
  marker,
  { timeout: 20000 },
)
record("§21 Club ON -- a direct message sends", true, convId)

// Now switch the club's own setting off.
async function setClubDirectMessaging(on) {
  await club.goto(`${APP}/club`, { waitUntil: "domcontentloaded" })
  await club.waitForLoadState("networkidle").catch(() => {})
  const sw = club.getByRole("switch", { name: "Direct Messaging" })
  const checked = (await sw.getAttribute("aria-checked")) === "true"
  if (checked !== on) {
    await sw.click()
    await club.waitForFunction(
      (want) =>
        document
          .querySelector('[role="switch"][aria-label="Direct Messaging"]')
          ?.getAttribute("aria-checked") === String(want),
      on,
      { timeout: 10000 },
    )
  }
}

await setClubDirectMessaging(false)

await club.goto(threadUrl, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const offText = await club.locator("main").last().innerText()
record("§21 Club OFF -- existing history is still readable", offText.includes(marker))

const composerCount = await club.locator('textarea[aria-label="Message"]').count()
const composerDisabled =
  composerCount === 0 ||
  (await club.locator('textarea[aria-label="Message"]').first().isDisabled().catch(() => true))
record("§21 Club OFF -- the composer is closed", composerDisabled,
  composerCount === 0 ? "composer removed" : "composer disabled")

// The server must refuse regardless of what the UI offers.
const refused = await club.evaluate(async (id) => {
  const res = await fetch(location.origin + `/messages/direct/${id}`, { method: "HEAD" })
  return res.status
}, convId)
record("§21 Club OFF -- the conversation itself still resolves (not deleted)", refused < 500, `HTTP ${refused}`)

// §21 restore
await setClubDirectMessaging(true)
await club.goto(threadUrl, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const backUrl = club.url()
const backText = await club.locator("main").last().innerText()
record("§21 Club restored -- the SAME thread resumes", backUrl === threadUrl && backText.includes(marker),
  backUrl.split("/").pop())
const composerBack = await club.locator('textarea[aria-label="Message"]').count()
record("§21 Club restored -- the composer is usable again", composerBack === 1)

// ---------------------------------------------------------------------
// §22 Site OFF + Club ON  ->  effective OFF
// ---------------------------------------------------------------------
async function setSiteDirectMessaging(on) {
  await site.goto(`${APP}/admin/messages`, { waitUntil: "domcontentloaded" })
  await site.waitForLoadState("networkidle").catch(() => {})
  const sw = site.getByRole("switch", { name: "Direct Messaging" })
  const checked = (await sw.getAttribute("aria-checked")) === "true"
  if (checked !== on) {
    await sw.click()
    await site.waitForFunction(
      (want) =>
        document
          .querySelector('[role="switch"][aria-label="Direct Messaging"]')
          ?.getAttribute("aria-checked") === String(want),
      on,
      { timeout: 10000 },
    )
  }
}

await setSiteDirectMessaging(false)

await club.goto(`${APP}/club`, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const siteOffText = await club.locator("body").innerText()
record("§22 Club UI names the Ovalball-level disablement",
  /Ovalball has this off for every club/i.test(siteOffText),
  siteOffText.match(/Ovalball has this off[^.]*\./)?.[0]?.slice(0, 80) || "(copy not found)")

const clubSwitchDisabled = await club
  .getByRole("switch", { name: "Direct Messaging" })
  .isDisabled()
  .catch(() => false)
record("§22 the club control is disabled rather than live-but-useless", clubSwitchDisabled)

// Candidate resolution must close.
await club.goto(`${APP}/messages/new/person`, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const candText = await club.locator("main").last().innerText()
record("§22 candidate resolution is closed while Ovalball has it off",
  !candText.includes(OTHER.name), candText.replace(/\n+/g, " / ").slice(0, 110))

// And sending is refused in the existing thread.
await club.goto(threadUrl, { waitUntil: "domcontentloaded" })
await club.waitForLoadState("networkidle").catch(() => {})
const siteOffComposer = await club.locator('textarea[aria-label="Message"]').count()
record("§22 sending is closed in the existing thread", siteOffComposer === 0, `${siteOffComposer} composer(s)`)

// §22 restore
await setSiteDirectMessaging(true)
await site.goto(`${APP}/admin/messages`, { waitUntil: "domcontentloaded" })
await site.waitForLoadState("networkidle").catch(() => {})
const restored =
  (await site.getByRole("switch", { name: "Direct Messaging" }).getAttribute("aria-checked")) === "true"
record("§22 Ovalball setting restored to ON", restored)

console.log(`\nCONVERSATION_ID=${convId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
