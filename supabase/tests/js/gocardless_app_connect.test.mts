// A CLUB CONNECTS GOCARDLESS FROM THE APP, AND DISCONNECTS IT (20270750000000).
//
// The phone used to open the website's own start route in the system browser, which needed a separate web
// sign-in and never came back to the app; and a phone disconnect left the club's token queued, unrevoked.
// This drives the real routes -- the app's start, begin, the callback's app branch, finish and disconnect, and
// the website's own start and callback -- with real people signed in through GoTrue and real RPCs against the
// local database. Only GoCardless itself is stubbed (its connect and API hosts), so every refusal below is
// the real one:
//
//   T  terms     neither start route lets a club connect GoCardless before it has agreed the Club Memberships terms
//   S  start     refuses no token, no permission and a website return address
//   B  begin     single use, three minutes; another address begins (it is recorded, never refused)
//   C  callback  the app branch attaches GoCardless's code only with this browser's own state cookie and sends
//                the browser back with a one-time return handoff; the website's branch removes its cookies on
//                their own path
//   F  finish    no handoff waits and changes nothing; a wrong one, or another person, voids the intent; an
//                expired code is refused; a link forwarded to another organisation can never be finished by
//                its sender; with the handoff, the connection is stored for the intent's club
//   G  switch    a club with live Direct Debits cannot be moved to another GoCardless account, from the app or
//                the website, and each says so in a fixed sentence
//   D  disconnect queues and drains the club's token -- revoked at GoCardless before the answer
//
// THE WEBSITE'S OWN ROUTES read their session from cookies through Next.js's request scope, which only exists
// inside the Next.js server. It is supplied here exactly as the server supplies it -- the real
// AsyncLocalStorage, and a request store holding the request's cookies -- with a real GoTrue session in the
// cookie @supabase/ssr writes. Nothing about the routes is stubbed.
//
// Everything it creates is removed afterwards -- the people, the clubs, the terms, the intents, the mandate, the
// connection, the revocation queue, and the audit, security-event and finance-audit rows the real functions
// wrote -- and that is checked.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { AsyncLocalStorage } from "node:async_hooks"
import { randomBytes, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { connectNoticeText } from "@/lib/payments/gocardless/connect-notices"

// What the Next.js server does as it boots, and must do before any of Next.js loads: request-scoped storage
// is built on the real AsyncLocalStorage, or on a stand-in that refuses every request.
;(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage
const { NextRequest } = await import("next/server")
const { workAsyncStorage } = (await import("next/dist/server/app-render/work-async-storage.external.js")) as {
  workAsyncStorage: { run<T>(store: unknown, fn: () => T): T }
}
const { workUnitAsyncStorage } = (await import("next/dist/server/app-render/work-unit-async-storage.external.js")) as {
  workUnitAsyncStorage: { run<T>(store: unknown, fn: () => T): T }
}
const { RequestCookies } = (await import("next/dist/compiled/@edge-runtime/cookies/index.js")) as { RequestCookies: new (headers: Headers) => unknown }
const { RequestCookiesAdapter } = (await import("next/dist/server/web/spec-extension/adapters/request-cookies.js")) as {
  RequestCookiesAdapter: { seal(cookies: unknown): unknown }
}

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const SITE = "http://localhost:3000"
const TOKEN = `tok_gcapp_${TAG}`
const ORG = `OR_GCAPP_${TAG}`
const OTHER_ORG = `OR_GCAPP_OTHER_${TAG}`
const RETURN_URL = `ovalball-dev://admin/subscriptions`
const HOME_IP = "203.0.113.10"
const AWAY_IP = "198.51.100.7"
const TERMS_FIRST = "Agree to Ovalball's terms for Club Memberships before connecting GoCardless."
const SWITCH_REFUSED = "This club still has live Direct Debits on its current GoCardless account, so it can't switch to a different one. Contact Ovalball support."
const HANDOFF = /^[A-Za-z0-9_-]{43}$/

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

// The local Supabase API and its keys, as the other API-driving suites read them: from the environment when
// the gate provides them, otherwise from .env.local. Never printed; restored afterwards.
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {}
  return ""
}
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")

const SAVED: Record<string, string | undefined> = {}
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "GOCARDLESS_ENV", "GOCARDLESS_CLIENT_ID", "GOCARDLESS_CLIENT_SECRET", "GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED"]) {
  SAVED[name] = process.env[name]
}
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
process.env.NEXT_PUBLIC_SITE_URL = SITE
// Sandbox whatever this machine is set to, with the test's own partner credentials: nothing here may reach a live account.
process.env.GOCARDLESS_ENV = "sandbox"
process.env.GOCARDLESS_CLIENT_ID = `client_${TAG}`
process.env.GOCARDLESS_CLIENT_SECRET = `secret_${TAG}`
delete process.env.GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED

// GoCardless, stubbed: its connect and API hosts only. Every other request (the local Supabase API) goes through.
const realFetch = globalThis.fetch
type Call = { url: string; method: string; body: string }
const gocardlessCalls: Call[] = []
let exchangeOrg = ORG
let exchangeToken = TOKEN
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/^https:\/\/[a-z-]+\.gocardless\.com\//.test(url)) {
    const call = { url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" }
    gocardlessCalls.push(call)
    const path = new URL(url).pathname
    if (path === "/oauth/access_token") {
      return new Response(JSON.stringify({ access_token: exchangeToken, token_type: "bearer", scope: "read_write", organisation_id: exchangeOrg }), { status: 200 })
    }
    if (path === "/creditors") {
      return new Response(JSON.stringify({ creditors: [{ id: `CR_GCAPP_${TAG}`, verification_status: "in_review" }] }), { status: 200 })
    }
    if (path === "/oauth/revoke") return new Response("", { status: 200 })
    return new Response(JSON.stringify({ error: { message: "not stubbed" } }), { status: 500 })
  }
  return realFetch(input, init)
}) as typeof fetch
const callsTo = (path: string) => gocardlessCalls.filter((c) => new URL(c.url).pathname === path)

