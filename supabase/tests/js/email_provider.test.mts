import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import {
  describeEmailConfiguration,
  getReplyToAddress,
  getSenderIdentity,
  selectEmailProvider,
} from "@/lib/email/provider"

/**
 * Provider adapter regressions.
 *
 * NOTHING HERE TOUCHES THE NETWORK. `fetch` is replaced for the duration of a
 * test and the request body is inspected, so what is asserted is the exact
 * payload Ovalball would put on the wire -- which is the only part of a
 * provider integration worth pinning. A test that really called ZeptoMail
 * would need a live token, would cost a send, and would fail for reasons
 * having nothing to do with this repository.
 */

const REAL_FETCH = globalThis.fetch
const SAVED_ENV: Record<string, string | undefined> = {}
const MANAGED = [
  "EMAIL_PROVIDER",
  "ZEPTOMAIL_API_KEY",
  "ZEPTOMAIL_API_URL",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_FROM_NAME",
  "EMAIL_REPLY_TO_ADDRESS",
  "EMAIL_REPLY_TO_NAME",
  "NODE_ENV",
]

beforeEach(() => {
  for (const key of MANAGED) SAVED_ENV[key] = process.env[key]
})

afterEach(() => {
  for (const key of MANAGED) {
    if (SAVED_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = SAVED_ENV[key]
  }
  globalThis.fetch = REAL_FETCH
})

/** Configures the production-intent environment and captures the outbound request. */
function captureZeptoRequest(): { body: () => Record<string, unknown>; url: () => string; headers: () => Record<string, string> } {
  let captured: { url: string; init: RequestInit } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init }
    return {
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          data: [{ code: "EM_104", additional_info: [], message: "OK" }],
          message: "OK",
          request_id: "req-abc-123",
          object: "Email",
        }),
    } as unknown as Response
  }) as unknown as typeof fetch

  return {
    body: () => JSON.parse(String(captured?.init.body ?? "{}")),
    url: () => captured?.url ?? "",
    headers: () => (captured?.init.headers ?? {}) as Record<string, string>,
  }
}

function configureProduction(): void {
  process.env.EMAIL_PROVIDER = "zeptomail"
  process.env.ZEPTOMAIL_API_KEY = "test-token-not-a-real-key"
  process.env.EMAIL_FROM_ADDRESS = "notifications@ovalball.co.uk"
  process.env.EMAIL_FROM_NAME = "Ovalball"
  process.env.EMAIL_REPLY_TO_ADDRESS = "hello@ovalball.co.uk"
}

const MESSAGE = { to: "someone@example.test", subject: "Subject", html: "<p>Body</p>", text: "Body" }

/* ------------------------------------------------------------------ */
/* Reply-To                                                            */
/* ------------------------------------------------------------------ */

test("the ZeptoMail request carries the configured reply_to", async () => {
  configureProduction()
  const capture = captureZeptoRequest()
  const { provider } = selectEmailProvider()
  await provider.send(MESSAGE, getSenderIdentity()!)

  const body = capture.body() as { reply_to?: Array<{ address: string }> }
  assert.ok(Array.isArray(body.reply_to), "reply_to must be an array -- ZeptoMail's own documented shape")
  assert.equal(body.reply_to![0].address, "hello@ovalball.co.uk")
})

test("under the intended production configuration replies go to hello@ovalball.co.uk", () => {
  configureProduction()
  assert.equal(getReplyToAddress()?.address, "hello@ovalball.co.uk")
  assert.equal(getSenderIdentity()?.replyTo?.address, "hello@ovalball.co.uk")
})

test("From and Reply-To are separate identities, not the same address", () => {
  configureProduction()
  const sender = getSenderIdentity()!
  assert.notEqual(
    sender.from.address,
    sender.replyTo?.address,
    "the sender must be a verified sending identity; the reply mailbox is a human one"
  )
})

