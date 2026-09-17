import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * MEMBERSHIP AND RELATIONSHIP RACES (Identity/Auth Slice 2, Phase 2 AH).
 *
 * Two real database sessions act at the same moment, and the outcome must be
 * the one the design names -- not whichever happened to win:
 *
 *   R7   approve vs decline the same join request   first decision wins
 *   R8   two Club Admins remove each other           exactly one succeeds
 *   R9   role assigned while the membership is       serialised on the
 *        being removed (both orders; the assigner    membership: revoke first
 *        is a second Club Admin -- the same lock
 *        path a Site Admin's assign_role takes)
 *                                                     refuses the role; assign
 *                                                     first, the revoke ends it
 *   R10  guardian approval vs the requester          first wins
 *        withdrawing (both orders)
 *   R20  player moved while an attendance response   the response is decided
 *        is submitted (both orders)                  against the place current
 *                                                     at its commit
 *
 * The choreography is deterministic rather than timed: session A does its
 * work and then waits on an advisory "gate" lock held by a controller, so its
 * transaction stays open holding its locks; the test sees (pg_stat_activity)
 * that session B is blocked behind A before the gate opens and A commits.
 *
 * Needs the local Supabase database. Everything it creates is removed at the
 * end, including the audit and security-event history of its disposable
 * identities (through the operator maintenance setting).
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
  const controller = spawn("docker", ["exec", "-i", "-e", "PGAPPNAME=race_gate", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q"])
  // A broken pipe on the gate must fail the race it belongs to, not the process.
  controller.stdin.on("error", () => {})
  controller.on("error", () => {})
  controller.stdin.write(`select pg_advisory_lock(${GATE});\n`)
  await waitUntil("the gate", () => one(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${GATE} and granted`) === "1")

  const appA = `race_a_${TAG}`
  const appB = `race_b_${TAG}`
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

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const ids = {
  admin1: randomUUID(),
  admin2: randomUUID(),
  admin3: randomUUID(),
  joiner: randomUUID(),
  target: randomUUID(),
  target2: randomUUID(),
  parent: randomUUID(),
  added: randomUUID(),
  added2: randomUUID(),
  club: "",
  team: "",
  team2: "",
}
const email = (id: string) => `race-${TAG}-${id}@ovalball.test`
const people = [ids.admin1, ids.admin2, ids.admin3, ids.joiner, ids.target, ids.target2, ids.parent, ids.added, ids.added2]

function seed() {
  const users = people
    .map(
      (id) => `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '', now(), now(), now(),
        '{}', '{}', '', '', '', '', '', '', '', '');
      -- D-S5-1: staff fixtures are adults; a role or override now needs a recorded date of birth saying so.
      insert into public.profiles (id, first_name, surname, email, date_of_birth) values ('${id}', 'Race', 'Tester', '${email(id)}', (current_date - interval '35 years')::date) on conflict (id) do nothing;`
    )
    .join("\n")
  sql(`${users}
    with d as (
      insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
      values ('Race RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'race-${TAG}') returning id
    )
    insert into public.clubs (directory_id, slug, status) select id, 'race-${TAG}', 'active' from d;`)
  ids.club = one(`select id from public.clubs where slug = 'race-${TAG}'`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}', 'Under 12 Boys', 'race-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
  ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
    values ('${ids.club}', 'Under 12 Boys B', 'race-u12b-${TAG}', 'youth', 'U12', 'boys', 'B', 'union', true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.club}', '${ids.admin1}', 'CLUB_ADMIN', 'active'),
      ('${ids.club}', '${ids.admin2}', 'CLUB_ADMIN', 'active'),
      ('${ids.club}', '${ids.admin3}', 'BASIC_USER', 'active'),
      ('${ids.club}', '${ids.target}', 'BASIC_USER', 'active'),
      ('${ids.club}', '${ids.target2}', 'BASIC_USER', 'active');`)
}

/** Removes everything a run tagged `tag` created (also used to clear a crashed run's rows). */
function cleanup(tag = TAG) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'race-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'race-${tag}-%@ovalball.test');
  v_players uuid[] := array(
    select ptm.player_id from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id where t.club_id = v_club
    union select g.player_id from public.guardians g where g.guardian_user_id = any(v_people));
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  -- Every row this run created, so its audit history can go with it.
  v_records := v_people || v_players
    || array(select id from public.clubs where id = v_club)
    || array(select id from public.teams where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club)
    || array(select id from public.role_assignments where club_id = v_club)
    || array(select id from public.club_join_requests where club_id = v_club)
    || array(select id from public.guardian_link_requests where club_id = v_club)
    || array(select id from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people))
    || array(select id from public.player_team_memberships where player_id = any(v_players))
    || array(select id from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club))
    || array(select id from public.player_fixture_attendance where player_id = any(v_players))
    || array(select id from public.access_review_items where club_id = v_club)
    || array(select id from public.site_admins where user_id = any(v_people))
    || array(select id from public.club_directory where normalized_key = 'race-${tag}');
  delete from public.player_fixture_attendance where player_id = any(v_players);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club);
  delete from public.guardian_link_requests where club_id = v_club;
  delete from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.access_review_items where club_id = v_club;
  delete from public.club_join_requests where club_id = v_club;
  delete from public.role_assignments where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.notifications where user_id = any(v_people);
  delete from public.club_setup_state where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = 'race-${tag}';
  delete from public.site_admins where user_id = any(v_people);
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = v_club or player_id = any(v_players);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  -- Removing the people writes their profiles' own deletion history last.
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}

