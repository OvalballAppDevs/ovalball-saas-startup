// OVALBALL'S OWN BILLING WEBHOOK NEVER ACKNOWLEDGES AN EVENT IT HAS NOT PROCESSED (20270765000000).
//
// The release operations review of 8 October 2026 found that app/api/platform-billing/webhooks answered 200 whatever
// happened: an event whose inbox write was refused (an outage, the release's read-only maintenance window) was
// acknowledged and lost, an event recorded and then failed was skipped by every redelivery, and the errors of the
// writes that move a club's billing state were never read at all. This drives the REAL route handler with signed
// deliveries against the database; the only thing stubbed is GoCardless itself (api-sandbox), so the inbox, its
// claim, the payment status writer and the subscription history are the real ones. Failures are injected where they
// happen in production -- the database refusing a write (SQLSTATE 25006, exactly what the maintenance gate raises),
// the database being unreachable, a response lost after the write committed, GoCardless failing -- never by a
// mocked "write succeeded". It covers:
//
//   A  a valid event is processed once and acknowledged          G  a bad signature is refused (498), nothing recorded
//   B  a duplicate is acknowledged without processing again      H  concurrent duplicates: one is processed, once
//   C  the database unreachable: 500, then redelivered once      I  processing fails after acceptance: kept, retried
//   D  a read-only refusal: 500, then redelivered once           J  a lost answer is never a false success
//   E  a failed transaction is never acknowledged or half-kept   K  every redelivery processes exactly once
//   F  malformed deliveries are refused, nothing recorded        L  no secret, signature or body in logs or answers
//   M  a delivery that outlives its claim applies nothing and cannot release or mark its successor's claim
//
// It refuses a non-local API, and proves the API and the SQL container are one database before the route writes.
// Everything it creates -- including its two injection triggers -- is removed at the end, and that is checked; it
// never touches another run's fixtures unless they are abandoned.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const SECRET = `whsec_platform_${TAG}_${randomUUID()}`
const ACCESS_TOKEN = `platform_token_${TAG}_${randomUUID()}`
const PERSONAL = `treasurer.${TAG}@example.test`
const PM = `PM_PBW_${TAG}`
const EV = (key: string) => `EV_PBW_${key}_${TAG}`

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

// The Supabase API and its service key, as the other API-driving suites read them: from the environment when the
// gate provides it, otherwise from .env.local. Everything set here is restored afterwards.
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {}
  return ""
}
const ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOCARDLESS_ENV", "GOCARDLESS_PLATFORM_WEBHOOK_SECRET", "GOCARDLESS_PLATFORM_ACCESS_TOKEN", "OVALBALL_SAAS_BILLING_ENABLED"] as const
const savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]))
const API = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
// THIS SUITE WRITES THROUGH THE ROUTE, SO IT MUST NEVER REACH A REAL PROJECT. The route writes wherever the API URL
// points, while fixtures and cleanup go to a local container: refuse anything but a loopback API before a single
// write, and (in before()) prove the API and the container are the same database before the route is called.
const apiHost = (() => { try { return new URL(API).hostname } catch { return "" } })()
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(apiHost)) {
  throw new Error(`platform_billing_webhook: refusing a non-local Supabase API (${apiHost || "unparseable"}); this suite writes and must only run against a local stack.`)
}
process.env.NEXT_PUBLIC_SUPABASE_URL = API
process.env.SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
// The test's own secrets, and sandbox whatever this machine is set to: nothing here may reach a live account.
process.env.GOCARDLESS_ENV = "sandbox"
process.env.GOCARDLESS_PLATFORM_WEBHOOK_SECRET = SECRET
process.env.GOCARDLESS_PLATFORM_ACCESS_TOKEN = ACCESS_TOKEN
process.env.OVALBALL_SAAS_BILLING_ENABLED = "true"

