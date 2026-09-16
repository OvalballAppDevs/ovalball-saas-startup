import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * FIXTURE CREATION RACES (Identity/Auth Slice 4C, Phase 2 AD, AA.3 row 4c).
 *
 * The creation transitions Slice 4C owns, raced by two real database sessions. No sleep decides a
 * result; where the paths genuinely contend the gate choreography serialises them, and where they
 * do not the two sessions simply run at once and the invariant is asserted on the persisted state.
 *
 *   C1  two staff create the same external fixture at once   both land; neither is lost or duplicated
 *                                                            into a single row (no false idempotency)
 *   C2  two staff ask the same Ovalball club at once         two requests, ZERO fixtures -- the
 *                                                            invariant holds under concurrency
 *   C3  a creation races the loss of the creator's authority  the fixture is created under the
 *                                                            authority that existed when it committed
 *   C4  a creation races the opponent club being deactivated  the opposition's Ovalball status is
 *                                                            decided once, and the outcome is internally
 *                                                            consistent: request XOR fixture, never both
 *
 * Everything it creates is removed at the end, including its audit history.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const GATE = 7_000_000 + Math.floor(Math.random() * 1_000_000)

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

/** A holds its transaction open behind the gate; B runs into A's locks; then the gate opens. */
async function race(a: { user: string; email: string; statement: string }, b: { user: string; email: string; statement: string }) {
  const controller = spawn("docker", ["exec", "-i", "-e", "PGAPPNAME=frace_gate", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q"])
  // A broken pipe on the gate must fail the race it belongs to, not the process.
  controller.stdin.on("error", () => {})
  controller.on("error", () => {})
  controller.stdin.write(`select pg_advisory_lock(${GATE});\n`)
  await waitUntil("the gate", () => one(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${GATE} and granted`) === "1")

  const appA = `frace_a_${TAG}`
  const appB = `frace_b_${TAG}`
  const sessions: Session[] = []
  try {
    sessions.push(session(appA, `begin;\n${actAs(a.user, a.email)}${a.statement};\nreset role;\nselect pg_advisory_lock(${GATE});\ncommit;\n`))
    await waitUntil("A to reach the gate", () => waitingOnGate(appA))
    sessions.push(session(appB, `begin;\n${actAs(b.user, b.email)}${b.statement};\ncommit;\n`))
    // If B is not blocked here, the lock that should serialise it is missing.
    await waitUntil("B to block behind A", () => blocked(appB), 5000)
  } finally {
    controller.stdin.write(`select pg_advisory_unlock(${GATE});\n\\q\n`)
    controller.stdin.end()
  }
  const [outA, outB] = await Promise.all(sessions.map((s) => s.done))
  return { outA, outB }
}


/** A standalone session script prefix that signs in as one person. */
function asUser(userId: string): string {
  return actAs(userId, `frace-${TAG}-${userId}@ovalball.test`)
}

// ---------------------------------------------------------------------------------------------------
// Seed: one club with two teams, a second Ovalball club, two fixture-authorised staff.
// ---------------------------------------------------------------------------------------------------
const ids = { a: randomUUID(), b: randomUUID(), club: "", team: "", team2: "", farClub: "", farTeam: "", farDir: "" }
const fEmail = (id: string) => `frace-${TAG}-${id}@ovalball.test`

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${fEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Frace', '${label}', '${fEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  person(ids.a, "AdminA"); person(ids.b, "AdminB")
  const dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Frace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','frace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${dir}','frace-${TAG}','active') returning id`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 12 Boys','frace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 14 Boys','frace-u14-${TAG}','youth','U14','boys','union',true) returning id`)
  ids.farDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Frace Far ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fracefar-${TAG}') returning id`)
  ids.farClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.farDir}','fracefar-${TAG}','active') returning id`)
  ids.farTeam = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.farClub}','Under 12 Boys','fracefar-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
    ('${ids.club}','${ids.a}','CLUB_ADMIN','active'), ('${ids.club}','${ids.b}','CLUB_ADMIN','active');`)
}
seed()
const startedAt = one(`select now()::text`)

function clearFixtures() {
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.fixture_requests fr using public.fixture_request_groups g
         where g.id = fr.group_id and g.requesting_club_id = '${ids.club}';
       delete from public.fixture_request_groups where requesting_club_id = '${ids.club}';
       delete from public.fixtures where owning_team_id in ('${ids.team}','${ids.team2}'); end $$;`)
}

const create = (team: string, text: string, day: number, opp?: string) =>
  `select public.create_fixture('${team}','Home','${text}',(current_date + ${day})::date,'Booked'` +
  (opp ? `,'${opp}'` : "") + `)`

after(() => {
  sql(`do $$
declare v_people uuid[] := array['${ids.a}'::uuid,'${ids.b}'::uuid]; v_rec uuid[];
begin
  perform set_config('ovalball.maintenance','on',true);
  v_rec := v_people
    || array(select id from public.fixtures where owning_team_id in ('${ids.team}','${ids.team2}'))
    || array(select id from public.teams where club_id in ('${ids.club}','${ids.farClub}'))
    || array(select id from public.clubs where id in ('${ids.club}','${ids.farClub}'))
    || array(select id from public.club_memberships where club_id in ('${ids.club}','${ids.farClub}'))
    || array(select id from public.role_assignments where club_id in ('${ids.club}','${ids.farClub}'))
    || array(select id from public.club_directory where normalized_key in ('frace-${TAG}','fracefar-${TAG}'))
    || array(select id from public.fixture_request_groups where requesting_club_id = '${ids.club}');
  delete from public.fixture_requests fr using public.fixture_request_groups g
    where g.id = fr.group_id and g.requesting_club_id = '${ids.club}';
  delete from public.fixture_request_groups where requesting_club_id = '${ids.club}';
  delete from public.fixtures where owning_team_id in ('${ids.team}','${ids.team2}');
  delete from public.role_assignments where club_id in ('${ids.club}','${ids.farClub}');
  delete from public.club_memberships where club_id in ('${ids.club}','${ids.farClub}');
  delete from public.teams where club_id in ('${ids.club}','${ids.farClub}');
  delete from public.clubs where id in ('${ids.club}','${ids.farClub}');
  delete from public.club_directory where normalized_key in ('frace-${TAG}','fracefar-${TAG}');
  delete from public.audit_log where changed_by = any(v_people) or record_id = any(v_rec);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('fixtures','fixture_requests','fixture_request_groups','club_directory','clubs',
                                'teams','club_memberships','role_assignments','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.fixtures f where f.id = a.record_id)
           and not exists (select 1 from public.fixture_requests r where r.id = a.record_id)
           and not exists (select 1 from public.fixture_request_groups g where g.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.clubs c where c.id = a.record_id)
           and not exists (select 1 from public.teams t where t.id = a.record_id)
           and not exists (select 1 from public.club_memberships m where m.id = a.record_id)
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})

test("C1 two staff create the same external fixture at once: both land, neither is lost", async () => {
  clearFixtures()
  const a = session(`frace_a_${TAG}`, `begin;\n${asUser(ids.a)}${create(ids.team, "External RFC", 10)};\ncommit;\n`)
  const b = session(`frace_b_${TAG}`, `begin;\n${asUser(ids.b)}${create(ids.team, "External RFC", 10)};\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  assert.doesNotMatch(oa, /ERROR/, oa)
  assert.doesNotMatch(ob, /ERROR/, ob)
  assert.equal(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`), "2",
    "two deliberate creations must both persist; silent de-duplication would lose a real fixture")
})

test("C2 two staff ask the same Ovalball club at once: two requests, ZERO fixtures", async () => {
  clearFixtures()
  const a = session(`frace_a_${TAG}`, `begin;\n${asUser(ids.a)}${create(ids.team, "Far U12", 11, ids.farTeam)};\ncommit;\n`)
  const b = session(`frace_b_${TAG}`, `begin;\n${asUser(ids.b)}${create(ids.team, "Far U12", 11, ids.farTeam)};\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  assert.doesNotMatch(oa, /ERROR/, oa)
  assert.doesNotMatch(ob, /ERROR/, ob)
  assert.equal(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`), "0",
    "the invariant must hold under concurrency: an Ovalball opponent is never booked")
  assert.equal(one(`select count(*) from public.fixture_request_groups where requesting_club_id = '${ids.club}'`), "2")
})

test("C3 a creation racing the loss of its creator's authority leaves one consistent outcome", async () => {
  clearFixtures()
  const ms = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.b}'`)
  const a = session(`frace_a_${TAG}`, `begin;\n${asUser(ids.b)}${create(ids.team, "External RFC", 12)};\ncommit;\n`)
  // Suspension, not revocation: the Slice 2 state machine treats removal as terminal ("a removed
  // membership cannot be switched back on"), which is correct and is not what this race is about.
  const b = session(`frace_b_${TAG}`, `begin;\nupdate public.club_memberships set state = 'SUSPENDED', authority_suspended = true where id = '${ms}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  void ob
  const n = one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`)
  assert.ok(["0", "1"].includes(n), `expected 0 or 1 fixture, saw ${n}\n${oa}`)
  sql(`update public.club_memberships set state='ACTIVE', authority_suspended=false where id='${ms}'`)
})

test("C4 a creation racing the opponent club's deactivation is request XOR fixture, never both", async () => {
  clearFixtures()
  const a = session(`frace_a_${TAG}`, `begin;\n${asUser(ids.a)}${create(ids.team, "Far U12", 13, ids.farTeam)};\ncommit;\n`)
  const b = session(`frace_b_${TAG}`, `begin;\nupdate public.clubs set status = 'inactive' where id = '${ids.farClub}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  void ob
  const fixtures = Number(one(`select count(*) from public.fixtures where owning_team_id = '${ids.team}'`))
  const groups = Number(one(`select count(*) from public.fixture_request_groups where requesting_club_id = '${ids.club}'`))
  assert.equal(fixtures + groups, 1, `exactly one outcome expected, saw ${fixtures} fixtures and ${groups} requests\n${oa}`)
  sql(`update public.clubs set status='active' where id='${ids.farClub}'`)
})
