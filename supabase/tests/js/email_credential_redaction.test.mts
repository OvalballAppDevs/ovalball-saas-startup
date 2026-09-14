import { test } from "node:test"
import assert from "node:assert/strict"

import { redactCredentials, selectEmailProvider } from "@/lib/email/provider"

/**
 * A provider failure must never write the API credential into the delivery
 * ledger.
 *
 * This happened in production: the configured ZeptoMail key contained a line
 * break, the runtime rejected the Authorization header, and its error message
 * -- which quotes the header value -- was stored in
 * email_deliveries.error_message, readable by administrators.
 */

const ENV = process.env as Record<string, string | undefined>

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete ENV[key]
    else ENV[key] = saved[key]
  }
}

const SECRET_LINE_1 = "wSsVR60fixtureOnlyNotARealCredentialAAAA1111"
const SECRET_LINE_2 = "BBBB2222fixtureOnlySecondLineOfTheToken"

test("a header-validation error quoting a multi-line key is stored without any part of the key", async () => {
  const saved = {
    NODE_ENV: ENV.NODE_ENV,
    EMAIL_PROVIDER: ENV.EMAIL_PROVIDER,
    ZEPTOMAIL_API_KEY: ENV.ZEPTOMAIL_API_KEY,
    ZEPTOMAIL_API_URL: ENV.ZEPTOMAIL_API_URL,
    VERCEL_ENV: ENV.VERCEL_ENV,
  }
  const realFetch = globalThis.fetch
  try {
    ENV.NODE_ENV = "production"
    ENV.EMAIL_PROVIDER = "zeptomail"
    ENV.ZEPTOMAIL_API_KEY = `Zoho-enczapikey ${SECRET_LINE_1}\n${SECRET_LINE_2}`
    delete ENV.ZEPTOMAIL_API_URL
    delete ENV.VERCEL_ENV
    globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      throw new TypeError(`Headers.append: "${init?.headers?.Authorization}" is an invalid header value.`)
    }) as typeof fetch

    const { provider, configurationError } = selectEmailProvider()
    assert.equal(configurationError, null)
    const result = await provider.send(
      { to: "someone@ovalball.test", subject: "Test", html: "<p>Test</p>", text: "Test" },
      { from: { address: "noreply@ovalball.test", name: null }, replyTo: null }
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(!result.errorMessage.includes(SECRET_LINE_1), "the first line of the key leaked")
    assert.ok(!result.errorMessage.includes(SECRET_LINE_2), "the second line of the key leaked")
    assert.match(result.errorMessage, /invalid header value/, "the useful part of the failure survives")
  } finally {
    globalThis.fetch = realFetch
    restoreEnv(saved)
  }
})

test("a provider error body echoing the credential is redacted", async () => {
  const saved = { NODE_ENV: ENV.NODE_ENV, EMAIL_PROVIDER: ENV.EMAIL_PROVIDER, ZEPTOMAIL_API_KEY: ENV.ZEPTOMAIL_API_KEY, VERCEL_ENV: ENV.VERCEL_ENV }
  const realFetch = globalThis.fetch
  try {
    ENV.NODE_ENV = "production"
    ENV.EMAIL_PROVIDER = "zeptomail"
    ENV.ZEPTOMAIL_API_KEY = SECRET_LINE_1
    delete ENV.VERCEL_ENV
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "TM_0000", details: `bad token ${SECRET_LINE_1}` } }), { status: 401 })) as typeof fetch
    const { provider } = selectEmailProvider()
    const result = await provider.send(
      { to: "someone@ovalball.test", subject: "Test", html: "<p>Test</p>", text: "Test" },
      { from: { address: "noreply@ovalball.test", name: null }, replyTo: null }
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.errorCode, "TM_0000")
    assert.ok(!result.errorMessage.includes(SECRET_LINE_1))
  } finally {
    globalThis.fetch = realFetch
    restoreEnv(saved)
  }
})

test("redactCredentials removes scheme values and long token runs even without the secret to hand", () => {
  const redacted = redactCredentials(`Authorization: Zoho-enczapikey ${SECRET_LINE_1} and Bearer abcdefgh12345678 and ${"x".repeat(60)}`)
  assert.ok(!redacted.includes(SECRET_LINE_1))
  assert.ok(!redacted.includes("abcdefgh12345678"))
  assert.ok(!redacted.includes("x".repeat(60)))
})

test("ordinary failure text is left readable", () => {
  const message = "TM_3201: sender address not verified for this Mail Agent."
  assert.equal(redactCredentials(message, ["unrelated-secret-value"]), message)
})
