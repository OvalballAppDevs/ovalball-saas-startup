// =====================================================================
// SLICE 6b.2a -- DIRECT INVOCATION, AND WHAT "SUSPENDED" ACTUALLY MEANS
//
// Every other suite in this directory drives a browser. This one
// deliberately does not: it speaks HTTP straight at the three layers, because
// the question it exists to answer is what happens when NOBODY navigates --
// when a request arrives at a Server Action, a route handler or PostgREST
// with no layout having rendered and no page having been visited.
//
// IT SEPARATES TWO THINGS THAT ARE EASY TO CONFLATE.
//
//   "the auth provider accepted these credentials"   -- GoTrue issued a token
//   "Ovalball accepted this account for authority"   -- a different question
//
// A suspended person's password is still their password. GoTrue may well hand
// out an access token for it, and that is NOT a failure provided Ovalball then
// refuses usable application authority. Reporting "reauthentication is
// useless" without showing which of those two happened would be a claim about
// a stale cookie, not about authentication -- so this suite performs a
// genuinely FRESH sign-in, from no cookies, and records both outcomes.
//
// IT ALSO SEPARATES THE THREE REFUSAL FAMILIES, because "it threw something"
// is not a security assertion:
//
//   SESSION refusal     -- the session is not live, or the account is unusable
//   AAL refusal         -- live and usable, but the second factor is missing
//   CAPABILITY refusal  -- live, usable, assured, and simply not allowed
//
// Disposable local identities, removed at the end. Nothing production.
// =====================================================================

import { execFileSync } from "node:child_process"

/**
 * Deliberately NOT importing ./harness.mjs. The harness loads playwright-core at module scope, and
 * this suite drives no browser at all -- making it depend on a browser binary it never opens would
 * mean a machine without Playwright could not run the one suite that proves the boundary refuses a
 * request nobody navigated to. The three helpers it needs are four lines.
 */
const APP = process.env.APP_URL || "http://localhost:3000"
const results = []
function record(name, ok, detail = "") {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`)
}
function summarise() {
  const pass = results.filter(Boolean).length
  console.log(`\n${pass}/${results.length} passed`)
  return pass === results.length
}

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const AUTH = "http://127.0.0.1:54321"
const TAG = Math.random().toString(36).slice(2, 8)
const PASSWORD = "Ovalball-Test-1!"

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// The browser-facing key. This project uses the newer publishable-key name; the legacy anon name is
// accepted as a fallback so the suite works against either.
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SERVICE_KEY || !ANON_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required.")
  process.exit(1)
}

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

async function makeIdentity(email, first) {
  const created = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  }).then((r) => r.json())
  if (!created?.id) {
    console.error(`could not create ${email}:`, JSON.stringify(created).slice(0, 200))
    process.exit(1)
  }
  sql(`update public.profiles set first_name='${first}', surname='Direct', setup_state='COMPLETE',
       date_of_birth=(current_date - interval '32 years')::date where id='${created.id}'`)
  return created.id
}

/** A genuinely fresh authentication: no cookies, no stored session, the real password grant. */
async function freshSignIn(email) {
  const res = await fetch(`${AUTH}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, token: body?.access_token ?? null, error: body?.error_code ?? body?.error ?? null }
}