// Everything the code under test prints, so the token and the codes can be shown never to be among it.
const printed: string[] = []
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error }
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
}

type Person = { email: string; password: string; id: string; token: string; session: Record<string, unknown> }
const people: Record<"admin" | "other", Person> = {
  admin: { email: `gc.app.admin.${TAG}@ovalball.test`, password: randomBytes(18).toString("base64url"), id: "", token: "", session: {} },
  other: { email: `gc.app.other.${TAG}@ovalball.test`, password: randomBytes(18).toString("base64url"), id: "", token: "", session: {} },
}
// `club` has agreed the Club Memberships terms; `unagreed` (the same admin's other club) has not.
const ids: { club: string; dir: string; unagreed: string; unagreedDir: string } = { club: "", dir: "", unagreed: "", unagreedDir: "" }

/** Everything a run tagged `t` created, by what it is called -- so a crashed earlier run is swept too. */
function cleanup(t: string) {
  sql(`
do $$
declare
  v_clubs uuid[] := array(select id from public.clubs where slug in ('gc-app-${t}', 'gc-app-u-${t}'));
  v_dirs uuid[] := array(select id from public.club_directory where normalized_key in ('gc-app-${t}', 'gc-app-u-${t}'));
  v_users uuid[] := array(select id from auth.users where email in ('gc.app.admin.${t}@ovalball.test', 'gc.app.other.${t}@ovalball.test'));
  v_records uuid[];
begin
  -- The history tables are append-only; an operator session may remove a disposable run's rows from them.
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_clubs || v_dirs || v_users
    || array(select id from public.gocardless_merchant_connections where club_id = any(v_clubs) or gc_organisation_id like 'OR_GCAPP_%${t}')
    || array(select id from public.gocardless_mandates where club_id = any(v_clubs))
    || array(select id from public.gocardless_customers where club_id = any(v_clubs))
    || array(select id from public.club_membership_terms_acceptances where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_users))
    || array(select id from public.role_assignments where club_id = any(v_clubs) or user_id = any(v_users))
    || array(select id from public.profiles where id = any(v_users));
  delete from internal.gocardless_connect_intents where club_id = any(v_clubs) or user_id = any(v_users);
  delete from internal.gocardless_token_revocations where club_id = any(v_clubs) or access_token like '%gcapp_${t}%';
  delete from public.notifications where user_id = any(v_users) or data ->> 'club_id' in (select unnest(v_clubs)::text);
  delete from public.finance_audit_log where club_id = any(v_clubs) or actor_user_id = any(v_users);
  delete from public.security_events where club_id = any(v_clubs) or actor_user_id = any(v_users) or subject_user_id = any(v_users);
  delete from public.gocardless_mandates where club_id = any(v_clubs);
  delete from public.gocardless_customers where club_id = any(v_clubs);
  delete from public.gocardless_merchant_connections where club_id = any(v_clubs) or gc_organisation_id like 'OR_GCAPP_%${t}';
  delete from public.club_membership_terms_acceptances where club_id = any(v_clubs);
  delete from public.role_assignments where club_id = any(v_clubs) or user_id = any(v_users);
  delete from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_users);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where id = any(v_dirs);
  delete from public.account_security_state where user_id = any(v_users);
  delete from public.user_session_versions where user_id = any(v_users);
  delete from public.profiles where id = any(v_users);
  delete from auth.users where id = any(v_users);
  delete from public.audit_log where record_id = any(v_records) or changed_by = any(v_users) or actor_user_id = any(v_users);
end $$;`)
}

// A crashed earlier run leaves its tagged rows; clear them before seeding. ('gc-app-' is 7 characters,
// 'gc-app-u-' 9, and 'gc.app.admin.' and 'gc.app.other.' are 13.)
for (const stale of sql(`select substr(slug, 8) from public.clubs where slug like 'gc-app-%' and slug not like 'gc-app-u-%'
    union select substr(slug, 10) from public.clubs where slug like 'gc-app-u-%'
    union select substr(split_part(email, '@', 1), 14) from auth.users where email like 'gc.app.admin.%@ovalball.test' or email like 'gc.app.other.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

async function signUpAndIn(who: "admin" | "other") {
  const person = people[who]
  const created = await realFetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password, email_confirm: true }),
  }).then((r) => r.json() as Promise<{ id?: string }>)
  assert.ok(created.id, `${who} was created`)
  person.id = created.id as string
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth) values ('${person.id}', 'Gcapp', '${who === "admin" ? "Treasurer" : "Bystander"}', '${person.email}', (current_date - interval '40 years')::date)
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;`)
  const session = await realFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>)
  assert.ok(session.access_token, `${who} signed in through GoTrue`)
  person.token = session.access_token as string
  person.session = session
}

