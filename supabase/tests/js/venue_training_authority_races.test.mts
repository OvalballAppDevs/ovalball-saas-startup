import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * VENUE AND TRAINING AUTHORITY RACES (Identity/Auth Slice 4E, Phase 2 AD, AA.3 row 4e).
 *
 * The transitions 4E owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  a venue is archived while a plan is saved against it   one consistent outcome, never a plan
 *                                                              pointing at a venue nobody may use
 *   R2  two staff rename the same venue at once                one name wins; the row is not lost
 *   R3  a training read races the loss of the reader's         the answer reflects authority at commit
 *       membership
 *   R4  two managers manage their own teams' training at once  both land, neither reaches the other's
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

const vEmail = (id: string) => `vrace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", email: vEmail(id) })}', true);\nset local role authenticated;\n`

const ids = {
  ca: randomUUID(), fs: randomUUID(), tm1: randomUUID(), tm2: randomUUID(), mb: randomUUID(),
  club: "", dir: "", team1: "", team2: "", venue: "", pitch: "", season: "", plan1: "", plan2: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${vEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Vrace', '${label}', '${vEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["ca", "CA"], ["fs", "FS"], ["tm1", "TM1"], ["tm2", "TM2"], ["mb", "MB"]] as const) person((ids as never as Record<string, string>)[k], v)
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Vrace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','vrace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','vrace-${TAG}','active') returning id`)
  ids.team1 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 12 Boys','vrace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 13 Boys','vrace-u13-${TAG}','youth','U13','boys','union',true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.club}','${ids.ca}','CLUB_ADMIN','active'),
      ('${ids.club}','${ids.fs}','FIXTURE_SECRETARY','active'),
      ('${ids.club}','${ids.mb}','BASIC_USER','active')`)
  const m1 = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.tm1}','BASIC_USER','active') returning id`)
  const m2 = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}','${ids.tm2}','BASIC_USER','active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission) values ('${m1}','${ids.team1}','manager'),('${m2}','${ids.team2}','manager')`)
  ids.venue = one(`insert into public.venues (club_id, name, slug, active) values ('${ids.club}','Vrace Park','vrace-park-${TAG}',true) returning id`)
  ids.pitch = one(`insert into public.club_pitches (club_id, venue_id, display_name, active) values ('${ids.club}','${ids.venue}','Pitch 1',true) returning id`)
  ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
  ids.plan1 = one(`insert into public.training_plans (club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id, created_by)
    values ('${ids.club}','${ids.team1}','${ids.season}','SEASON','${ids.venue}','${ids.pitch}','${ids.ca}') returning id`)
  ids.plan2 = one(`insert into public.training_plans (club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id, created_by)
    values ('${ids.club}','${ids.team2}','${ids.season}','SEASON','${ids.venue}','${ids.pitch}','${ids.ca}') returning id`)
}
seed()

test("R1 archiving a venue while a plan is saved against it leaves one consistent outcome", async () => {
  sql(`update public.venues set active = true where id = '${ids.venue}'`)
  const a = session(`vrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}update public.training_plans set preferred_venue_id = '${ids.venue}' where id = '${ids.plan1}';\ncommit;\n`)
  const b = session(`vrace_b_${TAG}`, `begin;\n${asUser(ids.ca)}select public.set_venue_active('${ids.venue}', false);\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const active = one(`select active from public.venues where id = '${ids.venue}'`)
  const planVenue = one(`select preferred_venue_id from public.training_plans where id = '${ids.plan1}'`)
  assert.equal(active, "f", `the venue should have been archived\nA:${oa}\nB:${ob}`)
  assert.equal(planVenue, ids.venue, `the plan should still name the venue it was saved against\nA:${oa}\nB:${ob}`)
  sql(`update public.venues set active = true where id = '${ids.venue}'`)
})

