// =====================================================================
// RECENT AAL2 -- THE AUTHORITY BEHIND SITE ADMIN MASTER CONTROL (Stage 0.3)
//
// Every Q.3 master-control RPC passes through internal.master_control_preamble,
// which calls internal.require_recent_aal2(interval '10 minutes'). Until a TOTP
// factor existed anywhere, that gate could only ever be proved from one side:
// everything was refused, and a suite that only ever sees refusals cannot tell a
// working boundary from a broken feature. This is the other side.
//
// The factor here is REAL. It is enrolled, challenged and verified through
// GoTrue's own API with a code computed from the secret it hands back -- exactly
// what an authenticator app does -- so the AAL2 session is genuine rather than
// asserted. No production session, no production secret, and the secrets this
// creates are destroyed with the identities that hold them.
//
// The distinction this pins is the one that is easy to lose: the gate is not
// "does this person have a factor", it is "did this SESSION present a code
// recently". A1-A5 prove those are different things, and C1-C3 prove the
// freshness window belongs to the verification rather than to the session.
//
// The ten-minute boundary is exercised by ageing the amr claim GoTrue wrote,
// which is the record the predicate actually reads -- not by sleeping, and not
// by writing an AAL2 claim that never happened.
// =====================================================================
import { execFileSync } from "node:child_process"
import { totp } from "../security/totp.mjs"

const C = "supabase_db_ovalball-saas-startup"
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const TAG = Math.random().toString(36).slice(2, 7)
const sql = (q) => execFileSync("docker", ["exec","-i",C,"psql","-U","postgres","-d","postgres","-Atq","-c",q], { encoding: "utf8" }).trim()

let pass = 0, fail = 0
const record = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`PASS  ${label}${detail ? `  -- ${detail}` : ""}`) }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  -- ${detail}` : ""}`) }
}

const api = async (path, { method = "POST", token, body } = {}) => {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { status: res.status, json }
}

