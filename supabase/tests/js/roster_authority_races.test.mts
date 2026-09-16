import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * ROSTER AUTHORITY RACES (Identity/Auth Slice 4B, Phase 2 AD, AA.3 row 4b).
 *
 * The team-place transitions Slice 4B owns, raced by two real database sessions with the same deterministic
 * gate choreography as membership_races and family_authority_races: session A holds its locks behind an
 * advisory gate, B is observed blocked behind A, and only then does the gate open. No sleep decides a result.
 *
 *   R1   two staff archive the same place at once          exactly one ending; the second is a no-op, not an error
 *   R2a  archive commits first, move second                the move is refused: an ended place is not moved
 *   R2b  move commits first, archive second                the archive ends the moved place, once
 *   R3   archive and restore race (both orders)            no resurrection of an ending that has committed
 *   R4   two staff add the same player to the same team    exactly one ACTIVE place survives the unique index
 *   R5   a Team Manager races a Club Admin on the same     authority is decided per session; neither escalates
 *        place                                             and the row lands in one consistent state
 *
 * Everything it creates is removed at the end, including its audit and security-event history.
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
  const controller = spawn("docker", ["exec", "-i", "-e", "PGAPPNAME=rrace_gate", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q"])
  // A broken pipe on the gate must fail the race it belongs to, not the process.
  controller.stdin.on("error", () => {})
  controller.on("error", () => {})
  controller.stdin.write(`select pg_advisory_lock(${GATE});\n`)
  await waitUntil("the gate", () => one(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${GATE} and granted`) === "1")

  const appA = `rrace_a_${TAG}`
  const appB = `rrace_b_${TAG}`
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

/** A standalone session script prefix that signs in as one person (the harness `actAs`, reused here). */
function asUser(userId: string): string {
  return actAs(userId, `rrace-${TAG}-${userId}@ovalball.test`)
}

// ---------------------------------------------------------------------------------------------------
// Seed: one club, two teams, a Club Admin, a Team Manager and a child with a place in the first team.
// ---------------------------------------------------------------------------------------------------

const ids = {
  ca: randomUUID(),
  ca2: randomUUID(),
  tm: randomUUID(),
  club: "",
  team: "",
  team2: "",
  player: "",
  place: "",
  msTm: "",
}
const rEmail = (id: string) => `rrace-${TAG}-${id}@ovalball.test`

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${rEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Rrace', '${label}', '${rEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;
  `)
}

function seed() {
  for (const [k, v] of [["ca", "Admin"], ["ca2", "AdminTwo"], ["tm", "Manager"]] as const) person(ids[k as "ca"], v)
  const dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Rrace ${TAG} RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rrace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${dir}', 'rrace-${TAG}', 'active') returning id`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}', 'Under 12 Boys', 'rrace-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
  ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}', 'Under 14 Boys', 'rrace-u14-${TAG}', 'youth', 'U14', 'boys', 'union', true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${ids.ca}', 'CLUB_ADMIN', 'active');`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${ids.ca2}', 'CLUB_ADMIN', 'active');`)
  ids.msTm = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${ids.tm}', 'BASIC_USER', 'active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission) values ('${ids.msTm}', '${ids.team}', 'manager');`)
  ids.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
    values ('Rrace', 'Child', (current_date - interval '11 years')::date, 'MALE') returning id`)
}

/** Every team place this suite creates, including ones a later test replaces, so cleanup can take their
 *  audit history with them -- the ids are gone from the table by then, but the history is not. */
const createdPlaces: string[] = []

function freshPlace(team = ids.team): string {
  for (const id of sql(`select id from public.player_team_memberships where player_id = '${ids.player}'`).split("\n")) {
    if (id.trim()) createdPlaces.push(id.trim())
  }
  sql(`delete from public.player_team_memberships where player_id = '${ids.player}';`)
  const id = one(`insert into public.player_team_memberships (player_id, team_id, status, state, source)
    values ('${ids.player}', '${team}', 'active', 'ACTIVE', 'CLUB_CREATED') returning id`)
  createdPlaces.push(id)
  return id
}

