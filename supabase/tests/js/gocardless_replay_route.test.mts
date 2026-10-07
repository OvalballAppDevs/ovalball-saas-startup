// THE WEBHOOK REPLAY ROUTE, AND WHAT IT RECOVERS (20270749000000).
//
// The webhook audit of 6 October 2026 found the replay route untested (G3) and four ways an event could still be
// stranded or failed for ever. This drives the real route handlers -- the replay and the webhook -- against the
// local database; the only thing stubbed is GoCardless itself (api-sandbox / connect-sandbox), so the inbox, its
// claim and back-off, the status writers and the obligations are the real ones. It covers the audit's tests:
//
//   1   the replay route: its door (503, 401, 405), what it takes and what it leaves, a failure's history, the
//       token drain, its exact answer, and its one log line
//   2   two replays at once never take the same event, and one never waits for the other
//   3   the stranding window: a redelivery answered 200 while another delivery held the event, which then failed,
//       is recovered by the replay
//   4   poison statuses: a payment's pending_customer_approval and customer_approval_denied, a billing request's
//       ready_to_fulfil and fulfilling, are recorded -- never failed for ever
//   10  a failed verification check never downgrades a known status, and the replay re-checks an unknown one
//
// and deferral end to end (G7): an event for a disconnected club waits, and is processed once the club reconnects.
// The replay claims the whole inbox and drains the whole revocation queue, so it refuses to run unless both hold
// nothing but its own rows. Everything it creates is removed at the end -- audit and security rows included -- and
// that is checked.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const WEBHOOK_SECRET = `whsec_replay_${TAG}`
const REPLAY_SECRET = `replay_secret_${TAG}_${randomUUID()}`
const TOKEN = `tok_replay_${TAG}`
const OLD_TOKEN = `tok_replay_old_${TAG}`
const ORG = `OR_REPLAY_${TAG}`
const BRQ = `BRQ_REPLAY_${TAG}`
const PM = (key: string) => `PM_REPLAY_${key}_${TAG}`
const EV = (key: string) => `EV_REPLAY_${key}_${TAG}`
const PAYMENT_KEYS = ["A", "B", "C", "D", "E", "S", "PCA", "DEN", "DEF"] as const

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The local Supabase API and its service key, as the other API-driving suites read them: from the environment
// when the gate provides it, otherwise from .env.local. Everything set here is restored afterwards.
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {}
  return ""
}
const ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOCARDLESS_ENV", "GOCARDLESS_WEBHOOK_SECRET", "GOCARDLESS_REPLAY_SECRET", "GOCARDLESS_CLIENT_ID", "GOCARDLESS_CLIENT_SECRET"] as const
const savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]))
process.env.NEXT_PUBLIC_SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
process.env.SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
// The test's own secrets, and sandbox whatever this machine is set to: nothing here may reach a live account.
process.env.GOCARDLESS_ENV = "sandbox"
process.env.GOCARDLESS_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.GOCARDLESS_CLIENT_ID = `client_${TAG}`
process.env.GOCARDLESS_CLIENT_SECRET = `secret_${TAG}`
delete process.env.GOCARDLESS_REPLAY_SECRET

// GoCardless, stubbed by path: every other request (the local Supabase API) goes through untouched.
const realFetch = globalThis.fetch
const gocardlessCalls: { url: string; path: string; method: string; body: string }[] = []
const answers = new Map<string, () => Response>()
let creditorsAnswer: () => Response = () => json(200, { creditors: [{ verification_status: "successful" }] })
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/gocardless\.com/.test(url)) {
    const path = new URL(url).pathname
    gocardlessCalls.push({ url, path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" })
    if (path === "/oauth/revoke") return new Response("", { status: 200 })
    if (path === "/creditors") return creditorsAnswer()
    const answer = answers.get(path)
    return answer ? answer() : json(404, { error: { message: "not stubbed" } })
  }
  return realFetch(input, init)
}) as typeof fetch
const paymentAnswer = (status: string, extra: Record<string, unknown> = {}) => () => json(200, { payments: { status, charge_date: "2026-10-01", ...extra } })
const callsFor = (path: string) => gocardlessCalls.filter((c) => c.path === path).length