before(async () => {
  assert.ok(PUBLISHABLE && SERVICE, "the local publishable and service keys are needed (environment or .env.local)")
  await signUpAndIn("admin")
  await signUpAndIn("other")
  for (const [slug, label] of [[`gc-app-${TAG}`, "GC App"], [`gc-app-u-${TAG}`, "GC App Unagreed"]] as const) {
    sql(`begin;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('${label} RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', '${slug}');
insert into public.clubs (directory_id, slug, status) select id, '${slug}', 'active' from public.club_directory where normalized_key = '${slug}';
insert into public.club_memberships (club_id, user_id, role, status) select id, '${people.admin.id}', 'CLUB_ADMIN', 'active' from public.clubs where slug = '${slug}';
commit;`)
  }
  ids.club = one(`select id from public.clubs where slug = 'gc-app-${TAG}';`)
  ids.dir = one(`select id from public.club_directory where normalized_key = 'gc-app-${TAG}';`)
  ids.unagreed = one(`select id from public.clubs where slug = 'gc-app-u-${TAG}';`)
  ids.unagreedDir = one(`select id from public.club_directory where normalized_key = 'gc-app-u-${TAG}';`)

  // The terms, agreed the way the product agrees them: by the admin, through the API, to the version shown.
  const version = one(`select internal.club_membership_terms_version();`)
  const agreed = await realFetch(`${SUPABASE_URL}/rest/v1/rpc/accept_club_membership_terms`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${people.admin.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_club_id: ids.club, p_version: version }),
  })
  assert.equal(agreed.status, 200, "the admin agreed the Club Memberships terms")
})

