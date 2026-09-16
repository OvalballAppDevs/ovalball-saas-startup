import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * CLUB DOCUMENTS, PARTNERS AND HANDOVER RACES (Identity/Auth Slice 4I, AA.3 row 4i).
 *
 * The transitions 4I owns, raced by real concurrent database sessions. No sleep decides a result.
 *
 *   R1  two Club Admins apply the same season handover at once   it happens once, not twice
 *   R2  a Fixtures Secretary applies while a Club Admin does     section U holds under a race
 *   R3  a document is filed while its folder is deleted          no document in a folder that is gone
 *   R4  two clubs open the same partnership from both ends       one relationship, not two
 *
 * R1 and R2 are the ones that matter. A season handover moves every age group in a club up a year;
 * applying it twice would promote every child twice, and there is no undo. Section U says preparing
 * a handover is the Fixtures Secretary's and applying it is the Club Admin's -- and before this
 * slice every handover RPC asked one undifferentiated "is this person a club admin?" question, so
 * the split existed only on paper. A boundary that is really enforced survives being raced.
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

// `set local role` needs a transaction block, so seeding done AS somebody has to be wrapped.
const sqlAs = (who: string, q: string) => sql(`begin;\n${asUser(who)}${q};\ncommit;`)
const oneAs = (who: string, q: string) => sqlAs(who, q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

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
  ca: randomUUID(), ca2: randomUUID(), fs: randomUUID(), farca: randomUUID(),
  club: "", dir: "", far: "", farDir: "", season: "", folder: "", rollover: "", team: "",
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

function club(slug: string): [string, string] {
  const dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Mrace ${slug} ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mrace-${slug}-${TAG}') returning id`)
  return [dir, one(`insert into public.clubs (directory_id, slug, status) values ('${dir}','mrace-${slug}-${TAG}','active') returning id`)]
}

function seed() {
  for (const [k, v] of [["ca","CA"],["ca2","CA2"],["fs","FS"],["farca","FARCA"]] as const) person((ids as never as Record<string,string>)[k], v)
  ;[ids.dir, ids.club] = club("home")
  ;[ids.farDir, ids.far] = club("far")
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.club}','${ids.ca}','CLUB_ADMIN','active'),
      ('${ids.club}','${ids.ca2}','CLUB_ADMIN','active'),
      ('${ids.club}','${ids.fs}','FIXTURE_SECRETARY','active'),
      ('${ids.far}','${ids.farca}','CLUB_ADMIN','active')`)
  ids.season = one(`select id from public.seasons where rugby_code = 'union' and not is_regression_fixture
                    and starts_on > current_date order by starts_on limit 1`)
  ids.folder = one(`insert into public.document_folders (club_id, name, created_by) values ('${ids.club}','Raced ${TAG}','${ids.ca}') returning id`)
}
seed()

/**
 * A handover is one-shot, so each race that applies one needs its own -- and it must have real work
 * to do. An empty handover applies to nothing, so a second application is indistinguishable from
 * the first and the race proves nothing. This one moves a U12 side up to U13: apply it twice and
 * the team lands on U14, which is a child playing a year out of their age grade.
 */
function freshRollover(): string {
  sql(`delete from public.season_transitions where rollover_id in (select id from public.age_grade_rollovers where club_id = '${ids.club}');
       delete from public.age_grade_rollover_group_flags where rollover_id in (select id from public.age_grade_rollovers where club_id = '${ids.club}');
       delete from public.age_grade_rollover_player_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id = '${ids.club}');
       delete from public.age_grade_rollover_planned_teams where rollover_id in (select id from public.age_grade_rollovers where club_id = '${ids.club}');
       delete from public.age_grade_rollover_team_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id = '${ids.club}');
       delete from public.age_grade_rollovers where club_id = '${ids.club}';
       delete from public.team_season_identity where team_id in (select id from public.teams where club_id = '${ids.club}');
       delete from public.teams where club_id = '${ids.club}';`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 12 Boys','mrace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  ids.rollover = oneAs(ids.ca, `select public.generate_rollover_proposal('${ids.club}', 'union', '${ids.season}')`)
  sqlAs(ids.ca, `select public.confirm_rollover_team_proposal(id, 'confirm')
         from public.age_grade_rollover_team_proposals where rollover_id = '${ids.rollover}'`)
  const blockers = oneAs(ids.ca, `select count(*) from public.handover_apply_blockers('${ids.rollover}')`)
  assert.equal(blockers, "0", "the seeded handover has blockers, so an apply would be refused for the wrong reason")
  return ids.rollover
}

test("R1 two Club Admins applying the same season handover at once apply it exactly once", async () => {
  const ro = freshRollover()
  const rev = one(`select decisions_revision from public.age_grade_rollovers where id = '${ro}'`)
  // Both pass the SAME expected revision. Read-then-write would let both through: each reads the
  // revision, each finds it current, and each promotes every age group in the club.
  const script = (who: string) =>
    `begin;\n${asUser(who)}select public.apply_season_handover('${ro}', ${rev});\ncommit;\n`
  const a = session(`mrace_a_${TAG}`, script(ids.ca))
  const b = session(`mrace_b_${TAG}`, script(ids.ca2))
  const [oa, ob] = await Promise.all([a.done, b.done])
  const appliedAt = one(`select coalesce(applied_at::text, '-') from public.age_grade_rollovers where id = '${ro}'`)
  assert.notEqual(appliedAt, "-", `neither application landed, so the race proves nothing\nA:${oa}\nB:${ob}`)
  // The apply is idempotent BY DESIGN -- it takes the row lock, sees applied_at, and returns zeros
  // rather than raising, so a double click or a resent form gets the same answer. That makes the
  // honest question not "did one session error?" but "did the work happen once?".
  const ageGroup = one(`select age_group from public.teams where id = '${ids.team}'`)
  assert.equal(ageGroup, "U13", `the side moved to ${ageGroup} -- a handover applied twice ages a child out of their grade\nA:${oa}\nB:${ob}`)
  const progressed = [oa, ob].filter((o) => /teams_progressed|,1,/.test(o) && /\bf\b|false/.test(o.split("\n")[0] ?? "")).length
  const appliedOnce = one(`select count(*) from public.age_grade_rollover_team_proposals
    where rollover_id = '${ro}' and applied_at is not null`)
  assert.equal(appliedOnce, "1", `${appliedOnce} team progressions were stamped applied\nA:${oa}\nB:${ob}`)
  assert.ok(progressed <= 1, `both sessions reported doing the work\nA:${oa}\nB:${ob}`)
})

test("R2 a Fixtures Secretary racing the Club Admin still cannot apply a season handover", async () => {
  const ro = freshRollover()
  const rev = one(`select decisions_revision from public.age_grade_rollovers where id = '${ro}'`)
  // Section U, under contention. Before this slice both sessions asked the same "club admin?"
  // question and the Secretary would have won whichever way the interleaving fell.
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.fs)}select public.apply_season_handover('${ro}', ${rev});\ncommit;\n`)
  const b = session(`mrace_b_${TAG}`, `begin;\n${asUser(ids.ca)}select public.apply_season_handover('${ro}', ${rev});\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  assert.ok(/ERROR/i.test(oa), `the Fixtures Secretary applied a season handover\nFS:${oa}`)
  const appliedBy = one(`select coalesce(applied_by::text, '-') from public.age_grade_rollovers where id = '${ro}'`)
  assert.equal(appliedBy, ids.ca, `the handover was not applied by the Club Admin (applied_by=${appliedBy})\nFS:${oa}\nCA:${ob}`)
  assert.equal(one(`select age_group from public.teams where id = '${ids.team}'`), "U13",
    `the raced pair did not leave the side one grade up\nFS:${oa}\nCA:${ob}`)
  // And the Secretary keeps the half that IS theirs -- the boundary is a split, not a demotion.
  const prepares = one(`select allowed from internal.capability_decision('${ids.fs}', 'team.handover.prepare', 'club', '${ids.club}', null, null)`)
  assert.equal(prepares, "t", "the Fixtures Secretary lost team.handover.prepare, which section U gives them")
})

test("R3 a document filed while its folder is deleted never ends up in a folder that is gone", async () => {
  const doc = randomUUID()
  const folder = one(`insert into public.document_folders (club_id, name, created_by) values ('${ids.club}','Doomed ${TAG}','${ids.ca}') returning id`)
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}insert into public.club_documents (id, club_id, folder_id, title, storage_path, mime_type, size_bytes, original_filename, category, uploaded_by)
    values ('${doc}','${ids.club}','${folder}','Raced ${TAG}','club/${ids.club}/raced-${TAG}.pdf','application/pdf',10,'r.pdf','other','${ids.ca}');\ncommit;\n`)
  const b = session(`mrace_b_${TAG}`, `begin;\n${asUser(ids.fs)}delete from public.document_folders where id = '${folder}';\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const orphan = one(`select count(*) from public.club_documents d where d.id = '${doc}' and d.folder_id is not null
                      and not exists (select 1 from public.document_folders f where f.id = d.folder_id)`)
  assert.equal(orphan, "0", `a document survived in a folder that no longer exists\nA:${oa}\nB:${ob}`)
  sql(`delete from public.club_documents where id = '${doc}'; delete from public.document_folders where id = '${folder}'`)
})

test("R4 two clubs opening the same partnership from both ends leave one relationship", async () => {
  sql(`delete from public.club_partnerships where requesting_club_id in ('${ids.club}','${ids.far}') or partner_club_id in ('${ids.club}','${ids.far}')`)
  const a = session(`mrace_a_${TAG}`, `begin;\n${asUser(ids.ca)}insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
    values ('${ids.club}','${ids.far}','pending','${ids.ca}');\ncommit;\n`)
  const b = session(`mrace_b_${TAG}`, `begin;\n${asUser(ids.farca)}insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
    values ('${ids.far}','${ids.club}','pending','${ids.farca}');\ncommit;\n`)
  const [oa, ob] = await Promise.all([a.done, b.done])
  const n = one(`select count(*) from public.club_partnerships where status <> 'revoked'
    and least(requesting_club_id, partner_club_id) = least('${ids.club}'::uuid,'${ids.far}'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('${ids.club}'::uuid,'${ids.far}'::uuid)`)
  assert.equal(n, "1", `the same partnership exists ${n} times\nA:${oa}\nB:${ob}`)
  // Both ends were authorised -- the duplicate was refused on identity, not on authority, which is
  // the distinction that matters when two clubs both legitimately want the same relationship.
  for (const [who, cl] of [[ids.ca, ids.club], [ids.farca, ids.far]] as const) {
    assert.equal(one(`select allowed from internal.capability_decision('${who}', 'club.partners.manage', 'club', '${cl}', null, null)`), "t",
      "a club administrator lost club.partners.manage")
  }
})

after(() => {
  const people = [ids.ca, ids.ca2, ids.fs, ids.farca]
  sql(`do $$
declare v_people uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
        v_clubs uuid[] := array['${ids.club}'::uuid, '${ids.far}'::uuid];
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from public.notifications where user_id = any(v_people);
  delete from public.security_events where club_id = any(v_clubs) or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  delete from public.club_partnerships where requesting_club_id = any(v_clubs) or partner_club_id = any(v_clubs);
  delete from public.club_ovalball_invitations where inviting_club_id = any(v_clubs);
  delete from public.club_documents where club_id = any(v_clubs);
  delete from public.document_folders where club_id = any(v_clubs);
  delete from public.season_transitions where rollover_id in (select id from public.age_grade_rollovers where club_id = any(v_clubs));
  delete from public.age_grade_rollover_group_flags where rollover_id in (select id from public.age_grade_rollovers where club_id = any(v_clubs));
  delete from public.age_grade_rollover_player_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id = any(v_clubs));
  delete from public.age_grade_rollover_planned_teams where rollover_id in (select id from public.age_grade_rollovers where club_id = any(v_clubs));
  delete from public.age_grade_rollover_team_proposals where rollover_id in (select id from public.age_grade_rollovers where club_id = any(v_clubs));
  delete from public.age_grade_rollovers where club_id = any(v_clubs);
  delete from public.team_season_identity where team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key like 'mrace-%-${TAG}';
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.table_name in ('club_partnerships','club_documents','document_folders','age_grade_rollovers','club_memberships','teams','clubs','club_directory','profiles')
           and a.changed_at >= '${startedAt}'::timestamptz
           and not exists (select 1 from public.club_partnerships x where x.id = a.record_id)
           and not exists (select 1 from public.club_documents x where x.id = a.record_id)
           and not exists (select 1 from public.document_folders x where x.id = a.record_id)
           and not exists (select 1 from public.age_grade_rollovers x where x.id = a.record_id)
           and not exists (select 1 from public.club_memberships x where x.id = a.record_id)
           and not exists (select 1 from public.teams x where x.id = a.record_id)
           and not exists (select 1 from public.clubs x where x.id = a.record_id)
           and not exists (select 1 from public.club_directory x where x.id = a.record_id)
           and not exists (select 1 from public.profiles x where x.id = a.record_id); end $$;`)
})
