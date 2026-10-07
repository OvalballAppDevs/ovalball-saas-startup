// THE MONEY REACHES THE CLUB: PAYOUTS AND REFUNDS ARE READ FROM GOCARDLESS AND KEPT (20270754000000, Part 2 §29).
//
// Drives the real webhook route with signed deliveries against the local database. Only GoCardless itself is
// stubbed (api-sandbox), so the inbox, the claim, the recording functions and the club's read are the real ones.
// A payout is read with every page of its items, linked to the club's own payments, and kept with the club's other
// GoCardless activity apart; a replay replaces rather than doubles; an archived item list (410) never wipes what is
// held; a refund made at GoCardless is recorded pending, then confirmed, and never goes backwards; the club's read
// explains the payout to the penny and is refused to anybody without the club's finance view. Everything created
// is removed at the end, and that is checked.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const SECRET = `whsec_test_${TAG}`
const TOKEN = `tok_test_${TAG}`
const ORG = `OR_PO_${TAG}`
const PAYOUT = `PO_${TAG}`
const PM_A = `PM_A_${TAG}`
const PM_B = `PM_B_${TAG}`
const PM_ELSEWHERE = `PM_X_${TAG}`
const REFUND = `RF_${TAG}`

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

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

// GoCardless, stubbed by path; the local Supabase API goes through untouched.
const realFetch = globalThis.fetch
const calls: { url: string; method: string }[] = []
let answer: (url: URL) => Response = () => new Response("{}", { status: 500 })
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/gocardless\.com/.test(url)) {
    calls.push({ url, method: init?.method ?? "GET" })
    return answer(new URL(url))
  }
  return realFetch(input, init)
}) as typeof fetch
const savedSecret = process.env.GOCARDLESS_WEBHOOK_SECRET
const savedEnv = process.env.GOCARDLESS_ENV
process.env.GOCARDLESS_WEBHOOK_SECRET = SECRET
process.env.GOCARDLESS_ENV = "sandbox"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
function signed(events: unknown[]): Request {
  const body = JSON.stringify({ events })
  const signature = createHmac("sha256", SECRET).update(body, "utf8").digest("hex")
  return new Request("http://localhost/api/gocardless/webhooks", { method: "POST", body, headers: { "Webhook-Signature": signature, "Content-Type": "application/json" } })
}
const ev = (id: string, resource: string, action: string, links: Record<string, string>) => ({ id: `EV_${id}_${TAG}`, resource_type: resource, action, links: { organisation: ORG, ...links }, created_at: new Date().toISOString() })

// The payout: two of the club's own payments (£16.40 each, members paying Ovalball's 40p on top), GoCardless's fee on
// each (with VAT), Ovalball's fee on each, and a payment the club collected elsewhere with its own fee. Two pages.
const PAYOUT_BODY = { payouts: { id: PAYOUT, amount: 4647, currency: "GBP", status: "paid", arrival_date: "2026-10-08", reference: `GC-${TAG}`, payout_type: "merchant", deducted_fees: 223, created_at: "2026-10-06T09:00:00Z" } }
const PAGE_1 = [
  { type: "payment_paid_out", amount: "1640.0", links: { payment: PM_A } },
  { type: "gocardless_fee", amount: "-30.0", taxes: [{ amount: "-5.0" }], links: { payment: PM_A } },
  { type: "app_fee", amount: "-40.0", links: { payment: PM_A } },
  { type: "payment_paid_out", amount: "1640.0", links: { payment: PM_B } },
]
const PAGE_2 = [
  { type: "gocardless_fee", amount: "-30.0", taxes: [{ amount: "-5.0" }], links: { payment: PM_B } },
  { type: "app_fee", amount: "-40.0", links: { payment: PM_B } },
  { type: "payment_paid_out", amount: "1590.0", links: { payment: PM_ELSEWHERE } },
  { type: "gocardless_fee", amount: "-83.0", links: { payment: PM_ELSEWHERE } },
]
let itemsGone = false
let refundStatus = "pending_submission"
function gocardless(url: URL): Response {
  if (url.pathname === `/payouts/${PAYOUT}`) return json(PAYOUT_BODY)
  if (url.pathname === "/payout_items") {
    if (itemsGone) return json({ error: { code: 410, reason: "payout_items_data_archived" } }, 410)
    return url.searchParams.get("after") === "cursor-2"
      ? json({ payout_items: PAGE_2, meta: { cursors: { after: null }, limit: 500 } })
      : json({ payout_items: PAGE_1, meta: { cursors: { after: "cursor-2" }, limit: 500 } })
  }
  if (url.pathname === `/refunds/${REFUND}`) return json({ refunds: { id: REFUND, amount: 600, status: refundStatus, links: { payment: PM_A } } })
  return json({ error: { message: `unexpected ${url.pathname}` } }, 404)
}