after(() => {
  globalThis.fetch = realFetch
  Object.assign(console, realConsole)
  for (const [name, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  cleanup(TAG)
  const users = [people.admin.id, people.other.id].filter(Boolean).map((u) => `'${u}'`).join(",") || "null"
  const clubs = [ids.club, ids.unagreed].filter(Boolean).map((c) => `'${c}'`).join(",") || "null"
  const left = one(`select (select count(*) from auth.users where email like 'gc.app.%.${TAG}@ovalball.test')
    + (select count(*) from public.profiles where id in (${users}))
    + (select count(*) from public.clubs where slug in ('gc-app-${TAG}', 'gc-app-u-${TAG}') or id in (${clubs}))
    + (select count(*) from public.club_directory where normalized_key in ('gc-app-${TAG}', 'gc-app-u-${TAG}'))
    + (select count(*) from public.club_membership_terms_acceptances where club_id in (${clubs}))
    + (select count(*) from internal.gocardless_connect_intents where user_id in (${users}) or club_id in (${clubs}))
    + (select count(*) from public.gocardless_merchant_connections where gc_organisation_id in ('${ORG}', '${OTHER_ORG}') or access_token like '%gcapp_${TAG}%' or club_id in (${clubs}))
    + (select count(*) from public.gocardless_mandates where club_id in (${clubs})) + (select count(*) from public.gocardless_customers where club_id in (${clubs}))
    + (select count(*) from internal.gocardless_token_revocations where access_token like '%gcapp_${TAG}%')
    + (select count(*) from public.finance_audit_log where club_id in (${clubs}) or actor_user_id in (${users}) or new_value::text like '%${TAG}%')
    + (select count(*) from public.security_events where club_id in (${clubs}) or actor_user_id in (${users}) or subject_user_id in (${users}))
    + (select count(*) from public.audit_log where changed_by in (${users}) or actor_user_id in (${users}) or record_id in (${users}) or record_id in (${clubs}));`)
  assert.equal(left, "0", "the test left rows behind")
})

// ------------------------------------------------------------------------------------------------ helpers

function request(path: string, init: { method?: string; token?: string; body?: unknown; ip?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (init.ip) headers["x-forwarded-for"] = `${init.ip}, 10.0.0.1`
  if (init.cookie) headers.cookie = init.cookie
  return new NextRequest(`${SITE}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/** The admin's real GoTrue session, in the cookie @supabase/ssr writes: `base64-` and base64url JSON, chunked at 3180. */
function sessionCookie(person: Person): string {
  const name = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
  const encoded = `base64-${Buffer.from(JSON.stringify(person.session)).toString("base64url")}`
  const chunks = encoded.match(/.{1,3180}/g) ?? []
  return chunks.length === 1 ? `${name}=${encoded}` : chunks.map((chunk, i) => `${name}.${i}=${chunk}`).join("; ")
}

/** A route of the WEBSITE, run inside the request scope the Next.js server would give it. */
function asWebRequest<T>(route: string, cookie: string, run: () => Promise<T>): Promise<T> {
  const sealed = RequestCookiesAdapter.seal(new RequestCookies(new Headers({ cookie })))
  return workAsyncStorage.run({ route, forceStatic: false, dynamicShouldError: false }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: sealed, mutableCookies: sealed, userspaceMutableCookies: sealed }, run)
  )
}

async function startApp(clubId = ids.club, token = people.admin.token, ip = HOME_IP, returnUrl = RETURN_URL) {
  const { POST } = await import("@/app/api/gocardless/oauth/app/start/route")
  const res = await POST(request("/api/gocardless/oauth/app/start", { method: "POST", token, ip, body: { clubId, returnUrl } }))
  return { status: res.status, body: await json(res) }
}

async function start(token = people.admin.token, ip = HOME_IP): Promise<{ intentId: string; beginToken: string }> {
  const { status, body } = await startApp(ids.club, token, ip)
  assert.equal(status, 200, `start refused: ${JSON.stringify(body)}`)
  const beginUrl = new URL(String(body.beginUrl))
  assert.equal(`${beginUrl.origin}${beginUrl.pathname}`, `${SITE}/api/gocardless/oauth/app/begin`, "the begin link is on the origin GoCardless returns to")
  return { intentId: String(body.intentId), beginToken: beginUrl.searchParams.get("t") ?? "" }
}

async function begin(beginToken: string, ip = HOME_IP): Promise<Response> {
  const { GET } = await import("@/app/api/gocardless/oauth/app/begin/route")
  return GET(request(`/api/gocardless/oauth/app/begin?t=${encodeURIComponent(beginToken)}`, { ip }))
}

async function callback(query: Record<string, string>, cookie?: string): Promise<Response> {
  const { GET } = await import("@/app/api/gocardless/oauth/callback/route")
  return GET(request(`/api/gocardless/oauth/callback?${new URLSearchParams(query)}`, { cookie }))
}

async function finish(intentId: string, handoff?: string | null, token = people.admin.token): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/gocardless/oauth/app/finish/route")
  const body = handoff === undefined ? { intentId } : { intentId, handoff }
  const res = await POST(request("/api/gocardless/oauth/app/finish", { method: "POST", token, body }))
  return { status: res.status, body: await json(res) }
}

const stateOf = (res: Response) => new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? ""

/** start -> begin -> callback with this browser's cookie: an intent whose code waits, and the handoff its return carried. */
async function returnedIntent(code: string, beginIp = HOME_IP): Promise<{ intentId: string; handoff: string }> {
  const { intentId, beginToken } = await start()
  const opened = await begin(beginToken, beginIp)
  assert.equal(opened.status, 307)
  const state = stateOf(opened)
  const back = await callback({ code, state }, `gc_oauth_app_state=${state}`)
  assert.equal(back.status, 307)
  const handoff = new URL(back.headers.get("location") ?? "").searchParams.get("handoff") ?? ""
  assert.match(handoff, HANDOFF)
  return { intentId, handoff }
}

const intent = (id: string) => {
  const [code, codeReceived, claimed, completed, failed, reason, begun, sameAddress, handoffHeld] = one(`select coalesce(code, '') || '|' || (code_received_at is not null) || '|' || (claimed_at is not null)
    || '|' || (completed_at is not null) || '|' || (failed_at is not null) || '|' || coalesce(failure_reason, '') || '|' || (begin_used_at is not null)
    || '|' || coalesce(begin_same_address::text, 'unknown') || '|' || (return_handoff_hash is not null) from internal.gocardless_connect_intents where id = '${id}';`).split("|")
  return {
    code,
    codeReceived: codeReceived === "true",
    claimed: claimed === "true",
    completed: completed === "true",
    failed: failed === "true",
    reason,
    begun: begun === "true",
    sameAddress,
    handoffHeld: handoffHeld === "true",
  }
}
const intentRow = (id: string) => one(`select row_to_json(i)::text from internal.gocardless_connect_intents i where id = '${id}';`)

const setCookies = (res: Response) => res.headers.getSetCookie()
const cleared = (res: Response, name: string) =>
  setCookies(res).some((c) => c.startsWith(`${name}=;`) && /Path=\/api\/gocardless\/oauth(;|$)/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c))

// ------------------------------------------------------------------------------------------------ tests

describe("GoCardless connect from the app", () => {
  it("T1 the app's start refuses a club that has not agreed the Club Memberships terms, and says so", async () => {
    const before = one(`select count(*) from internal.gocardless_connect_intents where club_id = '${ids.unagreed}';`)
    const { status, body } = await startApp(ids.unagreed)
    assert.equal(status, 409)
    assert.deepEqual(body, { ok: false, reason: "membership_terms", message: TERMS_FIRST })
    assert.equal(one(`select count(*) from internal.gocardless_connect_intents where club_id = '${ids.unagreed}';`), before, "a refused start created an intent")
  })

  it("T2 the website's start refuses the same club in the same words, and sends the agreed club to GoCardless", async () => {
    const { GET } = await import("@/app/api/gocardless/oauth/start/route")
    const cookie = sessionCookie(people.admin)
    const refused = await asWebRequest("/api/gocardless/oauth/start", cookie, () => GET(request(`/api/gocardless/oauth/start?clubId=${ids.unagreed}`, { cookie })))
    assert.equal(refused.status, 307)
    const to = new URL(refused.headers.get("location") ?? "")
    assert.equal(to.pathname, "/club/settings/subscriptions")
    // The address carries a code, never a sentence: the page turns it into the one fixed sentence.
    assert.equal(to.searchParams.get("gc_error"), "terms")
    assert.equal(connectNoticeText("terms"), TERMS_FIRST)
    assert.ok(!setCookies(refused).some((c) => c.startsWith("gc_oauth_state=")), "a refused club was sent on with a state cookie")

    const sent = await asWebRequest("/api/gocardless/oauth/start", cookie, () => GET(request(`/api/gocardless/oauth/start?clubId=${ids.club}`, { cookie })))
    assert.equal(sent.status, 307)
    const authorize = new URL(sent.headers.get("location") ?? "")
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://connect-sandbox.gocardless.com/oauth/authorize")
    assert.ok(setCookies(sent).some((c) => c.startsWith(`gc_oauth_state=${authorize.searchParams.get("state")};`)), "no state cookie for the agreed club")
  })

  it("S1 start refuses a caller with no token, without the permission, or naming a website to return to", async () => {
    const { POST } = await import("@/app/api/gocardless/oauth/app/start/route")
    const before = one(`select count(*) from internal.gocardless_connect_intents where club_id = '${ids.club}';`)
    const anonymous = await POST(request("/api/gocardless/oauth/app/start", { method: "POST", body: { clubId: ids.club, returnUrl: RETURN_URL } }))
    assert.equal(anonymous.status, 401)
    const forged = await POST(request("/api/gocardless/oauth/app/start", { method: "POST", token: "not.a.token", body: { clubId: ids.club, returnUrl: RETURN_URL } }))
    assert.equal(forged.status, 401)
    const stranger = await startApp(ids.club, people.other.token)
    assert.equal(stranger.status, 403)
    assert.match(String(stranger.body.message), /not authorised to connect GoCardless/i)
    for (const returnUrl of ["https://evil.example/collect", "http://localhost:3000/club/settings/subscriptions"]) {
      const website = await startApp(ids.club, people.admin.token, HOME_IP, returnUrl)
      assert.equal(website.status, 400, `${returnUrl} was accepted as a return address`)
      assert.equal(website.body.message, "That return address is not one the Ovalball app uses.")
    }
    const unreadable = await POST(request("/api/gocardless/oauth/app/start", { method: "POST", token: people.admin.token, body: { clubId: "not-a-club", returnUrl: RETURN_URL } }))
    assert.equal(unreadable.status, 400)
    assert.equal(one(`select count(*) from internal.gocardless_connect_intents where club_id = '${ids.club}';`), before, "a refused start created an intent")
  })

  it("B1 begin from another address -- Safari behind iCloud Private Relay, or the other IP family -- goes on to GoCardless, and the difference is only recorded", async () => {
    const { intentId, beginToken } = await start(people.admin.token, HOME_IP)
    const res = await begin(beginToken, AWAY_IP)
    assert.equal(res.status, 307)
    const authorize = new URL(res.headers.get("location") ?? "")
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://connect-sandbox.gocardless.com/oauth/authorize")
    assert.ok(setCookies(res).some((c) => c.startsWith(`gc_oauth_app_state=${authorize.searchParams.get("state")};`)), "no state cookie was set")
    const row = intent(intentId)
    assert.deepEqual([row.begun, row.failed, row.sameAddress], [true, false, "false"])
  })

  it("B2 begin from the starting address sends the browser to GoCardless with the state, in an httpOnly cookie -- once", async () => {
    const { intentId, beginToken } = await start()
    const res = await begin(beginToken)
    assert.equal(res.status, 307)
    const authorize = new URL(res.headers.get("location") ?? "")
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://connect-sandbox.gocardless.com/oauth/authorize")
    assert.equal(authorize.searchParams.get("redirect_uri"), `${SITE}/api/gocardless/oauth/callback`)
    const state = authorize.searchParams.get("state") ?? ""
    assert.match(state, /^[0-9a-f]{48}$/)
    const cookie = setCookies(res).find((c) => c.startsWith("gc_oauth_app_state="))
    assert.ok(cookie, "no state cookie")
    assert.ok(cookie.startsWith(`gc_oauth_app_state=${state};`), "the cookie holds the state GoCardless was given")
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /Path=\/api\/gocardless\/oauth(;|$)/)
    assert.match(cookie, /SameSite=lax/i)
    assert.match(cookie, /Max-Age=600/)
    assert.doesNotMatch(cookie, /Secure/i, "a plain-http request must not get a Secure cookie it would drop")
    assert.equal(res.headers.get("referrer-policy"), "no-referrer")
    assert.deepEqual([intent(intentId).begun, intent(intentId).sameAddress], [true, "true"])

    const again = await begin(beginToken)
    assert.equal(again.status, 400)
    assert.equal(again.headers.get("location"), null)
    assert.ok(!setCookies(again).some((c) => c.startsWith("gc_oauth_app_state=")), "a spent token set a cookie")
    assert.match(await again.text(), /expired or has already been used/)
    assert.ok(!intent(intentId).failed, "a replay disturbed the journey the first use began")
  })

  it("B3 a begin token past its three minutes opens nothing", async () => {
    const { intentId, beginToken } = await start()
    sql(`update internal.gocardless_connect_intents set begin_expires_at = now() - interval '1 second' where id = '${intentId}';`)
    const res = await begin(beginToken)
    assert.equal(res.status, 400)
    assert.equal(res.headers.get("location"), null)
    assert.deepEqual([intent(intentId).failed, intent(intentId).reason], [true, "begin_expired"])
  })

  it("C1 the callback's app branch refuses a missing or a different state cookie and attaches nothing", async () => {
    const { intentId, beginToken } = await start()
    const state = stateOf(await begin(beginToken))

    // No cookie at all: a GoCardless link forwarded into another browser. Nothing in it says "app", so the
    // website's own verification refuses it.
    const missing = await callback({ code: `code_missing_${TAG}`, state })
    assert.equal(missing.status, 307)
    const missingTo = new URL(missing.headers.get("location") ?? "")
    assert.equal(missingTo.pathname, "/club/settings/subscriptions")
    assert.equal(missingTo.searchParams.get("gc_error"), "unverified")
    assert.match(connectNoticeText("unverified") ?? "", /could not be verified/)

    // A different browser's cookie.
    const other = await callback({ code: `code_other_${TAG}`, state }, `gc_oauth_app_state=${randomBytes(24).toString("hex")}`)
    assert.equal(other.status, 400)
    assert.equal(other.headers.get("location"), null)
    assert.match(await other.text(), /could not be verified/)
    assert.ok(cleared(other, "gc_oauth_app_state"), "the app cookie is removed on its own path")

    assert.deepEqual([intent(intentId).code, intent(intentId).codeReceived, intent(intentId).failed, intent(intentId).handoffHeld], ["", false, false, false])
  })

  it("C2 with this browser's own cookie the code is attached and the browser goes back to the app with the intent and a one-time handoff", async () => {
    const { intentId, beginToken } = await start()
    const state = stateOf(await begin(beginToken))
    const code = `code_good_${TAG}`
    const res = await callback({ code, state }, `gc_oauth_app_state=${state}`)
    assert.equal(res.status, 307)
    const location = res.headers.get("location") ?? ""
    assert.match(location, new RegExp(`^${RETURN_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\?intent=${intentId}&result=returned&handoff=[A-Za-z0-9_-]{43}$`))
    assert.ok(!location.includes(code), "the code left the server")
    assert.ok(cleared(res, "gc_oauth_app_state"), "the cookie was not removed")
    const handoff = new URL(location).searchParams.get("handoff") ?? ""
    assert.equal(one(`select (return_handoff_hash = extensions.digest('${handoff}', 'sha256'))::text from internal.gocardless_connect_intents where id = '${intentId}';`), "true")
    assert.ok(!intentRow(intentId).includes(handoff), "the handoff itself is stored")
    assert.deepEqual([intent(intentId).code, intent(intentId).codeReceived], [code, true])

    // A second return for the same state attaches nothing new, and hands out no handoff.
    const replay = await callback({ code: `code_replay_${TAG}`, state }, `gc_oauth_app_state=${state}`)
    assert.equal(replay.headers.get("location"), `${RETURN_URL}?intent=${intentId}&result=error`)
    assert.equal(intent(intentId).code, code)
  })

  it("C3 GoCardless declining sends the browser back to the app with an error and closes the intent", async () => {
    const { intentId, beginToken } = await start()
    const state = stateOf(await begin(beginToken))
    const res = await callback({ error: "access_denied", state }, `gc_oauth_app_state=${state}`)
    assert.equal(res.status, 307)
    assert.equal(res.headers.get("location"), `${RETURN_URL}?intent=${intentId}&result=error`)
    assert.deepEqual([intent(intentId).failed, intent(intentId).reason], [true, "provider_declined"])
  })

  it("C4 the website's own branch refuses as before, and now removes its cookies on the path they were set on", async () => {
    const { GET } = await import("@/app/api/gocardless/oauth/callback/route")
    const mismatch = await GET(request(`/api/gocardless/oauth/callback?code=c&state=${"b".repeat(48)}`, { cookie: `gc_oauth_state=${"a".repeat(48)}; gc_oauth_club_id=${ids.club}` }))
    assert.equal(mismatch.status, 307)
    const to = new URL(mismatch.headers.get("location") ?? "")
    assert.equal(to.pathname, "/club/settings/subscriptions")
    assert.equal(to.searchParams.get("gc_error"), "unverified")
    assert.ok(cleared(mismatch, "gc_oauth_state") && cleared(mismatch, "gc_oauth_club_id"), "the website's cookies were not removed on their own path")

    const declined = await GET(request(`/api/gocardless/oauth/callback?error=access_denied&state=${"a".repeat(48)}`, { cookie: `gc_oauth_state=${"a".repeat(48)}; gc_oauth_club_id=${ids.club}` }))
    // GoCardless's own code ("access_denied") stays out of the page: the person reads that they cancelled.
    assert.equal(new URL(declined.headers.get("location") ?? "").searchParams.get("gc_error"), "cancelled")
    assert.match(connectNoticeText("cancelled") ?? "", /cancelled on GoCardless's page, so nothing was connected/)
    // And whatever else an address carries is never shown: anybody can write a link.
    assert.equal(connectNoticeText("Your club is suspended. Call 0800 000 000."), connectNoticeText("failed"))
    assert.equal(connectNoticeText(undefined), null)
    assert.ok(cleared(declined, "gc_oauth_state"))
    assert.equal(callsTo("/oauth/access_token").length, 0, "the website's refusals reached GoCardless")
  })

  it("F1 without the handoff the person who started it is told to wait, and nothing changes; with a wrong one the intent is void", async () => {
    const { intentId, handoff } = await returnedIntent(`code_wait_${TAG}`)
    const before = intentRow(intentId)
    const waiting = await finish(intentId)
    assert.equal(waiting.status, 409)
    assert.deepEqual([waiting.body.ok, waiting.body.outcome], [false, "awaiting_return"])
    assert.equal(intentRow(intentId), before, "asking without the handoff changed the intent")

    const unreadable = await finish(intentId, "not-a-handoff")
    assert.equal(unreadable.status, 400)
    assert.equal(intentRow(intentId), before, "an unreadable handoff changed the intent")

    const wrong = await finish(intentId, "A".repeat(43))
    assert.equal(wrong.status, 409)
    assert.equal(wrong.body.message, "This GoCardless connection could not be confirmed on this phone. Please try connecting again.")
    assert.deepEqual([intent(intentId).failed, intent(intentId).reason, intent(intentId).code, intent(intentId).handoffHeld], [true, "handoff_mismatch", "", false])
    const late = await finish(intentId, handoff)
    assert.equal(late.body.ok, false, "the right handoff reopened a void intent")
    assert.equal(callsTo("/oauth/access_token").length, 0, "GoCardless was asked to exchange a code")
  })

  it("F2 a different signed-in person cannot finish the app's connection even with the handoff, and voids it for its creator too", async () => {
    const { intentId, handoff } = await returnedIntent(`code_stolen_${TAG}`)
    const stolen = await finish(intentId, handoff, people.other.token)
    assert.equal(stolen.status, 403)
    assert.deepEqual([stolen.body.ok, stolen.body.outcome], [false, "failed"])
    assert.equal(stolen.body.message, "This GoCardless connection was started by a different account.")
    assert.deepEqual([intent(intentId).failed, intent(intentId).reason, intent(intentId).code], [true, "claimed_by_another_account", ""])

    const creator = await finish(intentId, handoff)
    assert.equal(creator.body.ok, false)
    assert.match(String(creator.body.message), /different account tried to finish it/)
    assert.equal(callsTo("/oauth/access_token").length, 0, "a refused finish reached GoCardless")
    assert.equal(one(`select count(*) from public.gocardless_merchant_connections where club_id = '${ids.club}';`), "0")
  })

  it("F3 a code older than GoCardless's five minutes is refused, and never exchanged", async () => {
    const { intentId, handoff } = await returnedIntent(`code_stale_${TAG}`)
    sql(`update internal.gocardless_connect_intents set code_received_at = now() - interval '6 minutes' where id = '${intentId}';`)
    const res = await finish(intentId, handoff)
    assert.equal(res.status, 409)
    assert.equal(res.body.message, "The connection took too long to finish. Please try connecting again.")
    assert.deepEqual([intent(intentId).reason, intent(intentId).code], ["code_expired", ""])
    assert.equal(callsTo("/oauth/access_token").length, 0)
  })

  it("F4 a finish with no token, or for an intent GoCardless never returned to, connects nothing", async () => {
    const { POST } = await import("@/app/api/gocardless/oauth/app/finish/route")
    const anonymous = await POST(request("/api/gocardless/oauth/app/finish", { method: "POST", body: { intentId: randomUUID() } }))
    assert.equal(anonymous.status, 401)

    const { intentId, beginToken } = await start()
    await begin(beginToken)
    const closed = await finish(intentId)
    assert.deepEqual([closed.status, closed.body.outcome, closed.body.message], [409, "cancelled", "GoCardless was not connected."])
    assert.equal(intent(intentId).reason, "not_returned")
    assert.equal(callsTo("/oauth/access_token").length, 0)
  })

  it("F5 a begin link forwarded to another organisation can never be finished by its sender", async () => {
    // The sender starts from their own network and keeps the link. The other organisation's browser -- another
    // network -- opens it, and their consent sends GoCardless's answer back to THAT browser, with the handoff.
    const { intentId, beginToken } = await start(people.admin.token, HOME_IP)
    const opened = await begin(beginToken, "192.0.2.77")
    assert.equal(opened.status, 307, "the forwarded link begins (the address is not what stops it)")
    const theirs = await callback({ code: `code_other_org_${TAG}`, state: stateOf(opened) }, `gc_oauth_app_state=${stateOf(opened)}`)
    assert.match(theirs.headers.get("location") ?? "", /&handoff=[A-Za-z0-9_-]{43}$/)

    // The sender holds everything else -- their session, the intent id -- and gets nothing.
    for (let i = 0; i < 3; i += 1) {
      const asked = await finish(intentId)
      assert.equal(asked.body.outcome, "awaiting_return")
    }
    assert.equal(intent(intentId).claimed, false)
    const guessed = await finish(intentId, randomBytes(32).toString("base64url"))
    assert.equal(guessed.body.ok, false)
    assert.deepEqual([intent(intentId).reason, intent(intentId).code], ["handoff_mismatch", ""])
    assert.equal(callsTo("/oauth/access_token").length, 0, "the other organisation's code was exchanged")
    assert.equal(one(`select count(*) from public.gocardless_merchant_connections where club_id = '${ids.club}';`), "0", "a connection was stored")
  })

  it("F6 with the handoff, the person who started it finishes it: the connection is stored for the intent's club, verified, and the intent completed", async () => {
    const code = `code_final_${TAG}`
    const { intentId, handoff } = await returnedIntent(code, AWAY_IP)
    const res = await finish(intentId, handoff)
    assert.equal(res.status, 200, `finish refused: ${JSON.stringify(res.body)}`)
    assert.deepEqual(res.body, { ok: true, verification: "in_review" })

    const exchange = callsTo("/oauth/access_token").at(-1)
    assert.ok(exchange, "GoCardless was asked to exchange the code")
    const sent = JSON.parse(exchange.body) as Record<string, string>
    assert.deepEqual([sent.code, sent.grant_type, sent.redirect_uri], [code, "authorization_code", `${SITE}/api/gocardless/oauth/callback`])

    const row = one(`select environment || '|' || gc_organisation_id || '|' || (access_token = '${TOKEN}') || '|' || connected_by || '|' || verification_status || '|' || (disconnected_at is null)
      from public.gocardless_merchant_connections where club_id = '${ids.club}';`)
    assert.equal(row, `sandbox|${ORG}|true|${people.admin.id}|in_review|true`)
    const ended = intent(intentId)
    assert.deepEqual([ended.claimed, ended.completed, ended.failed, ended.code, ended.handoffHeld, ended.sameAddress], [true, true, false, "", false, "false"])
    assert.equal(one(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action = 'gocardless_connected' and actor_user_id = '${people.admin.id}';`), "1")

    // Neither the token, the code, the handoff nor the partner secret was printed or answered.
    for (const secret of [TOKEN, code, handoff, `secret_${TAG}`]) {
      assert.ok(!printed.some((line) => line.includes(secret)), `${secret} was printed`)
      assert.ok(!JSON.stringify(res.body).includes(secret), `${secret} was answered`)
    }
  })

  it("G1 a club with live Direct Debits is not moved to a different GoCardless account -- from the app or the website -- and is told so in one fixed sentence", async () => {
    // A live mandate on the account the club is connected to (F6), and a consent for a DIFFERENT account.
    sql(`with c as (insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values ('${ids.club}', '${people.other.id}', 'CU_GCAPP_${TAG}') returning id)
         insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status) select '${ids.club}', id, 'MD_GCAPP_${TAG}', 'active' from c;`)
    exchangeOrg = OTHER_ORG
    exchangeToken = `tok_gcapp_other_${TAG}`
    const revokesBefore = callsTo("/oauth/revoke").length
    try {
      const { intentId, handoff } = await returnedIntent(`code_switch_app_${TAG}`)
      const app = await finish(intentId, handoff)
      assert.equal(app.status, 409)
      assert.deepEqual(app.body, { ok: false, outcome: "failed", message: SWITCH_REFUSED })
      assert.equal(intent(intentId).reason, "organisation_switch_refused")
      assert.equal(callsTo("/oauth/revoke").length, revokesBefore + 1, "the token for the other account was not revoked")
      assert.equal(new URLSearchParams(callsTo("/oauth/revoke").at(-1)?.body ?? "").get("token"), exchangeToken)

      // The website: its own start, then GoCardless's return to its callback, as the signed-in admin.
      const { GET: webStart } = await import("@/app/api/gocardless/oauth/start/route")
      const { GET: webCallback } = await import("@/app/api/gocardless/oauth/callback/route")
      const session = sessionCookie(people.admin)
      const started = await asWebRequest("/api/gocardless/oauth/start", session, () => webStart(request(`/api/gocardless/oauth/start?clubId=${ids.club}`, { cookie: session })))
      const state = stateOf(started)
      const cookie = `${session}; gc_oauth_state=${state}; gc_oauth_club_id=${ids.club}`
      const web = await asWebRequest("/api/gocardless/oauth/callback", cookie, () =>
        webCallback(request(`/api/gocardless/oauth/callback?code=code_switch_web_${TAG}&state=${state}`, { cookie }))
      )
      assert.equal(web.status, 307)
      const to = new URL(web.headers.get("location") ?? "")
      assert.equal(to.pathname, "/club/settings/subscriptions")
      assert.equal(to.searchParams.get("gc_error"), "switch_refused")
      assert.equal(connectNoticeText("switch_refused"), SWITCH_REFUSED)
      assert.ok(cleared(web, "gc_oauth_state") && cleared(web, "gc_oauth_club_id"), "the website's cookies were not removed on their own path")

      assert.equal(one(`select gc_organisation_id || '|' || (access_token = '${TOKEN}') from public.gocardless_merchant_connections where club_id = '${ids.club}';`), `${ORG}|true`,
        "the club's connection moved")
    } finally {
      exchangeOrg = ORG
      exchangeToken = TOKEN
      sql(`update public.gocardless_mandates set status = 'cancelled' where gc_mandate_id = 'MD_GCAPP_${TAG}';`)
    }
  })

  it("D1 the app's disconnect refuses without a token or the permission, then disconnects and revokes the token at GoCardless", async (t) => {
    const { POST } = await import("@/app/api/gocardless/connection/disconnect/route")
    const call = (token: string | undefined, body: unknown) => POST(request("/api/gocardless/connection/disconnect", { method: "POST", token, body }))

    assert.equal((await call(undefined, { clubId: ids.club, reason: "Testing" })).status, 401)
    const stranger = await call(people.other.token, { clubId: ids.club, reason: "Testing" })
    assert.equal(stranger.status, 403)
    assert.deepEqual(await json(stranger), { ok: false, code: "42501", message: "You are not authorised to disconnect GoCardless for this club." })
    assert.equal((await call(people.admin.token, { clubId: ids.club, reason: "   " })).status, 400)
    assert.equal(one(`select (disconnected_at is null)::text from public.gocardless_merchant_connections where club_id = '${ids.club}';`), "true", "a refused disconnect disconnected")

    // The drain empties the whole queue, so it is only run here when the queue holds nothing that is not this run's.
    if (one(`select count(*) from internal.gocardless_token_revocations where club_id is distinct from '${ids.club}';`) !== "0") {
      t.skip("the revocation queue already holds other tokens; refusing to drain someone else's")
      return
    }
    const revokesBefore = callsTo("/oauth/revoke").length
    const res = await call(people.admin.token, { clubId: ids.club, reason: "Moving to a new bank account" })
    assert.equal(res.status, 200)
    assert.deepEqual(await json(res), { ok: true })
    assert.equal(one(`select (disconnected_at is not null)::text || '|' || (access_token is null)::text || '|' || disconnected_by from public.gocardless_merchant_connections where club_id = '${ids.club}';`),
      `true|true|${people.admin.id}`)
    const revokes = callsTo("/oauth/revoke")
    assert.equal(revokes.length, revokesBefore + 1, "GoCardless was asked to revoke once")
    assert.equal(new URLSearchParams(revokes.at(-1)?.body ?? "").get("token"), TOKEN)
    assert.equal(one(`select count(*) from internal.gocardless_token_revocations where club_id = '${ids.club}' or access_token = '${TOKEN}';`), "0", "the token is still queued")
    assert.ok(!printed.some((line) => line.includes(TOKEN)), "the token was printed")

    const again = await call(people.admin.token, { clubId: ids.club, reason: "Again" })
    assert.equal(again.status, 409)
    assert.equal((await json(again)).message, "This club has no GoCardless connection to disconnect.")
  })
})