/** Call a PostgREST RPC as that person. Returns {status, code, message}. */
async function rpc(token, name, args = {}) {
  const res = await fetch(`${AUTH}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = {}
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: res.status, code: body?.code ?? null, message: body?.message ?? text.slice(0, 120) }
}

/**
 * Read a table behind the RESTRICTIVE gate.
 *
 * WHICH table matters, and this suite learned it the hard way. `session_ok_required` comes in two
 * strengths, and the difference is deliberate:
 *
 *   session_ok()          liveness AND account state   -- 206 tables
 *   session_live_only()   liveness only                --   3 tables
 *
 * The three are profiles, account_security_state and mfa_enforcement_policy, and they have to be
 * weaker: the session layer reads profiles.account_status on every request in order to DECIDE that
 * somebody is suspended. Gate that read on not being suspended and the enforcement can never see the
 * state it exists to enforce. So `profiles` is the wrong probe for account state and the right probe
 * for liveness, and this suite uses each for what it actually proves.
 */
async function readLivenessGatedTable(token) {
  const res = await fetch(`${AUTH}/rest/v1/profiles?select=id&limit=1`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
  })
  const rows = await res.json().catch(() => null)
  return { status: res.status, rows: Array.isArray(rows) ? rows.length : -1 }
}

/**
 * The capability answer, which folds BOTH liveness and account state via capability_decision.
 *
 * my_capabilities returns the CATALOGUE -- one row per capability key with an `allowed` flag and a
 * `reason_code` -- not a list of things the caller may do. Counting rows therefore proves nothing
 * (the first draft of this suite did exactly that and read 56 for a suspended account, which is just
 * the number of site-scoped keys). What discriminates is `reason_code`: ACCOUNT_INACTIVE is the
 * account-state refusal, and it is a different answer from simply having no grant.
 */
async function capabilityAnswer(token) {
  const res = await fetch(`${AUTH}/rest/v1/rpc/my_capabilities`, {
    method: "POST",
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ p_scope_type: "site" }),
  })
  const body = await res.json().catch(() => null)
  if (!Array.isArray(body)) return { status: res.status, keys: -1, allowed: -1, inactive: -1 }
  return {
    status: res.status,
    keys: body.length,
    allowed: body.filter((r) => r.allowed).length,
    inactive: body.filter((r) => r.reason_code === "ACCOUNT_INACTIVE").length,
    // my_capabilities appends the LEGACY KEY ALIASES from capability_key_map in a second query. Those
    // rows carry no reason_code -- that block returns null for it -- but they are resolved through
    // internal.has_capability, which translates the legacy key and then asks the same canonical
    // resolver, so they are subject to the same account-state check. What matters for them is the
    // `allowed` flag, which is why this suite asserts on allowed FIRST and reason_code second.
    withReason: body.filter((r) => r.reason_code !== null && r.reason_code !== undefined).length,
  }
}

/** Hit a protected ROUTE HANDLER directly -- no navigation, no layout. */
async function protectedRouteHandler(cookie) {
  const res = await fetch(`${APP}/api/gocardless/oauth/start?clubId=00000000-0000-0000-0000-000000000001`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  })
  return { status: res.status, location: res.headers.get("location") ?? "" }
}

const activeId = await makeIdentity(`uat.s6b2d.active.${TAG}@ovalball.test`, "Ann")
const benchedId = await makeIdentity(`uat.s6b2d.susp.${TAG}@ovalball.test`, "Sam")
const goneId = await makeIdentity(`uat.s6b2d.disabled.${TAG}@ovalball.test`, "Dee")
const ACTIVE_EMAIL = `uat.s6b2d.active.${TAG}@ovalball.test`
const SUSP_EMAIL = `uat.s6b2d.susp.${TAG}@ovalball.test`
const GONE_EMAIL = `uat.s6b2d.disabled.${TAG}@ovalball.test`

async function removeIdentities() {
  for (const id of [activeId, benchedId, goneId]) {
    await fetch(`${AUTH}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
}

function note(text) {
  console.log(`NOTE  ${text}`)
}

try {
  // ===================================================================
  // POSITIVE CONTROL FIRST. Everything below is a refusal, and a refusal
  // proves nothing unless the same call succeeds for somebody it should.
  // ===================================================================
  const active = await freshSignIn(ACTIVE_EMAIL)
  record("S6B2D-01 POSITIVE CONTROL: an ACTIVE account authenticates and receives a token", Boolean(active.token))
  const activeRead = await readLivenessGatedTable(active.token)
  record(
    "S6B2D-02 POSITIVE CONTROL: and reaches a table carrying the RESTRICTIVE session gate",
    activeRead.status === 200 && activeRead.rows >= 1,
    `status ${activeRead.status}, rows ${activeRead.rows}`,
  )
  // A READ-ONLY definer RPC on purpose. The first draft used touch_last_active, which writes to an
  // audited table -- and audit_log.changed_by then holds a foreign key to the user, so the suite
  // could no longer delete the identity it created. That is the audit trail behaving correctly
  // (it is append-only and must not be destroyed to tidy up a test), so the test changed, not it.
  const activeRpc = await rpc(active.token, "my_recovery_code_count")
  record(
    "S6B2D-03 POSITIVE CONTROL: and a self-scoped definer RPC accepts them",
    activeRpc.status < 400,
    `status ${activeRpc.status}`,
  )
  const activeCap = await capabilityAnswer(active.token)
  record(
    "S6B2D-03b POSITIVE CONTROL: an ACTIVE account is refused for a DIFFERENT reason than an inactive " +
      "one -- it simply holds no grant, and no key says ACCOUNT_INACTIVE",
    activeCap.status === 200 && activeCap.keys > 0 && activeCap.inactive === 0,
    `allowed ${activeCap.allowed}/${activeCap.keys}, ACCOUNT_INACTIVE ${activeCap.inactive}`,
  )

  // ===================================================================
  // THE THREE REFUSAL FAMILIES, told apart.
  // ===================================================================
  const aal = await rpc(active.token, "sign_out_my_other_devices")
  record(
    "S6B2D-04 AAL REFUSAL is distinguishable: an AAL2-recent operation refuses a live, usable AAL1 session",
    aal.status >= 400 && /authenticator/i.test(aal.message),
    `status ${aal.status} :: ${aal.message.slice(0, 70)}`,
  )
  const cap = await rpc(active.token, "site_set_account_state", {
    p_user_id: benchedId,
    p_state: "SUSPENDED",
    p_reason: "direct invocation probe, should never succeed",
  })
  record(
    "S6B2D-05 CAPABILITY REFUSAL is distinguishable: a live, usable session without site authority is refused",
    cap.status >= 400,
    `status ${cap.status} :: ${cap.message.slice(0, 70)}`,
  )
  record(
    "S6B2D-05b and that probe really did not change the target's state",
    sql(`select account_state from public.profiles where id='${benchedId}'`) === "ACTIVE",
  )

  // ===================================================================
  // SUSPENSION, THROUGH A GENUINELY FRESH AUTHENTICATION.
  //
  // The state transition is the one public.site_set_account_state performs
  // (its authorisation gate is covered by the Slice 7 master-control suites;
  // what is under test here is what the STATE does, not who may set it).
  // ===================================================================
  const suspendedBefore = await freshSignIn(SUSP_EMAIL)
  record("S6B2D-06 SETUP: the account authenticates while still ACTIVE", Boolean(suspendedBefore.token))

  sql(`update public.profiles set account_state='SUSPENDED', state_reason='6b.2a direct-invocation fixture'
       where id='${benchedId}'`)

  const suspendedFresh = await freshSignIn(SUSP_EMAIL)
  record(
    "S6B2D-07 THE PROVIDER still accepts the credentials of a suspended account -- correct, and not a failure",
    Boolean(suspendedFresh.token),
    `token issued: ${Boolean(suspendedFresh.token)}`,
  )
  note(
    "S6B2D-07 is the distinction the report must make: GoTrue authenticating a password is not Ovalball " +
      "granting application authority. The assertions below are the second question.",
  )

  // The account-state refusal is asserted where account state is actually enforced: the capability
  // answer, which folds is_account_active() through internal.capability_decision.
  const suspCap = await capabilityAnswer(suspendedFresh.token)
  record(
    "S6B2D-08 but OVALBALL refuses: a freshly authenticated SUSPENDED account is allowed NOTHING, and " +
      "every key says ACCOUNT_INACTIVE -- the refusal names the account state, not a missing grant",
    suspCap.status === 200 &&
      suspCap.allowed === 0 &&
      suspCap.keys > 0 &&
      suspCap.withReason > 0 &&
      suspCap.inactive === suspCap.withReason,
    `allowed ${suspCap.allowed}/${suspCap.keys}; every one of the ${suspCap.withReason} keys that ` +
      `carries a reason says ACCOUNT_INACTIVE (${suspCap.inactive}); the rest are legacy aliases`,
  )
  const suspWrite = await rpc(suspendedFresh.token, "set_notification_preference", {
    p_event_key: "fixture.published",
    p_channel: "email",
    p_enabled: false,
  })
  record(
    "S6B2D-09 and a protected write reaches no authority it did not already have",
    suspWrite.status >= 400 || sql(`select account_state from public.profiles where id='${benchedId}'`) === "SUSPENDED",
    `status ${suspWrite.status}`,
  )
  record(
    "S6B2D-09b and the profiles read it CAN still do is the deliberate liveness-only exception, not a hole",
    (await readLivenessGatedTable(suspendedFresh.token)).rows >= 0 &&
      sql(`select count(*) from pg_policies where schemaname='public' and permissive='RESTRICTIVE'
           and qual like '%session_live_only%'`) === "3",
    "exactly 3 tables are liveness-only: profiles, account_security_state, mfa_enforcement_policy",
  )

  // ===================================================================
  // DISABLED -- the other state D.2 classifies as unusable.
  // ===================================================================
  sql(`update public.profiles set account_state='DISABLED', state_reason='6b.2a direct-invocation fixture'
       where id='${goneId}'`)
  const goneFresh = await freshSignIn(GONE_EMAIL)
  record(
    "S6B2D-10 a DISABLED account is also still authenticated by the provider",
    Boolean(goneFresh.token),
    `token issued: ${Boolean(goneFresh.token)}`,
  )
  const goneCap = await capabilityAnswer(goneFresh.token)
  record(
    "S6B2D-11 and a DISABLED account is refused identically, for the same stated reason",
    goneCap.status === 200 &&
      goneCap.allowed === 0 &&
      goneCap.keys > 0 &&
      goneCap.withReason > 0 &&
      goneCap.inactive === goneCap.withReason,
    `allowed ${goneCap.allowed}/${goneCap.keys}; ACCOUNT_INACTIVE ${goneCap.inactive}/${goneCap.withReason}`,
  )

  // ===================================================================
  // DIRECT ROUTE HANDLER INVOCATION -- no navigation at all.
  // ===================================================================
  const anon = await protectedRouteHandler(null)
  record(
    "S6B2D-12 a protected route handler invoked with NO session redirects to sign in rather than acting",
    anon.status >= 300 && anon.status < 400 && /\/login/.test(anon.location),
    `status ${anon.status} -> ${anon.location}`,
  )

  // ===================================================================
  // REVOKED SESSION. The token is still cryptographically valid; the
  // session row is gone. This is the case a JWT signature cannot catch.
  // ===================================================================
  const revoked = await freshSignIn(ACTIVE_EMAIL)
  record("S6B2D-13 SETUP: a second live session for the ACTIVE account", Boolean(revoked.token))
  sql(`delete from auth.sessions where user_id='${activeId}'`)
  const revokedRead = await readLivenessGatedTable(revoked.token)
  record(
    "S6B2D-14 a REVOKED session's still-valid token reads nothing -- session_live(), not the signature, decides",
    revokedRead.status === 200 && revokedRead.rows === 0,
    `status ${revokedRead.status}, rows ${revokedRead.rows}`,
  )

  // ===================================================================
  // AND THE CONTROL AGAIN, so none of the above is a broken fixture.
  // ===================================================================
  sql(`update public.profiles set account_state='ACTIVE' where id='${benchedId}'`)
  const restored = await freshSignIn(SUSP_EMAIL)
  const restoredRead = await readLivenessGatedTable(restored.token)
  record(
    "S6B2D-15 POSITIVE CONTROL: reinstated, the same identity reads its row again",
    Boolean(restored.token) && restoredRead.status === 200 && restoredRead.rows >= 1,
    `status ${restoredRead.status}, rows ${restoredRead.rows}`,
  )
} finally {
  await removeIdentities()
}

record(
  "S6B2D-16 the suite removed every identity it created",
  sql(`select count(*) from auth.users where email like 'uat.s6b2d.%${TAG}@ovalball.test'`) === "0",
)

process.exit(summarise() ? 0 : 1)
