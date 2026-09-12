// EXACT MOBILE VIEWPORTS (brief §6, §37-§40).
//
// Every width is asserted from INSIDE the page before any judgement is made
// about the layout: a requested size Chromium did not honour is a harness
// failure, not a product pass or a product failure.

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const WIDTHS = [320, 360, 390, 430]
const CONV = process.env.CONV_ID

const browser = await launch()

const SURFACES = [
  { name: "Site Admin communications", email: "uat.fullsiteadmin@ovalball.test", path: "/admin/messages" },
  { name: "Club Admin communications", email: "uat.coach@ovalball.test", path: "/club" },
  { name: "Notification settings", email: "uat.coach@ovalball.test", path: "/account" },
  { name: "Messenger inbox", email: "uat.coach@ovalball.test", path: "/messages" },
  { name: "Message a Person", email: "uat.coach@ovalball.test", path: "/messages/new/person" },
  { name: "Direct thread", email: "uat.coach@ovalball.test", path: `/messages/direct/${CONV}` },
]

for (const surface of SURFACES) {
  for (const width of WIDTHS) {
    const ctx = await newContext(browser, { width, height: 844 })
    const page = await ctx.newPage()
    await signIn(page, surface.email)
    await page.goto(`${APP}${surface.path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const m = await measure(page)

    // HARNESS GATE FIRST.
    if (m.innerWidth !== width || m.clientWidth !== width) {
      record(`${surface.name} @ ${width}`, false,
        `HARNESS INVALID -- asked ${width}, got innerWidth=${m.innerWidth} clientWidth=${m.clientWidth}`)
      await ctx.close()
      continue
    }

    // Then the product judgement: no horizontal overflow.
    const noOverflow = m.scrollWidth <= width

    // And nothing clipped off the right edge.
    // Only content that is NOT inside a horizontal scroll container counts:
    // a wide table that scrolls inside its own box is correct, not a defect.
    const spill = await page.evaluate((w) => {
      const clipped = (el) => {
        let a = el.parentElement
        while (a && a !== document.documentElement) {
          const ox = getComputedStyle(a).overflowX
          if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true
          a = a.parentElement
        }
        return false
      }
      const bad = []
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > w + 1 && !clipped(el)) {
          bad.push(`${el.tagName}.${String(el.className || "").slice(0, 30)}@${Math.round(r.right)}`)
          if (bad.length >= 3) break
        }
      }
      return bad
    }, width)

    record(
      `${surface.name} @ ${width}`,
      noOverflow && spill.length === 0,
      `innerWidth=${m.innerWidth} scrollWidth=${m.scrollWidth}${spill.length ? " spill: " + spill.join(", ") : ""}`,
    )
    await ctx.close()
  }
}

await browser.close()
process.exit(summarise() ? 0 : 1)