// Everything the code under test prints, so the one summary line can be read and the secrets shown absent.
const printed: string[] = []
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error }
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
}

const ids: Record<string, string> = {}

/** Everything a run tagged `t` created, by what it is called -- so a crashed earlier run is swept too. */
function cleanup(t: string) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'gc-replay-${t}');
  v_dir uuid := (select id from public.club_directory where normalized_key = 'gc-replay-${t}');
  v_user uuid := (select id from auth.users where email = 'gc.replay.${t}@ovalball.test');
  v_programme uuid := (select id from public.club_subscription_programmes where club_id = (select id from public.clubs where slug = 'gc-replay-${t}'));
  v_players uuid[] := array(select id from public.players where lower(surname) = lower('Replay ${t}'));
  v_records uuid[];
begin
  -- The history tables are append-only; an operator session may remove a disposable run's rows from them.
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array_remove(array[v_club, v_dir, v_user, v_programme], null) || v_players
    || array(select id from public.club_subscription_pricing where programme_id = v_programme)
    || array(select id from public.player_subscription_payers where programme_id = v_programme)
    || array(select id from public.membership_obligations where club_id = v_club)
    || array(select id from public.gocardless_payments where club_id = v_club)
    || array(select id from public.gocardless_billing_requests where club_id = v_club)
    || array(select id from public.gocardless_merchant_connections where club_id = v_club)
    || array(select id from public.membership_products where club_id = v_club);
  delete from public.gocardless_events where gc_event_id like '%${t}%' or payload::text like '%${t}%' or club_id = v_club;
  delete from internal.gocardless_token_revocations where club_id = v_club or access_token like '%${t}%';
  delete from public.notifications where user_id = v_user;
  delete from public.finance_audit_log where club_id = v_club;
  delete from public.security_events where club_id = v_club or actor_user_id = v_user or subject_user_id = v_user;
  -- A recorded collection and its month point at each other.
  update public.membership_obligations set gocardless_payment_id = null where club_id = v_club and gocardless_payment_id is not null;
  delete from public.gocardless_payments where club_id = v_club;
  delete from public.membership_obligations where club_id = v_club;
  delete from public.gocardless_subscriptions where club_id = v_club;
  delete from public.gocardless_mandates where club_id = v_club;
  delete from public.gocardless_customers where club_id = v_club;
  delete from public.gocardless_billing_requests where club_id = v_club;
  delete from public.player_subscription_payers where programme_id = v_programme;
  delete from public.club_subscription_pricing where programme_id = v_programme;
  delete from public.club_subscription_programmes where id = v_programme;
  delete from public.gocardless_merchant_connections where club_id = v_club;
  delete from public.players where id = any(v_players);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
  delete from public.audit_log where record_id = any(v_records) or changed_by = v_user or actor_user_id = v_user;
end $$;`)
}

// A crashed earlier run leaves its tagged rows; clear them before anything else.
for (const stale of sql(`select substr(slug, 11) from public.clubs where slug like 'gc-replay-%'
    union select substr(split_part(email, '@', 1), 11) from auth.users where email like 'gc.replay.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

/** An inbox event as the webhook records it: claimed by this "delivery" (a live lease) and returned. */
function recordEvent(key: string, links: Record<string, string>, resourceType = "payments", action = "confirmed"): string {
  const payload = JSON.stringify({ id: EV(key), resource_type: resourceType, action, links, created_at: new Date().toISOString() })
  return one(`select public.record_gocardless_event('${EV(key)}', '${resourceType}', '${action}', '${payload}'::jsonb);`)
}
function signed(events: unknown[]): Request {
  const body = JSON.stringify({ events })
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex")
  return new Request("http://localhost/api/gocardless/webhooks", { method: "POST", body, headers: { "Webhook-Signature": signature, "Content-Type": "application/json" } })
}
const replayRequest = (authorization?: string) =>
  new Request("http://localhost/api/gocardless/webhooks/replay", { method: "POST", headers: authorization === undefined ? {} : { Authorization: authorization } })
