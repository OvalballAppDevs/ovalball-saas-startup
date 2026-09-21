import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * AGE-GRADE STATUS RACES (Convergence Step 12, §50).
 *
 * Step 12 adds no mutation: it adds readers over decisions other domains own. Its race surface is
 * therefore read-against-write, and the invariant is COHERENCE -- a coach reading the status while a
 * dispensation decision commits must get one of the two real answers, never a mixture and never a
 * default. Races that would only prove the dispensation state machine (which Step 12 does not own)
 * are deliberately not manufactured here.
 *
 *   R1  the status is read while a dispensation is approved    exactly one coherent answer, both before
 *                                                              and after, and never ELIGIBLE by accident
 *   R2  the status is read while the player leaves the team     the roster decides membership; a departed
 *                                                              player simply stops being listed
 *   R3  two readers at once agree                               the same answer twice, no interleaving
 *
 * Everything it creates is removed at the end.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const REF = "2026-11-15"

function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], {
    input: query,
    encoding: "utf8",
  }).trim()
}
const one = (query: string) => sql(query).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

function session(name: string, script: string): { done: Promise<string>; proc: ChildProcessWithoutNullStreams } {
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

/** One statement, as one person, in its own transaction — the claims are transaction-scoped. */
function asUser(userId: string, statement: string): string {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" })
  return `begin;\nselect set_config('request.jwt.claims', '${claims}', true);\nset local role authenticated;\n${statement}\nreset role;\ncommit;\n`
}

const id = { coach: randomUUID(), dir: "", club: "", u12: "", u13: "", player: "", season: "", disp: "" }

function seed() {
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
         email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('${id.coach}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         's12race-${TAG}@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
       insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${id.coach}', 'Race', 'Twelve', 's12race-${TAG}@ovalball.test', (current_date - interval '40 years')::date)
       on conflict (id) do nothing;`)
  id.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                values ('S12 Race RUFC ${TAG}', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's12race-${TAG}')
                returning id`)
  id.club = one(`insert into public.clubs (directory_id, slug, status) values ('${id.dir}', 's12race-${TAG}', 'active') returning id`)
  id.u12 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
                values ('${id.club}', 'Under 12 Boys', 's12race-u12-${TAG}', 'youth', 'U12', 'boys', 'union', true) returning id`)
  id.u13 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
                values ('${id.club}', 'Under 13 Boys', 's12race-u13-${TAG}', 'youth', 'U13', 'boys', 'union', true) returning id`)
  const ms = one(`insert into public.club_memberships (club_id, user_id, role, status)
                  values ('${id.club}', '${id.coach}', 'BASIC_USER', 'active') returning id`)
  sql(`insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
       values ('${id.coach}', '${ms}', '${id.club}', '${id.u12}', 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT')`)

  id.season = one(`select internal.resolve_season_for_date('union', date '${REF}')::text`)
  // A player one school year older than this side, so the un-dispensed answer is OUTSIDE_AGE_GRADE.
  const cutoff = one(`select r.age_grade_cutoff_date::text from internal.resolve_player_age_grade('union', '${id.season}', date '2015-01-01') r`)
  const dob = one(`select (date '${cutoff}' - interval '13 years')::date::text`)
  id.player = one(`insert into public.players (first_name, surname, date_of_birth, playing_pathway)
                   values ('Rae', 'Race ${TAG}', date '${dob}', 'MALE') returning id`)
  sql(`insert into public.player_team_memberships (player_id, team_id, state) values ('${id.player}', '${id.u12}', 'ACTIVE')`)
}

function freshDispensation(status: string): string {
  sql(`delete from public.player_team_dispensation where player_id = '${id.player}'`)
  return one(`insert into public.player_team_dispensation
                (player_id, source_team_id, target_team_id, season_id, status, requested_by, eligibility_rule_reference)
              values ('${id.player}', '${id.u13}', '${id.u12}', '${id.season}', '${status}', '${id.coach}',
                      'S12 race: exception recorded as an exception')
              returning id`)
}

seed()

