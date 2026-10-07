// A DISCONNECTED CLUB'S GOCARDLESS TOKEN IS REVOKED AT GOCARDLESS, AND NEVER LOGGED (20270744000000).
//
// The audit of 5-6 October 2026 proved that disconnecting GoCardless only stamped the connection: the club's
// access token stayed in the row, in plain text, able to act on the club's GoCardless account, and nothing ever
// asked GoCardless to revoke it. Disconnecting now moves the token into a server-only queue in the same
// transaction, and drainGoCardlessTokenRevocations revokes each one at GoCardless and deletes it; one GoCardless
// did not accept stays, with its reason, for the next run. This drives that through the real disconnect door
// (as a Club Admin) and the real drain; only GoCardless itself is stubbed. Everything it creates is removed.

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const TOKEN = `tok_revoke_${TAG}`
const ORG = `OR_REVOKE_${TAG}`

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
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
const gocardlessCalls: { url: string; body: string }[] = []
let revokeStatus = 500
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/gocardless\.com/.test(url)) {
    gocardlessCalls.push({ url, body: typeof init?.body === "string" ? init.body : "" })
    return new Response(revokeStatus === 200 ? "{}" : JSON.stringify({ error: { message: "unavailable" } }), { status: revokeStatus })
  }
  return realFetch(input, init)
}) as typeof fetch

// Everything the code under test prints, so the token can be shown never to be among it.
const printed: string[] = []
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error }
for (const level of ["log", "info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
}

const saved = { env: process.env.GOCARDLESS_ENV, id: process.env.GOCARDLESS_CLIENT_ID, secret: process.env.GOCARDLESS_CLIENT_SECRET }
process.env.GOCARDLESS_ENV = "sandbox"
process.env.GOCARDLESS_CLIENT_ID = `client_${TAG}`
process.env.GOCARDLESS_CLIENT_SECRET = `secret_${TAG}`

const ids: Record<string, string> = {}

/** Everything a run tagged `t` created, by what it is called -- so a crashed earlier run is swept too. */
function cleanup(t: string) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'gc-revoke-${t}');
  v_dir uuid := (select id from public.club_directory where normalized_key = 'gc-revoke-${t}');
  v_user uuid := (select id from auth.users where email = 'gc.revoke.${t}@ovalball.test');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array_remove(array[v_club, v_dir, v_user], null)
    || array(select id from public.gocardless_merchant_connections where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club);
  delete from internal.gocardless_token_revocations where club_id = v_club or access_token like '%${t}%';
  delete from public.notifications where user_id = v_user;
  delete from public.finance_audit_log where club_id = v_club;
  delete from public.security_events where club_id = v_club or actor_user_id = v_user or subject_user_id = v_user;
  delete from public.gocardless_merchant_connections where club_id = v_club;
  delete from public.role_assignments where club_id = v_club or user_id = v_user;
  delete from public.club_memberships where club_id = v_club or user_id = v_user;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
  delete from public.audit_log where record_id = any(v_records) or changed_by = v_user or actor_user_id = v_user;
end $$;`)
}

for (const stale of sql(`select substr(slug, 11) from public.clubs where slug like 'gc-revoke-%'
    union select substr(split_part(email, '@', 1), 11) from auth.users where email like 'gc.revoke.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)

before(() => {
  // The drain empties the whole queue, so it is only run here when the queue holds nothing but this test's row.
  assert.equal(one(`select count(*) from internal.gocardless_token_revocations;`), "0", "the revocation queue already holds tokens; refusing to drain someone else's")
  ids.user = randomUUID()
  sql(`begin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('${ids.user}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gc.revoke.${TAG}@ovalball.test', '', now(), now(), now(),
  '{}', '{}', '', '', '', '', '', '', '', '');
insert into public.profiles (id, first_name, surname, email, date_of_birth) values ('${ids.user}', 'Treasurer', 'Revoke', 'gc.revoke.${TAG}@ovalball.test', (current_date - interval '40 years')::date)
  on conflict (id) do update set date_of_birth = excluded.date_of_birth;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('GC Revoke RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gc-revoke-${TAG}');
insert into public.clubs (directory_id, slug, status) select id, 'gc-revoke-${TAG}', 'active' from public.club_directory where normalized_key = 'gc-revoke-${TAG}';
insert into public.club_memberships (club_id, user_id, role, status) select id, '${ids.user}', 'CLUB_ADMIN', 'active' from public.clubs where slug = 'gc-revoke-${TAG}';
insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
select id, 'sandbox', '${ORG}', '${TOKEN}', 'read_write', '${ids.user}' from public.clubs where slug = 'gc-revoke-${TAG}';
commit;`)
  ids.club = one(`select id from public.clubs where slug = 'gc-revoke-${TAG}';`)
})

