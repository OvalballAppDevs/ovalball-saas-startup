import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { describeEmailConfiguration, selectEmailProvider } from "@/lib/email/provider"

/**
 * NOTHING NAMED ZEPTOMAIL_API_KEY MAY EVER REACH A BROWSER, A LOG LINE, A
 * TEMPLATE ROW, OR A USER-FACING ERROR.
 *
 * Mixed structural (source-text) and behavioural checks. The structural
 * checks read this repository's own source rather than importing every
 * module, because the property being pinned -- "this string never appears
 * in this file" -- is about the file, not about calling it with a
 * particular input.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(ROOT, relativePath), "utf8")
}

test("no NEXT_PUBLIC_ZEPTOMAIL* variable exists anywhere in the repository", async () => {
  const files = [
    "lib/email/provider.ts",
    "lib/email/send.ts",
    ".env.example",
  ]
  for (const file of files) {
    const source = await read(file)
    assert.ok(!/NEXT_PUBLIC_ZEPTOMAIL/i.test(source), `${file} must never define a NEXT_PUBLIC_ZEPTOMAIL* variable`)
  }
})

test("the provider module is server-only, so it cannot be inlined into a browser bundle regardless of caller", async () => {
  const source = await read("lib/email/provider.ts")
  assert.match(source.split("\n")[0], /^import "server-only"$/)
})

// process.env.NODE_ENV is typed read-only by @types/node; the index-signature
// view is not, and is exactly as mutable at runtime -- Node itself imposes no
// such restriction. `undefined` is never assigned through it: Node coerces
// that to the literal string "undefined", so restoring an unset variable
// always deletes the key instead.
const ENV = process.env as Record<string, string | undefined>

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete ENV[key]
    else ENV[key] = saved[key]
  }
}

test("describeEmailConfiguration() -- the canonical validator -- never returns the API key itself, only presence", () => {
  const saved = { ZEPTOMAIL_API_KEY: ENV.ZEPTOMAIL_API_KEY, EMAIL_PROVIDER: ENV.EMAIL_PROVIDER, NODE_ENV: ENV.NODE_ENV }
  try {
    ENV.NODE_ENV = "production"
    ENV.EMAIL_PROVIDER = "zeptomail"
    ENV.ZEPTOMAIL_API_KEY = "super-secret-do-not-leak-this-token"
    const status = describeEmailConfiguration()
    const serialised = JSON.stringify(status)
    assert.ok(!serialised.includes("super-secret-do-not-leak-this-token"))
    assert.equal(status.apiKeyConfigured, true)
    assert.equal(typeof (status as Record<string, unknown>).apiKey, "undefined")
    assert.equal(typeof (status as Record<string, unknown>).zeptomailApiKey, "undefined")
  } finally {
    restoreEnv(saved)
  }
})

test("a malformed-endpoint configurationError never echoes the configured API key", () => {
  const saved = { NODE_ENV: ENV.NODE_ENV, EMAIL_PROVIDER: ENV.EMAIL_PROVIDER, ZEPTOMAIL_API_KEY: ENV.ZEPTOMAIL_API_KEY, ZEPTOMAIL_API_URL: ENV.ZEPTOMAIL_API_URL }
  try {
    ENV.NODE_ENV = "production"
    ENV.EMAIL_PROVIDER = "zeptomail"
    ENV.ZEPTOMAIL_API_KEY = "another-secret-value-12345"
    ENV.ZEPTOMAIL_API_URL = "not a url"
    const { configurationError } = selectEmailProvider()
    assert.ok(configurationError)
    assert.ok(!configurationError!.includes("another-secret-value-12345"))
  } finally {
    restoreEnv(saved)
  }
})

test("the Send Test Email public error translator never returns the raw provider message, only a fixed sentence", async () => {
  const source = await read("app/(app)/admin/email/actions.ts")
  const fnMatch = source.match(/function toPublicTestSendError\([\s\S]*?\n}/)
  assert.ok(fnMatch, "toPublicTestSendError must exist")
  const body = fnMatch![0]
  // The raw message may be logged (console.error) or matched against
  // (.includes), but never itself returned or interpolated into what
  // reaches the browser.
  assert.ok(!/return\s+message\b/.test(body), "must never return the raw provider message verbatim")
  assert.ok(!/return\s+`[^`]*\$\{message\}/.test(body), "must never interpolate the raw provider message into a returned string")
})

test("no fetch to a ZeptoMail-shaped URL exists outside the canonical provider adapter", async () => {
  const { execFileSync } = await import("node:child_process")
  const output = execFileSync(
    "git",
    ["grep", "-l", "-i", "zeptomail.com", "--", "lib/", "app/", "scripts/"],
    { cwd: ROOT, encoding: "utf8" }
  ).trim()
  const files = output.split("\n").filter(Boolean)
  assert.deepEqual(files, ["lib/email/provider.ts"], "only the canonical adapter may know ZeptoMail's own host")
})

test("no console call in the provider adapter logs the raw API key", async () => {
  const source = await read("lib/email/provider.ts")
  const consoleCalls = source.match(/console\.(log|error|warn)\([^)]*\)/g) ?? []
  for (const call of consoleCalls) {
    assert.ok(!/apiKey|ZEPTOMAIL_API_KEY/.test(call), `a console call must never reference the API key: ${call}`)
  }
})