// --- fixture identities, created through the admin API and destroyed at the end
const MINE = `s03.%.${TAG}@ovalball.test`
async function makeUser(slug, password) {
  const email = `s03.${slug}.${TAG}@ovalball.test`
  const r = await api("/auth/v1/admin/users", {
    token: SERVICE,
    body: { email, password, email_confirm: true },
  })
  if (!r.json?.id) throw new Error(`could not create ${slug}: ${JSON.stringify(r.json).slice(0, 160)}`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
       values ('${r.json.id}', 'Stage', '${slug}', '${email}', '1985-02-02', 'ACTIVE')
       on conflict (id) do update set account_state='ACTIVE';
       select internal.refresh_account_security_state('${r.json.id}');`)
  return { id: r.json.id, email, password }
}
const makeSiteAdmin = (id, profile) =>
  sql(`insert into public.site_admins (user_id, status, profile_key, admin_role) values ('${id}','active','${profile}','${profile}')`)

const signIn = async (u) => {
  const r = await api("/auth/v1/token?grant_type=password", { body: { email: u.email, password: u.password } })
  if (!r.json?.access_token) throw new Error(`sign-in failed: ${JSON.stringify(r.json).slice(0, 160)}`)
  return r.json
}
const aalOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).aal
const sessionOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).session_id

/** Enrol, challenge and verify a real TOTP factor. Returns the upgraded session. */
async function enrolAndVerify(token) {
  const enrol = await api("/auth/v1/factors", { token, body: { factor_type: "totp", friendly_name: `stage03-${TAG}` } })
  const factorId = enrol.json?.id
  const secret = enrol.json?.totp?.secret
  if (!factorId || !secret) throw new Error(`enrol failed: ${JSON.stringify(enrol.json).slice(0, 200)}`)
  const verified = await verifyFactor(token, factorId, secret)
  return { factorId, secret, ...verified }
}
async function verifyFactor(token, factorId, secret) {
  const challenge = await api(`/auth/v1/factors/${factorId}/challenge`, { token })
  const challengeId = challenge.json?.id
  // A code is valid for a 30-second window; if we are close to the boundary the
  // next attempt uses the next step rather than retrying the same digits.
  for (const offset of [0, 30_000]) {
    const code = totp(secret, Date.now() + offset)
    const v = await api(`/auth/v1/factors/${factorId}/verify`, { token, body: { challenge_id: challengeId, code } })
    if (v.json?.access_token) return { token: v.json.access_token, factorId }
  }
  throw new Error("verify failed for both time steps")
}

/** The master-control RPC under test. Refusals come back as a PostgREST error. */
const masterControl = (token, targetId, state = "ACTIVE") =>
  api("/rest/v1/rpc/site_set_account_state", {
    token,
    body: { p_user_id: targetId, p_state: state, p_reason: "Stage 0.3 authority proof, automated." },
  })
const refused = (r) => r.status >= 400 && /authenticator|not authorised|permission|42501/i.test(JSON.stringify(r.json))

try {
  const admin = await makeUser("admin", `Stage03!${TAG}aA`)
  const weak = await makeUser("weak", `Stage03!${TAG}bB`)
  const target = await makeUser("target", `Stage03!${TAG}cC`)
  makeSiteAdmin(admin.id, "SITE_FULL")
  makeSiteAdmin(weak.id, "SITE_DATA")

  // ---------------------------------------------------------------- AAL1
  const aal1 = await signIn(admin)
  record(aalOf(aal1.access_token) === "aal1", "A1 a password sign-in starts at AAL1", aalOf(aal1.access_token))
  let r = await masterControl(aal1.access_token, target.id, "SUSPENDED")
  record(refused(r), "A2 AAL1 + full site authority is REFUSED a master-control action", `${r.status} ${JSON.stringify(r.json?.message ?? r.json).slice(0, 70)}`)

  // A verified factor EXISTING is not the same as having used it.
  const { factorId, secret, token: aal2 } = await enrolAndVerify(aal1.access_token)
  record(sql(`select status from auth.mfa_factors where id = '${factorId}'`) === "verified", "A3 the factor really is verified in GoTrue")
  const stillAal1 = await signIn(admin)
  record(aalOf(stillAal1.access_token) === "aal1", "A4 a NEW password sign-in is still AAL1 even though a verified factor exists")
  r = await masterControl(stillAal1.access_token, target.id, "SUSPENDED")
  record(refused(r), "A5 and is still refused -- possessing a factor is not the same as having presented it")

  // ---------------------------------------------------------------- AAL2
  record(aalOf(aal2) === "aal2", "B1 presenting the code upgrades the session to AAL2", aalOf(aal2))
  r = await masterControl(aal2, target.id, "SUSPENDED")
  record(r.status < 400, "B2 and the same operation now SUCCEEDS", `${r.status}`)
  record(sql(`select account_state from public.profiles where id = '${target.id}'`) === "SUSPENDED",
    "B3 with a real effect on canonical state, not just a 200")

  // ------------------------------------------------------- the 10-minute window
  const sess = sessionOf(aal2)
  sql(`update auth.mfa_amr_claims set updated_at = now() - interval '11 minutes'
        where session_id = '${sess}' and authentication_method = 'totp'`)
  r = await masterControl(aal2, target.id, "ACTIVE")
  record(refused(r), "C1 the SAME AAL2 session is refused once its verification is 11 minutes old")

  sql(`update auth.mfa_amr_claims set updated_at = now() - interval '9 minutes'
        where session_id = '${sess}' and authentication_method = 'totp'`)
  r = await masterControl(aal2, target.id, "ACTIVE")
  record(r.status < 400, "C2 and allowed again at 9 minutes -- the boundary is the freshness of the check, not the session")

  sql(`update auth.mfa_amr_claims set updated_at = now() - interval '11 minutes'
        where session_id = '${sess}' and authentication_method = 'totp'`)
  const reverified = await verifyFactor(aal2, factorId, secret)
  r = await masterControl(reverified.token, target.id, "ACTIVE")
  record(r.status < 400, "C3 presenting a fresh code restores it")

  // ------------------------------------------------- capability, session, identity
  const weakSession = await signIn(weak)
  const weakAal2 = await enrolAndVerify(weakSession.access_token)
  record(aalOf(weakAal2.token) === "aal2", "D1 a narrower Site Admin can reach AAL2 too")
  r = await masterControl(weakAal2.token, target.id, "SUSPENDED")
  record(refused(r), "D2 but is refused for want of the CAPABILITY -- MFA is not a substitute for authority")

  const targetSession = await signIn(target)
  r = await masterControl(targetSession.access_token, admin.id, "SUSPENDED")
  record(refused(r), "D3 and somebody who is no kind of Site Admin is refused outright")

  sql(`delete from auth.sessions where id = '${sessionOf(reverified.token)}'`)
  r = await masterControl(reverified.token, target.id, "SUSPENDED")
  record(refused(r), "D4 a revoked session is refused even though its JWT has not expired")
} catch (err) {
  record(false, "harness completed without throwing", String(err).slice(0, 200))
} finally {
  // Statement by statement, because one refusal must not abort the rest --
  // public.audit_log is append-only BY DESIGN and is deliberately not touched.
  // The secrets are what matter here, and they go.
  const tidy = (statement) => { try { sql(statement) } catch { /* keep going */ } }
  tidy(`delete from auth.mfa_amr_claims a using auth.sessions s, auth.users u
          where a.session_id = s.id and s.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from auth.mfa_challenges c using auth.mfa_factors f, auth.users u
          where c.factor_id = f.id and f.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from auth.mfa_factors f using auth.users u where f.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from auth.sessions s using auth.users u where s.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from public.site_admins sa using auth.users u where sa.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from public.security_events e using auth.users u where e.actor_user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from public.profiles p using auth.users u where p.id = u.id and u.email like '${MINE}'`)
  tidy(`delete from auth.identities i using auth.users u where i.user_id = u.id and u.email like '${MINE}'`)
  tidy(`delete from auth.users where email like '${MINE}'`)

  // THE SECRET IS THE THING. A TOTP secret and an AAL2 session are what this
  // harness created that must not outlive it. An auth.users row whose audit
  // history keeps it alive is inert -- no factor, no session, no site admin row.
  record(sql(`select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id
               where u.email like '${MINE}'`) === "0",
    "Z1 every TOTP secret this harness created is destroyed")
  record(sql(`select count(*) from auth.sessions s join auth.users u on u.id = s.user_id
               where u.email like '${MINE}'`) === "0",
    "Z2 and every session with it")
  record(sql(`select count(*) from public.site_admins sa join auth.users u on u.id = sa.user_id
               where u.email like '${MINE}'`) === "0",
    "Z3 and no site admin row is left behind")
  const remaining = sql(`select count(*) from auth.users where email like '${MINE}'`)
  if (remaining !== "0") {
    console.log(`NOTE  ${remaining} inert identity row(s) remain: public.audit_log is append-only by design, so an identity that acted cannot be deleted. No factor, session or authority remains on them.`)
  }
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail === 0 ? 0 : 1)