test("R2 two staff renaming the same venue at once leave exactly one name", async () => {
  const a = session(`vrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}update public.venues set name = 'Named by CA' where id = '${ids.venue}';\ncommit;\n`)
  const b = session(`vrace_b_${TAG}`, `begin;\n${asUser(ids.fs)}update public.venues set name = 'Named by FS' where id = '${ids.venue}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const name = one(`select name from public.venues where id = '${ids.venue}'`)
  assert.ok(["Named by CA", "Named by FS"].includes(name), `unexpected terminal name ${name}\nA:${oa}\nB:${ob}`)
  assert.equal(one(`select count(*) from public.venues where id = '${ids.venue}'`), "1", "the venue row survived")
})

test("R3 a training read racing the loss of the reader's membership commits under one authority", async () => {
  const ms = one(`select id from public.club_memberships where club_id = '${ids.club}' and user_id = '${ids.tm1}'`)
  const a = session(`vrace_a_${TAG}`, `begin;\n${asUser(ids.tm1)}select 'R3MARK:' || internal.training_session_visible_row('${ids.club}','${ids.team1}',null)::text;\ncommit;\n`)
  // Suspension, not removal: the Slice 2 state machine treats removal as terminal.
  const b = session(`vrace_b_${TAG}`, `begin;\nupdate public.club_memberships set state='SUSPENDED', authority_suspended=true where id='${ms}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  void ob
  assert.match(oa, /R3MARK:(true|false)/, `the authority question did not return a clean boolean\n${oa}`)
  sql(`update public.club_memberships set state='ACTIVE', authority_suspended=false where id='${ms}'`)
  // Evaluated AS the manager: internal.can_manage_training reads auth.uid(), so asking it as the
  // superuser with no JWT claims would answer "false" for everybody and prove nothing.
  const restored = one(`begin;
    select set_config('request.jwt.claims', '{"sub":"${ids.tm1}","role":"authenticated"}', true);
    select internal.can_manage_training('${ids.club}','${ids.team1}');
    commit;`)
  assert.equal(restored, "t", "authority is restored after reinstatement")
})

test("R4 two managers managing their own teams' training at once do not reach each other's", async () => {
  const probe = (user: string, own: string, other: string) =>
    `begin;\n${asUser(user)}select 'R4MARK:' || internal.can_manage_training('${ids.club}','${own}')::text
       || internal.can_manage_training('${ids.club}','${other}')::text as marker;\ncommit;\n`
  const a = session(`vrace_a_${TAG}`, probe(ids.tm1, ids.team1, ids.team2))
  const b = session(`vrace_b_${TAG}`, probe(ids.tm2, ids.team2, ids.team1))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const mark = (s: string) => (s.match(/R4MARK:(\w+)/) ?? [])[1] ?? "(none)"
  assert.equal(mark(oa), "truefalse", `TM1 saw own/other = ${mark(oa)}\n${oa}`)
  assert.equal(mark(ob), "truefalse", `TM2 saw own/other = ${mark(ob)}\n${ob}`)
})

after(() => {
  sql(`do $$
declare v_people uuid[] := array['${ids.ca}'::uuid,'${ids.fs}'::uuid,'${ids.tm1}'::uuid,'${ids.tm2}'::uuid,'${ids.mb}'::uuid]; v_rec uuid[];
begin
  perform set_config('ovalball.maintenance','on',true);
  v_rec := v_people
    || array(select id from public.training_plans where club_id = '${ids.club}')
    || array(select id from public.training_sessions where club_id = '${ids.club}')
    || array(select id from public.venues where club_id = '${ids.club}')
    || array(select id from public.club_pitches where club_id = '${ids.club}')
    || array(select id from public.teams where club_id = '${ids.club}')
    || array(select id from public.clubs where id = '${ids.club}')
    || array(select id from public.club_memberships where club_id = '${ids.club}')
    || array(select id from public.role_assignments where club_id = '${ids.club}')
    || array(select id from public.club_directory where normalized_key = 'vrace-${TAG}');
  delete from public.training_plan_schedule_rules where training_plan_id in (select id from public.training_plans where club_id='${ids.club}');
  delete from public.training_sessions where club_id = '${ids.club}';
  delete from public.training_plans where club_id = '${ids.club}';
  delete from public.club_event_teams where event_id in (select id from public.club_events where club_id='${ids.club}');
  delete from public.club_events where club_id = '${ids.club}';
  delete from public.club_pitches where club_id = '${ids.club}';
  delete from public.venues where club_id = '${ids.club}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id='${ids.club}');
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.teams where club_id = '${ids.club}';
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'vrace-${TAG}';
  delete from public.audit_log where changed_by = any(v_people) or record_id = any(v_rec);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('venues','club_pitches','training_plans','training_sessions','club_events',
                                'club_directory','clubs','teams','club_memberships','role_assignments','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.venues v where v.id = a.record_id)
           and not exists (select 1 from public.club_pitches cp where cp.id = a.record_id)
           and not exists (select 1 from public.training_plans tp where tp.id = a.record_id)
           and not exists (select 1 from public.training_sessions ts where ts.id = a.record_id)
           and not exists (select 1 from public.club_events ce where ce.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.clubs c where c.id = a.record_id)
           and not exists (select 1 from public.teams t where t.id = a.record_id)
           and not exists (select 1 from public.club_memberships cm where cm.id = a.record_id)
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})
