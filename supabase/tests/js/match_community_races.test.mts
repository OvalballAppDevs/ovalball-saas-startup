import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * MATCH COMMUNITY RACES (Convergence Step 11, §32).
 *
 * The community writes, raced by real database sessions. Nothing here is decided by a sleep: each
 * race runs both sides genuinely concurrently and then asserts the PERSISTED state, because the
 * only duplicate-prevention that matters is the one a double click, two tabs and a replayed request
 * all lose to.
 *
 *   R1  one voter submits twice at once          exactly one vote row -- the unique constraint, not the UI
 *   R2  two voters submit at once                both land; neither overwrites the other
 *   R3  a vote races the award closing           deterministic: the vote is either counted or refused,
 *                                                and a closed award never gains a vote afterwards
 *   R4  two admins close at once                 ONE decision: one outcome, one closer, one winner
 *   R5  the winner leaves the team as it closes  the award keeps the team and match it was won with
 *
 * Everything it creates is removed at the end.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)

function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], {
    input: query,
    encoding: "utf8",
  }).trim()
}
const one = (query: string) => sql(query).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

interface Session {
  done: Promise<string>
  proc: ChildProcessWithoutNullStreams
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

/**
 * A session script that runs one statement as one person, in its own transaction. The transaction is
 * not optional: `set_config(..., true)` and `set local role` are transaction-scoped, and without it
 * the claims are discarded before the RPC is reached and every call is refused as unsigned-in.
 */
function asUser(userId: string, statement: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", email: `s11race-${TAG}-${userId}@ovalball.test` })
  return `begin;\nselect set_config('request.jwt.claims', '${claims}', true);\nset local role authenticated;\n${statement}\nreset role;\ncommit;\n`
}

// -------------------------------------------------------------------------------------------------
// Seed: one club, one youth side, two coaches (both authorised to administer), two parents with a
// child each on the roster, and one played fixture.
// -------------------------------------------------------------------------------------------------
const id = {
  coachA: randomUUID(),
  coachB: randomUUID(),
  parentA: randomUUID(),
  parentB: randomUUID(),
  club: "",
  team: "",
  childA: "",
  childB: "",
  fixture: "",
  award: "",
  dir: "",
}

function seed() {
  const people = [id.coachA, id.coachB, id.parentA, id.parentB]
  for (const person of people) {
    sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
           raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
           email_change_token_current, phone_change, phone_change_token, reauthentication_token)
         values ('${person}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           's11race-${TAG}-${person}@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
         insert into public.profiles (id, first_name, surname, email, date_of_birth)
         values ('${person}', 'Race', 'Eleven', 's11race-${TAG}-${person}@ovalball.test', (current_date - interval '38 years')::date)
         on conflict (id) do nothing;`)
  }
  id.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                values ('S11 Race RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's11race-${TAG}')
                returning id`)
  id.club = one(`insert into public.clubs (directory_id, slug, status) values ('${id.dir}', 's11race-${TAG}', 'active') returning id`)
  id.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
                 values ('${id.club}', 'Under 12 Boys', 's11race-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)

  for (const [person, role] of [
    [id.coachA, "COACH"],
    [id.coachB, "COACH"],
    [id.parentA, null],
    [id.parentB, null],
  ] as [string, string | null][]) {
    const ms = one(`insert into public.club_memberships (club_id, user_id, role, status)
                    values ('${id.club}', '${person}', 'BASIC_USER', 'active') returning id`)
    if (role) {
      sql(`insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
           values ('${person}', '${ms}', '${id.club}', '${id.team}', '${role}', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT')`)
    }
  }

  id.childA = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
                   values ('Rio', 'RaceA ${TAG}', (current_date - interval '11 years')::date, 'MALE') returning id`)
  id.childB = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
                   values ('Sam', 'RaceB ${TAG}', (current_date - interval '11 years')::date, 'MALE') returning id`)
  sql(`insert into public.player_team_memberships (player_id, team_id, state) values
         ('${id.childA}', '${id.team}', 'ACTIVE'), ('${id.childB}', '${id.team}', 'ACTIVE');
       insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
         ('${id.parentA}', '${id.childA}', 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', '${id.parentA}'),
         ('${id.parentB}', '${id.childB}', 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', '${id.parentB}');`)

  id.fixture = one(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
                    values ('${id.team}', 'Home', 'Race Opposition RFC ${TAG}', current_date - 7, 'Completed', 'club_created', 20, 15, 'external_recorded')
                    returning id`)
  sql(`insert into public.team_award_category_settings (team_id, category_key, enabled)
       values ('${id.team}', 'FAMILY_OR_SELF_PLAYER', true)`)
}

function openAward(): string {
  return one(`begin;
              select set_config('request.jwt.claims', '{"sub":"${id.coachA}","role":"authenticated"}', true);
              set local role authenticated;
              select public.open_match_award('${id.fixture}', '${id.team}', 'FAMILY_OR_SELF_PLAYER');
              reset role;
              commit;`)
}

function reopen() {
  // Each race needs a fresh open award; the row is the unit under test, so it is rebuilt rather
  // than mutated back into shape.
  sql(`delete from public.match_award_votes where award_id in (select id from public.match_awards where fixture_id = '${id.fixture}');
       delete from public.match_awards where fixture_id = '${id.fixture}';`)
  id.award = openAward()
}

seed()

after(() => {
  sql(`delete from public.match_award_votes where award_id in (select id from public.match_awards where fixture_id = '${id.fixture}');
       delete from public.match_awards where fixture_id = '${id.fixture}';
       delete from public.match_kudos where fixture_id = '${id.fixture}';
       delete from public.team_award_category_settings where team_id = '${id.team}';
       delete from public.fixtures where id = '${id.fixture}';
       delete from public.guardians where player_id in ('${id.childA}', '${id.childB}');
       delete from public.player_team_memberships where team_id = '${id.team}';
       delete from public.players where id in ('${id.childA}', '${id.childB}');
       delete from public.role_assignments where club_id = '${id.club}';
       delete from public.club_memberships where club_id = '${id.club}';
       delete from public.teams where club_id = '${id.club}';
       delete from public.clubs where id = '${id.club}';
       delete from public.club_directory where id = '${id.dir}';
       delete from public.profiles where id in ('${id.coachA}', '${id.coachB}', '${id.parentA}', '${id.parentB}');
       delete from auth.users where id in ('${id.coachA}', '${id.coachB}', '${id.parentA}', '${id.parentB}');`)
})

test("R1 one voter submitting twice at once leaves exactly one vote", async () => {
  reopen()
  const script = (n: string) =>
    asUser(id.parentA, `select public.cast_match_award_vote('${id.award}', '${id.childA}'); -- ${n}`)
  const [a, b] = [session(`s11r1a_${TAG}`, script("a")), session(`s11r1b_${TAG}`, script("b"))]
  await Promise.all([a.done, b.done])

  const rows = one(`select count(*) from public.match_award_votes where award_id = '${id.award}' and voter_user_id = '${id.parentA}'`)
  assert.equal(rows, "1", "a double submission must not become two votes")
})

test("R2 two different voters at once both land", async () => {
  reopen()
  const [a, b] = [
    session(`s11r2a_${TAG}`, asUser(id.parentA, `select public.cast_match_award_vote('${id.award}', '${id.childA}');`)),
    session(`s11r2b_${TAG}`, asUser(id.parentB, `select public.cast_match_award_vote('${id.award}', '${id.childB}');`)),
  ]
  await Promise.all([a.done, b.done])

  assert.equal(one(`select count(*) from public.match_award_votes where award_id = '${id.award}'`), "2")
  assert.equal(
    one(`select count(distinct voter_user_id) from public.match_award_votes where award_id = '${id.award}'`),
    "2",
    "one voter must not overwrite the other"
  )
})

test("R3 a vote racing the close is either counted or refused, and never lands on a closed award", async () => {
  reopen()
  const [voter, closer] = [
    session(`s11r3v_${TAG}`, asUser(id.parentA, `select public.cast_match_award_vote('${id.award}', '${id.childA}');`)),
    session(`s11r3c_${TAG}`, asUser(id.coachA, `select public.close_match_award('${id.award}');`)),
  ]
  const [voterOut] = await Promise.all([voter.done, closer.done])

  const status = one(`select status from public.match_awards where id = '${id.award}'`)
  assert.equal(status, "CLOSED", "the close must land")

  const votes = Number(one(`select count(*) from public.match_award_votes where award_id = '${id.award}'`))
  const refused = /Voting has closed|ERROR/.test(voterOut)
  // Deterministic either way: counted before the close, or refused. What must not happen is a vote
  // that was refused yet persisted, or accepted yet lost.
  assert.ok(
    (votes === 1 && !refused) || (votes === 0 && refused) || (votes === 1 && refused === false),
    `inconsistent outcome: ${votes} vote(s), refused=${refused}`
  )

  // And afterwards the closed award cannot gain one.
  const late = session(`s11r3l_${TAG}`, asUser(id.parentB, `select public.cast_match_award_vote('${id.award}', '${id.childB}');`))
  await late.done
  assert.equal(
    one(`select count(*) from public.match_award_votes where award_id = '${id.award}' and voter_user_id = '${id.parentB}'`),
    "0",
    "a closed award must not accept a late vote"
  )
})

test("R4 two admins closing at once produce one decision", async () => {
  reopen()
  sql(`insert into public.match_award_votes (award_id, voter_user_id, player_id)
       values ('${id.award}', '${id.parentA}', '${id.childA}'), ('${id.award}', '${id.parentB}', '${id.childA}')`)

  const [a, b] = [
    session(`s11r4a_${TAG}`, asUser(id.coachA, `select public.close_match_award('${id.award}');`)),
    session(`s11r4b_${TAG}`, asUser(id.coachB, `select public.close_match_award('${id.award}');`)),
  ]
  await Promise.all([a.done, b.done])

  const row = one(`select status || '|' || outcome || '|' || coalesce(winner_player_id::text,'-') || '|' ||
                          (select count(distinct closed_by)::text from public.match_awards where id = '${id.award}')
                     from public.match_awards where id = '${id.award}'`)
  assert.equal(row, `CLOSED|WINNER|${id.childA}|1`, "one closure, one outcome, one winner, one closer")
})

test("R5 the winner leaving the team as it closes does not rewrite the award", async () => {
  reopen()
  sql(`insert into public.match_award_votes (award_id, voter_user_id, player_id)
       values ('${id.award}', '${id.parentA}', '${id.childA}')`)

  const [closer, mover] = [
    session(`s11r5c_${TAG}`, asUser(id.coachA, `select public.close_match_award('${id.award}');`)),
    session(
      `s11r5m_${TAG}`,
      `update public.player_team_memberships set state = 'ENDED', ended_at = now()
         where player_id = '${id.childA}' and team_id = '${id.team}';\n`
    ),
  ]
  await Promise.all([closer.done, mover.done])

  const kept = one(`select winner_player_id::text || '|' || team_id::text || '|' || fixture_id::text
                      from public.match_awards where id = '${id.award}'`)
  assert.equal(kept, `${id.childA}|${id.team}|${id.fixture}`, "history stays attached to the match and team it was won with")

  // Not switched back on: a finished team place is final in this schema, and the teardown removes
  // the row outright rather than asking it to pretend otherwise.
})
