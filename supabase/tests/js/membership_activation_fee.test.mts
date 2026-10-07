// OVALBALL'S FEE REACHES GOCARDLESS (Club Memberships Part 1, 20270748000000).
//
// lib/payments/gocardless/activate-membership.ts turns a member's new Direct Debit into GoCardless instructions. These
// tests run it for real against the local database, with only GoCardless's HTTP API stubbed, and read back exactly
// what it asked GoCardless for:
//
//   A1  the club bears the fee: the pro-rata first month is a one-off for its own amount with Ovalball's 2.5% as the
//       payment's app_fee, and the monthly subscription asks for the price with its 2.5% as app_fee; both are recorded
//       with the fee they carry
//   A2  activating again (a retried click) asks GoCardless for nothing new: no second payment, subscription or fee
//   B1  members bear it: the subscription asks for the price plus the fee, with the fee as app_fee
//   C1  a fully discounted member: no subscription is asked for at all (GoCardless refuses £0, and there is nothing to
//       collect), and activation still succeeds
//   D1  a club GoCardless is still verifying: activation refuses before asking GoCardless for anything
//
// The world is built with SQL, tagged, and removed afterwards; the last test proves nothing is left behind.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
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
process.env.NEXT_PUBLIC_SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
process.env.SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")

// ---------------------------------------------------------------------------------------------- GoCardless, stubbed
const realFetch = globalThis.fetch
type Call = { path: string; method: string; body: Record<string, any>; idempotencyKey: string | null }
const calls: Call[] = []
let seq = 0
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
const inFive = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!/gocardless\.com/.test(url)) return realFetch(input, init)
  const path = new URL(url).pathname
  const headers = new Headers(init?.headers)
  const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {}
  calls.push({ path, method: init?.method ?? "GET", body, idempotencyKey: headers.get("Idempotency-Key") })
  if (path.startsWith("/mandates/")) return json(200, { mandates: { id: path.split("/")[2], status: "active", next_possible_charge_date: inFive } })
  if (path === "/payments") return json(201, { payments: { id: `PM_ACTFEE_${TAG}_${++seq}`, status: "pending_submission" } })
  if (path === "/subscriptions") return json(201, { subscriptions: { id: `SB_ACTFEE_${TAG}_${++seq}`, status: "active", start_date: body.subscriptions?.start_date ?? null } })
  return json(404, { error: { message: "not stubbed" } })
}) as typeof fetch

// ---------------------------------------------------------------------------------------------- the world
const ids: Record<string, string> = {}
const period = one(`select date_trunc('month', current_date)::date`)

/** One club with a £20.00 membership for its Under 12s, a verified GoCardless connection and the given fee bearer. */
function club(key: string, bearer: "GOCARDLESS_APP_FEE" | "PAYER_SURCHARGE", verification = "successful"): void {
  const dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Actfee ${key} ${TAG} RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'actfee-${key}-${TAG}') returning id`)
  const c = one(`insert into public.clubs (directory_id, slug, status) values ('${dir}', 'actfee-${key}-${TAG}', 'active') returning id`)
  const team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${c}', 'Under 12 Boys', 'actfee-${key}-${TAG}-u12', 'youth', 'U12', 'boys', 'union', true) returning id`)
  const admin = person(`admin.${key}`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${c}', '${admin}', 'CLUB_ADMIN', 'active');
       insert into public.club_membership_terms_acceptances (club_id, version, fee_bps, accepted_by) values ('${c}', internal.club_membership_terms_version(), 250, '${admin}');`)
  // The club's own settings and its one membership, through the doors, as its Club Admin.
  const prog = one(`select set_config('request.jwt.claims', jsonb_build_object('sub', '${admin}', 'role', 'authenticated')::text, false);
    set role authenticated;
    select public.save_membership_settings('${c}', 1, 'PRORATE_CURRENT_MONTH', '${bearer === "GOCARDLESS_APP_FEE" ? "CLUB" : "PAYER"}');`)
  const product = one(`select id from public.membership_products where club_id = '${c}' and status = 'active'`)
  sql(`select set_config('request.jwt.claims', jsonb_build_object('sub', '${admin}', 'role', 'authenticated')::text, false);
       set role authenticated;
       select public.set_membership_product_price('${product}', 2000, current_date);`)
  sql(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
       values ('${c}', 'sandbox', 'OR_ACTFEE_${key}_${TAG}', null, 'read_write', '${verification}', '${admin}', now());
       update public.club_subscription_programmes set enabled = true, activated_at = now() where id = '${prog}';`)
  Object.assign(ids, { [`${key}_club`]: c, [`${key}_team`]: team, [`${key}_prog`]: prog, [`${key}_admin`]: admin })
}