const ids: Record<string, string> = {}

function cleanup(t: string) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'gc-payout-${t}');
  v_dir uuid := (select id from public.club_directory where normalized_key = 'gc-payout-${t}');
  v_users uuid[] := array(select id from auth.users where email like 'gc.payout.%.${t}@ovalball.test');
  v_programme uuid := (select id from public.club_subscription_programmes where club_id = (select id from public.clubs where slug = 'gc-payout-${t}'));
  v_players uuid[] := array(select id from public.players where lower(surname) = lower('Payout ${t}'));
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array_remove(array[v_club, v_dir, v_programme], null) || v_users || v_players
    || array(select id from public.club_subscription_pricing where programme_id = v_programme)
    || array(select id from public.player_subscription_payers where programme_id = v_programme)
    || array(select id from public.membership_obligations where club_id = v_club)
    || array(select id from public.gocardless_payments where club_id = v_club)
    || array(select id from public.gocardless_payouts where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.gocardless_merchant_connections where club_id = v_club);
  delete from public.gocardless_events where gc_event_id like '%${t}%' or payload::text like '%${t}%';
  delete from public.gocardless_reconciliation_entries where payout_id in (select id from public.gocardless_payouts where club_id = v_club);
  delete from public.gocardless_payouts where club_id = v_club;
  delete from public.payment_refunds where payment_id in (select id from public.gocardless_payments where club_id = v_club);
  delete from public.finance_audit_log where club_id = v_club;
  delete from public.security_events where club_id = v_club or actor_user_id = any(v_users) or subject_user_id = any(v_users);
  delete from public.notifications where user_id = any(v_users);
  update public.membership_obligations set gocardless_payment_id = null where club_id = v_club;
  delete from public.gocardless_payments where club_id = v_club;
  delete from public.membership_obligations where club_id = v_club;
  delete from public.player_subscription_payers where programme_id = v_programme;
  delete from public.membership_product_teams where club_id = v_club;
  delete from public.club_subscription_pricing where programme_id = v_programme;
  delete from public.membership_products where club_id = v_club;
  delete from public.club_subscription_programmes where id = v_programme;
  delete from public.gocardless_merchant_connections where club_id = v_club;
  delete from public.role_assignments where membership_id in (select id from public.club_memberships where club_id = v_club);
  delete from public.club_memberships where club_id = v_club;
  delete from public.players where id = any(v_players);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;
  delete from public.profiles where id = any(v_users);
  delete from auth.users where id = any(v_users);
  delete from public.audit_log where record_id = any(v_records) or changed_by = any(v_users) or actor_user_id = any(v_users);
end $$;`)
}

for (const stale of sql(`select substr(slug, 11) from public.clubs where slug like 'gc-payout-%'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

