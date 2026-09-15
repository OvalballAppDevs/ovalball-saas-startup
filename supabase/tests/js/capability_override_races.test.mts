import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * CAPABILITY DECISION RACES (Identity/Auth Slice 3, Phase 2 AH R19).
 *
 * Two real database sessions decide at the same moment, and the outcome is the one the design names:
 *
 *   R19a  SITE withhold first, CLUB allow second    the club allow is refused; the site withhold stands
 *   R19b  CLUB allow first, SITE withhold second    the site withhold replaces it; one active decision
 *   R19c  two Club Admins decide opposite ways      serialised: the second replaces the first
 *   R19d  a delegated allow while the delegator     either order, the allow gives nothing once the
 *         loses Club Admin                          delegator's authority has gone
 *   R19e  a delegated allow while the member is     suspension first: the decision is refused; decision
 *         being suspended (both orders)             first: recorded, and the suspension still denies
 *
 * Deterministic choreography, as js/membership_races.test.mts: session A does its work and waits on an
 * advisory gate with its locks held; the test sees (pg_stat_activity) that B is blocked behind A, then
 * opens the gate. Everything created is removed at the end, history included.
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

function actAs(userId: string) {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", email: email(userId) })
  return `select set_config('request.jwt.claims', '${claims}', true);\nset local role authenticated;\n`
}