seed()
after(() => {
  cleanup()
  const left = one(`select (select count(*) from public.clubs where slug = 'race-${TAG}') || '|' || (select count(*) from auth.users where email like 'race-${TAG}-%')
    || '|' || (select count(*) from pg_stat_activity where application_name like 'race_%_${TAG}')`)
  assert.equal(left, "0|0|0", `the race test left rows or sessions behind (clubs|users|sessions = ${left})`)
})

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

test("R7: approve and decline the same join request -- the first decision wins", async () => {
  const join = one(`insert into public.club_join_requests (club_id, requesting_user_id, requested_role) values ('${ids.club}', '${ids.joiner}', 'Coach') returning id`)
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.decide_club_join_request('${join}', 'APPROVE', null)` },
    { user: ids.admin2, email: email(ids.admin2), statement: `select public.decide_club_join_request('${join}', 'DECLINE', 'duplicate')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /already been decided/, outB)
  assert.equal(one(`select status from public.club_join_requests where id = '${join}'`), "approved")
  assert.equal(one(`select state from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.joiner}'`), "ACTIVE")
})

test("R8: two Club Admins remove each other -- exactly one succeeds and the club keeps an admin", async () => {
  const ms1 = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.admin1}' and state = 'ACTIVE'`)
  const ms2 = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.admin2}' and state = 'ACTIVE'`)
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.transition_club_membership('${ms2}', 'REVOKED', 'race')` },
    { user: ids.admin2, email: email(ids.admin2), statement: `select public.transition_club_membership('${ms1}', 'REVOKED', 'race')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.club_memberships where id = '${ms2}'`), "REVOKED")
  assert.equal(one(`select state from public.club_memberships where id = '${ms1}'`), "ACTIVE")
  assert.equal(
    one(`select count(*) from public.role_assignments ra join public.club_memberships cm on cm.id = ra.membership_id
         where ra.club_id = '${ids.club}' and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE' and cm.state = 'ACTIVE'`),
    "1"
  )
})

test("R9a: membership removed first -- the concurrent role assignment is refused", async () => {
  // After R8 the club has one Club Admin; a second one assigns roles here.
  sql(`update public.club_memberships set role = 'CLUB_ADMIN' where club_id = '${ids.club}' and user_id = '${ids.admin3}' and state = 'ACTIVE'`)
  const ms = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.target}' and state = 'ACTIVE'`)
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.transition_club_membership('${ms}', 'REVOKED', 'race')` },
    { user: ids.admin3, email: email(ids.admin3), statement: `select public.assign_role('${ms}', 'COACH', '${ids.team}', 'race')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /only be given to an active member/, outB)
  assert.equal(one(`select count(*) from public.role_assignments where membership_id = '${ms}' and state <> 'REVOKED'`), "0")
})