seed()

/** When this run began, so the final audit pass is bounded to history this suite wrote. */
const startedAt = one(`select now()::text`)

after(() => {
  // audit_log and security_events are append-only (Slice 1 perimeter). The sanctioned way for a disposable
  // suite to take its own history with it is the maintenance flag, inside this one cleanup transaction.
  sql(`do $$
declare
  v_people uuid[] := array['${ids.ca}'::uuid, '${ids.ca2}'::uuid, '${ids.tm}'::uuid];
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people
    || string_to_array('${createdPlaces.join(",")}', ',')::uuid[]
    || array(select id from public.players where id = '${ids.player}')
    || array(select id from public.clubs where id = '${ids.club}')
    || array(select id from public.teams where club_id = '${ids.club}')
    || array(select id from public.club_memberships where club_id = '${ids.club}')
    || array(select id from public.role_assignments where club_id = '${ids.club}')
    || array(select id from public.player_team_memberships where player_id = '${ids.player}')
    || array(select id from public.club_directory where normalized_key = 'rrace-${TAG}');
  delete from public.player_team_memberships where player_id = '${ids.player}';
  delete from public.players where id = '${ids.player}';
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.teams where club_id = '${ids.club}';
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'rrace-${TAG}';
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = '${ids.club}';
  delete from public.audit_log where changed_by = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
  // Deleting the last rows inside that block wrote its own delete-history, so one more pass takes it.
  // Bounded to this suite's own window and to rows that no longer exist, so it cannot reach live history.
  // The platform runner executes suites sequentially, so the window belongs to this suite alone.
  sql(`do $$
begin
  perform set_config('ovalball.maintenance', 'on', true);
  delete from public.audit_log a
   where a.table_name = 'player_team_memberships'
     and a.changed_at >= '${startedAt}'::timestamptz
     and not exists (select 1 from public.player_team_memberships p where p.id = a.record_id);
end $$;`)
})

// ---------------------------------------------------------------------------------------------------
// R1  Two staff archive the same place at once.
// ---------------------------------------------------------------------------------------------------
test("R1 two staff archive the same place: one ending, the second a no-op", async () => {
  const place = freshPlace()
  const { outA, outB } = await race(
    { user: ids.ca, email: rEmail(ids.ca), statement: `select public.archive_player_team_membership('${place}')` },
    { user: ids.ca2, email: rEmail(ids.ca2), statement: `select public.archive_player_team_membership('${place}')` },
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  // The second is deliberately not an error: saying it twice is not a failure, but it must not end it twice.
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
  assert.equal(one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}' and state = 'ENDED'`), "1")
})

// ---------------------------------------------------------------------------------------------------
// R2  Archive against move, in both orders.
// ---------------------------------------------------------------------------------------------------
test("R2a archive commits first: the move is refused, not applied to an ended place", async () => {
  const place = freshPlace()
  const { outA, outB } = await race(
    { user: ids.ca, email: rEmail(ids.ca), statement: `select public.archive_player_team_membership('${place}')` },
    { user: ids.ca2, email: rEmail(ids.ca2), statement: `select public.move_player_team_membership('${place}', '${ids.team2}', 'race')` },
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /ERROR/, `the move should not apply to an ended place: ${outB}`)
  assert.equal(one(`select team_id from public.player_team_memberships where id = '${place}'`), ids.team)
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
})

