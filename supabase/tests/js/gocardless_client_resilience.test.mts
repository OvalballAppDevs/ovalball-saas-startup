// THE ONE GOCARDLESS CLIENT RECOVERS A CREATE THAT ALREADY HAPPENED, AND WAITS OUT A RATE LIMIT (partner audit, 6 October 2026).
//
// GoCardless honours an idempotency key for at least 30 days and answers a repeat with
// 409 idempotent_creation_conflict, naming the resource the first attempt created; a create that succeeded at
// GoCardless but was never recorded here used to fail for those 30 days. A 429 is "safe to retry"
// (https://docs.gocardless.com/docs/api-reference/limits), but only a read or a keyed create may be repeated.
// GoCardless itself is stubbed; nothing here reaches the network.

import { after, describe, it } from "node:test"
import assert from "node:assert/strict"

import { GoCardlessApiError, gcRequest } from "@/lib/payments/gocardless/client"

const realFetch = globalThis.fetch
const savedEnv = process.env.GOCARDLESS_ENV
process.env.GOCARDLESS_ENV = "sandbox"
after(() => {
  globalThis.fetch = realFetch
  if (savedEnv === undefined) delete process.env.GOCARDLESS_ENV
  else process.env.GOCARDLESS_ENV = savedEnv
})

type Call = { url: string; method: string; key: string | null }
function stub(answers: Response[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, method: init?.method ?? "GET", key: headers["Idempotency-Key"] ?? null })
    const next = answers.shift()
    if (!next) throw new Error("no more stubbed answers")
    return next
  }) as typeof fetch
  return calls
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
const soon = () => new Date(Date.now() + 10).toUTCString()
const base = { environment: "sandbox" as const, accessToken: "tok_test_resilience" }

describe("GoCardless client resilience", () => {
  it("GC1 a keyed create that already happened is fetched back, not failed for 30 days", async () => {
    const calls = stub([
      json(409, { error: { code: 409, type: "invalid_state", errors: [{ reason: "idempotent_creation_conflict", links: { conflicting_resource_id: "PM_EXISTING" } }] } }),
      json(200, { payments: { id: "PM_EXISTING", status: "pending_submission" } }),
    ])
    const r = await gcRequest<{ payments: { id: string } }>({ ...base, method: "POST", path: "/payments", body: { payments: {} }, idempotencyKey: "payment-ob1" })
    assert.equal(r.payments.id, "PM_EXISTING")
    assert.equal(calls.length, 2)
    assert.equal(calls[1].method, "GET")
    assert.match(calls[1].url, /\/payments\/PM_EXISTING$/)
    assert.equal(calls[1].key, null, "the fetch-back carries no idempotency key")
  })

  it("GC2 any other 409, or one on an action endpoint, is still an error", async () => {
    stub([json(409, { error: { errors: [{ reason: "cancellation_failed" }] } })])
    await assert.rejects(gcRequest({ ...base, method: "POST", path: "/payments", body: {}, idempotencyKey: "k" }), (e: unknown) => e instanceof GoCardlessApiError && e.status === 409)
    stub([json(409, { error: { errors: [{ reason: "idempotent_creation_conflict", links: { conflicting_resource_id: "X" } }] } })])
    await assert.rejects(gcRequest({ ...base, method: "POST", path: "/payments/PM1/actions/retry", body: {}, idempotencyKey: "k2" }), (e: unknown) => e instanceof GoCardlessApiError && e.status === 409)
  })

  it("GC3 a rate-limited read waits for GoCardless's reset and tries again", async () => {
    const calls = stub([json(429, { error: { code: 429 } }, { "ratelimit-reset": soon() }), json(200, { mandates: { id: "MD1" } })])
    const r = await gcRequest<{ mandates: { id: string } }>({ ...base, method: "GET", path: "/mandates/MD1" })
    assert.equal(r.mandates.id, "MD1")
    assert.equal(calls.length, 2)
  })

  it("GC4 a create without a key is never repeated, rate-limited or not", async () => {
    const calls = stub([json(429, { error: { code: 429 } })])
    await assert.rejects(gcRequest({ ...base, method: "POST", path: "/payments", body: {} }), (e: unknown) => e instanceof GoCardlessApiError && e.status === 429)
    assert.equal(calls.length, 1)
  })

  it("GC5 a keyed create is repeated at most three times, then the 429 is the answer", async () => {
    const calls = stub([0, 1, 2, 3].map(() => json(429, { error: { code: 429 } }, { "ratelimit-reset": soon() })))
    await assert.rejects(gcRequest({ ...base, method: "POST", path: "/subscriptions", body: {}, idempotencyKey: "sub-1" }), (e: unknown) => e instanceof GoCardlessApiError && e.status === 429)
    assert.equal(calls.length, 4)
    assert.ok(calls.every((c) => c.key === "sub-1"), "every repeat carries the same key")
  })
})