test("R9b: role assigned first -- the concurrent removal revokes it too", async () => {
  const ms = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.target2}' and state = 'ACTIVE'`)
  const { outA, outB } = await race(
    { user: ids.admin3, email: email(ids.admin3), statement: `select public.assign_role('${ms}', 'COACH', '${ids.team}', 'race')` },
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.transition_club_membership('${ms}', 'REVOKED', 'race')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.role_assignments where membership_id = '${ms}' and role_key = 'COACH'`), "REVOKED")
  assert.equal(one(`select count(*) from public.role_assignments where membership_id = '${ms}' and state <> 'REVOKED'`), "0")
})

function seedFamily(addedUser: string) {
  const player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Race', 'Race ${TAG}', current_date - 4200, 'MALE') returning id`)
  sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${player}', '${ids.team}', 'active');
       insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${ids.parent}', '${player}', 'parent', 'active')
       on conflict do nothing;`)
  const request = one(`
    select set_config('request.jwt.claims', '${JSON.stringify({ sub: ids.parent, role: "authenticated" })}', false);
    select request_id from public.request_additional_guardian('${player}', '${email(addedUser)}');`)
  sql(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: addedUser, role: "authenticated", email: email(addedUser) })}', false);
       select public.respond_to_additional_guardian_request('${request}', 'ACCEPT');`)
  return { player, request }
}

test("R10a: the club approves while the requester withdraws -- approval first wins", async () => {
  const { player, request } = seedFamily(ids.added)
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select * from public.approve_guardian_link_request('${request}')` },
    { user: ids.parent, email: email(ids.parent), statement: `select public.cancel_guardian_link_request('${request}')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /already been decided/, outB)
  assert.equal(one(`select state from public.guardians where guardian_user_id = '${ids.added}' and player_id = '${player}'`), "ACTIVE")
})

test("R10b: the requester withdraws while the club approves -- withdrawal first wins", async () => {
  const { player, request } = seedFamily(ids.added2)
  const { outA, outB } = await race(
    { user: ids.parent, email: email(ids.parent), statement: `select public.cancel_guardian_link_request('${request}')` },
    { user: ids.admin1, email: email(ids.admin1), statement: `select * from public.approve_guardian_link_request('${request}')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /ERROR/, outB)
  assert.equal(one(`select status from public.guardian_link_requests where id = '${request}'`), "CANCELLED")
  assert.equal(one(`select state from public.guardians where guardian_user_id = '${ids.added2}' and player_id = '${player}'`), "DECLINED")
})

let fixtureDay = 30
function seedAttendance() {
  const player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Race', 'Race ${TAG}', current_date - 4200, 'MALE') returning id`)
  const place = one(`insert into public.player_team_memberships (player_id, team_id, status) values ('${player}', '${ids.team}', 'active') returning id`)
  sql(`insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${ids.parent}', '${player}', 'parent', 'active');`)
  fixtureDay += 1
  const fixture = one(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
    values ('${ids.team}', 'Home', 'Race Opponent ${TAG}', current_date + ${fixtureDay}, '10:30', 'Booked', 'club_created') returning id`)
  return { player, place, fixture }
}

test("R20a: the move commits first -- a response for the old team is refused", async () => {
  const { player, place, fixture } = seedAttendance()
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.move_player_team_membership('${place}', '${ids.team2}', 'race')` },
    { user: ids.parent, email: email(ids.parent), statement: `select public.respond_to_attendance('${fixture}', '${player}', 'ATTENDING')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /not associated with a team involved/, outB)
  assert.equal(one(`select count(*) from public.player_fixture_attendance where fixture_id = '${fixture}' and player_id = '${player}'`), "0")
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
})

test("R20b: the response commits first -- it stands, and the move then proceeds", async () => {
  const { player, place, fixture } = seedAttendance()
  const { outA, outB } = await race(
    { user: ids.parent, email: email(ids.parent), statement: `select public.respond_to_attendance('${fixture}', '${player}', 'ATTENDING')` },
    { user: ids.admin1, email: email(ids.admin1), statement: `select public.move_player_team_membership('${place}', '${ids.team2}', 'race')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select status from public.player_fixture_attendance where fixture_id = '${fixture}' and player_id = '${player}'`), "ATTENDING")
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
  assert.equal(one(`select count(*) from public.player_team_memberships where player_id = '${player}' and team_id = '${ids.team2}' and state = 'ACTIVE'`), "1")
})