function user(label: string): string {
  return one(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gc.payout.${label}.${TAG}@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') returning id;`)
}

/** The club's read, as somebody. */
function payoutsAs(userId: string): { ok: boolean; body: string } {
  try {
    const out = one(`begin;
      select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      set local role authenticated;
      select public.club_payouts('${ids.club}')::text;
      rollback;`)
    return { ok: true, body: out }
  } catch (e) {
    return { ok: false, body: String((e as { stderr?: string }).stderr ?? e) }
  }
}

before(() => {
  ids.admin = user("admin")
  ids.parent = user("parent")
  ids.outsider = user("outsider")
  sql(`insert into public.profiles (id, first_name, surname, email, account_state) values
         ('${ids.admin}', 'Payout', 'Admin', 'gc.payout.admin.${TAG}@ovalball.test', 'ACTIVE'),
         ('${ids.parent}', 'Payout', 'Parent', 'gc.payout.parent.${TAG}@ovalball.test', 'ACTIVE'),
         ('${ids.outsider}', 'Payout', 'Outsider', 'gc.payout.outsider.${TAG}@ovalball.test', 'ACTIVE')
       on conflict (id) do update set account_state = 'ACTIVE';`)
  ids.dir = one(`insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
    values ('GC Payout ${TAG}', 'union', 'England', 'England', 'manual', 'gc-payout-${TAG}', 'verified') returning id;`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'gc-payout-${TAG}', 'active') returning id;`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${ids.admin}', 'CLUB_ADMIN', 'active');`)
  ids.programme = one(`insert into public.club_subscription_programmes (club_id, enabled, created_by) values ('${ids.club}', true, '${ids.admin}') returning id;`)
  ids.pricing = one(`insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values ('${ids.programme}', 1600, current_date - 60, '${ids.admin}') returning id;`)
  for (const [key, gc] of [["a", PM_A], ["b", PM_B]] as const) {
    ids[`player_${key}`] = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('${key.toUpperCase()}', 'Payout ${TAG}', '2014-01-01', 'MALE') returning id;`)
    ids[`payer_${key}`] = one(`insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
      values ('${ids[`player_${key}`]}', '${ids.programme}', '${ids.parent}', 'guardian', 'active', '${ids.parent}') returning id;`)
    ids[`ob_${key}`] = one(`insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
      values ('${ids.programme}', '${ids.club}', '${ids[`player_${key}`]}', '${ids[`payer_${key}`]}', '${ids.pricing}', date_trunc('month', current_date)::date, 1600, current_date, 'PAID') returning id;`)
    ids[`pay_${key}`] = one(`insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, app_fee_minor)
      values ('${ids.club}', '${ids[`ob_${key}`]}', '${gc}', 1640, 'paid_out', 40) returning id;`)
  }
  sql(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
       values ('${ids.club}', 'sandbox', '${ORG}', '${TOKEN}', 'read_write', '${ids.admin}');`)
  answer = gocardless
})

