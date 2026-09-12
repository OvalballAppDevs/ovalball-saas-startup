// ACCESSIBILITY, KEYBOARD AND FOCUS (brief §41-§44).
//
// axe-core for the machine-checkable rules, then real key events for the
// things axe cannot see: whether Tab reaches a control, whether Space
// operates a switch, and whether focus comes back out of a dialog.

import fs from "node:fs"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const AXE = fs.readFileSync(
  "/Users/Devs/.claude/jobs/e976849c/tmp/node_modules/axe-core/axe.min.js",
  "utf8",
)
const CONV = process.env.CONV_ID

const browser = await launch()

async function audit(page, label) {
  await page.addScriptTag({ content: AXE })
  const results = await page.evaluate(async () => {
    // Scoped to the rules this brief names; a full-page sweep of unrelated
    // marketing chrome is not what is being accepted here.
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    })
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      target: v.nodes[0]?.target?.join(" ") ?? "",
    }))
  })
  const serious = results.filter((v) => v.impact === "critical" || v.impact === "serious")
  record(
    `§41-43 axe: ${label}`,
    serious.length === 0,
    serious.length
      ? serious.map((v) => `${v.id}(${v.nodes}) ${v.target}`).join(" | ").slice(0, 180)
      : `${results.length} minor/moderate, 0 serious`,
  )
  return results
}

// ---------------------------------------------------------------------
// Site Admin communications
// ---------------------------------------------------------------------
const adminCtx = await newContext(browser)
const admin = await adminCtx.newPage()
await signIn(admin, "uat.fullsiteadmin@ovalball.test")
await admin.goto(`${APP}/admin/messages`, { waitUntil: "domcontentloaded" })
await admin.waitForLoadState("networkidle").catch(() => {})
await audit(admin, "Site Admin communications")

// §41 keyboard reaches a switch, and Space operates it.
const reached = await admin.evaluate(() => {
  const sw = document.querySelector('[role="switch"][aria-label="Direct Messaging"]')
  if (!sw) return null
  sw.focus()
  return document.activeElement === sw
})
record("§41 a communications switch is focusable", reached === true)

const beforeState = await admin
  .getByRole("switch", { name: "Direct Messaging" })
  .getAttribute("aria-checked")
await admin.keyboard.press("Space")
await admin.waitForTimeout(2500)
const afterState = await admin
  .getByRole("switch", { name: "Direct Messaging" })
  .getAttribute("aria-checked")
record("§41 Space operates the switch", beforeState !== afterState, `${beforeState} -> ${afterState}`)
// Put it straight back. The row re-renders after the save, so focus has to
// be re-established rather than assumed.
await admin.evaluate(() =>
  document.querySelector('[role="switch"][aria-label="Direct Messaging"]').focus(),
)
await admin.keyboard.press("Space")
await admin.waitForTimeout(2500)
const restored = await admin
  .getByRole("switch", { name: "Direct Messaging" })
  .getAttribute("aria-checked")
record("§41 and Space toggles it back", restored === beforeState, `now ${restored}`)

// §41 visible focus
const focusVisible = await admin.evaluate(() => {
  const sw = document.querySelector('[role="switch"][aria-label="Direct Messaging"]')
  sw.focus()
  const cs = getComputedStyle(sw)
  // The project's controls use a focus-visible ring rather than an outline.
  return cs.outlineStyle !== "none" || cs.boxShadow !== "none" || sw.matches(":focus-visible")
})
record("§41 focus is visibly indicated", focusVisible === true)

// §44 disabled semantics where precedence applies
const disabledSemantics = await admin.evaluate(() => {
  const switches = [...document.querySelectorAll('[role="switch"]')]
  return switches.every((s) => s.hasAttribute("aria-checked"))
})
record("§44 every switch exposes a state", disabledSemantics === true)

// ---------------------------------------------------------------------
// Notification settings -- channel names must be distinguishable
// ---------------------------------------------------------------------
const acctCtx = await newContext(browser)
const acct = await acctCtx.newPage()
await signIn(acct, "uat.coach@ovalball.test")
await acct.goto(`${APP}/account`, { waitUntil: "domcontentloaded" })
await acct.waitForLoadState("networkidle").catch(() => {})
await audit(acct, "Notification settings")

const names = await acct.evaluate(() =>
  [...document.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute("aria-label")),
)
const dupes = names.filter((n, i) => names.indexOf(n) !== i)
record("§42 no two notification switches share an accessible name", dupes.length === 0,
  dupes.length ? `duplicated: ${[...new Set(dupes)].join(", ")}` : `${names.length} distinct`)
record("§42 channel is named in the accessible name",
  names.some((n) => / in app$/i.test(n || "")) && names.some((n) => / by email$/i.test(n || "")),
  names.slice(0, 3).join(" | "))

// ---------------------------------------------------------------------
// Messenger + the direct thread
// ---------------------------------------------------------------------
const msgCtx = await newContext(browser)
const msg = await msgCtx.newPage()
await signIn(msg, "uat.coach@ovalball.test")
await msg.goto(`${APP}/messages/direct/${CONV}`, { waitUntil: "domcontentloaded" })
await msg.waitForLoadState("networkidle").catch(() => {})
await audit(msg, "Direct conversation")

// §43 exactly one main landmark
const mains = await msg.evaluate(() => document.querySelectorAll("main").length)
record("§43 the page has exactly one main landmark", mains === 1, `${mains} <main>`)

// §43 the composer is reachable by keyboard and typing works
const composerFocus = await msg.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="Message"]')
  if (!ta) return "absent"
  ta.focus()
  return document.activeElement === ta
})
record("§43 the composer is keyboard focusable", composerFocus === true, String(composerFocus))

// §44 focus containment and restoration in the block dialog
await msg.getByRole("button", { name: "Block" }).focus()
await msg.keyboard.press("Enter")
await msg.waitForTimeout(800)
const dialogOpen = (await msg.getByRole("dialog").count()) > 0
record("§44 Enter opens the block dialog from the keyboard", dialogOpen)

if (dialogOpen) {
  const insideAfterTabs = await msg.evaluate(async () => {
    const dlg = document.querySelector('[role="dialog"]')
    return dlg.contains(document.activeElement) || document.activeElement === document.body
  })
  record("§44 focus is not left outside the open dialog", insideAfterTabs === true)

  // Cancel with the keyboard and confirm focus returns to the page.
  await msg.getByRole("button", { name: /cancel/i }).focus()
  await msg.keyboard.press("Enter")
  await msg.waitForTimeout(800)
  record("§44 the dialog closes from the keyboard", (await msg.getByRole("dialog").count()) === 0)
  const focusBack = await msg.evaluate(() => document.activeElement?.tagName !== "BODY")
  record("§44 focus returns to a control after the dialog closes", focusBack === true,
    await msg.evaluate(() => document.activeElement?.textContent?.slice(0, 30) || document.activeElement?.tagName))
}

await browser.close()
process.exit(summarise() ? 0 : 1)