const paymentEvent = (key: string) => ({ id: EV(key), resource_type: "payments", action: "confirmed", links: { payment: PM(key), organisation: ORG }, created_at: new Date().toISOString() })
const eventRow = (key: string) => {
  const [processed, attempts, failures, error, firstError, deferred, dead, leased] = one(`select processed || '|' || attempts || '|' || failure_count || '|' || coalesce(processing_error, '') || '|' ||
      coalesce(first_error, '') || '|' || (deferred_at is not null) || '|' || (dead_lettered_at is not null) || '|' || (coalesce(claimed_until, '-infinity') > now())
      from public.gocardless_events where gc_event_id = '${EV(key)}';`).split("|")
  return { processed: processed === "true", attempts: Number(attempts), failures: Number(failures), error, firstError, deferred: deferred === "true", dead: dead === "true", leased: leased === "true" }
}
const paymentStatus = (key: string) => one(`select status from public.gocardless_payments where gc_payment_id = '${PM(key)}';`)
const obligationStatus = (key: string) => one(`select o.status from public.membership_obligations o join public.gocardless_payments p on p.obligation_id = o.id where p.gc_payment_id = '${PM(key)}';`)
const verification = () => one(`select verification_status from public.gocardless_merchant_connections where id = '${ids.connection}';`)
/** Settles leftover events of a finished test, so the next replay sees only its own. */
const settle = (keys: string[]) => sql(`update public.gocardless_events set processed = true, processed_at = now(), claimed_until = null where gc_event_id in (${keys.map((k) => `'${EV(k)}'`).join(", ")});`)