function person(label: string): string {
  const id = randomUUID()
  const email = `actfee.${label}.${TAG}@ovalball.test`
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', '', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state) values ('${id}', '${label.split(".")[0]}', 'Actfee', '${email}', '1980-01-01', 'ACTIVE')
    on conflict (id) do update set account_state = 'ACTIVE';`)
  return id
}

/** A child of a parent in the club's Under 12s, enrolled through claim_responsible_payer, with a live mandate. */
function member(key: string, clubKey: string, joinedDay: number, discountedToZero = false): void {
  const parent = person(`parent.${key}`)
  const player = one(`insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
    values ('${key}', 'Actfee', internal.date_of_birth_in_age_grade('union', 'U12'), true, 'MALE') returning id`)
  sql(`insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values ('${parent}', '${player}', 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
       insert into public.player_team_memberships (player_id, team_id, status, state, source) values ('${player}', '${ids[`${clubKey}_team`]}', 'active', 'ACTIVE', 'CLUB_CREATED');`)
  const psp = one(`select set_config('request.jwt.claims', jsonb_build_object('sub', '${parent}', 'role', 'authenticated')::text, false);
    set role authenticated;
    select public.claim_responsible_payer('${player}', '${ids[`${clubKey}_prog`]}');`)
  sql(`update public.player_subscription_payers set effective_from = '${period}'::date + ${joinedDay - 1}${discountedToZero ? ", final_amount_minor = 0, sibling_discount_amount_minor = 2000" : ""} where id = '${psp}'`)
  const customer = one(`insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values ('${ids[`${clubKey}_club`]}', '${parent}', 'CU_ACTFEE_${key}_${TAG}') returning id`)
  const br = one(`insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
    values ('${ids[`${clubKey}_club`]}', '${psp}', 'BRQ_ACTFEE_${key}_${TAG}', 'fulfilled', '${parent}') returning id`)
  const mandate = one(`insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, next_possible_charge_date)
    values ('${ids[`${clubKey}_club`]}', '${customer}', '${br}', 'MD_ACTFEE_${key}_${TAG}', 'active', '${inFive}') returning id`)
  Object.assign(ids, { [`${key}_parent`]: parent, [`${key}_player`]: player, [`${key}_psp`]: psp, [`${key}_mandate`]: mandate })
}

function clean(tag = TAG): string {
  sql(`do $$
declare
  v_clubs uuid[] := array(select id from public.clubs where slug like 'actfee-%-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'actfee.%.${tag}@ovalball.test');
  v_players uuid[] := array(select id from public.players where surname = 'Actfee' and id in (select ptm.player_id from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id where t.club_id = any(v_clubs)));
  v_progs uuid[] := array(select id from public.club_subscription_programmes where club_id = any(v_clubs));
begin
  perform set_config('ovalball.maintenance', 'on', true);
  delete from public.notifications where user_id = any(v_people);
  delete from public.finance_audit_log where club_id = any(v_clubs) or actor_user_id = any(v_people);
  delete from public.security_events where club_id = any(v_clubs) or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  update public.membership_obligations set gocardless_payment_id = null where club_id = any(v_clubs);
  delete from public.gocardless_payments where club_id = any(v_clubs);
  delete from public.gocardless_subscriptions where club_id = any(v_clubs);
  delete from public.gocardless_mandates where club_id = any(v_clubs);
  delete from public.gocardless_billing_requests where club_id = any(v_clubs);
  delete from public.gocardless_customers where club_id = any(v_clubs);
  delete from public.gocardless_merchant_connections where club_id = any(v_clubs);
  delete from public.club_membership_terms_acceptances where club_id = any(v_clubs);
  delete from public.membership_obligations where club_id = any(v_clubs);
  delete from public.membership_player_products where programme_id = any(v_progs);
  delete from public.player_subscription_payers where programme_id = any(v_progs);
  delete from public.membership_product_teams where club_id = any(v_clubs);
  delete from public.club_subscription_pricing where programme_id = any(v_progs);
  delete from public.membership_products where club_id = any(v_clubs);
  delete from public.club_subscription_programmes where id = any(v_progs);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.guardians where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where membership_id in (select id from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_people));
  delete from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_people);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key like 'actfee-%-${tag}';
  -- What these people did while the tests ran was audited under their names; it goes before they do.
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people)
     or record_id = any(v_clubs || v_people || v_players || v_progs);
  delete from public.profiles where id = any(v_people);
  delete from auth.identities where user_id = any(v_people);
  delete from auth.users where id = any(v_people);
  -- And what the deletes above wrote themselves.
  delete from public.audit_log where changed_at = now();
