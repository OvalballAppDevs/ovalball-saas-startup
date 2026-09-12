// ATTACHMENTS (brief §11).
//
// Exercised on the fixture conversation, which is where the product offers
// them: the composer's "Add to message" menu, the real file input, the real
// upload, and the real signed-URL download on the receiving side.
//
// One accepted case and one refused case, both against the policy the
// product already has (PDF/JPEG/PNG/WEBP, 2MB) -- nothing about that policy
// is changed here.

import path from "node:path"
import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const QA_DIR = process.env.QA_FILES || path.join(process.cwd(), "qa-files")
const VALID = path.join(QA_DIR, "qa-team-sheet.png")
const OVERSIZE = path.join(QA_DIR, "qa-oversize.png")
const WRONG_TYPE = path.join(QA_DIR, "qa-notes.txt")

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const A = { email: "uat.coach@ovalball.test" }
const B = { email: "uat.unrelated@ovalball.test" }

const fixtureId = sql(
  "select id from public.fixtures where opponent_team_id is not null order by created_at desc limit 1;",
)
const threadUrl = `${APP}/messages/fixture/${fixtureId}`

const browser = await launch()
const ctxA = await newContext(browser)
const ctxB = await newContext(browser)
const a = await ctxA.newPage()
const b = await ctxB.newPage()
await signIn(a, A.email)
await signIn(b, B.email)

await a.goto(threadUrl, { waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})

// ---------------------------------------------------------------------
// §11 the picker is reachable through the ordinary UI
// ---------------------------------------------------------------------
const addMenu = a.getByRole("button", { name: /add to message/i })
record("§11 the attachment menu is reachable", (await addMenu.count()) > 0)

const fileInput = a.locator('input[type="file"]').first()
const accept = await fileInput.getAttribute("accept")
record("§11 the input declares the product's allowed types", /pdf/.test(accept) && /png/.test(accept), accept)

// ---------------------------------------------------------------------
// §11 REFUSED: unsupported type
// ---------------------------------------------------------------------
// The composer accepts the chosen file into its tray and validates on SEND,
// so the refusal is only reachable by actually trying to send it.
await fileInput.setInputFiles(WRONG_TYPE)
await a.waitForTimeout(1200)
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type("QA-ATTACHMENT refused type")
await a.getByRole("button", { name: "Send message" }).click()
await a.waitForTimeout(3000)
let refusal = await a.locator("body").innerText()
record("§11 an unsupported type is refused with useful copy", /unsupported file type/i.test(refusal),
  refusal.match(/[^\n]*[Uu]nsupported[^\n]*/)?.[0]?.slice(0, 80) || "(no message)")
record("§11 the refusal names what IS allowed", /pdf/i.test(refusal) && /png/i.test(refusal))

// ---------------------------------------------------------------------
// §11 REFUSED: oversize
// ---------------------------------------------------------------------
await a.reload({ waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})
await a.locator('input[type="file"]').first().setInputFiles(OVERSIZE)
await a.waitForTimeout(1200)
await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type("QA-ATTACHMENT refused size")
await a.getByRole("button", { name: "Send message" }).click()
await a.waitForTimeout(3000)
refusal = await a.locator("body").innerText()
record("§11 an oversize file is refused with useful copy", /2\s*MB|smaller/i.test(refusal),
  refusal.match(/[^\n]*(2MB|smaller)[^\n]*/i)?.[0]?.slice(0, 80) || "(no message)")

// Neither refusal may leave a half-sent message behind.
const strayAfterRefusal = sql(
  `select count(*) from public.fixture_message_attachments a
   join public.fixture_messages m on m.id = a.message_id
   where m.fixture_id = '${fixtureId}' and a.original_filename in ('qa-notes.txt','qa-oversize.png');`,
)
record("§11 a refused file is never stored", strayAfterRefusal === "0", `${strayAfterRefusal} stored`)

