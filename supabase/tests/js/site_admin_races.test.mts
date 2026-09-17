import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * SITE ADMIN MASTER-CONTROL RACES (Identity/Auth Slice 7, Phase 2 AH R9 and R16).
 *
 *   R9   a Site Admin assigns a club role while the membership is being
 *        revoked, in both orders. Serialised on the membership: revoke first
 *        and the role is refused; assign first and the revoke cascades it.
 *
 *   R16  two Full Site Admins approve the SAME Site Admin grant request at the
 *        same moment. Exactly one grant; the second is told it has already
 *        been decided. This is the two-person rule's most obvious failure
 *        mode -- not somebody defeating it deliberately, but two colleagues
 *        clearing the same queue at the same time and the approval being
 *        consumed twice.
 *
 * R9 already had coverage in membership_races.test.mts, where a second CLUB
 * ADMIN stood in for the Site Admin because site_assign_club_role did not
 * exist yet -- the comment there says so, and calls it "the same lock path".
 * It now exists, so the race is run against the real RPC rather than its
 * understudy. The understudy stays: the club-to-club version is a different
 * scenario that is also worth holding still.
 *
 * The choreography is deterministic rather than timed, matching the other
 * race suites: session A does its work and then waits on an advisory gate,
 * holding its transaction and therefore its locks open; the test confirms
 * through pg_stat_activity that session B is genuinely BLOCKED behind A
 * before the gate opens. If B is not blocked, the lock that should serialise
 * them is missing and the test fails there -- which is the difference between
 * a race and two calls one after the other.
 *
 * Needs the local Supabase database. Everything it creates is removed at the
 * end, and the final assertion proves it.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const GATE = 8_000_000 + Math.floor(Math.random() * 1_000_000)

function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], {
    input: query,
    encoding: "utf8",
  }).trim()
}
const one = (query: string) => sql(query).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Session {
  proc: ChildProcessWithoutNullStreams
  done: Promise<string>
}

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

async function waitUntil(label: string, predicate: () => boolean, timeoutMs = 20000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(50)
  }
}

const waitingOnGate = (app: string) =>
  one(`select count(*) from pg_stat_activity a join pg_locks l on l.pid = a.pid
       where a.application_name = '${app}' and not l.granted and l.locktype = 'advisory' and l.objid = ${GATE}`) === "1"
const blocked = (app: string) =>
  one(`select count(*) from pg_stat_activity where application_name = '${app}' and wait_event_type = 'Lock'`) === "1"

function actAs(userId: string, email: string) {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", email })
  return `select set_config('request.jwt.claims', '${claims}', true);\nset local role authenticated;\n`
}

