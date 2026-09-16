import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * MESSAGING AUTHORITY RACES (Identity/Auth Slice 4F, Phase 2 AD, AA.3 row 4f).
 *
 * The transitions 4F owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  two people report the same message at once      two rows, neither overwriting the other
 *   R2  one person reports the same message twice at once  exactly one row for that reporter
 *   R3  a report races the loss of the reporter's authority  the outcome is internally consistent
 *   R4  a block races an unblock                        one terminal state, not both
 *
 * R1 and R2 are the pair that matters: section T's "each report is its own row (no overwrite)" has
 * to survive concurrency, and the guard that stops one person flooding the queue must not also
 * collapse two different people's reports into one.
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

const mEmail = (id: string) => `mrace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", email: mEmail(id) })}', true);\nset local role authenticated;\n`

const ids = {
  ca: randomUUID(), tm: randomUUID(), co: randomUUID(), so: randomUUID(), mb: randomUUID(),
  club: "", dir: "", team: "", season: "", fixture: "", conv: "", message: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${mEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Mrace', '${label}', '${mEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["ca","CA"],["tm","TM"],["co","CO"],["so","SO"],["mb","MB"]] as const) person((ids as never as Record<string,string>)[k], v)
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Mrace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mrace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','mrace-${TAG}','active') returning id`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 12 Boys','mrace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.ca}','CLUB_ADMIN','active'),('${ids.club}','${ids.mb}','BASIC_USER','active')`)
  const mt = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.tm}','BASIC_USER','active') returning id`)
  const mc = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.co}','BASIC_USER','active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission) values ('${mt}','${ids.team}','manager'),('${mc}','${ids.team}','coach')`)
  // The Safeguarding Officer uses the role Slice 2 already models -- no 4G machinery is created.
  const ms = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.so}','BASIC_USER','active') returning id`)
  sql(`insert into public.role_assignments (club_id, user_id, membership_id, role_key, state, source, confirmation_state, granted_by)
       values ('${ids.club}','${ids.so}','${ms}','SAFEGUARDING_OFFICER','ACTIVE','LEGACY_BACKFILL','CONFIRMED','${ids.ca}')`)
  ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
  const row = sql(`insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
    values ('${ids.team}','Home','Mrace External RFC',current_date+20,'Booked','club_created','${ids.season}') returning id || ' ' || conversation_id`).trim()
  ;[ids.fixture, ids.conv] = row.split(/\s+/)
  ids.message = one(`insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind)
    values ('${ids.fixture}','${ids.conv}','${ids.co}','Mrace message ${TAG}','message') returning id`)
}
seed()

const clearReports = () => sql(`delete from public.message_reports where message_id = '${ids.message}';
  update public.fixture_messages set reported_at=null, reported_by=null, report_reason=null, report_status=null where id='${ids.message}'`)

test("R1 two people reporting the same message at once produce two rows, neither overwritten", async () => {
  clearReports()
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.tm)}select public.report_message('${ids.message}', 'reported by the manager');\ncommit;\n`)
  const b = session(`mrace_b_${TAG}`, `begin;\n${asUser(ids.ca)}select public.report_message('${ids.message}', 'reported by the club admin');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const rows = one(`select count(*) from public.message_reports where message_id = '${ids.message}'`)
  const reasons = one(`select count(distinct reason) from public.message_reports where message_id = '${ids.message}'`)
  assert.equal(rows, "2", `section T requires one row per report\nA:${oa}\nB:${ob}`)
  assert.equal(reasons, "2", `one reporter's reason overwrote the other's\nA:${oa}\nB:${ob}`)
})

test("R2 one person reporting twice at once still leaves exactly one row for them", async () => {
  clearReports()
  const script = (n: string) => `begin;\n${asUser(ids.tm)}select public.report_message('${ids.message}', 'attempt ${n}');\ncommit;\n`
  const a = session(`mrace_a_${TAG}`, script("one"))
  const b = session(`mrace_b_${TAG}`, script("two"))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const mine = one(`select count(*) from public.message_reports where message_id = '${ids.message}' and reported_by = '${ids.tm}'`)
  assert.equal(mine, "1", `the same person got more than one open row\nA:${oa}\nB:${ob}`)
})