end $$;`)
  return one(`select (select count(*) from public.clubs where slug like 'actfee-%-${tag}') + (select count(*) from auth.users where email like 'actfee.%.${tag}@ovalball.test')
    + (select count(*) from public.club_directory where normalized_key like 'actfee-%-${tag}') + (select count(*) from public.gocardless_payments where gc_payment_id like 'PM_ACTFEE_${tag}_%')`)
}

async function activate(key: string, clubKey: string) {
  const { activateMembership } = await import("@/lib/payments/gocardless/activate-membership")
  const { createServiceRoleClient } = await import("@/lib/supabase/service-role")
  return activateMembership({
    supabase: createServiceRoleClient() as never,
    environment: "sandbox",
    accessToken: `tok_actfee_${TAG}`,
    payerSubscriptionId: ids[`${key}_psp`]!,
    programmeId: ids[`${clubKey}_prog`]!,
    clubId: ids[`${clubKey}_club`]!,
    gocardlessMandateId: ids[`${key}_mandate`]!,
    gcMandateId: `MD_ACTFEE_${key}_${TAG}`,
  })
}
const fee = (minor: number) => Number(one(`select internal.ovalball_fee_minor(${minor}, 250)`))

before(() => {
  club("club", "GOCARDLESS_APP_FEE")
  club("payer", "PAYER_SURCHARGE")
  club("verifying", "GOCARDLESS_APP_FEE", "in_review")
  member("ann", "club", 11)
  member("ben", "payer", 1)
  member("cy", "club", 1, true)
  member("dee", "verifying", 1)
})

after(() => {
  globalThis.fetch = realFetch
})

describe("Ovalball's fee reaches GoCardless", () => {
  it("A1 the club bears it: the pro-rata month and the subscription each carry 2.5% as their app_fee, and are recorded with it", async () => {
    calls.length = 0
    const result = await activate("ann", "club")
    assert.equal(result.ok, true, JSON.stringify(result))
    const owed = one(`select amount_due_minor || '|' || platform_fee_minor || '|' || collect_amount_minor from public.membership_obligations where payer_subscription_id = '${ids.ann_psp}' and billing_period = '${period}'`).split("|").map(Number)
    const [due, obligationFee, collect] = owed as [number, number, number]
    assert.ok(due > 0 && due < 2000, `a pro-rata first month (${due}p)`)
    assert.equal(obligationFee, fee(due))
    assert.equal(collect, due, "the club bears the fee: the member pays the membership amount only")
    const payment = calls.find((c) => c.path === "/payments")
    assert.ok(payment, "a one-off payment for the pro-rata month was asked for")
    assert.deepEqual([payment!.body.payments.amount, payment!.body.payments.app_fee], [due, fee(due)])
    assert.equal(payment!.idempotencyKey?.startsWith("payment-"), true, "keyed by the obligation, so a retry cannot pay twice")
    const subscription = calls.find((c) => c.path === "/subscriptions")
    assert.ok(subscription, "a monthly subscription was asked for")
    assert.deepEqual([subscription!.body.subscriptions.amount, subscription!.body.subscriptions.app_fee, subscription!.body.subscriptions.day_of_month], [2000, 50, 1])
    assert.ok(subscription!.body.subscriptions.start_date > period, "the subscription starts after the month the one-off covers")
    // Recorded with the fee each carries.
    assert.equal(one(`select app_fee_minor from public.gocardless_payments where obligation_id = (select id from public.membership_obligations where payer_subscription_id = '${ids.ann_psp}' and billing_period = '${period}')`), String(fee(due)))
    assert.equal(one(`select app_fee_minor || '|' || amount_minor from public.gocardless_subscriptions where payer_subscription_id = '${ids.ann_psp}'`), "50|2000")
  })

  it("A2 activating again asks GoCardless for nothing new: no second payment, subscription or fee", async () => {
    calls.length = 0
    const result = await activate("ann", "club")
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(calls.filter((c) => c.path === "/payments" || c.path === "/subscriptions").length, 0, JSON.stringify(calls.map((c) => c.path)))
    assert.equal(one(`select count(*) from public.gocardless_payments gp join public.membership_obligations o on o.id = gp.obligation_id where o.payer_subscription_id = '${ids.ann_psp}'`), "1")
    assert.equal(one(`select count(*) from public.gocardless_subscriptions where payer_subscription_id = '${ids.ann_psp}'`), "1")
  })

  it("B1 members bear it: the subscription asks for the price plus the fee, with the fee as its app_fee", async () => {
    calls.length = 0
    const result = await activate("ben", "payer")
    assert.equal(result.ok, true, JSON.stringify(result))
    const subscription = calls.find((c) => c.path === "/subscriptions")
    assert.ok(subscription)
    assert.deepEqual([subscription!.body.subscriptions.amount, subscription!.body.subscriptions.app_fee], [2050, 50])
    for (const payment of calls.filter((c) => c.path === "/payments")) {
      assert.equal(payment.body.payments.app_fee * 2 <= payment.body.payments.amount, true, "an app fee never exceeds half a payment")
      assert.equal(payment.body.payments.amount, 2050, "the first month too collects the price plus the fee")
    }
  })

  it("C1 a fully discounted member: no subscription is asked for, and activation still succeeds", async () => {
    calls.length = 0
    const result = await activate("cy", "club")
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(calls.filter((c) => c.path === "/subscriptions" || c.path === "/payments").length, 0, JSON.stringify(calls.map((c) => c.path)))
    assert.equal(one(`select status || '|' || platform_fee_minor from public.membership_obligations where payer_subscription_id = '${ids.cy_psp}' and billing_period = '${period}'`), "EXEMPT|0")
  })

  it("D1 a club GoCardless is still verifying: activation refuses before asking GoCardless for anything", async () => {
    calls.length = 0
    const result = await activate("dee", "verifying")
    assert.equal(result.ok, false)
    assert.match((result as { error: string }).error, /still being verified/)
    assert.equal(calls.length, 0)
  })

  it("Z1 nothing is left behind", () => {
    assert.equal(clean(), "0")
  })
})
