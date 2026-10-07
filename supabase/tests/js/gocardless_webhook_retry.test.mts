// A FAILED WEBHOOK EVENT IS PROCESSED AGAIN; A PROCESSED ONE NEVER IS (20270744000000, the webhook route).
//
// The audit of 5-6 October 2026 proved that the member-payments webhook answered 200 whatever happened and
// skipped every redelivery, so an event whose processing failed was never processed. This drives the real
// route handler with signed deliveries against the local database: the only thing stubbed is GoCardless
// itself (api-sandbox / connect-sandbox), so the inbox, the claim, the status writer and the obligation are
// the real ones. Everything it creates is removed at the end, and that is checked.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const SECRET = `whsec_test_${TAG}`
const TOKEN = `tok_test_${TAG}`
const ORG = `OR_TEST_${TAG}`
const GC_PAYMENT = `PM_TEST_${TAG}`

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

// The local Supabase API and its service key, as the other API-driving suites read them: from the environment
// when the gate provides it, otherwise from .env.local. Restored afterwards.
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {}
  return ""
}
const savedApi = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
process.env.NEXT_PUBLIC_SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
process.env.SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
function restoreApiEnv() {
  if (savedApi.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = savedApi.url
  if (savedApi.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedApi.key
}

// GoCardless, stubbed: every other request (the local Supabase API) goes through untouched.
const realFetch = globalThis.fetch
const gocardlessCalls: { url: string; method: string; body: string }[] = []
let gocardlessAnswer: (url: string) => Response = () => new Response("{}", { status: 500 })
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/gocardless\.com/.test(url)) {
    gocardlessCalls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" })
    return gocardlessAnswer(url)
  }
  return realFetch(input, init)
}) as typeof fetch

// The test's own secret, and sandbox whatever this machine is set to: nothing here may reach a live account.
const savedSecret = process.env.GOCARDLESS_WEBHOOK_SECRET
const savedEnv = process.env.GOCARDLESS_ENV
process.env.GOCARDLESS_WEBHOOK_SECRET = SECRET
process.env.GOCARDLESS_ENV = "sandbox"

const ids: Record<string, string> = {}

function signed(events: unknown[]): Request {
  const body = JSON.stringify({ events })
  const signature = createHmac("sha256", SECRET).update(body, "utf8").digest("hex")
  return new Request("http://localhost/api/gocardless/webhooks", { method: "POST", body, headers: { "Webhook-Signature": signature, "Content-Type": "application/json" } })
}

const confirmedEvent = { id: `EV_TEST_${TAG}`, resource_type: "payments", action: "confirmed", links: { payment: GC_PAYMENT }, created_at: new Date().toISOString() }

/** Everything a run tagged `t` created, by what it is called -- so a crashed earlier run is swept too. */
function cleanup(t: string) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'gc-retry-${t}');
  v_dir uuid := (select id from public.club_directory where normalized_key = 'gc-retry-${t}');
  v_user uuid := (select id from auth.users where email = 'gc.retry.${t}@ovalball.test');
  v_programme uuid := (select id from public.club_subscription_programmes where club_id = (select id from public.clubs where slug = 'gc-retry-${t}'));
  v_players uuid[] := array(select id from public.players where lower(surname) = lower('Retry ${t}'));
  v_records uuid[];
begin
  -- The history tables are append-only; an operator session may remove a disposable run's rows from them.
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array_remove(array[v_club, v_dir, v_user, v_programme], null) || v_players
    || array(select id from public.club_subscription_pricing where programme_id = v_programme)
    || array(select id from public.player_subscription_payers where programme_id = v_programme)
    || array(select id from public.membership_obligations where club_id = v_club)
    || array(select id from public.gocardless_payments where club_id = v_club)
    || array(select id from public.gocardless_merchant_connections where club_id = v_club);
  delete from public.gocardless_events where gc_event_id like '%${t}%' or payload::text like '%${t}%';
  delete from internal.gocardless_token_revocations where club_id = v_club;
  delete from public.notifications where user_id = v_user;
  delete from public.finance_audit_log where club_id = v_club;
  delete from public.security_events where club_id = v_club or actor_user_id = v_user or subject_user_id = v_user;
  delete from public.gocardless_payments where club_id = v_club;
  delete from public.membership_obligations where club_id = v_club;
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

