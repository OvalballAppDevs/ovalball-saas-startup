#!/usr/bin/env node
/**
 * Source-level guards for the public Contact endpoint.
 *
 * These are the properties an HTTP check cannot prove from the outside, and
 * they are exactly the ones that would turn a contact form into an open
 * mail relay if they ever regressed. Run alongside verify-legal-routes.mjs:
 *
 *   node scripts/verify-contact-safety.mjs
 */

import { readFileSync } from "node:fs"

let pass = 0
let fail = 0

function check(name, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

const action = readFileSync("app/contact/actions.ts", "utf8")
const reasons = readFileSync("lib/contact/reasons.ts", "utf8")
const form = readFileSync("app/contact/contact-form.tsx", "utf8")
const metadata = readFileSync("lib/legal/metadata.ts", "utf8")

console.log("Contact endpoint cannot be told where to send:\n")

// The decisive property: the submitted input shape has no recipient field
// of any kind, so there is nothing for a caller to point elsewhere.
const inputBlock = action.slice(action.indexOf("export async function submitContactMessage"), action.indexOf("): Promise<ContactResult>"))
check(
  "the action accepts no recipient/to/cc/bcc/address parameter",
  !/\b(to|cc|bcc|recipient|recipients|destination|address|mailTo|sendTo)\b\s*:/i.test(inputBlock),
  inputBlock.replace(/\s+/g, " ").slice(0, 160)
)
check(
  "the action passes no recipient to the database RPC",
  !/p_(to|recipient|email_to|destination)\b/.test(action)
)
check(
  "the action derives the ticket category server-side, not from the client",
  action.includes("CONTACT_REASON_CATEGORY[input.reason]") && !/p_category:\s*input\.category/.test(action)
)
check(
  "the action derives the ticket subject server-side, not from the client",
  action.includes("contactSubject(input.reason)") && !/p_subject:\s*input\.(subject|message)/.test(action)
)
check(
  "the reason is validated against a closed list before use",
  action.includes("isContactReason(input.reason)")
)
check(
  "every contact reason maps to a known support category",
  (() => {
    const listed = [...reasons.matchAll(/^\s{2}"([a-z_]+)",$/gm)].map((m) => m[1])
    const mapped = [...reasons.matchAll(/^\s{2}([a-z_]+):\s*"[a-z_]+",$/gm)].map((m) => m[1])
    return listed.length >= 7 && listed.every((r) => mapped.includes(r))
  })()
)

console.log("\nServer-side validation is present, not client-only:")
check("name is validated server-side", /name\.length === 0/.test(action) && /MAX_NAME/.test(action))
check("email shape is validated server-side", /\^\[\^@\\s\]\+@/.test(action))
check("message is validated server-side", /message\.length === 0/.test(action) && /MAX_MESSAGE/.test(action))
check("input is trimmed before use", /\.trim\(\)/.test(action))

console.log("\nAbuse protection:")
check("a honeypot field is enforced in the action", /input\.honeypot/.test(action))
check("the honeypot is present and hidden in the form", /aria-hidden="true"/.test(form) && /honeypot/.test(form))
check(
  "the action relies on the rate-limited shared RPC, not a bespoke insert",
  action.includes("submit_public_support_ticket") && !/\.from\("support_tickets"\)/.test(action)
)

console.log("\nNo credentials or provider secrets in client-reachable code:")
check(
  "no API key or secret literal in the contact form",
  !/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}/i.test(form)
)
check("the form never names a destination address of its own", !/hello@ovalball\.co\.uk["']\s*,?\s*\n?\s*(to|recipient)/i.test(form))

console.log("\nCanonical identity is defined once:")
check("the contact email is defined in lib/legal/metadata.ts", metadata.includes('CONTACT_EMAIL = "hello@ovalball.co.uk"'))
check("the copyright line is generated, not hand-typed per page", /export function copyrightLine/.test(metadata))
check("no Jaxippa reference remains in the identity module", !/jaxippa/i.test(metadata))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
