import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * SAFEGUARDING AUTHORITY RACES (Identity/Auth Slice 4G, Phase 2 AD, AA.3 row 4g).
 *
 * The transitions 4G owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  two Club Admins nominate the same person at once   one nomination, not two
 *   R2  two Site Admins confirm the same nomination at once  one confirmation, one confirmer
 *   R3  confirmation races deactivation                      one terminal state, and the authority
 *                                                            that results matches the state recorded
 *   R4  confirmation races the loss of the nominee's membership  a person removed from the club is
 *                                                            never confirmed into its safeguarding role
 *
 * R3 and R4 are the pair that matters. Both are moments where a confirmation could land on a person
 * who is, by the time it lands, not somebody the club wants holding safeguarding authority -- and
 * "the row said ACTIVE but the capability said no" would be a worse outcome than either.
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

const sEmail = (id: string) => `srace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", email: sEmail(id) })}', true);\nset local role authenticated;\n`

const ids = {
  ca: randomUUID(), ca2: randomUUID(), nom: randomUUID(), sa: randomUUID(), sa2: randomUUID(),
  club: "", dir: "", nomMembership: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${sEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Srace', '${label}', '${sEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["ca","CA"],["ca2","CA2"],["nom","NOM"],["sa","SA"],["sa2","SA2"]] as const) person((ids as never as Record<string,string>)[k], v)
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Srace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','srace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','srace-${TAG}','active') returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
       ('${ids.club}','${ids.ca}','CLUB_ADMIN','active'),('${ids.club}','${ids.ca2}','CLUB_ADMIN','active')`)
  ids.nomMembership = one(`insert into public.club_memberships (club_id, user_id, role, status)
       values ('${ids.club}','${ids.nom}','BASIC_USER','active') returning id`)
  sql(`insert into public.site_admins (user_id, status, admin_role) values ('${ids.sa}','active','full'),('${ids.sa2}','active','full')
       on conflict (user_id) do update set status='active', admin_role='full'`)
}
seed()

const clearNominations = () => sql(`delete from public.role_assignments where club_id = '${ids.club}' and role_key = 'SAFEGUARDING_OFFICER';
  update public.club_memberships set state='ACTIVE', status='active' where id = '${ids.nomMembership}';`)
// The setup nomination runs as the Club Admin, like every other nomination: the RPC refuses an
// unauthenticated caller, and a race harness that reached around its own gate would be testing
// something the product cannot do.
const nominate = () =>
  one(`begin;\n${asUser(ids.ca)}select (public.nominate_club_safeguarding_officer('${ids.club}','${ids.nom}','primary','race setup') ->> 'assignment_id');\ncommit;`)

test("R1 two Club Admins nominating the same person at once leave one nomination, not two", async () => {
  clearNominations()
  const script = (who: string) =>
    `begin;\n${asUser(who)}select public.nominate_club_safeguarding_officer('${ids.club}','${ids.nom}','primary','raced');\ncommit;\n`
  const a = session(`srace_a_${TAG}`, script(ids.ca))
  const b = session(`srace_b_${TAG}`, script(ids.ca2))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const rows = one(`select count(*) from public.role_assignments where club_id='${ids.club}' and user_id='${ids.nom}' and role_key='SAFEGUARDING_OFFICER'`)
  assert.equal(rows, "1", `two concurrent nominations produced ${rows} assignments\nA:${oa}\nB:${ob}`)
  const pending = one(`select confirmation_state from public.role_assignments where club_id='${ids.club}' and user_id='${ids.nom}' and role_key='SAFEGUARDING_OFFICER'`)
  assert.equal(pending, "PENDING_CONFIRMATION", `a raced nomination confirmed itself\nA:${oa}\nB:${ob}`)
})

test("R2 two Site Admins confirming the same nomination at once confirm it once, with one confirmer", async () => {
  clearNominations()
  const assignment = nominate()
  const script = (who: string) =>
    `begin;\n${asUser(who)}select public.confirm_safeguarding_officer('${assignment}','raced confirmation');\ncommit;\n`
  const a = session(`srace_a_${TAG}`, script(ids.sa))
  const b = session(`srace_b_${TAG}`, script(ids.sa2))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const row = sql(`select confirmation_state || ' ' || coalesce(confirmed_by::text,'-') from public.role_assignments where id = '${assignment}'`).trim()
  assert.match(row, /^CONFIRMED /, `the raced confirmation did not settle\nA:${oa}\nB:${ob}`)
  const confirmedBy = row.split(/\s+/)[1]
  assert.ok(([ids.sa, ids.sa2] as string[]).includes(confirmedBy), `confirmed_by is not one of the two racers: ${row}`)
  // Exactly one of the two got to do it: the other must have been refused, not silently ignored.
  const refusals = [oa, ob].filter((o) => /already confirmed/i.test(o)).length
  assert.equal(refusals, 1, `one confirmation should be refused as already-confirmed\nA:${oa}\nB:${ob}`)
})

test("R3 confirmation racing deactivation leaves one state, and the authority matches it", async () => {
  clearNominations()
  const assignment = nominate()
  const a = session(`srace_a_${TAG}`, `begin;\n${asUser(ids.sa)}select public.confirm_safeguarding_officer('${assignment}','raced against deactivation');\ncommit;\n`)
  const b = session(`srace_b_${TAG}`, `begin;\n${asUser(ids.ca)}select internal.end_role('${assignment}','REVOKED','raced deactivation',null);\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const row = sql(`select state || ' ' || coalesce(confirmation_state,'-') from public.role_assignments where id = '${assignment}'`).trim()
  const holds = one(`select count(*) from unnest(internal.active_safeguarding_officer_ids('${ids.club}')) u where u = '${ids.nom}'`)
  // Whichever won, the capability answer has to agree with the row. A REVOKED assignment that still
  // grants, or an ACTIVE CONFIRMED one that does not, would be the real failure here.
  if (row.startsWith("REVOKED")) {
    assert.equal(holds, "0", `a revoked assignment still grants safeguarding authority (${row})\nA:${oa}\nB:${ob}`)
  } else {
    assert.equal(row, "ACTIVE CONFIRMED", `unexpected settled state ${row}\nA:${oa}\nB:${ob}`)
    assert.equal(holds, "1", `a confirmed active assignment grants nothing (${row})\nA:${oa}\nB:${ob}`)
  }
})