// GoCardless, stubbed: every other request (the Supabase API) goes through, unless a test is losing an answer.
const realFetch = globalThis.fetch
const gocardlessCalls: { path: string; method: string }[] = []
let paymentAnswer: () => Promise<Response> = async () => json(200, { payments: { status: "confirmed", amount: 1500, currency: "GBP" } })
/** When set, the named database call reaches the database (and commits) but its answer never comes back. */
let loseAnswerOf: string | null = null
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/gocardless\.com/.test(url)) {
    const path = new URL(url).pathname
    gocardlessCalls.push({ path, method: init?.method ?? "GET" })
    if (path === `/payments/${PM}`) return paymentAnswer()
    return json(404, { error: { message: "not stubbed" } })
  }
  if (loseAnswerOf && url.includes(`/rest/v1/rpc/${loseAnswerOf}`)) {
    await realFetch(input, init) // it reaches the database, and the database commits
    throw new TypeError("fetch failed") // ...and the answer is lost on the way back
  }
  return realFetch(input, init)
}) as typeof fetch
const paymentFetches = () => gocardlessCalls.filter((c) => c.path === `/payments/${PM}`).length
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Everything the code under test prints, so it can be shown free of secrets and bodies.
const printed: string[] = []
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error }
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
}
const answers: string[] = []

const ids: Record<string, string> = {}

const event = (key: string) => ({
  id: EV(key),
  resource_type: "payments",
  action: "confirmed",
  links: { payment: PM },
  // Never trusted and never logged: present so its absence from every log and answer can be checked.
  metadata: { contact: PERSONAL },
  created_at: new Date().toISOString(),
})
function signedBody(body: string, secret = SECRET): Request {
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex")
  return new Request("http://localhost/api/platform-billing/webhooks", { method: "POST", body, headers: { "Webhook-Signature": signature, "Content-Type": "application/json" } })
}
const signed = (events: unknown[]) => signedBody(JSON.stringify({ events }))
async function deliver(request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/platform-billing/webhooks/route")
  const response = await POST(request as never)
  const text = await response.text()
  answers.push(text)
  return { status: response.status, body: JSON.parse(text) }
}

const inbox = (key: string) => {
  const line = one(`select count(*) || '|' || coalesce(bool_and(processed)::text, '') || '|' || coalesce(max(attempts), 0) || '|' || coalesce(max(processing_error), '') || '|' || coalesce(bool_or(claimed_until > now())::text, '')
      from public.platform_provider_events where provider_event_id = '${EV(key)}';`)
  const [rows, processed, attempts, error, leased] = line.split("|")
  return { rows: Number(rows), processed: processed === "true", attempts: Number(attempts), error, leased: leased === "true" }
}
const paymentStatus = () => one(`select status from public.platform_payments where id = '${ids.payment}';`)
const confirmations = () => Number(one(`select count(*) from public.platform_subscription_events where club_id = '${ids.club}' and event_type = 'payment_confirmed';`))
/** Puts the payment back to submitted (and its history with it), so the next scenario starts from the same place. */
function resetPayment() {
  sql(`begin; set local session_replication_role = replica;
    delete from public.platform_subscription_events where club_id = '${ids.club}';
    update public.platform_payments set status = 'submitted', confirmed_at = null where id = '${ids.payment}';
    commit;`)
}

/** The two injection triggers: the read-only refusal and a failing payment write. Scoped to this run's own rows. */
const READONLY_TRIGGER = `pbw_inject_readonly_${TAG}`
const PAYMENT_TRIGGER = `pbw_inject_payment_${TAG}`
function injectReadOnlyRefusal(on: boolean) {
  if (on) {
    sql(`create function internal.${READONLY_TRIGGER}() returns trigger language plpgsql as $$
      begin
        if new.provider_event_id like '%${TAG}' then
          raise exception 'cannot execute INSERT in a read-only transaction' using errcode = '25006';
        end if;
        return new;
      end $$;
      create trigger ${READONLY_TRIGGER} before insert or update on public.platform_provider_events
        for each row execute function internal.${READONLY_TRIGGER}();`)
  } else {
    sql(`drop trigger if exists ${READONLY_TRIGGER} on public.platform_provider_events; drop function if exists internal.${READONLY_TRIGGER}();`)
  }
}
function injectPaymentWriteFailure(on: boolean) {
  if (on) {
    sql(`create function internal.${PAYMENT_TRIGGER}() returns trigger language plpgsql as $$
      begin
        if new.id = '${ids.payment}' then raise exception 'injected failure in the payment write'; end if;
        return new;
      end $$;
      create trigger ${PAYMENT_TRIGGER} before update on public.platform_payments
        for each row execute function internal.${PAYMENT_TRIGGER}();`)
  } else {
    sql(`drop trigger if exists ${PAYMENT_TRIGGER} on public.platform_payments; drop function if exists internal.${PAYMENT_TRIGGER}();`)
  }
}