test("an unconfigured reply address omits reply_to entirely rather than sending an empty one", async () => {
  configureProduction()
  delete process.env.EMAIL_REPLY_TO_ADDRESS
  const capture = captureZeptoRequest()
  const { provider } = selectEmailProvider()
  await provider.send(MESSAGE, getSenderIdentity()!)

  assert.ok(!("reply_to" in capture.body()), "an empty array is a value, and providers may reject one")
})

test("no feature can supply its own Reply-To: it comes only from configuration", () => {
  // The sender identity is built from the environment, and `send` takes it as
  // one object. There is no per-call reply-to argument to abuse, which is the
  // same reasoning that keeps `to` out of this pipeline.
  const source = String(getSenderIdentity)
  assert.match(source, /EMAIL_REPLY_TO_ADDRESS|getReplyToAddress/)
})

/* ------------------------------------------------------------------ */
/* Provider response handling                                          */
/* ------------------------------------------------------------------ */

test("a successful send records the documented request_id, not an invented message id", async () => {
  configureProduction()
  captureZeptoRequest()
  const { provider } = selectEmailProvider()
  const result = await provider.send(MESSAGE, getSenderIdentity()!)

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.providerReference, "req-abc-123")
})

test("nothing reads a message_id: ZeptoMail's send endpoint documents none", async () => {
  configureProduction()
  // A response shaped exactly as the docs describe, plus a decoy message_id
  // that a future provider change might introduce. The adapter must ignore it
  // rather than start reporting an identifier the API does not guarantee.
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          data: [{ code: "EM_104", additional_info: [], message: "OK", message_id: "decoy" }],
          request_id: "req-real",
        }),
    }) as unknown as Response) as unknown as typeof fetch

  const { provider } = selectEmailProvider()
  const result = await provider.send(MESSAGE, getSenderIdentity()!)
  assert.equal(result.ok && result.providerReference, "req-real")
})

test("a provider error keeps ZeptoMail's own error code, which is the actionable part", async () => {
  configureProduction()
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: "TM_3201", message: "sender address not verified" } }),
    }) as unknown as Response) as unknown as typeof fetch

  const { provider } = selectEmailProvider()
  const result = await provider.send(MESSAGE, getSenderIdentity()!)
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.errorCode, "TM_3201")
})

/* ------------------------------------------------------------------ */
/* Configuration safety                                                */
/* ------------------------------------------------------------------ */

test("no email environment variable is NEXT_PUBLIC_, so no credential reaches a bundle", () => {
  const source = String(selectEmailProvider) + String(getSenderIdentity) + String(getReplyToAddress)
  assert.ok(!source.includes("NEXT_PUBLIC_"), "a NEXT_PUBLIC_ email variable would be inlined into browser JavaScript")
})

test("the API key never appears in the request body -- only in the Authorization header", async () => {
  configureProduction()
  const capture = captureZeptoRequest()
  const { provider } = selectEmailProvider()
  await provider.send(MESSAGE, getSenderIdentity()!)

  assert.ok(!JSON.stringify(capture.body()).includes("test-token-not-a-real-key"))
  assert.match(capture.headers().Authorization, /^Zoho-enczapikey /)
})

test("an unset provider stays log-only outside production and delivers nothing", () => {
  delete process.env.EMAIL_PROVIDER
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.delivers, false, "local development must not mail real club members")
  assert.equal(configurationError, null, "log-only is the deliberate local default, not a fault")
})

test("zeptomail without a key refuses to deliver and says why", () => {
  process.env.EMAIL_PROVIDER = "zeptomail"
  delete process.env.ZEPTOMAIL_API_KEY
  const { provider, configurationError } = selectEmailProvider()
  assert.equal(provider.delivers, false)
  assert.match(String(configurationError), /ZEPTOMAIL_API_KEY/)
})

test("System Health reports whether replies reach a mailbox, without calling it an error", () => {
  configureProduction()
  assert.equal(describeEmailConfiguration().replyToConfigured, true)

  delete process.env.EMAIL_REPLY_TO_ADDRESS
  const described = describeEmailConfiguration()
  assert.equal(described.replyToConfigured, false)
  assert.equal(described.configurationError, null, "no reply address is a choice, not a misconfiguration")
})
