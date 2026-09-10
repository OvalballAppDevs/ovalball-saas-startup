/**
 * Renders one email to a file so a human can look at it in a browser.
 *
 * Uses renderEmail -- the function sendEmailEvent calls -- so what lands on
 * disk is what a recipient would receive, not an approximation of it. It sends
 * nothing, reads no database, and takes its details from the controlled
 * preview fixtures, so no real person or club can appear in the output.
 *
 *   node --import ./scripts/email-test-loader.mjs --experimental-strip-types \
 *     scripts/render-email-sample.mts <event_key> <out.html>
 */
import { writeFileSync } from "node:fs"

import { templateContract } from "@/lib/email/contracts"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

import type { EmailEventKey } from "@/lib/email/catalogue"

const [key, out] = process.argv.slice(2)
if (!key || !out) {
  console.error("usage: render-email-sample.mts <event_key> <out.html>")
  process.exit(1)
}

const eventKey = key as EmailEventKey
const fixture = PREVIEW_FIXTURES[eventKey]?.[0]
if (!fixture) {
  console.error(`"${key}" is not an email Ovalball sends.`)
  process.exit(1)
}

const rendered = renderEmail(
  eventKey,
  fixture.data as never,
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  templateContract(eventKey).default
)

writeFileSync(out, rendered.html, "utf8")
console.log(`subject: ${rendered.subject}`)
console.log(`wrote:   ${out}`)