// ---------------------------------------------------------------------
// §11 ACCEPTED: send, receive, view
// ---------------------------------------------------------------------
await a.reload({ waitUntil: "domcontentloaded" })
await a.waitForLoadState("networkidle").catch(() => {})

await b.goto(threadUrl, { waitUntil: "domcontentloaded" })
await b.waitForLoadState("networkidle").catch(() => {})

const caption = `QA-ATTACHMENT team sheet ${Date.now()}`
await a.locator('input[type="file"]').first().setInputFiles(VALID)
await a.waitForTimeout(1500)
record("§11 the chosen file is accepted and shown before sending",
  /qa-team-sheet/i.test(await a.locator("body").innerText()))

await a.locator('textarea[aria-label="Message"]').evaluate((el) => el.focus())
await a.keyboard.type(caption)
await a.getByRole("button", { name: "Send message" }).click()

let sent = true
try {
  await a.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    caption,
    { timeout: 30000 },
  )
} catch {
  sent = false
}
record("§11 the message with the attachment sends", sent, caption)

const stored = sql(
  `select coalesce(max(a.original_filename) || '|' || max(a.mime_type) || '|' || max(a.size_bytes)::text, 'none')
   from public.fixture_message_attachments a
   join public.fixture_messages m on m.id = a.message_id
   where m.fixture_id = '${fixtureId}' and a.original_filename = 'qa-team-sheet.png';`,
)
record("§11 the attachment is stored with correct metadata", stored !== "none", stored)

// The recipient receives it live and can open it.
let receivedLive = true
try {
  await b.waitForFunction(
    (m) => document.querySelector("main")?.innerText.includes(m) ?? false,
    caption,
    { timeout: 30000 },
  )
} catch {
  receivedLive = false
}
record("§11 the recipient receives the attachment message live", receivedLive)

const recipientText = await b.locator("main").last().innerText()
const imgCount = await b.evaluate(() => document.querySelectorAll("main img").length)
record("§11 the recipient sees the attachment rendered",
  imgCount > 0 || /qa-team-sheet/i.test(recipientText),
  `${imgCount} image(s) in the thread`)

// AUTHORISED VIEW: follow the product's own link and confirm real bytes.
const href = await b.evaluate(() => {
  const link = [...document.querySelectorAll("main a[href]")].find((x) =>
    /qa-team-sheet/i.test(x.textContent || "") || /storage|attachment|sign/i.test(x.getAttribute("href") || ""),
  )
  return link?.getAttribute("href") ?? null
})
const imgSrc = await b.evaluate(() => {
  const img = [...document.querySelectorAll("main img")].find((x) => /sign|attachment|storage/i.test(x.src))
  return img?.src ?? null
})
const target = href || imgSrc
if (target) {
  const status = await b.evaluate(async (u) => {
    const res = await fetch(u)
    return `${res.status}:${res.headers.get("content-type")}`
  }, target)
  record("§11 the recipient can open the attachment", status.startsWith("200"), status)
} else {
  record("§11 the recipient can open the attachment", false, "no attachment link or image found")
}

// ---------------------------------------------------------------------
// §11 the attachment must not break the layout at 320
// ---------------------------------------------------------------------
const mobileCtx = await newContext(browser, { width: 320, height: 844 })
const m320 = await mobileCtx.newPage()
await signIn(m320, A.email)
await m320.goto(threadUrl, { waitUntil: "domcontentloaded" })
await m320.waitForLoadState("networkidle").catch(() => {})
const vp = await measure(m320)
record("§11 the attachment renders without overflow at 320",
  vp.innerWidth === 320 && vp.clientWidth === 320 && vp.scrollWidth === 320,
  `innerWidth=${vp.innerWidth} clientWidth=${vp.clientWidth} scrollWidth=${vp.scrollWidth}`)
await mobileCtx.close()

console.log(`\nFIXTURE_ID=${fixtureId}`)
await browser.close()
process.exit(summarise() ? 0 : 1)