test("R4 a nominee who loses their membership as confirmation lands is never confirmed into the role", async () => {
  clearNominations()
  const assignment = nominate()
  const a = session(`srace_a_${TAG}`, `begin;\n${asUser(ids.sa)}select public.confirm_safeguarding_officer('${assignment}','raced against removal');\ncommit;\n`)
  const b = session(`srace_b_${TAG}`, `begin;\nselect internal.lock_club_people('${ids.club}');\nupdate public.club_memberships set state='REVOKED', status='revoked' where id='${ids.nomMembership}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const state = one(`select confirmation_state from public.role_assignments where id = '${assignment}'`)
  const membership = one(`select state from public.club_memberships where id = '${ids.nomMembership}'`)
  const holds = one(`select count(*) from unnest(internal.active_safeguarding_officer_ids('${ids.club}')) u where u = '${ids.nom}'`)
  if (membership === "REVOKED") {
    // The confirmation may have won the lock and landed first; what must never happen is a person
    // who is not a member of the club counting as one of its Safeguarding Officers.
    assert.equal(holds, "0", `a non-member counts as a Safeguarding Officer (confirmation=${state})\nA:${oa}\nB:${ob}`)
  } else {
    assert.equal(state, "CONFIRMED", `membership survived but confirmation did not settle\nA:${oa}\nB:${ob}`)
  }
})

after(() => {
  const people = [ids.ca, ids.ca2, ids.nom, ids.sa, ids.sa2]
  sql(`do $$
declare v_people uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from public.safeguarding_thread_reviews where club_id = '${ids.club}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.security_events where club_id = '${ids.club}' or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.site_admins where user_id = any(v_people);
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'srace-${TAG}';
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('role_assignments','club_memberships','clubs','club_directory','profiles','site_admins')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.club_memberships cm where cm.id = a.record_id)
           and not exists (select 1 from public.clubs c where c.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})