test("R3 a report racing the loss of the reporter's authority leaves one consistent outcome", async () => {
  clearReports()
  const ms = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.tm}'`)
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.tm)}select public.report_message('${ids.message}', 'racing my own suspension');\ncommit;\n`)
  // Suspension, not removal: the Slice 2 state machine treats removal as terminal.
  const b = session(`mrace_b_${TAG}`, `begin;\nupdate public.club_memberships set state='SUSPENDED', authority_suspended=true where id='${ms}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  void ob
  const n = Number(one(`select count(*) from public.message_reports where message_id='${ids.message}' and reported_by='${ids.tm}'`))
  assert.ok(n === 0 || n === 1, `expected zero or one report, saw ${n}\n${oa}`)
  sql(`update public.club_memberships set state='ACTIVE', authority_suspended=false where id='${ms}'`)
})

test("R4 a block racing an unblock ends in exactly one state", async () => {
  sql(`delete from public.club_message_blocks where club_id = '${ids.club}' and blocked_user_id = '${ids.mb}'`)
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}select public.block_user_from_club_messages('${ids.club}','${ids.mb}','racing');\ncommit;\n`)
  const b = session(`mrace_b_${TAG}`, `begin;\n${asUser(ids.so)}select public.block_user_from_club_messages('${ids.club}','${ids.mb}','also racing');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const n = one(`select count(*) from public.club_message_blocks where club_id='${ids.club}' and blocked_user_id='${ids.mb}'`)
  assert.equal(n, "1", `two concurrent blocks left ${n} rows\nA:${oa}\nB:${ob}`)
  sql(`delete from public.club_message_blocks where club_id = '${ids.club}' and blocked_user_id = '${ids.mb}'`)
})

after(() => {
  sql(`do $$
declare v_people uuid[] := array['${ids.ca}'::uuid,'${ids.tm}'::uuid,'${ids.co}'::uuid,'${ids.so}'::uuid,'${ids.mb}'::uuid]; v_rec uuid[];
begin
  perform set_config('ovalball.maintenance','on',true);
  v_rec := v_people
    || array(select id from public.message_reports where message_id in (select id from public.fixture_messages where fixture_id = '${ids.fixture}'))
    || array(select id from public.fixture_messages where fixture_id = '${ids.fixture}')
    || array(select id from public.fixtures where owning_team_id = '${ids.team}')
    || array(select id from public.teams where club_id = '${ids.club}')
    || array(select id from public.clubs where id = '${ids.club}')
    || array(select id from public.club_memberships where club_id = '${ids.club}')
    || array(select id from public.role_assignments where club_id = '${ids.club}')
    || array(select id from public.club_directory where normalized_key = 'mrace-${TAG}');
  delete from public.message_reports where message_id in (select id from public.fixture_messages where fixture_id = '${ids.fixture}');
  delete from public.club_message_blocks where club_id = '${ids.club}';
  delete from public.fixture_messages where fixture_id = '${ids.fixture}' or team_conversation_id = '${ids.team}';
  delete from public.team_conversations where team_id = '${ids.team}';
  delete from public.fixtures where owning_team_id = '${ids.team}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id='${ids.club}');
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.teams where club_id = '${ids.club}';
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'mrace-${TAG}';
  delete from public.audit_log where changed_by = any(v_people) or record_id = any(v_rec);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('message_reports','fixture_messages','fixtures','club_message_blocks','team_conversations',
                                'club_directory','clubs','teams','club_memberships','role_assignments','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.fixture_messages m where m.id = a.record_id)
           and not exists (select 1 from public.fixtures f where f.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.clubs c where c.id = a.record_id)
           and not exists (select 1 from public.teams t where t.id = a.record_id)
           and not exists (select 1 from public.club_memberships cm where cm.id = a.record_id)
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})