after(() => {
  sql(`delete from public.player_team_dispensation where player_id = '${id.player}';
       delete from public.player_team_memberships where team_id in ('${id.u12}', '${id.u13}');
       delete from public.players where id = '${id.player}';
       delete from public.role_assignments where club_id = '${id.club}';
       delete from public.club_memberships where club_id = '${id.club}';
       delete from public.teams where club_id = '${id.club}';
       delete from public.clubs where id = '${id.club}';
       delete from public.club_directory where id = '${id.dir}';
       delete from public.profiles where id = '${id.coach}';
       delete from auth.users where id = '${id.coach}';`)
})

test("R1 a status read racing a dispensation approval gets one coherent answer", async () => {
  id.disp = freshDispensation("requested")
  const before = one(
    `begin; select set_config('request.jwt.claims','{"sub":"${id.coach}","role":"authenticated"}',true);
     set local role authenticated;
     select status from public.team_age_grade_attention('${id.u12}', date '${REF}') where player_id = '${id.player}';
     reset role; commit;`
  )
  assert.equal(before, "DISPENSATION_PENDING", "a requested dispensation reads as pending")

  const [reader, writer] = [
    session(
      `s12r1r_${TAG}`,
      asUser(id.coach, `select status from public.team_age_grade_attention('${id.u12}', date '${REF}') where player_id = '${id.player}';`)
    ),
    session(`s12r1w_${TAG}`, `update public.player_team_dispensation set status = 'approved' where id = '${id.disp}';\n`),
  ]
  const [readerOut] = await Promise.all([reader.done, writer.done])

  // Either answer is correct; a third one would not be.
  const saw = ["DISPENSATION_PENDING", "DISPENSATION_APPROVED"].filter((s) => readerOut.includes(s))
  assert.equal(saw.length, 1, `expected exactly one coherent answer, saw: ${saw.join(",")}`)
  assert.ok(!readerOut.includes("ELIGIBLE"), "the reader must never report eligible by accident")

  const after_ = one(
    `begin; select set_config('request.jwt.claims','{"sub":"${id.coach}","role":"authenticated"}',true);
     set local role authenticated;
     select status from public.team_age_grade_attention('${id.u12}', date '${REF}') where player_id = '${id.player}';
     reset role; commit;`
  )
  assert.equal(after_, "DISPENSATION_APPROVED", "and afterwards the approved decision is what is reported")
})

test("R2 a player leaving the team as the status is read simply stops being listed", async () => {
  freshDispensation("requested")
  const [reader, mover] = [
    session(
      `s12r2r_${TAG}`,
      asUser(id.coach, `select count(*) from public.team_age_grade_attention('${id.u12}', date '${REF}');`)
    ),
    session(
      `s12r2m_${TAG}`,
      `update public.player_team_memberships set state = 'ENDED', ended_at = now()
        where player_id = '${id.player}' and team_id = '${id.u12}';\n`
    ),
  ]
  await Promise.all([reader.done, mover.done])

  const rows = one(
    `begin; select set_config('request.jwt.claims','{"sub":"${id.coach}","role":"authenticated"}',true);
     set local role authenticated;
     select count(*) from public.team_age_grade_attention('${id.u12}', date '${REF}');
     reset role; commit;`
  )
  assert.equal(rows, "0", "the roster decides who is listed, so a departed player is not")

  // The dispensation row itself is untouched by the reader: history is not rewritten by reading it.
  assert.equal(
    one(`select count(*) from public.player_team_dispensation where player_id = '${id.player}'`),
    "1",
    "reading a status must not alter the decision behind it"
  )
})

test("R3 two simultaneous readers agree", async () => {
  // A finished team place is final, as the schema says: the player is ADDED AGAIN rather than
  // switched back on, which is what the product would actually do.
  sql(`delete from public.player_team_memberships where player_id = '${id.player}' and team_id = '${id.u12}';
       insert into public.player_team_memberships (player_id, team_id, state) values ('${id.player}', '${id.u12}', 'ACTIVE');`)
  freshDispensation("approved")
  const script = asUser(id.coach, `select status from public.team_age_grade_attention('${id.u12}', date '${REF}') where player_id = '${id.player}';`)
  const [a, b] = [session(`s12r3a_${TAG}`, script), session(`s12r3b_${TAG}`, script)]
  const [outA, outB] = await Promise.all([a.done, b.done])
  assert.ok(
    outA.includes("DISPENSATION_APPROVED") && outB.includes("DISPENSATION_APPROVED"),
    "two readers at once must see the same committed answer"
  )
})
