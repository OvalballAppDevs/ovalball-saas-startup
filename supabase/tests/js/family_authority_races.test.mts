import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * FAMILY AUTHORITY RACES (Identity/Auth Slice 4a, Phase 2 AD).
 *
 * The relationship transitions Slice 4a moved to the canonical decision, raced by two real database sessions with
 * the deterministic gate choreography of membership_races.test.mts (session A holds its locks behind an advisory
 * gate; B is seen blocked behind A before the gate opens):
 *
 *   F1a  Ovalball's hold commits first, the club's removal second   the removal ends the held relationship
 *   F1b  the club's removal commits first, the hold second          the hold is refused: nothing active to hold
 *   F2   two Club Admins approve the same additional guardian        exactly one approval; one relationship
 *   F3   the guardian ends their own relationship while Ovalball    the hold is refused; the guardian's ending
 *        places a hold                                              stands
 *
 * Everything it creates is removed at the end, including its audit, notification and security-event history.
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

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const ids = {
  admin1: randomUUID(),
  admin2: randomUUID(),
  site: randomUUID(),
  parent: randomUUID(),
  added: randomUUID(),
  club: "",
  team: "",
}
const email = (id: string) => `frace-${TAG}-${id}@ovalball.test`
const people = [ids.admin1, ids.admin2, ids.site, ids.parent, ids.added]

function seed() {
  const users = people
    .map(
      (id) => `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '', now(), now(), now(),
        '{}', '{}', '', '', '', '', '', '', '', '');
      insert into public.profiles (id, first_name, surname, email) values ('${id}', 'Race', 'Tester', '${email(id)}') on conflict (id) do nothing;`
    )
    .join("\n")
  sql(`${users}
    with d as (
      insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
      values ('Family Race RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'frace-${TAG}') returning id
    )
    insert into public.clubs (directory_id, slug, status) select id, 'frace-${TAG}', 'active' from d;`)
  ids.club = one(`select id from public.clubs where slug = 'frace-${TAG}'`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}', 'Under 12 Boys', 'frace-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.club}', '${ids.admin1}', 'CLUB_ADMIN', 'active'),
      ('${ids.club}', '${ids.admin2}', 'CLUB_ADMIN', 'active');
    insert into public.site_admins (user_id, status, admin_role) values ('${ids.site}', 'active', 'full');`)
}

/** Removes everything a run tagged `tag` created (also used to clear a crashed run's rows). */
function cleanup(tag = TAG) {
  sql(`
do $$
declare
  v_club uuid := (select id from public.clubs where slug = 'frace-${tag}');
  v_people uuid[] := array(select id from auth.users where email like 'frace-${tag}-%@ovalball.test');
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
    || array(select id from public.club_directory where normalized_key = 'frace-${tag}');
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
  delete from public.club_directory where normalized_key = 'frace-${tag}';
  -- On a database with no other Full Site Admin (a clean boot) the last-admin guard would keep this disposable one.
  -- Only then, and only inside this cleanup transaction, the guard is set aside for this one delete.
  if not exists (select 1 from public.site_admins where status = 'active' and profile_key = 'SITE_FULL' and not (user_id = any(v_people))) then
    alter table public.site_admins disable trigger prevent_last_full_admin_lockout;
    delete from public.site_admins where user_id = any(v_people);
    alter table public.site_admins enable trigger prevent_last_full_admin_lockout;
  else
    delete from public.site_admins where user_id = any(v_people);
  end if;
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
  const left = one(`select (select count(*) from public.clubs where slug = 'frace-${TAG}') || '|' || (select count(*) from auth.users where email like 'frace-${TAG}-%')
    || '|' || (select count(*) from pg_stat_activity where application_name like 'frace_%_${TAG}')`)
  assert.equal(left, "0|0|0", `the race test left rows or sessions behind (clubs|users|sessions = ${left})`)
})

/** A placed child with the parent as ACTIVE guardian; returns the player and the relationship. */
function seedChild() {
  const player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Race', 'Family ${TAG}', current_date - 4200, 'MALE') returning id`)
  sql(`insert into public.player_team_memberships (player_id, team_id, status) values ('${player}', '${ids.team}', 'active');
       insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values ('${ids.parent}', '${player}', 'parent', 'active');`)
  return { player, relationship: one(`select id from public.guardians where guardian_user_id = '${ids.parent}' and player_id = '${player}'`) }
}

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

test("F1a: Ovalball's hold commits first -- the club's removal then ends the held relationship", async () => {
  const { relationship } = seedChild()
  const { outA, outB } = await race(
    { user: ids.site, email: email(ids.site), statement: `select public.transition_guardian_relationship('${relationship}', 'SUSPENDED', 'race hold', false)` },
    { user: ids.admin1, email: email(ids.admin1), statement: `select * from public.remove_guardian_relationship('${relationship}', 'race removal')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.doesNotMatch(outB, /ERROR/, outB)
  assert.equal(one(`select state from public.guardians where id = '${relationship}'`), "REVOKED")
})

test("F1b: the club's removal commits first -- the hold is refused, there is nothing active to hold", async () => {
  const { relationship } = seedChild()
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select * from public.remove_guardian_relationship('${relationship}', 'race removal')` },
    { user: ids.site, email: email(ids.site), statement: `select public.transition_guardian_relationship('${relationship}', 'SUSPENDED', 'race hold', false)` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /Only an active relationship can be put on hold/, outB)
  assert.equal(one(`select state from public.guardians where id = '${relationship}'`), "REVOKED")
  assert.equal(one(`select suspension_reason is null from public.guardians where id = '${relationship}'`), "t")
})

test("F2: two Club Admins approve the same additional guardian -- exactly one approval", async () => {
  const { player } = seedChild()
  const request = one(`
    select set_config('request.jwt.claims', '${JSON.stringify({ sub: ids.parent, role: "authenticated" })}', false);
    select request_id from public.request_additional_guardian('${player}', '${email(ids.added)}');`)
  sql(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: ids.added, role: "authenticated", email: email(ids.added) })}', false);
       select public.respond_to_additional_guardian_request('${request}', 'ACCEPT');`)
  const { outA, outB } = await race(
    { user: ids.admin1, email: email(ids.admin1), statement: `select * from public.approve_guardian_link_request('${request}')` },
    { user: ids.admin2, email: email(ids.admin2), statement: `select * from public.approve_guardian_link_request('${request}')` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /already been decided/, outB)
  assert.equal(one(`select count(*) from public.guardians where guardian_user_id = '${ids.added}' and player_id = '${player}' and state = 'ACTIVE'`), "1")
  assert.equal(one(`select count(*) from public.guardians where guardian_user_id = '${ids.added}' and player_id = '${player}'`), "1")
})

test("F3: the guardian ends their own relationship while Ovalball places a hold -- the ending stands", async () => {
  const { relationship } = seedChild()
  const { outA, outB } = await race(
    { user: ids.parent, email: email(ids.parent), statement: `select public.transition_guardian_relationship('${relationship}', 'REVOKED', null)` },
    { user: ids.site, email: email(ids.site), statement: `select public.transition_guardian_relationship('${relationship}', 'SUSPENDED', 'race hold', false)` }
  )
  assert.doesNotMatch(outA, /ERROR/, outA)
  assert.match(outB, /Only an active relationship can be put on hold/, outB)
  assert.equal(one(`select state from public.guardians where id = '${relationship}'`), "REVOKED")
})