async function race(a: { user: string; email: string; statement: string }, b: { user: string; email: string; statement: string }) {
  const controller = spawn("docker", ["exec", "-i", "-e", "PGAPPNAME=sar_gate", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q"])
  controller.stdin.on("error", () => {})
  controller.on("error", () => {})
  controller.stdin.write(`select pg_advisory_lock(${GATE});\n`)
  await waitUntil("the gate", () => one(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${GATE} and granted`) === "1")

  const appA = `sar_a_${TAG}`
  const appB = `sar_b_${TAG}`
  const sessions: Session[] = []
  try {
    sessions.push(session(appA, `begin;\n${actAs(a.user, a.email)}${a.statement};\nreset role;\nselect pg_advisory_lock(${GATE});\ncommit;\n`))
    await waitUntil("A to reach the gate", () => waitingOnGate(appA))
    sessions.push(session(appB, `begin;\n${actAs(b.user, b.email)}${b.statement};\ncommit;\n`))
    // If B is not blocked here, the lock that should serialise it is missing and
    // these are two sequential calls wearing the word "race".
    await waitUntil("B to block behind A", () => blocked(appB), 5000)
  } finally {
    controller.stdin.write(`select pg_advisory_unlock(${GATE});\n\\q\n`)
    controller.stdin.end()
  }
  const [outA, outB] = await Promise.all(sessions.map((s) => s.done))
  return { outA, outB }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const ids = {
  full1: randomUUID(),
  full2: randomUUID(),
  full3: randomUUID(),
  target: randomUUID(),
  candidate: randomUUID(),
  club: "",
}
const email = (id: string) => `sar-${TAG}-${id}@ovalball.test`
const people = [ids.full1, ids.full2, ids.full3, ids.target, ids.candidate]

function seed() {
  const users = people
    .map(
      (id) => `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '', now(), now(), now(),
        '{}', '{}', '', '', '', '', '', '', '', '');
      insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
      values ('${id}', 'Race', 'SiteAdmin', '${email(id)}', (current_date - interval '35 years')::date, 'ACTIVE') on conflict (id) do nothing;`
    )
    .join("\n")
  sql(`${users}
    with d as (
      insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
      values ('SAR RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'verified', 'site_admin_manual', 'sar-${TAG}') returning id
    )
    insert into public.clubs (directory_id, slug, status) select id, 'sar-${TAG}', 'active' from d;`)
  ids.club = one(`select id from public.clubs where slug = 'sar-${TAG}'`)
  // Three Full Site Admins, because R16 needs two approvers who are neither the
  // requester nor the target. Seeded directly: Slice 7c closed every browser
  // route into this table, and the harness is admitting it is seeding state
  // rather than exercising the path under test.
  sql(`insert into public.site_admins (user_id, status, profile_key) values
    ('${ids.full1}', 'active', 'SITE_FULL'),
    ('${ids.full2}', 'active', 'SITE_FULL'),
    ('${ids.full3}', 'active', 'SITE_FULL');`)
}

/** Clears the club's people between races, under the maintenance setting the append-only guards expect. */
function resetClubPeople() {
  sql(`do $$
begin
  perform set_config('ovalball.maintenance', 'on', true);
  delete from public.role_assignments where club_id = (select id from public.clubs where slug = 'sar-${TAG}');
  delete from public.club_memberships where club_id = (select id from public.clubs where slug = 'sar-${TAG}');
end $$;`)
}

function cleanup(tag = TAG) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'sar-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'sar-${tag}-%@ovalball.test');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people
    || array(select id from public.clubs where id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.site_admins where user_id = any(v_people))
    || array(select id from public.site_admin_grant_requests where target_user_id = any(v_people) or requested_by = any(v_people))
    || array(select id from public.club_directory where normalized_key = 'sar-${tag}');
  delete from public.site_admin_grant_requests where target_user_id = any(v_people) or requested_by = any(v_people);
  delete from public.role_assignments where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.notifications where user_id = any(v_people);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = 'sar-${tag}';
  delete from public.site_admins where user_id = any(v_people);
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = v_club;
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}

seed()

after(() => {
  cleanup()
  const left = one(`select (select count(*) from public.clubs where slug = 'sar-${TAG}') || '|' || (select count(*) from auth.users where email like 'sar-${TAG}-%')
    || '|' || (select count(*) from pg_stat_activity where application_name like 'sar_%_${TAG}')`)
  assert.equal(left, "0|0|0", `the race test left rows or sessions behind (clubs|users|sessions = ${left})`)
})

// ---------------------------------------------------------------------------
// R9 -- against the real master-control RPC this time
// ---------------------------------------------------------------------------

function seedMembership() {
  return one(`insert into public.club_memberships (club_id, user_id, role, status, state, source)
              values ('${ids.club}', '${ids.target}', 'BASIC_USER', 'active', 'ACTIVE', 'SITE_ADMIN_ASSIGNMENT') returning id`)
}

/**
 * AH's R9 row says "revoke first -> assignment refused (membership not
 * ACTIVE)". That is the outcome for a CLUB ADMIN's assignment, and it is what
 * membership_races.test.mts holds still.
 *
 * It is NOT the outcome for site_assign_club_role, and the difference is
 * specified rather than accidental: Q.3 says that RPC "auto-creates ACTIVE
 * membership if missing (source SITE_ADMIN_ASSIGNMENT)". Master control exists
 * precisely so a Site Admin can put somebody into a club who has no
 * relationship with it, so a revocation a moment earlier cannot be a reason to
 * refuse -- the Site Admin is entitled to admit them from nothing.
 *
 * So the invariant worth holding still is the one that would actually be a
 * defect: an ACTIVE role must never hang off a REVOKED membership. Whichever
 * order the two sessions commit in, the role and the membership underneath it
 * have to agree.
 */
test("R9a: the membership is revoked first -- the Site Admin re-admits, and no role is left on the revoked row", async () => {
  const membership = seedMembership()
  const { outA, outB } = await race(
    {
      user: ids.full1,
      email: email(ids.full1),
      statement: `select public.site_transition_club_membership('${membership}', 'REVOKED', 'the person has left the club entirely')`,
    },
    {
      user: ids.full2,
      email: email(ids.full2),
      // A CLUB-scoped role, deliberately: site_assign_club_role refuses a
      // team-scoped one outright (SMC-13), which would end the race before
      // either session reached a lock and would look like a missing lock.
      statement: `select public.site_assign_club_role('${ids.target}', '${ids.club}', 'FIXTURES_SECRETARY', 'appointing them as fixtures secretary at the club request', '{}'::jsonb)`,
    }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.club_memberships where id = '${membership}'`), "REVOKED")
  // The role exists, on a DIFFERENT membership that the RPC admitted.
  assert.equal(
    one(`select count(*) from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.target}' and state = 'ACTIVE' and source = 'SITE_ADMIN_ASSIGNMENT'`),
    "1",
    "master control should have admitted the person afresh rather than reusing the revoked row"
  )
  assert.equal(
    one(`select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
         where ra.club_id = '${ids.club}' and ra.state = 'ACTIVE' and m.state <> 'ACTIVE'`),
    "0",
    "an active role is hanging off a membership that is not active"
  )
  resetClubPeople()
})

test("R9b: the role is assigned first -- the revocation then cascades it away", async () => {
  const membership = seedMembership()
  const { outA, outB } = await race(
    {
      user: ids.full1,
      email: email(ids.full1),
      statement: `select public.site_assign_club_role('${ids.target}', '${ids.club}', 'FIXTURES_SECRETARY', 'appointing them as fixtures secretary at the club request', '{}'::jsonb)`,
    },
    {
      user: ids.full2,
      email: email(ids.full2),
      statement: `select public.site_transition_club_membership('${membership}', 'REVOKED', 'the person has left the club entirely')`,
    }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.club_memberships where id = '${membership}'`), "REVOKED")
  assert.equal(
    one(`select count(*) from public.role_assignments where membership_id = '${membership}' and state = 'ACTIVE'`),
    "0",
    "the revocation left an active role behind -- M.1 says it cascades"
  )
  resetClubPeople()
})

// ---------------------------------------------------------------------------
// R16 -- two administrators clearing the same queue
// ---------------------------------------------------------------------------

test("R16: two Full Site Admins approve the same grant request -- exactly one grant", async () => {
  sql(`delete from public.site_admins where user_id = '${ids.candidate}';
       delete from public.site_admin_grant_requests where target_user_id = '${ids.candidate}';`)
  const request = one(`insert into public.site_admin_grant_requests (target_user_id, profile_key, requested_by, reason)
    values ('${ids.candidate}', 'SITE_SUPPORT', '${ids.full1}', 'they are taking over support cover from March') returning id`)

  const { outA, outB } = await race(
    { user: ids.full2, email: email(ids.full2), statement: `select public.site_approve_site_admin_grant('${request}', 'agreed, they are taking over support cover')` },
    { user: ids.full3, email: email(ids.full3), statement: `select public.site_approve_site_admin_grant('${request}', 'also agreeing, having seen the same request')` }
  )

  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /already been decided/, outB)
  assert.equal(one(`select state from public.site_admin_grant_requests where id = '${request}'`), "CONSUMED")
  assert.equal(
    one(`select count(*) from public.site_admins where user_id = '${ids.candidate}' and status = 'active'`),
    "1",
    "the candidate should be an active Site Admin exactly once"
  )
  // The decision is attributed to whoever actually made it, not to both.
  assert.equal(one(`select decided_by from public.site_admin_grant_requests where id = '${request}'`), ids.full2)
  assert.equal(
    one(`select count(*) from public.security_events where subject_user_id = '${ids.candidate}' and event_type = 'site_admin.grant_approved'`),
    "1",
    "one approval, one audit line"
  )
})
