import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * CLUB ADMIN AUTHORITY RACES (Identity/Auth Slice 4H, Phase 2 AD, AA.3 row 4h).
 *
 * The transitions 4H owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  two Club Admins suspend the same membership at once   one terminal state, not two
 *   R2  two Club Admins remove the LAST two Club Admins at once  section S: "Remove the last Club
 *                                                             Admin" is a prohibition, and a race is
 *                                                             exactly how you would try to defeat it
 *   R3  an export races the loss of the exporter's authority  the event and the outcome agree
 *   R4  a role assignment races the revocation of the membership it rests on
 *
 * R2 is the one that matters. A club with no Club Admin has nobody who can invite one, so the guard
 * is not a nicety -- and a guard that reads the current count and then writes is exactly the shape
 * that two concurrent sessions defeat.
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

const hEmail = (id: string) => `hrace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", email: hEmail(id) })}', true);\nset local role authenticated;\n`

const ids = {
  ca: randomUUID(), ca2: randomUUID(), member: randomUUID(), other: randomUUID(),
  club: "", dir: "", caMembership: "", ca2Membership: "", memberMembership: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${hEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Hrace', '${label}', '${hEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["ca","CA"],["ca2","CA2"],["member","MB"],["other","OT"]] as const) person((ids as never as Record<string,string>)[k], v)
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Hrace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','hrace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','hrace-${TAG}','active') returning id`)
  ids.caMembership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.ca}','CLUB_ADMIN','active') returning id`)
  ids.ca2Membership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.ca2}','CLUB_ADMIN','active') returning id`)
  ids.memberMembership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.member}','BASIC_USER','active') returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.other}','BASIC_USER','active')`)
}
seed()

// A REVOKED membership cannot be switched back on -- the state machine says so, and R2 revokes two.
// So each test gets FRESH membership rows rather than a reset, which is also closer to the truth: a
// club re-admitting somebody creates a new membership, it does not resurrect the old one.
function freshMemberships() {
  sql(`delete from public.role_assignments where club_id = '${ids.club}';
       delete from public.club_memberships where club_id = '${ids.club}';`)
  ids.caMembership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.ca}','CLUB_ADMIN','active') returning id`)
  ids.ca2Membership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.ca2}','CLUB_ADMIN','active') returning id`)
  ids.memberMembership = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.member}','BASIC_USER','active') returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.other}','BASIC_USER','active')`)
}

test("R1 two Club Admins suspending the same membership at once leave one terminal state", async () => {
  freshMemberships()
  const script = (who: string) =>
    `begin;\n${asUser(who)}select public.transition_club_membership('${ids.memberMembership}', 'SUSPENDED', 'raced suspension');\ncommit;\n`
  const a = session(`hrace_a_${TAG}`, script(ids.ca))
  const b = session(`hrace_b_${TAG}`, script(ids.ca2))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const state = one(`select state from public.club_memberships where id = '${ids.memberMembership}'`)
  assert.equal(state, "SUSPENDED", `the raced suspension did not settle\nA:${oa}\nB:${ob}`)
  const suspensions = one(`select count(*) from public.security_events
    where event_type like 'membership.%' and club_id = '${ids.club}' and occurred_at > now() - interval '1 minute'`)
  assert.ok(Number(suspensions) >= 1, `no membership event was recorded\nA:${oa}\nB:${ob}`)
})

test("R2 two Club Admins removing each other at once cannot leave the club with none", async () => {
  freshMemberships()
  // Each session removes the OTHER Club Admin. Read-then-write would let both pass the "is there
  // another one?" check and both commit, and the club would be left with nobody who can invite one.
  const a = session(`hrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select public.transition_club_membership('${ids.ca2Membership}', 'REVOKED', 'raced removal a');\ncommit;\n`)
  const b = session(`hrace_b_${TAG}`, `begin;\n${asUser(ids.ca2)}select public.transition_club_membership('${ids.caMembership}', 'REVOKED', 'raced removal b');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const admins = one(`select count(*) from public.club_memberships cm
    join public.role_assignments ra on ra.membership_id = cm.id and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE'
    where cm.club_id = '${ids.club}' and cm.state = 'ACTIVE'`)
  const legacyAdmins = one(`select count(*) from public.club_memberships
    where club_id = '${ids.club}' and state = 'ACTIVE' and role = 'CLUB_ADMIN'`)
  assert.ok(Number(admins) >= 1 || Number(legacyAdmins) >= 1,
    `both removals landed and the club has no Club Admin left\nA:${oa}\nB:${ob}`)
})

test("R3 an export racing the loss of its exporter's authority records only what actually happened", async () => {
  freshMemberships()
  sql(`delete from public.security_events where club_id = '${ids.club}' and event_type = 'export.generated'`)
  const a = session(`hrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select public.record_club_export('${ids.club}', 'player_movements', 'raced export', 5);\ncommit;\n`)
  const b = session(`hrace_b_${TAG}`, `begin;\n${asUser(ids.ca2)}select public.transition_club_membership('${ids.caMembership}', 'REVOKED', 'raced revoke');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const events = Number(one(`select count(*) from public.security_events where club_id = '${ids.club}' and event_type = 'export.generated'`))
  const exportRefused = /not authorised/i.test(oa)
  // Either the export ran and is recorded, or it was refused and is not. What must never happen is a
  // personal-data export that happened and left no event, or an event for one that did not.
  assert.ok((exportRefused && events === 0) || (!exportRefused && events === 1),
    `export outcome and its record disagree (refused=${exportRefused}, events=${events})\nA:${oa}\nB:${ob}`)
})

test("R4 a role assignment racing the revocation of the membership it rests on stays consistent", async () => {
  freshMemberships()
  sql(`delete from public.role_assignments where club_id = '${ids.club}' and user_id = '${ids.member}'`)
  const a = session(`hrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select internal.grant_role('${ids.memberMembership}', 'VOLUNTEER', null, 'CLUB_ADMIN_ASSIGNMENT', 'raced grant');\ncommit;\n`)
  const b = session(`hrace_b_${TAG}`, `begin;\n${asUser(ids.ca2)}select public.transition_club_membership('${ids.memberMembership}', 'REVOKED', 'raced revoke');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const memberState = one(`select state from public.club_memberships where id = '${ids.memberMembership}'`)
  const roleState = one(`select coalesce(max(state), '-') from public.role_assignments where membership_id = '${ids.memberMembership}' and role_key = 'VOLUNTEER'`)
  // A role that outlives the membership it rests on would be authority with nothing behind it.
  if (memberState === "REVOKED") {
    assert.ok(roleState === "-" || roleState === "REVOKED",
      `a revoked membership left an ACTIVE role assignment behind\nA:${oa}\nB:${ob}`)
  } else {
    assert.ok(roleState === "ACTIVE" || roleState === "-", `unexpected role state ${roleState}\nA:${oa}\nB:${ob}`)
  }
})

after(() => {
  const people = [ids.ca, ids.ca2, ids.member, ids.other]
  sql(`do $$
declare v_people uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from public.notifications where user_id = any(v_people);
  delete from public.security_events where club_id = '${ids.club}' or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'hrace-${TAG}';
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('role_assignments','club_memberships','clubs','club_directory','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.club_memberships cm where cm.id = a.record_id)
           and not exists (select 1 from public.clubs c where c.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})