// A crashed earlier run leaves its tagged rows; clear them before seeding.
for (const stale of sql(`select substr(slug, 10) from public.clubs where slug like 'gc-retry-%'
    union select substr(split_part(email, '@', 1), 10) from auth.users where email like 'gc.retry.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

before(() => {
  ids.user = one(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gc.retry.${TAG}@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') returning id;`)
  ids.dir = one(`insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
    values ('GC Retry ${TAG}', 'union', 'England', 'England', 'manual', 'gc-retry-${TAG}', 'verified') returning id;`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'gc-retry-${TAG}', 'active') returning id;`)
  ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Gee', 'Retry ${TAG}', '2015-01-01', 'MALE') returning id;`)
  ids.programme = one(`insert into public.club_subscription_programmes (club_id, enabled, created_by) values ('${ids.club}', true, '${ids.user}') returning id;`)
  ids.pricing = one(`insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values ('${ids.programme}', 1600, current_date - 30, '${ids.user}') returning id;`)
  ids.payer = one(`insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
    values ('${ids.player}', '${ids.programme}', '${ids.user}', 'guardian', 'active', '${ids.user}') returning id;`)
  ids.obligation = one(`insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
    values ('${ids.programme}', '${ids.club}', '${ids.player}', '${ids.payer}', '${ids.pricing}', date_trunc('month', current_date)::date, 1600, current_date, 'SUBMITTED') returning id;`)
  ids.payment = one(`insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status)
    values ('${ids.club}', '${ids.obligation}', '${GC_PAYMENT}', 1600, 'submitted') returning id;`)
  ids.connection = one(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
    values ('${ids.club}', 'sandbox', '${ORG}', '${TOKEN}', 'read_write', '${ids.user}') returning id;`)
})

after(() => {
  globalThis.fetch = realFetch
  restoreApiEnv()
  if (savedSecret === undefined) delete process.env.GOCARDLESS_WEBHOOK_SECRET
  else process.env.GOCARDLESS_WEBHOOK_SECRET = savedSecret
  if (savedEnv === undefined) delete process.env.GOCARDLESS_ENV
  else process.env.GOCARDLESS_ENV = savedEnv
  cleanup(TAG)
  const left = one(`select (select count(*) from public.clubs where slug = 'gc-retry-${TAG}') + (select count(*) from auth.users where email = 'gc.retry.${TAG}@ovalball.test')
    + (select count(*) from public.gocardless_events where gc_event_id like '%${TAG}%') + (select count(*) from public.gocardless_payments where gc_payment_id = '${GC_PAYMENT}')
    + (select count(*) from public.finance_audit_log f where f.new_value::text like '%${TAG}%' or f.old_value::text like '%${TAG}%')
    + (select count(*) from public.players where lower(surname) = lower('Retry ${TAG}'));`)
  assert.equal(left, "0", "the test left rows behind")
})

describe("GoCardless webhook: claim, process, retry", () => {
  it("W1 a delivery whose GoCardless re-fetch fails is answered 500, keeps the event unprocessed with its reason, and changes no money state", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    gocardlessAnswer = () => new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), { status: 503 })
    const res = await POST(signed([confirmedEvent]) as never)
    assert.equal(res.status, 500)
    const [processed, error] = one(`select processed || '|' || coalesce(processing_error, '') from public.gocardless_events where gc_event_id = '${confirmedEvent.id}';`).split("|")
    assert.equal(processed, "false")
    assert.ok(error.length > 0, "the failure's reason is kept on the event")
    assert.equal(one(`select status from public.gocardless_payments where gc_payment_id = '${GC_PAYMENT}';`), "submitted")
    assert.equal(one(`select status from public.membership_obligations where id = '${ids.obligation}';`), "SUBMITTED")
  })

  it("W2 GoCardless's redelivery of that event is processed this time: the payment is confirmed and the month paid", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    gocardlessAnswer = () => new Response(JSON.stringify({ payments: { status: "confirmed", charge_date: "2026-10-05" } }), { status: 200 })
    const res = await POST(signed([confirmedEvent]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select status from public.gocardless_payments where gc_payment_id = '${GC_PAYMENT}';`), "confirmed")
    assert.equal(one(`select status from public.membership_obligations where id = '${ids.obligation}';`), "PAID")
    assert.equal(one(`select processed::text from public.gocardless_events where gc_event_id = '${confirmedEvent.id}';`), "true")
  })

  it("W3 a third delivery of the same event is a no-op: GoCardless is not even asked", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const before = gocardlessCalls.length
    const res = await POST(signed([confirmedEvent]) as never)
    assert.equal(res.status, 200)
    assert.equal(gocardlessCalls.length, before)
  })

  it("W4 a delivery whose signature does not verify is answered 498 and touches nothing", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const before = gocardlessCalls.length
    const forged = { ...confirmedEvent, id: `EV_FORGED_${TAG}` }
    const req = new Request("http://localhost/api/gocardless/webhooks", { method: "POST", body: JSON.stringify({ events: [forged] }), headers: { "Webhook-Signature": "00".repeat(32) } })
    const res = await POST(req as never)
    assert.equal(res.status, 498)
    assert.equal(gocardlessCalls.length, before)
    assert.equal(one(`select count(*) from public.gocardless_events where gc_event_id = '${forged.id}';`), "0")
  })

  it("W5 GoCardless's own 'app disconnected' event (it has no id) ends the club's connection and drops its token", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const event = { resource_type: "organisations", action: "disconnected", links: { organisation: ORG }, created_at: new Date().toISOString() }
    const res = await POST(signed([event]) as never)
    assert.equal(res.status, 200)
    const row = one(`select (disconnected_at is not null)::text || '|' || (access_token is null)::text from public.gocardless_merchant_connections where id = '${ids.connection}';`)
    assert.equal(row, "true|true")
  })
})