before(() => {
  // The replay claims the whole inbox and drains the whole revocation queue; it may only meet its own rows.
  assert.equal(one(`select count(*) from public.gocardless_events where processed = false;`), "0", "the inbox already holds unprocessed events; refusing to replay someone else's")
  assert.equal(one(`select count(*) from internal.gocardless_token_revocations;`), "0", "the revocation queue already holds tokens; refusing to drain someone else's")
  assert.equal(one(`select count(*) from public.gocardless_merchant_connections where disconnected_at is null and verification_status = 'unknown';`), "0", "another club's verification would be re-checked; refusing")

  ids.user = one(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gc.replay.${TAG}@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') returning id;`)
  ids.dir = one(`insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
    values ('GC Replay ${TAG}', 'union', 'England', 'England', 'manual', 'gc-replay-${TAG}', 'verified') returning id;`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'gc-replay-${TAG}', 'active') returning id;`)
  ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Rae', 'Replay ${TAG}', '2015-01-01', 'FEMALE') returning id;`)
  ids.programme = one(`insert into public.club_subscription_programmes (club_id, enabled, created_by) values ('${ids.club}', true, '${ids.user}') returning id;`)
  ids.pricing = one(`insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values ('${ids.programme}', 1600, current_date - 400, '${ids.user}') returning id;`)
  ids.payer = one(`insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
    values ('${ids.player}', '${ids.programme}', '${ids.user}', 'guardian', 'active', '${ids.user}') returning id;`)
  // One month and one submitted payment per scenario.
  PAYMENT_KEYS.forEach((key, i) => {
    const obligation = one(`insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
      values ('${ids.programme}', '${ids.club}', '${ids.player}', '${ids.payer}', '${ids.pricing}', (date_trunc('month', current_date) - interval '${i} months')::date, 1600, current_date, 'SUBMITTED') returning id;`)
    sql(`insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status) values ('${ids.club}', '${obligation}', '${PM(key)}', 1600, 'submitted');`)
  })
  ids.connection = one(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by, verification_status, status_checked_at)
    values ('${ids.club}', 'sandbox', '${ORG}', '${TOKEN}', 'read_write', '${ids.user}', 'successful', now()) returning id;`)
  ids.billingRequest = one(`insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
    values ('${ids.club}', '${ids.payer}', '${BRQ}', 'pending', '${ids.user}') returning id;`)
})

after(() => {
  globalThis.fetch = realFetch
  Object.assign(console, realConsole)
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  cleanup(TAG)
  const left = one(`select (select count(*) from public.clubs where slug = 'gc-replay-${TAG}') + (select count(*) from auth.users where email = 'gc.replay.${TAG}@ovalball.test')
    + (select count(*) from public.gocardless_events where gc_event_id like '%${TAG}%' or payload::text like '%${TAG}%')
    + (select count(*) from public.gocardless_payments where gc_payment_id like '%${TAG}%')
    + (select count(*) from public.gocardless_billing_requests where gc_billing_request_id = '${BRQ}')
    + (select count(*) from public.gocardless_merchant_connections where gc_organisation_id = '${ORG}')
    + (select count(*) from internal.gocardless_token_revocations where access_token like '%${TAG}%')
    + (select count(*) from public.finance_audit_log f where f.new_value::text like '%${TAG}%' or f.old_value::text like '%${TAG}%')
    + (select count(*) from public.security_events s where s.metadata::text like '%${TAG}%')
    + (select count(*) from public.audit_log a where coalesce(a.before::text, '') || coalesce(a.after::text, '') like '%${TAG}%')
    + (select count(*) from public.players where lower(surname) = lower('Replay ${TAG}'));`)
  assert.equal(left, "0", "the test left rows behind")
})

describe("GoCardless webhook replay: scheduled recovery", () => {
  it("R1 the replay route answers only its own bearer secret: 503 unset, 401 otherwise, 405 to GET -- and touches nothing", async () => {
    const { GET, POST } = await import("@/app/api/gocardless/webhooks/replay/route")
    const inboxBefore = one(`select count(*) from public.gocardless_events;`)
    assert.equal((await POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)).status, 503)
    process.env.GOCARDLESS_REPLAY_SECRET = REPLAY_SECRET
    assert.equal((await POST(replayRequest() as never)).status, 401, "no header")
    assert.equal((await POST(replayRequest(`Bearer ${REPLAY_SECRET.replace(/.$/, (c) => (c === "x" ? "y" : "x"))}`) as never)).status, 401, "the wrong secret, same length")
    assert.equal((await POST(replayRequest(`Bearer ${REPLAY_SECRET}x`) as never)).status, 401, "a longer secret")
    assert.equal((await POST(replayRequest(REPLAY_SECRET) as never)).status, 401, "no Bearer scheme")
    const get = await GET()
    assert.equal(get.status, 405)
    assert.equal(get.headers.get("Allow"), "POST")
    assert.equal(gocardlessCalls.length, 0, "GoCardless was asked")
    assert.equal(one(`select count(*) from public.gocardless_events;`), inboxBefore)
    assert.ok(!printed.some((line) => line.includes(REPLAY_SECRET)), "the replay secret was printed")
  })

  it("R2 a 498 is logged as one line, without the body", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const before = printed.length
    const forged = JSON.stringify({ events: [{ id: EV("FORGED"), resource_type: "payments", action: "confirmed", links: { payment: PM("A") } }] })
    const res = await POST(new Request("http://localhost/api/gocardless/webhooks", { method: "POST", body: forged, headers: { "Webhook-Signature": "ab".repeat(32) } }) as never)
    assert.equal(res.status, 498)
    const lines = printed.slice(before)
    assert.equal(lines.filter((l) => l.includes("Answered 498")).length, 1, `expected one 498 line, got: ${lines.join(" / ")}`)
    assert.ok(!lines.some((l) => l.includes(EV("FORGED")) || l.includes(PM("A")) || l.includes("ab".repeat(32))), "the 498 line carries the body or the signature")
    assert.equal(one(`select count(*) from public.gocardless_events where gc_event_id = '${EV("FORGED")}';`), "0")
  })

  it("R3 a replay processes the stale failed event, leaves the processed, held and dead-lettered ones alone, keeps a new failure's history, revokes a queued token, and answers exactly", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/replay/route")
    const a = recordEvent("A", { payment: PM("A"), organisation: ORG })
    sql(`select public.mark_gocardless_event_processed('${a}', 'GoCardless answered 503');
         update public.gocardless_events set last_attempt_at = now() - interval '10 minutes' where id = '${a}';`)
    const b = recordEvent("B", { payment: PM("B"), organisation: ORG })
    sql(`select public.mark_gocardless_event_processed('${b}', null);`)
    const c = recordEvent("C", { payment: PM("C"), organisation: ORG })
    sql(`update public.gocardless_events set created_at = now() - interval '1 day' where id = '${c}';`)
    const d = recordEvent("D", { payment: PM("D"), organisation: ORG })
    sql(`update public.gocardless_events set attempts = internal.gocardless_event_attempt_ceiling() where id = '${d}';
         select public.mark_gocardless_event_processed('${d}', 'GoCardless answered 500');
         update public.gocardless_events set last_attempt_at = now() - interval '1 day' where id = '${d}';`)
    const e = recordEvent("E", { payment: PM("E"), organisation: ORG })
    sql(`select public.mark_gocardless_event_processed('${e}', 'GoCardless answered 502');
         update public.gocardless_events set last_attempt_at = now() - interval '10 minutes' where id = '${e}';
         insert into internal.gocardless_token_revocations (club_id, environment, gc_organisation_id, access_token, reason)
         values ('${ids.club}', 'sandbox', '${ORG}', '${OLD_TOKEN}', 'disconnected');`)
    const before = { b: eventRow("B"), c: eventRow("C"), d: eventRow("D") }
    answers.set(`/payments/${PM("A")}`, paymentAnswer("confirmed", { app_fee: 40 }))
    answers.set(`/payments/${PM("E")}`, () => json(503, { error: { message: "unavailable" } }))
    const logged = printed.length

    const res = await POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: false, claimed: 2, replayed: 1, deferred: 0, failed: 1, tokensRevoked: 1, tokensFailed: 0, verificationChecked: 0, verificationFailed: 0 })

    assert.equal(eventRow("A").processed, true)
    assert.equal(paymentStatus("A"), "confirmed")
    assert.equal(obligationStatus("A"), "PAID")
    assert.equal(one(`select app_fee_minor from public.gocardless_payments where gc_payment_id = '${PM("A")}';`), "40", "the payment's own app fee is kept")
    assert.deepEqual(eventRow("B"), before.b, "a processed event was touched")
    assert.deepEqual(eventRow("C"), before.c, "an event another delivery holds was touched")
    assert.deepEqual(eventRow("D"), before.d, "a dead-lettered event was touched")
    assert.equal(callsFor(`/payments/${PM("B")}`) + callsFor(`/payments/${PM("C")}`) + callsFor(`/payments/${PM("D")}`), 0, "GoCardless was asked about an event the replay must leave")
    const failing = eventRow("E")
    assert.equal(failing.processed, false)
    assert.match(failing.error, /503/)
    assert.equal(failing.firstError, "GoCardless answered 502", "the first error is kept beside the last")
    assert.equal(failing.attempts, 2)
    assert.equal(failing.failures, 2)
    assert.equal(paymentStatus("E"), "submitted", "a failed re-fetch changes no money state")
    assert.equal(one(`select count(*) from internal.gocardless_token_revocations where access_token = '${OLD_TOKEN}';`), "0", "the queued token was not revoked")
    const revoke = gocardlessCalls.find((call) => call.path === "/oauth/revoke")
    assert.ok(revoke && new URLSearchParams(revoke.body).get("token") === OLD_TOKEN, "GoCardless was not asked to revoke the queued token")

    const lines = printed.slice(logged)
    assert.deepEqual(lines, ["[gocardless replay] ok=false claimed=2 replayed=1 deferred=0 failed=1 tokensRevoked=1 tokensFailed=0 verificationChecked=0 verificationFailed=0"], "exactly one summary line, counts only")
    assert.ok(!printed.some((line) => line.includes(REPLAY_SECRET) || line.includes(TOKEN) || line.includes(OLD_TOKEN)), "a secret or a token was printed")
  })

  it("R4 the next run waits out the back-off: the event that just failed is not taken again at once", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/replay/route")
    const asked = gocardlessCalls.length
    const res = await POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.deepEqual(await res.json(), { ok: true, claimed: 0, replayed: 0, deferred: 0, failed: 0, tokensRevoked: 0, tokensFailed: 0, verificationChecked: 0, verificationFailed: 0 })
    assert.equal(gocardlessCalls.length, asked)
    assert.equal(eventRow("E").attempts, 2)
    settle(["C", "D", "E"])
  })

  it("R5 the stranding window is closed: a redelivery answered 200 while another delivery held the event, which then failed, is recovered by the replay", async () => {
    const webhook = await import("@/app/api/gocardless/webhooks/route")
    const replay = await import("@/app/api/gocardless/webhooks/replay/route")
    answers.set(`/payments/${PM("S")}`, paymentAnswer("confirmed"))
    // Delivery 1 claims the event and is still working on it...
    const id = recordEvent("S", { payment: PM("S"), organisation: ORG })
    // ...when GoCardless's redelivery arrives: skipped, answered 200, GoCardless not asked.
    const redelivery = await webhook.POST(signed([paymentEvent("S")]) as never)
    assert.equal(redelivery.status, 200)
    assert.equal(callsFor(`/payments/${PM("S")}`), 0)
    assert.equal(eventRow("S").processed, false)
    // Delivery 1 then fails. GoCardless will not redeliver an event it was told succeeded.
    sql(`select public.mark_gocardless_event_processed('${id}', 'the first delivery timed out');`)
    sql(`update public.gocardless_events set last_attempt_at = now() - interval '6 minutes' where id = '${id}';`)
    const res = await replay.POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.deepEqual(await res.json(), { ok: true, claimed: 1, replayed: 1, deferred: 0, failed: 0, tokensRevoked: 0, tokensFailed: 0, verificationChecked: 0, verificationFailed: 0 })
    assert.equal(eventRow("S").processed, true)
    assert.equal(paymentStatus("S"), "confirmed")
    assert.equal(obligationStatus("S"), "PAID")
  })

  it("R6 poison statuses are recorded per GoCardless's meanings, never failed for ever", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    answers.set(`/payments/${PM("PCA")}`, paymentAnswer("pending_customer_approval"))
    answers.set(`/payments/${PM("DEN")}`, paymentAnswer("customer_approval_denied"))
    answers.set(`/billing_requests/${BRQ}`, () => json(200, { billing_requests: { status: "ready_to_fulfil", links: {} } }))
    const brEvent = (key: string) => ({ id: EV(key), resource_type: "billing_requests", action: "payer_details_confirmed", links: { billing_request: BRQ, organisation: ORG }, created_at: new Date().toISOString() })
    const res = await POST(signed([paymentEvent("PCA"), paymentEvent("DEN"), brEvent("BR1")]) as never)
    assert.equal(res.status, 200)
    assert.deepEqual([eventRow("PCA").processed, eventRow("DEN").processed, eventRow("BR1").processed], [true, true, true])
    assert.equal(paymentStatus("PCA"), "pending_customer_approval")
    assert.equal(obligationStatus("PCA"), "SUBMITTED", "a payment waiting for approval leaves its month as it was")
    assert.equal(paymentStatus("DEN"), "customer_approval_denied")
    assert.equal(obligationStatus("DEN"), "CANCELLED", "a declined payment will not be collected")
    assert.equal(one(`select status from public.gocardless_billing_requests where id = '${ids.billingRequest}';`), "ready_to_fulfil")
    answers.set(`/billing_requests/${BRQ}`, () => json(200, { billing_requests: { status: "fulfilling", links: {} } }))
    const res2 = await POST(signed([brEvent("BR2")]) as never)
    assert.equal(res2.status, 200)
    assert.equal(one(`select status from public.gocardless_billing_requests where id = '${ids.billingRequest}';`), "fulfilling")
  })

  it("R7 an event for a disconnected club waits, spends no budget, and is processed once the club reconnects", async () => {
    const webhook = await import("@/app/api/gocardless/webhooks/route")
    const replay = await import("@/app/api/gocardless/webhooks/replay/route")
    answers.set(`/payments/${PM("DEF")}`, paymentAnswer("confirmed"))
    sql(`update public.gocardless_merchant_connections set disconnected_at = now(), access_token = null where id = '${ids.connection}';`)
    const res = await webhook.POST(signed([paymentEvent("DEF")]) as never)
    assert.equal(res.status, 200, "waiting is not a failure, so GoCardless is not asked to redeliver")
    const waiting = eventRow("DEF")
    assert.deepEqual([waiting.processed, waiting.deferred, waiting.failures], [false, true, 0])
    assert.match(one(`select deferred_reason from public.gocardless_events where gc_event_id = '${EV("DEF")}';`), /^The club is not connected to GoCardless\./)
    assert.equal(callsFor(`/payments/${PM("DEF")}`), 0)

    sql(`update public.gocardless_events set deferred_at = now() - interval '6 minutes' where gc_event_id = '${EV("DEF")}';`)
    const still = await replay.POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.equal((await still.json()).claimed, 0, "the replay took an event its club still cannot act for")

    sql(`update public.gocardless_merchant_connections set disconnected_at = null, access_token = '${TOKEN}' where id = '${ids.connection}';`)
    const back = await replay.POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.deepEqual(await back.json(), { ok: true, claimed: 1, replayed: 1, deferred: 0, failed: 0, tokensRevoked: 0, tokensFailed: 0, verificationChecked: 0, verificationFailed: 0 })
    assert.equal(eventRow("DEF").processed, true)
    assert.equal(paymentStatus("DEF"), "confirmed")
  })

  it("R8 a failed verification check never downgrades a known status; GoCardless's answer replaces it; the replay re-checks an unknown one", async () => {
    const webhook = await import("@/app/api/gocardless/webhooks/route")
    const replay = await import("@/app/api/gocardless/webhooks/replay/route")
    const creditorEvent = (key: string) => ({ id: EV(key), resource_type: "creditors", action: "creditor_updated", links: { organisation: ORG }, created_at: new Date().toISOString() })
    assert.equal(verification(), "successful")

    creditorsAnswer = () => json(503, { error: { message: "unavailable" } })
    const failed = await webhook.POST(signed([creditorEvent("CR1")]) as never)
    assert.equal(failed.status, 500, "a failed check is a failed event, so GoCardless redelivers it")
    assert.equal(verification(), "successful", "a failed check downgraded a known status")
    assert.match(eventRow("CR1").error, /503/)

    creditorsAnswer = () => json(200, { creditors: [{ verification_status: "in_review" }] })
    const redelivered = await webhook.POST(signed([creditorEvent("CR1")]) as never)
    assert.equal(redelivered.status, 200)
    assert.equal(verification(), "in_review")

    creditorsAnswer = () => json(200, { creditors: [{ verification_status: "pending_review" }] })
    const undocumented = await webhook.POST(signed([creditorEvent("CR2")]) as never)
    assert.equal(undocumented.status, 500)
    assert.equal(verification(), "in_review", "a value GoCardless has not documented was written")
    settle(["CR2"])

    sql(`update public.gocardless_merchant_connections set verification_status = 'unknown', status_checked_at = null where id = '${ids.connection}';`)
    creditorsAnswer = () => json(200, { creditors: [{ verification_status: "successful" }] })
    const res = await replay.POST(replayRequest(`Bearer ${REPLAY_SECRET}`) as never)
    assert.deepEqual(await res.json(), { ok: true, claimed: 0, replayed: 0, deferred: 0, failed: 0, tokensRevoked: 0, tokensFailed: 0, verificationChecked: 1, verificationFailed: 0 })
    assert.equal(verification(), "successful", "the replay did not re-check a connection whose status was unknown")
  })

  it("R10 a collection GoCardless made from a subscription is discovered once, into its month, with GoCardless's own app fee", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const customer = one(`insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values ('${ids.club}', '${ids.user}', 'CU_REPLAY_${TAG}') returning id;`)
    const mandate = one(`insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme) values ('${ids.club}', '${customer}', 'MD_REPLAY_${TAG}', 'active', 'bacs') returning id;`)
    const subscription = one(`insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, app_fee_minor, status)
      values ('${ids.club}', '${ids.payer}', '${mandate}', '${ids.pricing}', 'SB_REPLAY_${TAG}', 1600, 40, 'active') returning id;`)
    // A month no obligation exists for yet: the collection's own charge date decides it.
    const ahead = new Date()
    ahead.setUTCDate(1)
    ahead.setUTCMonth(ahead.getUTCMonth() + 3)
    const month = `${ahead.getUTCFullYear()}-${String(ahead.getUTCMonth() + 1).padStart(2, "0")}`
    answers.set(`/payments/${PM("DISC")}`, () => json(200, { payments: { status: "submitted", amount: 1600, currency: "GBP", charge_date: `${month}-05`, app_fee: 40, links: { subscription: `SB_REPLAY_${TAG}`, mandate: `MD_REPLAY_${TAG}` } } }))
    const created = (key: string) => ({ id: EV(key), resource_type: "payments", action: "created", links: { payment: PM("DISC"), subscription: `SB_REPLAY_${TAG}`, organisation: ORG }, created_at: new Date().toISOString() })

    const res = await POST(signed([created("DISC1")]) as never)
    assert.equal(res.status, 200)
    const [status, fee, recordedSubscription, period, obligation] = one(`select p.status || '|' || coalesce(p.app_fee_minor::text, '') || '|' || coalesce(p.gocardless_subscription_id::text, '') || '|' ||
        o.billing_period || '|' || o.status from public.gocardless_payments p join public.membership_obligations o on o.id = p.obligation_id where p.gc_payment_id = '${PM("DISC")}';`).split("|")
    assert.equal(status, "submitted", "the discovered payment was brought to GoCardless's own status")
    assert.equal(fee, "40", "the payment's own app fee was not recorded")
    assert.equal(recordedSubscription, subscription)
    assert.equal(period, `${month}-01`)
    assert.equal(obligation, "SUBMITTED")

    const again = await POST(signed([created("DISC2")]) as never)
    assert.equal(again.status, 200)
    assert.equal(one(`select count(*) from public.gocardless_payments where gc_payment_id = '${PM("DISC")}';`), "1", "a second delivery recorded the collection twice")
  })

  it("R9 two replays at once never take the same event, and one never waits for the other", async () => {
    const keys = ["K1", "K2", "K3"]
    for (const [i, key] of keys.entries()) {
      const id = recordEvent(key, { payment: PM(`NONE${i}`), organisation: ORG })
      sql(`select public.mark_gocardless_event_processed('${id}', 'x');
           update public.gocardless_events set last_attempt_at = now() - interval '10 minutes', created_at = timestamptz '2001-01-01' + interval '${i} minutes' where id = '${id}';`)
    }
    const mine = new Set(keys.map((k) => one(`select id from public.gocardless_events where gc_event_id = '${EV(k)}';`)))
    // Replay A takes the two oldest and holds them, uncommitted, for three seconds.
    const first = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { stdio: ["pipe", "pipe", "pipe"] })
    let firstOut = ""
    first.stdout.on("data", (chunk) => (firstOut += chunk))
    const firstDone = new Promise<number>((resolve) => first.on("close", () => resolve(Date.now())))
    first.stdin.end(`begin; select string_agg(id::text, ',') from public.claim_stale_gocardless_events(2); select pg_sleep(3); commit;`)
    await sleep(1000)
    // Replay B, meanwhile.
    const second = sql(`select coalesce(string_agg(id::text, ','), '') from public.claim_stale_gocardless_events(10);`)
    const secondDone = Date.now()
    const firstFinished = await firstDone
    const taken = { first: firstOut.trim().split("\n")[0].split(",").filter(Boolean), second: second.split(",").filter(Boolean) }
    assert.equal(taken.first.filter((id) => mine.has(id)).length, 2, `replay A took ${taken.first.length}`)
    assert.equal(taken.second.filter((id) => mine.has(id)).length, 1, "replay B did not take the one event left")
    assert.deepEqual(taken.first.filter((id) => taken.second.includes(id)), [], "both replays took the same event")
    assert.ok(secondDone < firstFinished, "replay B waited for replay A instead of skipping the events A holds")
    settle(keys)
  })
})