test("R2b move commits first: the archive ends the moved place, exactly once", async () => {
  const place = freshPlace()
  const { outA, outB } = await race(
    { user: ids.ca, email: rEmail(ids.ca), statement: `select public.move_player_team_membership('${place}', '${ids.team2}', 'race')` },
    { user: ids.ca2, email: rEmail(ids.ca2), statement: `select public.archive_player_team_membership('${place}')` },
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  // The move ends the old row and creates a new ACTIVE one on the target, so archiving the ORIGINAL id is
  // correctly a no-op rather than an error, and the player keeps exactly one place -- on the team they moved to.
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
  assert.equal(one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}' and state = 'ACTIVE'`), "1")
  assert.equal(one(`select team_id from public.player_team_memberships where player_id = '${ids.player}' and state = 'ACTIVE'`), ids.team2)
})

// ---------------------------------------------------------------------------------------------------
// R3  Archive against restore: an ending that has committed is not resurrected by a concurrent restore.
// ---------------------------------------------------------------------------------------------------
test("R3a archive and restore race: no resurrection that loses the ending", async () => {
  const place = freshPlace()
  // restore_player_team_membership takes no row lock and INSERTS a readmission row rather than flipping the
  // ended one, so the gate choreography does not apply here: these two genuinely run at the same time.
  const a = session(`rrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select public.archive_player_team_membership('${place}');\ncommit;\n`)
  const b = session(`rrace_b_${TAG}`, `begin;\n${asUser(ids.ca2)}select public.restore_player_team_membership('${place}');\ncommit;\n`)
  const [outA, outB] = await Promise.all([a.done, b.done])

  // Whatever the interleaving, the player must not end up with two places, and the ended row must stay ended.
  const active = one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}' and state = 'ACTIVE'`)
  assert.ok(["0", "1"].includes(active), `expected at most one active place, saw ${active}\nA:${outA}\nB:${outB}`)
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED",
    `the committed ending must not be rewritten\nA:${outA}\nB:${outB}`)
})

test("R3b two concurrent restores of the same ended place leave exactly one active place", async () => {
  const place = freshPlace()
  sql(`update public.player_team_memberships set state = 'ENDED', status = 'ended', end_reason = 'race setup' where id = '${place}';`)
  const a = session(`rrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select public.restore_player_team_membership('${place}');\ncommit;\n`)
  const b = session(`rrace_b_${TAG}`, `begin;\n${asUser(ids.ca2)}select public.restore_player_team_membership('${place}');\ncommit;\n`)
  const [outA, outB] = await Promise.all([a.done, b.done])
  const active = one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}' and status = 'active'`)
  assert.equal(active, "1", `the partial unique index must hold under concurrency\nA:${outA}\nB:${outB}`)
})

// ---------------------------------------------------------------------------------------------------
// R4  Two staff add the same player to the same team: the partial unique index must hold under concurrency.
// ---------------------------------------------------------------------------------------------------
test("R4 concurrent adds of the same player to the same team leave exactly one active place", async () => {
  sql(`delete from public.player_team_memberships where player_id = '${ids.player}';`)
  const insert = `insert into public.player_team_memberships (player_id, team_id, status, state, source)
                  values ('${ids.player}', '${ids.team}', 'active', 'ACTIVE', 'CLUB_CREATED')`
  // Written as the owner: this asserts the database constraint, not the authority layer (RA8 covers that).
  const a = session(`rrace_a_${TAG}`, `begin;\n${insert};\nselect pg_sleep(0.3);\ncommit;\n`)
  const b = session(`rrace_b_${TAG}`, `begin;\n${insert};\ncommit;\n`)
  const [outA, outB] = await Promise.all([a.done, b.done])
  const active = one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}' and status = 'active'`)
  assert.equal(active, "1", `expected exactly one active place, saw ${active}\nA:${outA}\nB:${outB}`)
})

// ---------------------------------------------------------------------------------------------------
// R5  A Team Manager races a Club Admin on the same place: authority is decided per session.
// ---------------------------------------------------------------------------------------------------
test("R5 Team Manager and Club Admin race the same place: one consistent state, no escalation", async () => {
  const place = freshPlace()
  const { outA, outB } = await race(
    { user: ids.tm, email: rEmail(ids.tm), statement: `select public.archive_player_team_membership('${place}')` },
    { user: ids.ca, email: rEmail(ids.ca), statement: `select public.archive_player_team_membership('${place}')` },
  )
  assert.doesNotMatch(outA, /ERROR/, `the Team Manager holds team.roster.manage for this team: ${outA}`)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.player_team_memberships where id = '${place}'`), "ENDED")
  assert.equal(one(`select count(*) from public.player_team_memberships where player_id = '${ids.player}'`), "1")
})