async function race(a: { user: string; statement: string }, b: { user: string; statement: string }) {
  const controller = spawn("docker", ["exec", "-i", "-e", "PGAPPNAME=race_gate", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q"])
  controller.stdin.on("error", () => {})
  controller.on("error", () => {})
  controller.stdin.write(`select pg_advisory_lock(${GATE});\n`)
  await waitUntil("the gate", () => one(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${GATE} and granted`) === "1")

  const appA = `race_a_${TAG}`
  const appB = `race_b_${TAG}`
  const sessions: Session[] = []
  try {
    sessions.push(session(appA, `begin;\n${actAs(a.user)}${a.statement};\nreset role;\nselect pg_advisory_lock(${GATE});\ncommit;\n`))
    await waitUntil("A to reach the gate", () => waitingOnGate(appA))
    sessions.push(session(appB, `begin;\n${actAs(b.user)}${b.statement};\ncommit;\n`))
    await waitUntil("B to block behind A", () => blocked(appB), 5000)
  } finally {
    controller.stdin.write(`select pg_advisory_unlock(${GATE});\n\\q\n`)
    controller.stdin.end()
  }
  const [outA, outB] = await Promise.all(sessions.map((s) => s.done))
  return { outA, outB }
}

const ids = {
  full: randomUUID(),
  admin1: randomUUID(),
  admin2: randomUUID(),
  delegator: randomUUID(),
  member1: randomUUID(),
  member2: randomUUID(),
  member3: randomUUID(),
  member4: randomUUID(),
  member5: randomUUID(),
  club: "",
}
const email = (id: string) => `crace-${TAG}-${id}@ovalball.test`
const people = [ids.full, ids.admin1, ids.admin2, ids.delegator, ids.member1, ids.member2, ids.member3, ids.member4, ids.member5]
const KEY = "fixture.fixture.edit"

function seed() {
  const users = people
    .map(
      (id) => `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '', now(), now(), now(),
        '{}', '{}', '', '', '', '', '', '', '', '');
      insert into public.profiles (id, first_name, surname, email) values ('${id}', 'Race', 'Tester', '${email(id)}') on conflict (id) do nothing;`,
    )
    .join("\n")
  sql(`begin;
${users}
insert into public.site_admins (user_id, status, admin_role) values ('${ids.full}', 'active', 'full');
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Capability Race RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'crace-${TAG}');
insert into public.clubs (directory_id, slug, status) select id, 'crace-${TAG}', 'active' from public.club_directory where normalized_key = 'crace-${TAG}';
insert into public.club_memberships (club_id, user_id, role, status)
select c.id, p.user_id, p.role, 'active' from public.clubs c,
  (values ('${ids.admin1}'::uuid, 'CLUB_ADMIN'), ('${ids.admin2}'::uuid, 'CLUB_ADMIN'), ('${ids.delegator}'::uuid, 'CLUB_ADMIN'),
          ('${ids.member1}'::uuid, 'BASIC_USER'), ('${ids.member2}'::uuid, 'BASIC_USER'), ('${ids.member3}'::uuid, 'BASIC_USER'),
          ('${ids.member4}'::uuid, 'BASIC_USER'), ('${ids.member5}'::uuid, 'BASIC_USER')) as p (user_id, role)
where c.slug = 'crace-${TAG}';
commit;`)
  ids.club = one(`select id from public.clubs where slug = 'crace-${TAG}'`)
}

function cleanup(tag = TAG) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'crace-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'crace-${tag}-%@ovalball.test');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people
    || array(select id from public.clubs where id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.capability_overrides where club_id = v_club or user_id = any(v_people))
    || array(select id from public.site_admins where user_id = any(v_people))
    || array(select id from public.club_directory where normalized_key = 'crace-${tag}');
  delete from public.capability_overrides where club_id = v_club or user_id = any(v_people);
  delete from public.access_review_items where club_id = v_club;
  delete from public.role_assignments where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.notifications where user_id = any(v_people);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = 'crace-${tag}';
  -- On an otherwise empty database this run's Full Site Admin is the last one, and the last-Full guard
  -- (rightly) refuses to remove it. Only then, and only inside this transaction, the guard is set aside
  -- for this disposable row and put straight back.
  if not exists (select 1 from public.site_admins where status = 'active' and profile_key = 'SITE_FULL' and not (user_id = any(v_people))) then
    alter table public.site_admins disable trigger prevent_last_full_admin_lockout;
    delete from public.site_admins where user_id = any(v_people);
    alter table public.site_admins enable trigger prevent_last_full_admin_lockout;
  else
    delete from public.site_admins where user_id = any(v_people);
  end if;
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = v_club;
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}

// A crashed earlier run on this database leaves its tagged rows; clear them before seeding.
for (const stale of sql(`select distinct split_part(email, '-', 2) from auth.users where email like 'crace-%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanup(stale)
seed()

after(() => {
  cleanup()
  const left = one(`select (select count(*) from public.clubs where slug = 'crace-${TAG}') || '|' || (select count(*) from auth.users where email like 'crace-${TAG}-%')
    || '|' || (select count(*) from pg_stat_activity where application_name like 'race_%_${TAG}')`)
  assert.equal(left, "0|0|0", `the race test left rows or sessions behind (clubs|users|sessions = ${left})`)
})

const setOverride = (member: string, effect: "grant" | "deny", reason: string) =>
  `select public.set_capability_override('${member}', '${KEY}', 'club', '${ids.club}', null, '${effect}', '${reason}')`
const activeDecisions = (member: string) =>
  one(`select coalesce(string_agg(effect || ':' || granted_level, ',' order by granted_at), '') from public.capability_overrides
       where user_id = '${member}' and capability_key = '${KEY}' and status = 'active'`)
const canAs = (member: string) =>
  one(`begin; select set_config('request.jwt.claims', '{"sub":"${member}","role":"authenticated"}', true); set local role authenticated;
       select internal.can('${KEY}', 'club', '${ids.club}', null, null); rollback;`)

test("R19a: a club allow racing a site withhold that holds the lock is refused", async () => {
  const { outA, outB } = await race(
    { user: ids.full, statement: setOverride(ids.member1, "deny", "Ovalball decision") },
    { user: ids.admin1, statement: setOverride(ids.member1, "grant", "club allow") },
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /higher level/, outB)
  assert.equal(activeDecisions(ids.member1), "deny:SITE")
})

test("R19b: a site withhold racing a club allow that holds the lock replaces it", async () => {
  const { outA, outB } = await race(
    { user: ids.admin1, statement: setOverride(ids.member2, "grant", "club allow") },
    { user: ids.full, statement: setOverride(ids.member2, "deny", "Ovalball decision") },
  )
  assert.doesNotMatch(outA + outB, /ERROR/, outA + outB)
  assert.equal(activeDecisions(ids.member2), "deny:SITE")
  assert.equal(one(`select count(*) from public.capability_overrides where user_id = '${ids.member2}' and status = 'revoked' and revoked_level = 'SITE'`), "1")
})

test("R19c: two Club Admins deciding opposite ways are serialised; the second replaces the first", async () => {
  const { outA, outB } = await race(
    { user: ids.admin1, statement: setOverride(ids.member3, "grant", "first") },
    { user: ids.admin2, statement: setOverride(ids.member3, "deny", "second") },
  )
  assert.doesNotMatch(outA + outB, /ERROR/, outA + outB)
  assert.equal(activeDecisions(ids.member3), "deny:CLUB")
  assert.equal(canAs(ids.member3), "f")
})

test("R19d: an allow delegated while its delegator loses Club Admin gives nothing afterwards", async () => {
  const assignment = one(`select id from public.role_assignments where user_id = '${ids.delegator}' and club_id = '${ids.club}' and role_key = 'CLUB_ADMIN' and state = 'ACTIVE'`)
  const { outA, outB } = await race(
    { user: ids.delegator, statement: setOverride(ids.member4, "grant", "delegated") },
    { user: ids.admin1, statement: `select public.transition_role_assignment('${assignment}', 'REVOKED', 'race: delegator removed')` },
  )
  assert.doesNotMatch(outA + outB, /ERROR/, outA + outB)
  assert.equal(activeDecisions(ids.member4), "grant:CLUB")
  assert.equal(canAs(ids.member4), "f", "the allow must be re-validated against the delegator's current authority")
})

test("R19e: a decision and a suspension of the same member are serialised in both orders", async () => {
  const membership = one(`select id from public.club_memberships where user_id = '${ids.member5}' and club_id = '${ids.club}'`)
  // suspension first: the decision sees the suspended membership and is refused
  let { outA, outB } = await race(
    { user: ids.admin1, statement: `select public.transition_club_membership('${membership}', 'SUSPENDED', 'race: suspended')` },
    { user: ids.admin2, statement: setOverride(ids.member5, "grant", "allow while suspended") },
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /not an active member/, outB)
  assert.equal(activeDecisions(ids.member5), "")
  sql(`begin; select set_config('request.jwt.claims', '{"sub":"${ids.admin1}","role":"authenticated"}', true); set local role authenticated;
       select public.transition_club_membership('${membership}', 'ACTIVE', 'race: restored'); commit;`)
  // decision first: it is recorded, and the suspension that follows still denies
  ;({ outA, outB } = await race(
    { user: ids.admin2, statement: setOverride(ids.member5, "grant", "allow before suspension") },
    { user: ids.admin1, statement: `select public.transition_club_membership('${membership}', 'SUSPENDED', 'race: suspended after')` },
  ))
  assert.doesNotMatch(outA + outB, /ERROR/, outA + outB)
  assert.equal(activeDecisions(ids.member5), "grant:CLUB")
  assert.equal(canAs(ids.member5), "f")
})
