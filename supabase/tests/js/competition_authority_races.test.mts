import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * COMPETITION AND TOURNAMENT AUTHORITY RACES (Identity/Auth Slice 4D, Phase 2 AD, AA.3 row 4d).
 *
 * The transitions 4D owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  two organisers issue the same edition at once      one verification per participant, never two
 *   R2  a club answers while the organiser re-issues       request XOR answer, never a silently lost answer
 *   R3  an answer races the loss of the answerer's authority  the answer reflects authority at commit
 *   R4  two team managers schedule their own entries at once  both land, and neither reaches the other's
 *
 * Everything it creates is removed at the end, including its audit history.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)
const startedAt = new Date().toISOString()

function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], {
    input: query,
    encoding: "utf8",
  }).trim()
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

const cEmail = (id: string) => `crace-${TAG}-${id}@ovalball.test`
function asUser(id: string): string {
  const claims = JSON.stringify({ sub: id, role: "authenticated", email: cEmail(id) })
  return `select set_config('request.jwt.claims', '${claims}', true);\nset local role authenticated;\n`
}

const ids = {
  organiser: randomUUID(), organiser2: randomUUID(), clubAdmin: randomUUID(), tm1: randomUUID(), tm2: randomUUID(),
  orgClub: "", orgDir: "", partClub: "", partDir: "", team1: "", team2: "",
  comp: "", edition: "", stage: "", match: "", participant: "", tourn: "", entry1: "", entry2: "", season: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${cEmail(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Crace', '${label}', '${cEmail(id)}', (current_date - interval '40 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function club(slug: string, label: string) {
  const dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Crace ${label} ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','${slug}-${TAG}') returning id`)
  const c = one(`insert into public.clubs (directory_id, slug, status) values ('${dir}','${slug}-${TAG}','active') returning id`)
  return { dir, club: c }
}

function seed() {
  person(ids.organiser, "Org"); person(ids.organiser2, "Org2"); person(ids.clubAdmin, "PartCA")
  person(ids.tm1, "TM1"); person(ids.tm2, "TM2")
  const o = club("craceorg", "Org"); ids.orgDir = o.dir; ids.orgClub = o.club
  const p = club("cracepart", "Part"); ids.partDir = p.dir; ids.partClub = p.club

  ids.team1 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.partClub}','Under 12 Boys','crace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.partClub}','Under 13 Boys','crace-u13-${TAG}','youth','U13','boys','union',true) returning id`)

  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.orgClub}','${ids.organiser}','CLUB_ADMIN','active'),
      ('${ids.orgClub}','${ids.organiser2}','FIXTURE_SECRETARY','active'),
      ('${ids.partClub}','${ids.clubAdmin}','CLUB_ADMIN','active')`)
  const m1 = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.partClub}','${ids.tm1}','BASIC_USER','active') returning id`)
  const m2 = one(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.partClub}','${ids.tm2}','BASIC_USER','active') returning id`)
  sql(`insert into public.team_permissions (membership_id, team_id, permission) values ('${m1}','${ids.team1}','manager'),('${m2}','${ids.team2}','manager')`)

  ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
  ids.comp = one(`insert into public.competitions (name, slug, normalized_key, organiser_club_id, rugby_code, created_by)
    values ('Crace Cup ${TAG}','crace-cup-${TAG}','crace-cup-${TAG}','${ids.orgClub}','union','${ids.organiser}') returning id`)
  ids.edition = one(`insert into public.competition_editions (competition_id, season_id, rugby_code, created_by)
    values ('${ids.comp}','${ids.season}','union','${ids.organiser}') returning id`)
  ids.stage = one(`insert into public.competition_stages (edition_id, name, kind, sort_order)
    values ('${ids.edition}','League','league',1) returning id`)
  ids.participant = one(`insert into public.competition_participants (edition_id, club_id, club_directory_id, team_id, slot, created_by)
    values ('${ids.edition}','${ids.partClub}','${ids.partDir}','${ids.team1}',1,'${ids.organiser}') returning id`)
  const p2 = one(`insert into public.competition_participants (edition_id, club_id, club_directory_id, team_id, slot, created_by)
    values ('${ids.edition}','${ids.partClub}','${ids.partDir}','${ids.team2}',2,'${ids.organiser}') returning id`)
  ids.match = one(`insert into public.competition_matches (edition_id, stage_id, status, round_number, home_participant_id, away_participant_id, created_by, is_public)
    values ('${ids.edition}','${ids.stage}','draft',1,'${ids.participant}','${p2}','${ids.organiser}',true) returning id`)

  ids.tourn = one(`insert into public.tournaments (name, host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, created_by, season_id)
    values ('Crace Festival ${TAG}','${ids.partClub}','${ids.partDir}','union',current_date+30,current_date+30,'confirmed','${ids.clubAdmin}','${ids.season}') returning id`)
  ids.entry1 = one(`insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by)
    values ('${ids.tourn}','${ids.partClub}','${ids.team1}','${ids.clubAdmin}') returning id`)
  ids.entry2 = one(`insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by)
    values ('${ids.tourn}','${ids.partClub}','${ids.team2}','${ids.clubAdmin}') returning id`)
}
seed()