after(() => {
  globalThis.fetch = realFetch
  if (savedApi.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = savedApi.url
  if (savedApi.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedApi.key
  if (savedSecret === undefined) delete process.env.GOCARDLESS_WEBHOOK_SECRET
  else process.env.GOCARDLESS_WEBHOOK_SECRET = savedSecret
  if (savedEnv === undefined) delete process.env.GOCARDLESS_ENV
  else process.env.GOCARDLESS_ENV = savedEnv
  cleanup(TAG)
  const left = one(`select (select count(*) from public.clubs where slug = 'gc-payout-${TAG}') + (select count(*) from auth.users where email like 'gc.payout.%.${TAG}@ovalball.test')
    + (select count(*) from public.gocardless_events where gc_event_id like '%${TAG}%') + (select count(*) from public.gocardless_payouts where gc_payout_id = '${PAYOUT}')
    + (select count(*) from public.payment_refunds where gc_refund_id = '${REFUND}') + (select count(*) from public.players where lower(surname) = lower('Payout ${TAG}'));`)
  assert.equal(left, "0", "the test left rows behind")
})

describe("GoCardless payouts and refunds reach the club's ledger", () => {
  it("PO1 a paid payout is read with every page of its items and kept, linked to the club's own payments", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const res = await POST(signed([ev("payout", "payouts", "paid", { payout: PAYOUT })]) as never)
    assert.equal(res.status, 200)
    assert.ok(calls.some((c) => /\/payout_items\?.*after=cursor-2/.test(c.url)), "the second page was asked for")
    const [items, ours, other] = one(`select count(*) || '|' || count(payment_id) || '|' || count(*) filter (where payment_id is null)
        from public.gocardless_reconciliation_entries e join public.gocardless_payouts p on p.id = e.payout_id where p.gc_payout_id = '${PAYOUT}';`).split("|")
    assert.deepEqual([items, ours, other], ["8", "6", "2"], "eight items; six are the club's own payments, two its other activity")
  })

  it("PO2 the club's read explains the payout to the penny: members paid, GoCardless's fee and VAT, Ovalball's fee, other activity", () => {
    const r = payoutsAs(ids.admin)
    assert.ok(r.ok, r.body)
    const p = JSON.parse(r.body).payouts[0]
    assert.equal(p.reference, `GC-${TAG}`)
    assert.equal(p.amount_minor, 4647)
    assert.equal(p.members_paid_minor, 3280)
    assert.equal(p.gocardless_fees_minor, -60)
    assert.equal(p.gocardless_vat_minor, -10)
    assert.equal(p.ovalball_fee_minor, -80)
    assert.equal(p.other_minor, 1507, "£15.90 collected elsewhere less its own 83p fee")
    assert.equal(p.balanced, true, "the items add up to what reached the bank")
    assert.equal(p.members_paid_minor + p.gocardless_fees_minor + p.ovalball_fee_minor + p.refunds_minor + p.failures_minor + p.other_minor, p.amount_minor)
    assert.ok(!/PM_|PO_|OR_|tok_/.test(r.body), "no GoCardless ids or tokens in the read")
  })

  it("PO3 a redelivered or replayed payout replaces its items, never doubles them", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const res = await POST(signed([ev("payout-again", "payouts", "paid_again", { payout: PAYOUT })]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select count(*) from public.gocardless_reconciliation_entries e join public.gocardless_payouts p on p.id = e.payout_id where p.gc_payout_id = '${PAYOUT}';`), "8")
    assert.equal(one(`select count(*) from public.gocardless_payouts where gc_payout_id = '${PAYOUT}';`), "1")
  })

  it("PO4 once GoCardless has archived the items (410), a replay keeps the items already held", async () => {
    itemsGone = true
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const res = await POST(signed([ev("payout-archived", "payouts", "paid", { payout: PAYOUT })]) as never)
    itemsGone = false
    assert.equal(res.status, 200)
    assert.equal(one(`select count(*) from public.gocardless_reconciliation_entries e join public.gocardless_payouts p on p.id = e.payout_id where p.gc_payout_id = '${PAYOUT}';`), "8")
  })

  it("PO5 only the club's finance viewers read its payouts", () => {
    assert.equal(payoutsAs(ids.parent).ok, false, "a parent who pays is refused")
    assert.equal(payoutsAs(ids.outsider).ok, false, "a stranger is refused")
    assert.match(payoutsAs(ids.parent).body, /not authorised/)
  })

  it("PO6 a refund made at GoCardless is recorded pending, confirmed once paid, and never goes backwards", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    refundStatus = "pending_submission"
    let res = await POST(signed([ev("refund-created", "refunds", "created", { refund: REFUND, payment: PM_A })]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select status || '|' || source || '|' || amount_minor from public.payment_refunds where gc_refund_id = '${REFUND}';`), "pending|gocardless|600")
    refundStatus = "paid"
    res = await POST(signed([ev("refund-paid", "refunds", "paid", { refund: REFUND, payment: PM_A })]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select status from public.payment_refunds where gc_refund_id = '${REFUND}';`), "confirmed")
    // A stale "created" delivered late re-reads GoCardless, but a stale answer cannot move it back either.
    refundStatus = "submitted"
    res = await POST(signed([ev("refund-late", "refunds", "created", { refund: REFUND, payment: PM_A })]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select status from public.payment_refunds where gc_refund_id = '${REFUND}';`), "confirmed")
    assert.equal(one(`select count(*) from public.payment_refunds where gc_refund_id = '${REFUND}';`), "1")
    assert.equal(one(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action in ('refund_recorded_from_gocardless', 'refund_status_from_gocardless');`), "2")
  })

  it("PO7 a refund on a payment Ovalball did not collect is not recorded", async () => {
    const { POST } = await import("@/app/api/gocardless/webhooks/route")
    const before = one(`select count(*) from public.payment_refunds;`)
    const res = await POST(signed([ev("refund-elsewhere", "refunds", "created", { refund: `RF_X_${TAG}`, payment: PM_ELSEWHERE })]) as never)
    assert.equal(res.status, 200)
    assert.equal(one(`select count(*) from public.payment_refunds;`), before)
  })

  it("PO8 recording is the server's alone: a signed-in person cannot write a payout or a refund", () => {
    const attempt = (q: string) => {
      try {
        sql(`begin; select set_config('request.jwt.claims', '{"sub":"${ids.admin}","role":"authenticated"}', true); set local role authenticated; ${q}; rollback;`)
        return "OK"
      } catch (e) {
        return String((e as { stderr?: string }).stderr ?? e)
      }
    }
    assert.match(attempt(`select public.record_gocardless_payout('${ids.club}', '{"id":"PO_FAKE","amount":1,"status":"paid"}'::jsonb, '[]'::jsonb)`), /permission denied|server only/)
    assert.match(attempt(`select public.record_gocardless_refund('RF_FAKE', '${PM_A}', 100, 'paid')`), /permission denied|server only/)
  })
})
