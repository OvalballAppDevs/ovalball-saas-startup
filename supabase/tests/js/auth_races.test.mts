/**
 * AUTHENTICATION RACES (Identity/Auth Slice 6, Phase 2 AH R13, R14, R17)
 *
 * Two real psql sessions, running at the same time against the same rows. Not one session pretending:
 * a race simulated sequentially proves the code runs, not that the lock holds.
 *
 *   R13  a session is revoked while a request is in flight
 *   R14  an account is suspended while a request is in flight
 *   R17  the same recovery code is redeemed twice at once
 *
 * R17 is the one that would actually cost something. A recovery code bypasses the second factor, so a
 * code that can be consumed twice is a second factor that can be bypassed twice -- and the natural
 * implementation, "look it up, then mark it used", loses that race.
 *
 * Everything created here is removed at the end, including its audit history.
 */

import assert from "node:assert/strict"
import { after, test } from "node:test"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)

function sql(q: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"],
    { input: q, encoding: "utf8" },
  ).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

interface Session { proc: ChildProcessWithoutNullStreams; done: Promise<string> }
function session(name: string, script: string): Session {
  const proc = spawn("docker", ["exec", "-i", "-e", `PGAPPNAME=${name}`, CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=0"])
  let out = ""
  proc.stdin.on("error", (e) => (out += `\nstdin: ${e.message}`))
  proc.stdout.on("data", (d) => (out += d))
  proc.stderr.on("data", (d) => (out += d))
  const done = new Promise<string>((resolve) => proc.on("close", () => resolve(out)))
  proc.stdin.write(script)
  proc.stdin.end()
  return { proc, done }
}

const email = (n: string) => `arace-${TAG}-${n}@ovalball.test`
const ids = { alice: randomUUID(), bob: randomUUID() }

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(label)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
    values ('${id}', 'Arace', '${label}', '${email(label)}', (current_date - interval '33 years')::date, 'ACTIVE')
    on conflict (id) do update set account_state = 'ACTIVE';
    select internal.refresh_account_security_state('${id}');`)
}
person(ids.alice, "alice")
person(ids.bob, "bob")

const asUser = (id: string, sessionId?: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated" })}'::text, true);\n`.replace(
    '"role":"authenticated"}',
    sessionId ? `"role":"authenticated","session_id":"${sessionId}"}` : '"role":"authenticated"}',
  )

test("R17 the same recovery code redeemed twice at once is consumed exactly once", async () => {
  // Ten codes, and both sessions will go for the same one.
  const codes = sql(`select unnest(internal.generate_recovery_codes('${ids.alice}'))`)
    .split("\n").map((l) => l.trim()).filter(Boolean)
  const target = codes[0]

  const script = `begin;\nselect pg_sleep(0.05);\nselect internal.redeem_recovery_code('${ids.alice}', '${target}');\ncommit;\n`
  const [a, b] = [session(`arace_r17a_${TAG}`, script), session(`arace_r17b_${TAG}`, script)]
  const [oa, ob] = await Promise.all([a.done, b.done])
  const ctx = `A:${oa}\nB:${ob}`

  // Exactly one `t` across the two sessions. Two would mean the second factor can be bypassed twice.
  const successes = [oa, ob].filter((o) => /^\s*t\s*$/m.test(o)).length
  assert.equal(successes, 1, `the code was accepted ${successes} times\n${ctx}`)

  assert.equal(
    one(`select count(*) from public.account_recovery_codes where user_id='${ids.alice}' and used_at is not null`),
    "1",
    `more than one code row was consumed\n${ctx}`,
  )
  assert.equal(
    one(`select count(*) from public.account_recovery_codes where user_id='${ids.alice}' and used_at is null`),
    "9",
    `the wrong number of codes remain\n${ctx}`,
  )
})

test("R13 a session revoked mid-flight is refused on its next statement", async () => {
  const sessionId = one(`insert into auth.sessions (id, user_id, created_at, updated_at, aal)
                         values (gen_random_uuid(), '${ids.bob}', now(), now(), 'aal1') returning id`)

  // One session holds a transaction open across a revocation performed by the other.
  const holder = session(
    `arace_r13_hold_${TAG}`,
    `begin;
${asUser(ids.bob, sessionId)}select internal.session_ok() as before_revoke;
select pg_sleep(0.6);
select internal.session_ok() as after_revoke;
commit;
`,
  )
  const revoker = session(
    `arace_r13_rev_${TAG}`,
    `select pg_sleep(0.25);\nselect internal.revoke_session('${sessionId}');\n`,
  )

  const [held, revoked] = await Promise.all([holder.done, revoker.done])
  const ctx = `HOLD:${held}\nREVOKE:${revoked}`

  const answers = held.split("\n").map((l) => l.trim()).filter((l) => l === "t" || l === "f")
  assert.equal(answers[0], "t", `the session should have worked before revocation\n${ctx}`)
  assert.equal(answers[1], "f", `a revoked session must be refused on its next statement\n${ctx}`)
  assert.equal(one(`select count(*) from auth.sessions where id='${sessionId}'`), "0", "the session row is gone")
})

test("R14 an account suspended mid-flight is refused on its next statement", async () => {
  const sessionId = one(`insert into auth.sessions (id, user_id, created_at, updated_at, aal)
                         values (gen_random_uuid(), '${ids.alice}', now(), now(), 'aal1') returning id`)
  sql(`update public.profiles set account_state='ACTIVE' where id='${ids.alice}'`)

  const holder = session(
    `arace_r14_hold_${TAG}`,
    `begin;
${asUser(ids.alice, sessionId)}select internal.session_ok() as before_suspend;
select pg_sleep(0.6);
select internal.session_ok() as after_suspend;
commit;
`,
  )
  const suspender = session(
    `arace_r14_sus_${TAG}`,
    `select pg_sleep(0.25);\nupdate public.profiles set account_state='SUSPENDED' where id='${ids.alice}';\n`,
  )

  const [held, suspended] = await Promise.all([holder.done, suspender.done])
  const ctx = `HOLD:${held}\nSUSPEND:${suspended}`

  const answers = held.split("\n").map((l) => l.trim()).filter((l) => l === "t" || l === "f")
  assert.equal(answers[0], "t", `the account should have worked before suspension\n${ctx}`)
  assert.equal(
    answers[1],
    "f",
    `a suspended account must be refused on its next statement -- suspension that waits for a token to ` +
      `expire is not suspension\n${ctx}`,
  )
  sql(`update public.profiles set account_state='ACTIVE' where id='${ids.alice}'`)
})

after(() => {
  const people = [ids.alice, ids.bob]
  sql(`do $$
declare v uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from auth.sessions where user_id = any(v);
  delete from public.account_recovery_codes where user_id = any(v);
  delete from public.security_events where subject_user_id = any(v) or actor_user_id = any(v);
  delete from public.account_security_state where user_id = any(v);
  delete from public.audit_log where changed_by = any(v);
  delete from public.profiles where id = any(v);
  delete from auth.users where id = any(v);
end $$;`)
})
