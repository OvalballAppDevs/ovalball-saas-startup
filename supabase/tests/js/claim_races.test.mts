import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * CLUB CLAIM RACES (Identity/Auth Slice 5, Phase 2 race R12).
 *
 *   R12  two reviewers approving competing claims for the same club at once
 *
 * This is the race the directory-row lock exists for. Two people claim the same club; two Site
 * Admins open the queue and approve one each. Without the lock both approvals run: two clubs could be
 * created for one directory entry, or one club could acquire two administrators who each believe they
 * are the one, and nothing would record that the other claim had ever been live.
 *
 * Everything it creates is removed at the end, including its audit history.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const startedAt = new Date().toISOString()

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
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

const email = (id: string) => `crace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) => `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated" })}', true);\n`

const ids = { a: randomUUID(), b: randomUUID(), admin1: randomUUID(), admin2: randomUUID(), dir: "" }

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Crace', '${label}', '${email(id)}', (current_date - interval '38 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["a","A"],["b","B"],["admin1","AD1"],["admin2","AD2"]] as const) {
    person((ids as never as Record<string,string>)[k], v)
  }
  sql(`insert into public.site_admins (user_id, status, admin_role) values
       ('${ids.admin1}','active','full'), ('${ids.admin2}','active','full')
       on conflict (user_id) do update set status = 'active'`)
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Crace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','crace-${TAG}') returning id`)
}
seed()

test("R12 two reviewers approving competing claims for one club leave exactly one approval", async () => {
  const claimA = one(`begin;\n${asUser(ids.a)}select public.submit_club_claim('${ids.dir}', 'Club Secretary', 'I am the secretary', '{}'::jsonb);\ncommit;`)
  const claimB = one(`begin;\n${asUser(ids.b)}select public.submit_club_claim('${ids.dir}', 'Treasurer', 'I am the treasurer', '{}'::jsonb);\ncommit;`)
  assert.ok(claimA && claimB && claimA !== claimB, "the two competing claims were not created")

  const decide = (admin: string, claim: string, n: string) =>
    session(`crace_${n}_${TAG}`,
      `begin;\n${asUser(admin)}select public.decide_club_claim('${claim}', 'APPROVED', 'raced approval ${n}', null);\ncommit;\n`)
  const [o1, o2] = await Promise.all([decide(ids.admin1, claimA, "1").done, decide(ids.admin2, claimB, "2").done])

  const approved = Number(one(`select count(*) from public.club_claims where directory_id = '${ids.dir}' and state = 'APPROVED'`))
  const superseded = Number(one(`select count(*) from public.club_claims where directory_id = '${ids.dir}' and state = 'SUPERSEDED'`))
  const clubs = Number(one(`select count(*) from public.clubs where directory_id = '${ids.dir}'`))

  assert.equal(approved, 1, `${approved} claims were approved for one club\n1:${o1}\n2:${o2}`)
  assert.equal(superseded, 1, `the losing claim is ${superseded === 0 ? "still live" : "in an unexpected state"}\n1:${o1}\n2:${o2}`)
  assert.equal(clubs, 1, `${clubs} clubs were created for one directory entry\n1:${o1}\n2:${o2}`)

  // And the losing claim says which claim beat it, so the rival can be told something true.
  const supersededBy = one(`select superseded_by_claim_id from public.club_claims where directory_id = '${ids.dir}' and state = 'SUPERSEDED'`)
  const winner = one(`select id from public.club_claims where directory_id = '${ids.dir}' and state = 'APPROVED'`)
  assert.equal(supersededBy, winner, "the superseded claim does not point at the claim that beat it")

  // Exactly one administrator, not two who each believe they are the one.
  const admins = Number(one(`select count(*) from public.role_assignments ra
    join public.club_memberships m on m.id = ra.membership_id
    join public.clubs c on c.id = m.club_id
    where c.directory_id = '${ids.dir}' and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE'`))
  assert.ok(admins <= 1, `the raced approvals produced ${admins} Club Admins\n1:${o1}\n2:${o2}`)
})

after(() => {
  const people = [ids.a, ids.b, ids.admin1, ids.admin2]
  sql(`do $$
declare v_people uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
        v_clubs uuid[] := array(select id from public.clubs where directory_id = '${ids.dir}');
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from public.club_claim_messages where claim_id in (select id from public.club_claims where directory_id = '${ids.dir}');
  delete from public.club_claims where directory_id = '${ids.dir}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.security_events where actor_user_id = any(v_people) or club_id = any(v_clubs);
  delete from public.platform_trials where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key = 'crace-${TAG}';
  delete from public.site_admins where user_id = any(v_people);
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.changed_at >= '${startedAt}'::timestamptz
           and a.table_name in ('club_claims','clubs','club_memberships','role_assignments','club_directory','profiles','teams')
           and not exists (select 1 from public.club_claims x where x.id = a.record_id)
           and not exists (select 1 from public.clubs x where x.id = a.record_id)
           and not exists (select 1 from public.club_memberships x where x.id = a.record_id)
           and not exists (select 1 from public.role_assignments x where x.id = a.record_id)
           and not exists (select 1 from public.profiles x where x.id = a.record_id); end $$;`)
})