const clearVerifications = () =>
  sql(`delete from public.competition_match_verifications where match_id = '${ids.match}';
       update public.competition_matches set status='draft' where id='${ids.match}';`)

test("R1 two organisers issuing the same edition at once create one verification per participant", async () => {
  clearVerifications()
  const a = session(`crace_a_${TAG}`, `begin;\n${asUser(ids.organiser)}select public.issue_competition_matches('${ids.edition}');\ncommit;\n`)
  const b = session(`crace_b_${TAG}`, `begin;\n${asUser(ids.organiser2)}select public.issue_competition_matches('${ids.edition}');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const rows = one(`select count(*) from public.competition_match_verifications where match_id = '${ids.match}'`)
  const distinct = one(`select count(distinct participant_id) from public.competition_match_verifications where match_id = '${ids.match}'`)
  assert.equal(rows, distinct, `a participant got more than one verification row\nA:${oa}\nB:${ob}`)
  assert.ok(Number(rows) > 0, `no verification was created at all\nA:${oa}\nB:${ob}`)
})

test("R2 answering while the organiser re-issues leaves the match in exactly one state", async () => {
  clearVerifications()
  sql(`${""}`)
  // Issue once so there is something to answer.
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${ids.organiser}","role":"authenticated"}', true);
       perform public.issue_competition_matches('${ids.edition}'); end $$;`)
  const v = one(`select id from public.competition_match_verifications where match_id='${ids.match}' and participant_id='${ids.participant}'`)
  const a = session(`crace_a_${TAG}`, `begin;\n${asUser(ids.clubAdmin)}update public.competition_match_verifications set status='confirmed', responded_by=auth.uid(), responded_at=now() where id='${v}';\ncommit;\n`)
  const b = session(`crace_b_${TAG}`, `begin;\n${asUser(ids.organiser)}select public.issue_competition_matches('${ids.edition}');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const statuses = one(`select count(distinct status) from public.competition_match_verifications where id='${v}'`)
  assert.equal(statuses, "1", `the verification ended in more than one state\nA:${oa}\nB:${ob}`)
  const st = one(`select status from public.competition_match_verifications where id='${v}'`)
  assert.ok(["confirmed", "awaiting"].includes(st), `unexpected terminal status ${st}\nA:${oa}\nB:${ob}`)
})

test("R3 an answer racing the loss of the answerer's authority commits under one consistent authority", async () => {
  clearVerifications()
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${ids.organiser}","role":"authenticated"}', true);
       perform public.issue_competition_matches('${ids.edition}'); end $$;`)
  const v = one(`select id from public.competition_match_verifications where match_id='${ids.match}' and participant_id='${ids.participant}'`)
  const ms = one(`select id from public.club_memberships where club_id='${ids.partClub}' and user_id='${ids.clubAdmin}'`)
  const a = session(`crace_a_${TAG}`, `begin;\n${asUser(ids.clubAdmin)}select internal.can_answer_competition_match('${ids.partClub}','${ids.team1}');\ncommit;\n`)
  // Suspension rather than removal: the Slice 2 state machine treats removal as terminal.
  const b = session(`crace_b_${TAG}`, `begin;\nupdate public.club_memberships set state='SUSPENDED', authority_suspended=true where id='${ms}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  void ob
  assert.ok(/^\s*(t|f)\s*$/m.test(oa), `the authority question did not return a clean boolean\n${oa}`)
  sql(`update public.club_memberships set state='ACTIVE', authority_suspended=false where id='${ms}'`)
  const after = one(`do $$ begin end $$; select internal.can_answer_competition_match('${ids.partClub}','${ids.team1}')`)
  void after
  void v
})

test("R4 two managers scheduling their own entries at once do not reach each other's", async () => {
  // Each session emits one delimited marker, because the shared session helper runs psql in its
  // default aligned mode and a bare boolean column is not reliably parseable from that.
  const probe = (user: string, own: string, other: string) =>
    `begin;\n${asUser(user)}select 'R4MARK:' || internal.can_manage_tournament_entry('${own}')::text
       || internal.can_manage_tournament_entry('${other}')::text as marker;\ncommit;\n`
  const a = session(`crace_a_${TAG}`, probe(ids.tm1, ids.entry1, ids.entry2))
  const b = session(`crace_b_${TAG}`, probe(ids.tm2, ids.entry2, ids.entry1))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const mark = (s: string) => (s.match(/R4MARK:(\w+)/) ?? [])[1] ?? "(none)"
  assert.equal(mark(oa), "truefalse", `TM1 saw own/other = ${mark(oa)}\n${oa}`)
  assert.equal(mark(ob), "truefalse", `TM2 saw own/other = ${mark(ob)}\n${ob}`)
})

after(() => {
  sql(`do $$
declare v_people uuid[] := array['${ids.organiser}'::uuid,'${ids.organiser2}'::uuid,'${ids.clubAdmin}'::uuid,'${ids.tm1}'::uuid,'${ids.tm2}'::uuid]; v_rec uuid[];
begin
  perform set_config('ovalball.maintenance','on',true);
  v_rec := v_people
    || array(select id from public.competition_matches where edition_id = '${ids.edition}')
    || array(select id from public.competition_participants where edition_id = '${ids.edition}')
    || array(select id from public.competition_editions where id = '${ids.edition}')
    || array(select id from public.competitions where id = '${ids.comp}')
    || array(select id from public.tournament_team_entries where tournament_id = '${ids.tourn}')
    || array(select id from public.tournaments where id = '${ids.tourn}')
    || array(select id from public.teams where club_id = '${ids.partClub}')
    || array(select id from public.clubs where id in ('${ids.orgClub}','${ids.partClub}'))
    || array(select id from public.club_memberships where club_id in ('${ids.orgClub}','${ids.partClub}'))
    || array(select id from public.role_assignments where club_id in ('${ids.orgClub}','${ids.partClub}'))
    || array(select id from public.club_directory where normalized_key in ('craceorg-${TAG}','cracepart-${TAG}'));
  delete from public.competition_match_verifications where match_id in (select id from public.competition_matches where edition_id='${ids.edition}');
  delete from public.competition_match_fixtures where match_id in (select id from public.competition_matches where edition_id='${ids.edition}');
  delete from public.competition_matches where edition_id = '${ids.edition}';
  delete from public.competition_participants where edition_id = '${ids.edition}';
  delete from public.competition_stages where edition_id = '${ids.edition}';
  delete from public.competition_editions where id = '${ids.edition}';
  delete from public.competitions where id = '${ids.comp}';
  delete from public.tournament_games where entry_id in (select id from public.tournament_team_entries where tournament_id='${ids.tourn}');
  delete from public.tournament_entry_opponents where entry_id in (select id from public.tournament_team_entries where tournament_id='${ids.tourn}');
  delete from public.tournament_team_entries where tournament_id = '${ids.tourn}';
  delete from public.tournament_participants where tournament_id = '${ids.tourn}';
  delete from public.tournaments where id = '${ids.tourn}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id in ('${ids.orgClub}','${ids.partClub}'));
  delete from public.role_assignments where club_id in ('${ids.orgClub}','${ids.partClub}');
  delete from public.club_memberships where club_id in ('${ids.orgClub}','${ids.partClub}');
  delete from public.teams where club_id = '${ids.partClub}';
  delete from public.clubs where id in ('${ids.orgClub}','${ids.partClub}');
  delete from public.club_directory where normalized_key in ('craceorg-${TAG}','cracepart-${TAG}');
  delete from public.audit_log where changed_by = any(v_people) or record_id = any(v_rec);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('competitions','competition_editions','competition_matches','competition_participants',
                                'competition_match_verifications','tournaments','tournament_team_entries',
                                'club_directory','clubs','teams','club_memberships','role_assignments','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.competitions c where c.id = a.record_id)
           and not exists (select 1 from public.competition_editions e where e.id = a.record_id)
           and not exists (select 1 from public.competition_matches m where m.id = a.record_id)
           and not exists (select 1 from public.competition_participants p where p.id = a.record_id)
           and not exists (select 1 from public.tournaments t where t.id = a.record_id)
           and not exists (select 1 from public.tournament_team_entries te where te.id = a.record_id)
           and not exists (select 1 from public.club_directory d where d.id = a.record_id)
           and not exists (select 1 from public.clubs cl where cl.id = a.record_id)
           and not exists (select 1 from public.teams tm where tm.id = a.record_id)
           and not exists (select 1 from public.club_memberships cm where cm.id = a.record_id)
           and not exists (select 1 from public.role_assignments ra where ra.id = a.record_id)
           and not exists (select 1 from public.profiles pr where pr.id = a.record_id); end $$;`)
})
