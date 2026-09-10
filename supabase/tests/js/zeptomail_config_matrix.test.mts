import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import { selectEmailProvider } from "@/lib/email/provider"

/**
 * THE PRODUCTION-READINESS MATRIX for email provider selection.
 *
 * Nothing here calls ZeptoMail, or any network. Every case sets environment
 * variables for one test, reads selectEmailProvider()'s verdict, and puts
 * them back -- the same isolation email_provider.test.mts already uses. What
 * is pinned is the FAIL-CLOSED CONTRACT: production must never silently
 * discard mail (log-only with no configurationError), and a malformed or
 * insecure provider endpoint must never reach an outbound request.
 */

const SAVED_ENV: Record<string, string | undefined> = {}
const MANAGED = [
  "EMAIL_PROVIDER",
  "ZEPTOMAIL_API_KEY",
  "ZEPTOMAIL_API_URL",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_FROM_NAME",
  "NODE_ENV",
  "VERCEL_ENV",
]

beforeEach(() => {
  for (const key of MANAGED) SAVED_ENV[key] = process.env[key]
  for (const key of MANAGED) delete process.env[key]
})

afterEach(() => {
  for (const key of MANAGED) {
    if (SAVED_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = SAVED_ENV[key]
  }
})

// process.env.NODE_ENV is typed read-only by @types/node; the index-signature
// view is not, and is exactly as mutable at runtime -- Node itself imposes no
// such restriction.
const ENV = process.env as Record<string, string | undefined>

function setProduction(): void {
  ENV.NODE_ENV = "production"
}

test("development + mailpit -> accepted, delivers", () => {
  process.env.EMAIL_PROVIDER = "mailpit"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "mailpit")
  assert.equal(provider.delivers, true)
  assert.equal(configurationError, null)
})

test("production + zeptomail + key -> accepted, delivers", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "not-a-real-key"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "zeptomail")
  assert.equal(provider.delivers, true)
  assert.equal(configurationError, null)
})

test("production + zeptomail + no key -> refused, log-only", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.ok(configurationError)
})

test("production + mailpit -> refused, log-only", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "mailpit"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.ok(configurationError)
})

test('production + EMAIL_PROVIDER="log" -> refused, log-only', () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "log"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.ok(configurationError)
})

test("production + EMAIL_PROVIDER unset -> refused, log-only (never silently discards production mail)", () => {
  setProduction()
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.ok(configurationError)
})

test("unknown provider name -> refused in every environment", () => {
  process.env.EMAIL_PROVIDER = "sparkpost"
  const dev = selectEmailProvider()
  assert.equal(dev.provider.name, "log-only")
  assert.ok(dev.configurationError)

  setProduction()
  const prod = selectEmailProvider()
  assert.equal(prod.provider.name, "log-only")
  assert.ok(prod.configurationError)
})

test("malformed ZEPTOMAIL_API_URL -> refused, never reaches the network", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "not-a-real-key"
  process.env.ZEPTOMAIL_API_URL = "not a url at all"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.match(configurationError ?? "", /ZEPTOMAIL_API_URL/)
})

test("non-HTTPS ZEPTOMAIL_API_URL -> refused, an API key must never travel over plain HTTP", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "not-a-real-key"
  process.env.ZEPTOMAIL_API_URL = "http://api.zeptomail.com/v1.1/email"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.match(configurationError ?? "", /HTTPS/)
})

test("Preview environment refuses zeptomail even when explicitly configured", () => {
  process.env.VERCEL_ENV = "preview"
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "not-a-real-key"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "log-only")
  assert.equal(provider.delivers, false)
  assert.match(configurationError ?? "", /Preview/)
})

test("no configuration error string ever contains the configured API key", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "super-secret-do-not-leak-this-token"
  process.env.ZEPTOMAIL_API_URL = "not a url at all"
  const { configurationError } = selectEmailProvider()
  assert.ok(configurationError)
  assert.ok(!configurationError!.includes("super-secret-do-not-leak-this-token"))
})

test("a genuinely custom HTTPS endpoint is accepted and used verbatim", () => {
  setProduction()
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "not-a-real-key"
  process.env.ZEPTOMAIL_API_URL = "https://api.zeptomail.eu/v1.1/email"
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.name, "zeptomail")
  assert.equal(configurationError, null)
})