after(() => {
  globalThis.fetch = realFetch
  restoreApiEnv()
  Object.assign(console, realConsole)
  for (const [key, value] of [["GOCARDLESS_ENV", saved.env], ["GOCARDLESS_CLIENT_ID", saved.id], ["GOCARDLESS_CLIENT_SECRET", saved.secret]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  cleanup(TAG)
  const left = one(`select (select count(*) from public.clubs where slug = 'gc-revoke-${TAG}') + (select count(*) from auth.users where email = 'gc.revoke.${TAG}@ovalball.test')
    + (select count(*) from internal.gocardless_token_revocations where access_token like '%${TAG}%')
    + (select count(*) from public.gocardless_merchant_connections where gc_organisation_id = '${ORG}');`)
  assert.equal(left, "0", "the test left rows behind")
})

describe("GoCardless token revocation", () => {
  it("R1 a Club Admin's disconnect takes the token out of the connection and queues it, in one transaction", () => {
    sql(`begin;
select set_config('request.jwt.claims', json_build_object('sub', '${ids.user}', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.disconnect_gocardless('${ids.club}', 'Moving the club to a new bank account');
commit;`)
    assert.equal(one(`select (disconnected_at is not null)::text || '|' || (access_token is null)::text from public.gocardless_merchant_connections where gc_organisation_id = '${ORG}';`), "true|true")
    assert.equal(one(`select count(*) from internal.gocardless_token_revocations where club_id = '${ids.club}' and access_token = '${TOKEN}';`), "1")
  })

  it("R2 a revocation GoCardless does not accept stays queued with its reason, and the token is printed nowhere", async () => {
    const { drainGoCardlessTokenRevocations } = await import("@/lib/payments/gocardless/token-revocation")
    revokeStatus = 500
    const result = await drainGoCardlessTokenRevocations()
    assert.deepEqual(result, { revoked: 0, failed: 1 })
    const call = gocardlessCalls.at(-1)
    assert.ok(call, "GoCardless was asked")
    assert.equal(new URL(call.url).origin + new URL(call.url).pathname, "https://connect-sandbox.gocardless.com/oauth/revoke")
    assert.equal(new URLSearchParams(call.body).get("token"), TOKEN)
    const [attempts, reason] = one(`select attempts || '|' || coalesce(last_error, '') from internal.gocardless_token_revocations where club_id = '${ids.club}';`).split("|")
    assert.equal(attempts, "1")
    assert.match(reason, /500/)
    assert.ok(!reason.includes(TOKEN), "the stored reason does not carry the token")
    assert.ok(!printed.some((line) => line.includes(TOKEN)), "the token was printed")
  })

  it("R3 the next run revokes it, and the token then exists nowhere in the database", async () => {
    const { drainGoCardlessTokenRevocations } = await import("@/lib/payments/gocardless/token-revocation")
    revokeStatus = 200
    const result = await drainGoCardlessTokenRevocations()
    assert.deepEqual(result, { revoked: 1, failed: 0 })
    assert.equal(one(`select count(*) from internal.gocardless_token_revocations where club_id = '${ids.club}';`), "0")
    assert.equal(one(`select (select count(*) from public.gocardless_merchant_connections where access_token = '${TOKEN}')
      + (select count(*) from internal.gocardless_token_revocations where access_token = '${TOKEN}');`), "0")
    assert.ok(!printed.some((line) => line.includes(TOKEN)), "the token was printed")
  })

  it("R4 no signed-in person can read the queue or claim from it", () => {
    const refused = (q: string) => {
      try {
        sql(`begin; select set_config('request.jwt.claims', json_build_object('sub', '${ids.user}', 'role', 'authenticated')::text, true); set local role authenticated; ${q}; rollback;`)
        return false
      } catch (error) {
        return /permission denied/.test(String((error as { stderr?: string }).stderr ?? error))
      }
    }
    assert.ok(refused(`select * from internal.gocardless_token_revocations`), "a Club Admin could read the queue")
    assert.ok(refused(`select * from public.claim_gocardless_token_revocations(1)`), "a Club Admin could claim tokens")
  })
})