function cleanup(t: string) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'pbw-${t}');
  v_dir uuid := (select id from public.club_directory where normalized_key = 'pbw-${t}');
  v_records uuid[];
begin
  set local session_replication_role = replica; -- the commercial history is append-only
  v_records := array_remove(array[v_club, v_dir], null)
    || array(select id from public.platform_club_subscriptions where club_id = v_club)
    || array(select id from public.platform_payments where club_id = v_club)
    || array(select id from public.platform_provider_events where provider_event_id like '%${t}');
  delete from public.platform_provider_events where provider_event_id like '%${t}';
  delete from public.platform_subscription_events where club_id = v_club;
  delete from public.platform_payments where club_id = v_club;
  delete from public.platform_club_subscriptions where club_id = v_club;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
  for (const name of sql(`select proname from pg_proc where pronamespace = 'internal'::regnamespace and proname like 'pbw_inject_%${t}'`).split("\n").map((l) => l.trim()).filter(Boolean)) {
    const table = name.includes("readonly") ? "platform_provider_events" : "platform_payments"
    sql(`drop trigger if exists ${name} on public.${table}; drop function if exists internal.${name}();`)
  }
}

before(async () => {
  // A crashed earlier run leaves its tagged rows and injections. Only ABANDONED ones are cleared: a club more than a
  // day old (a whole run takes seconds), or an injection whose run has no club at all (each run creates its club
  // before any injection) -- never another run that is still going, unless it has been suspended for a day.
  for (const stale of sql(`select substr(slug, 5) from public.clubs where slug like 'pbw-%' and created_at < now() - interval '24 hours'
      union select substr(proname, length(proname) - 7) from pg_proc
       where pronamespace = 'internal'::regnamespace and proname like 'pbw_inject_%'
         and not exists (select 1 from public.clubs c where c.slug = 'pbw-' || substr(proname, length(proname) - 7))`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

  ids.dir = one(`insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
    values ('PBW ${TAG}', 'union', 'England', 'England', 'manual', 'pbw-${TAG}', 'verified') returning id;`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'pbw-${TAG}', 'active') returning id;`)
  ids.subscription = one(`insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status)
    values ('${ids.club}', 'standard', 1500, 1, 'pending_setup') returning id;`)
  ids.payment = one(`insert into public.platform_payments (club_id, subscription_id, gross_pence, net_pence, status, provider, provider_payment_id, idempotency_key)
    values ('${ids.club}', '${ids.subscription}', 1500, 1500, 'submitted', 'gocardless', '${PM}', 'pbw-${TAG}') returning id;`)

  // The API the route will write through must be THIS database: the club just inserted through the container has to
  // be visible through it. Otherwise stop before the route writes anything anywhere.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string
  const seen = await realFetch(`${API}/rest/v1/clubs?slug=eq.pbw-${TAG}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows = seen.ok ? ((await seen.json()) as { id: string }[]) : []
  if (rows.length !== 1 || rows[0].id !== ids.club) {
    throw new Error("platform_billing_webhook: the Supabase API and the SQL container are not the same database; refusing to run.")
  }
})

after(() => {
  for (const level of ["log", "info", "warn", "error"] as const) console[level] = realConsole[level]
  globalThis.fetch = realFetch
  try {
    cleanup(TAG)
    assert.equal(one(`select count(*) from public.clubs where slug = 'pbw-${TAG}';`), "0")
    assert.equal(one(`select count(*) from public.platform_provider_events where provider_event_id like '%${TAG}';`), "0")
    assert.equal(one(`select count(*) from pg_proc where proname like 'pbw_inject_%${TAG}';`), "0")
    assert.equal(one(`select count(*) from pg_trigger where tgname like 'pbw_inject_%${TAG}';`), "0")
  } finally {
    for (const name of ENV_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
  }
})

describe("the platform-billing webhook acknowledges only what it has processed", () => {
  it("A: a valid authenticated event is recorded once, processed once and acknowledged", async () => {
    const before = paymentFetches()
    const res = await deliver(signed([event("A")]))
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, processed: 1, duplicate: 0, inProgress: 0, failed: 0 })
    assert.deepEqual(inbox("A"), { rows: 1, processed: true, attempts: 1, error: "", leased: false })
    assert.equal(paymentStatus(), "confirmed")
    assert.equal(confirmations(), 1)
    assert.equal(paymentFetches() - before, 1)
    assert.ok(gocardlessCalls.every((c) => c.method === "GET"), "processing must never change anything at GoCardless")
  })

  it("B: a duplicate delivery is acknowledged without processing it again", async () => {
    const before = paymentFetches()
    const res = await deliver(signed([event("A")]))
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, processed: 0, duplicate: 1, inProgress: 0, failed: 0 })
    assert.equal(inbox("A").rows, 1)
    assert.equal(paymentFetches(), before)
    assert.equal(confirmations(), 1)
  })

  it("C: with the database unreachable it answers 500 and records nothing; the redelivery is processed once", async () => {
    resetPayment()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9" // nothing listens on the discard port
    try {
      const res = await deliver(signed([event("C")]))
      assert.equal(res.status, 500)
      assert.equal(res.body.failed, 1)
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = API
    }
    assert.equal(inbox("C").rows, 0)
    assert.equal(paymentStatus(), "submitted")
    const again = await deliver(signed([event("C")]))
    assert.equal(again.status, 200)
    assert.equal(again.body.processed, 1)
    assert.equal(paymentStatus(), "confirmed")
    assert.equal(confirmations(), 1)
  })

  it("D: a read-only refusal (SQLSTATE 25006) answers 500, never 200; the redelivery after reopening is processed once", async () => {
    resetPayment()
    injectReadOnlyRefusal(true)
    try {
      const res = await deliver(signed([event("D")]))
      assert.equal(res.status, 500)
      assert.equal(res.body.failed, 1)
      assert.equal(inbox("D").rows, 0)
      assert.equal(paymentStatus(), "submitted")
      assert.ok(printed.some((l) => l.includes(EV("D")) && l.includes("read-only")), "the refusal is logged against the event")
    } finally {
      injectReadOnlyRefusal(false)
    }
    const before = paymentFetches()
    const again = await deliver(signed([event("D")]))
    assert.equal(again.status, 200)
    assert.deepEqual(inbox("D"), { rows: 1, processed: true, attempts: 1, error: "", leased: false })
    assert.equal(paymentFetches() - before, 1)
    assert.equal(confirmations(), 1)
  })

  it("E: a failed transaction is neither acknowledged nor half-kept; the event stays recoverable with its reason", async () => {
    resetPayment()
    injectPaymentWriteFailure(true)
    try {
      const res = await deliver(signed([event("E")]))
      assert.equal(res.status, 500)
      const row = inbox("E")
      assert.equal(row.rows, 1)
      assert.equal(row.processed, false)
      assert.match(row.error, /injected failure in the payment write/)
      assert.equal(row.leased, false, "the claim is released so the redelivery takes it")
      assert.equal(paymentStatus(), "submitted", "the payment write rolled back whole")
      assert.equal(confirmations(), 0, "no history row survived the failed transaction")
    } finally {
      injectPaymentWriteFailure(false)
    }
    const again = await deliver(signed([event("E")]))
    assert.equal(again.status, 200)
    const row = inbox("E")
    assert.equal(row.processed, true)
    assert.equal(row.attempts, 2)
    assert.equal(row.error, "")
    assert.equal(paymentStatus(), "confirmed")
    assert.equal(confirmations(), 1)
  })

  it("F: malformed deliveries are refused and nothing is recorded", async () => {
    const notJson = await deliver(signedBody("{not json"))
    assert.equal(notJson.status, 400)
    const noEvents = await deliver(signedBody(JSON.stringify({ nothing: true })))
    assert.equal(noEvents.status, 400)
    const nullBody = await deliver(signedBody("null"))
    assert.equal(nullBody.status, 400)
    const noId = await deliver(signed([event("F1"), { ...event("F2"), id: null }]))
    assert.equal(noId.status, 400)
    assert.equal(inbox("F1").rows, 0, "a batch with an unidentifiable event is refused whole, before anything is recorded")
    const noAction = await deliver(signed([{ ...event("F3"), action: undefined }]))
    assert.equal(noAction.status, 400)
    assert.equal(inbox("F3").rows, 0)
    // A payment event that names no payment cannot be reconciled: refused, never recorded and acknowledged as done.
    const noLink = await deliver(signed([{ ...event("F4"), links: {} }]))
    assert.equal(noLink.status, 400)
    const badLink = await deliver(signed([{ ...event("F5"), links: { payment: 42 } }]))
    assert.equal(badLink.status, 400)
    const mandateNoLink = await deliver(signed([{ ...event("F6"), resource_type: "mandates", links: { payment: PM } }]))
    assert.equal(mandateNoLink.status, 400)
    assert.equal(inbox("F4").rows + inbox("F5").rows + inbox("F6").rows, 0)
    // A type this route does not act on is recorded and acknowledged (nothing to reconcile).
    const payout = await deliver(signed([{ ...event("F7"), resource_type: "payouts", links: {} }]))
    assert.equal(payout.status, 200)
    assert.equal(inbox("F7").processed, true)
  })

  it("G: an invalid or missing signature is refused with 498 and nothing is recorded; an unconfigured endpoint answers 503", async () => {
    const wrong = await deliver(signedBody(JSON.stringify({ events: [event("G")] }), `whsec_wrong_${TAG}`))
    assert.equal(wrong.status, 498)
    const unsigned = await deliver(new Request("http://localhost/api/platform-billing/webhooks", { method: "POST", body: JSON.stringify({ events: [event("G")] }) }))
    assert.equal(unsigned.status, 498)
    assert.equal(inbox("G").rows, 0)
    delete process.env.GOCARDLESS_PLATFORM_WEBHOOK_SECRET
    try {
      const unconfigured = await deliver(signed([event("G")]))
      assert.equal(unconfigured.status, 503)
    } finally {
      process.env.GOCARDLESS_PLATFORM_WEBHOOK_SECRET = SECRET
    }
    assert.equal(inbox("G").rows, 0)
  })

  it("H: concurrent duplicate deliveries process the event exactly once, and only finished work is acknowledged", async () => {
    resetPayment()
    const before = paymentFetches()
    const slow = paymentAnswer
    paymentAnswer = async () => {
      await sleep(400)
      return json(200, { payments: { status: "confirmed", amount: 1500, currency: "GBP" } })
    }
    let results: { status: number; body: Record<string, unknown> }[]
    try {
      results = await Promise.all(Array.from({ length: 5 }, () => deliver(signed([event("H")]))))
    } finally {
      paymentAnswer = slow
    }
    const processed = results.filter((r) => r.body.processed === 1)
    assert.equal(processed.length, 1, "exactly one delivery processed it")
    assert.equal(processed[0].status, 200)
    for (const r of results.filter((x) => x !== processed[0])) {
      // Either it saw the event being processed (and asked to be redelivered) or it came after (and was told done).
      assert.ok((r.status === 500 && r.body.inProgress === 1) || (r.status === 200 && r.body.duplicate === 1), JSON.stringify(r))
    }
    assert.equal(inbox("H").rows, 1)
    assert.equal(inbox("H").processed, true)
    assert.equal(paymentFetches() - before, 1)
    assert.equal(confirmations(), 1)
    const later = await deliver(signed([event("H")]))
    assert.equal(later.status, 200)
    assert.equal(later.body.duplicate, 1)
    assert.equal(confirmations(), 1)
  })

  it("I: processing that fails after durable acceptance answers 500, keeps the event, and the redelivery processes it", async () => {
    resetPayment()
    const good = paymentAnswer
    paymentAnswer = async () => json(500, { error: { message: "GoCardless is having a moment" } })
    try {
      const res = await deliver(signed([event("I")]))
      assert.equal(res.status, 500)
      const row = inbox("I")
      assert.equal(row.rows, 1)
      assert.equal(row.processed, false)
      assert.notEqual(row.error, "")
      assert.equal(row.leased, false)
    } finally {
      paymentAnswer = good
    }
    assert.equal(paymentStatus(), "submitted")
    const again = await deliver(signed([event("I")]))
    assert.equal(again.status, 200)
    assert.equal(inbox("I").processed, true)
    assert.equal(paymentStatus(), "confirmed")
    assert.equal(confirmations(), 1)
  })

  it("J: an ambiguous outcome is never a false success -- a lost answer is retried, and work already done never runs twice", async () => {
    // (1) The inbox write committed but its answer was lost: 500. A redelivery while the claim is live is NOT
    // acknowledged (the event is recorded but not processed); once the claim lapses, the redelivery processes it.
    resetPayment()
    loseAnswerOf = "claim_platform_provider_event"
    try {
      const res = await deliver(signed([event("J1")]))
      assert.equal(res.status, 500)
    } finally {
      loseAnswerOf = null
    }
    assert.equal(inbox("J1").rows, 1)
    assert.equal(inbox("J1").processed, false)
    assert.equal(inbox("J1").leased, true)
    const early = await deliver(signed([event("J1")]))
    assert.equal(early.status, 500, "recorded but unprocessed must never be acknowledged")
    assert.equal(early.body.inProgress, 1)
    assert.equal(paymentStatus(), "submitted")
    sql(`update public.platform_provider_events set claimed_until = now() - interval '1 second' where provider_event_id = '${EV("J1")}';`) // two minutes pass
    const later = await deliver(signed([event("J1")]))
    assert.equal(later.status, 200)
    assert.equal(later.body.processed, 1)
    assert.equal(paymentStatus(), "confirmed")
    assert.equal(confirmations(), 1)

    // (2) Processing finished and was marked processed, but that answer was lost: 500, and the event stays processed
    // (the failure report does not undo it). The redelivery is acknowledged as a duplicate and runs nothing again.
    resetPayment()
    const before = paymentFetches()
    loseAnswerOf = "mark_platform_provider_event_processed"
    try {
      const res = await deliver(signed([event("J2")]))
      assert.equal(res.status, 500)
    } finally {
      loseAnswerOf = null
    }
    assert.equal(inbox("J2").processed, true, "a lost success answer must not un-process the event")
    const again = await deliver(signed([event("J2")]))
    assert.equal(again.status, 200)
    assert.equal(again.body.duplicate, 1)
    assert.equal(paymentFetches() - before, 1)
    assert.equal(confirmations(), 1)
  })

  it("K: in a mixed batch only the failed event runs again on redelivery", async () => {
    resetPayment()
    const notOurs = { ...event("K2"), links: { payment: `PM_NOT_OURS_${TAG}` } }
    injectReadOnlyRefusal(true)
    sql(`drop trigger ${READONLY_TRIGGER} on public.platform_provider_events;
      create trigger ${READONLY_TRIGGER} before insert or update on public.platform_provider_events
        for each row when (new.provider_event_id = '${EV("K1")}') execute function internal.${READONLY_TRIGGER}();`)
    try {
      const res = await deliver(signed([event("K1"), notOurs]))
      assert.equal(res.status, 500)
      assert.equal(res.body.failed, 1)
      assert.equal(res.body.processed, 1)
    } finally {
      injectReadOnlyRefusal(false)
    }
    const again = await deliver(signed([event("K1"), notOurs]))
    assert.equal(again.status, 200)
    assert.deepEqual(again.body, { ok: true, processed: 1, duplicate: 1, inProgress: 0, failed: 0 })
    assert.equal(inbox("K1").attempts, 1)
    assert.equal(inbox("K2").attempts, 1)
    assert.equal(confirmations(), 1)
  })

  it("M: a delivery that outlives its claim applies nothing and cannot clear or mark its successor's claim", async () => {
    resetPayment()
    // Delivery A's GoCardless call hangs until released; meanwhile its two-minute claim lapses and B takes the event.
    let releaseA: () => void = () => {}
    const aCanFinish = new Promise<void>((resolve) => { releaseA = resolve })
    const good = paymentAnswer
    let calls = 0
    paymentAnswer = async () => {
      calls += 1
      if (calls === 1) await aCanFinish
      return json(200, { payments: { status: "confirmed", amount: 1500, currency: "GBP" } })
    }
    try {
      const a = deliver(signed([event("M")]))
      for (let i = 0; i < 50 && inbox("M").rows === 0; i++) await sleep(20)
      assert.equal(inbox("M").leased, true)
      sql(`update public.platform_provider_events set claimed_until = now() - interval '1 second' where provider_event_id = '${EV("M")}';`) // A's lease lapses
      const b = await deliver(signed([event("M")]))
      assert.equal(b.status, 200, "B owns the event now and processes it")
      assert.equal(b.body.processed, 1)
      assert.equal(confirmations(), 1)
      releaseA()
      const late = await a
      assert.equal(late.status, 500, "A cannot acknowledge work it no longer owns")
      assert.equal(late.body.inProgress, 1)
      assert.equal(late.body.processed, 0)
    } finally {
      paymentAnswer = good
      releaseA()
    }
    const row = inbox("M")
    assert.equal(row.processed, true, "A's late failure did not un-process B's work")
    assert.equal(row.error, "")
    assert.equal(row.attempts, 2)
    assert.equal(confirmations(), 1, "A applied nothing after losing its claim")
    // And a stale owner cannot release or mark a live successor's claim.
    resetPayment()
    const next = one(`select attempts from public.platform_provider_events where provider_event_id = '${EV("M")}';`)
    sql(`update public.platform_provider_events set processed = false, processed_at = null, claimed_until = now() + interval '2 minutes', attempts = attempts + 1 where provider_event_id = '${EV("M")}';`)
    const id = one(`select id from public.platform_provider_events where provider_event_id = '${EV("M")}';`)
    assert.equal(one(`select public.mark_platform_provider_event_processed('${id}', 'stale owner', ${next});`), "f")
    assert.equal(one(`select public.mark_platform_provider_event_processed('${id}', null, ${next});`), "f")
    assert.equal(inbox("M").leased, true, "the successor's claim is untouched")
    assert.equal(one(`select public.platform_provider_event_claim_held('${id}', ${Number(next) + 1});`), "t")
    assert.equal(one(`select public.platform_provider_event_claim_held('${id}', ${next});`), "f")
    sql(`update public.platform_provider_events set processed = true, processed_at = now(), claimed_until = null where id = '${id}';`)
  })

  it("L: no secret, signature, token or event body reaches a log line or an answer", () => {
    const everything = [...printed, ...answers].join("\n")
    for (const secret of [SECRET, ACCESS_TOKEN, PERSONAL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "never"]) {
      assert.ok(!everything.includes(secret), "a secret or a body field was printed or answered")
    }
    assert.ok(!/[0-9a-f]{64}/.test(everything), "no signature (or other 256-bit hex value) was printed or answered")
    assert.ok(!everything.includes('"metadata"'), "no event body was printed")
    for (const answer of answers) {
      assert.ok(Object.keys(JSON.parse(answer)).every((k) => ["ok", "processed", "duplicate", "inProgress", "failed", "error"].includes(k)), answer)
    }
  })
})
