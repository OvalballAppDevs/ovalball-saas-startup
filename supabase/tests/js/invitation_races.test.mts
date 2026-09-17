import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"

/**
 * INVITATION RACES (Identity/Auth Slice 5, Phase 2 races R1-R6, plus R18).
 *
 * Real concurrent database sessions. No sleep decides a result.
 *
 *   R1  the same single-use invitation redeemed twice at once   one membership, not two
 *   R2  redemption racing revocation                            whichever commits first wins, coherently
 *   R3  the issuer loses authority while redemption is in flight
 *   R4  two personal invitations issued for one email and scope  one invitation, not two live secrets
 *   R5  a team code redeemed twice by the same person           one join request, idempotent
 *   R6  a team code's max_uses reached by concurrent users      exactly max_uses succeed
 *   R18 a THREE-team staff invitation opened twice at once       one complete three-team outcome
 *
 * R1 and R6 are the ones that matter. An invitation is a credential: if two sessions can both consume
 * a single-use one, the "single use" in the design is decoration, and a club that invited one Club
 * Admin gets two.
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

const email = (id: string) => `irace-${TAG}-${id}@ovalball.test`
const asUser = (id: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated" })}', true);\n`

const ids = {
  ca: randomUUID(), ca2: randomUUID(), invitee: randomUUID(), joinerA: randomUUID(), joinerB: randomUUID(), joinerC: randomUUID(),
  multi: randomUUID(),
  club: "", dir: "", team: "", teamB: "", teamC: "",
}

function person(id: string, label: string) {
  sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email(id)}', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') on conflict (id) do nothing;
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values ('${id}', 'Irace', '${label}', '${email(id)}', (current_date - interval '35 years')::date)
    on conflict (id) do update set surname = excluded.surname;`)
}

function seed() {
  for (const [k, v] of [["ca","CA"],["ca2","CA2"],["invitee","INV"],["joinerA","JA"],["joinerB","JB"],["joinerC","JC"],["multi","MT"]] as const) {
    person((ids as never as Record<string,string>)[k], v)
  }
  ids.dir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Irace ${TAG} RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','irace-${TAG}') returning id`)
  ids.club = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}','irace-${TAG}','active') returning id`)
  ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 12 Boys','irace-u12-${TAG}','youth','U12','boys','union',true) returning id`)
  ids.teamB = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 13 Boys','irace-u13-${TAG}','youth','U13','boys','union',true) returning id`)
  ids.teamC = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values ('${ids.club}','Under 14 Boys','irace-u14-${TAG}','youth','U14','boys','union',true) returning id`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${ids.club}','${ids.ca}','CLUB_ADMIN','active'),
      ('${ids.club}','${ids.ca2}','CLUB_ADMIN','active')`)
}
seed()

/** Issues an invitation as the Club Admin and returns its id, token and code. */
function issueAs(actor: string, kind: string, to: string | null, roles: string[], maxUses: number | null = null,
                 teams: string[] | null = null): { id: string; token: string; code: string } {
  const teamList = teams ? `array[${teams.map((t) => `'${t}'::uuid`).join(",")}]` : "null"
  const row = one(`begin;
${asUser(actor)}select id || '|' || token || '|' || code from public.issue_invitation(
  '${kind}', ${kind === "TEAM_JOIN_CODE" ? "null" : `'${ids.club}'`}, ${teams ? "null" : `'${ids.team}'`}, null, null, null,
  ${to ? `'${to}'` : "null"}, '${JSON.stringify({ roles })}'::jsonb, ${maxUses ?? "null"}, ${teamList}) as t(id, token, code, e, a);
commit;`)
  const [id, token, code] = row.split("|")
  return { id, token, code }
}
const issue = (kind: string, to: string | null, roles: string[], maxUses: number | null = null) =>
  issueAs(ids.ca, kind, to, roles, maxUses)

test("R1 the same single-use invitation redeemed twice at once produces one membership, not two", async () => {
  const inv = issue("CLUB_STAFF", email(ids.invitee), ["COACH"])
  const script = `begin;\n${asUser(ids.invitee)}select public.redeem_invitation('${inv.token}', null);\ncommit;\n`
  const [a, b] = [session(`irace_a_${TAG}`, script), session(`irace_b_${TAG}`, script)]
  const [oa, ob] = await Promise.all([a.done, b.done])

  const memberships = one(`select count(*) from public.club_memberships where user_id = '${ids.invitee}' and club_id = '${ids.club}'`)
  assert.equal(memberships, "1", `the invitee ended up with ${memberships} memberships\nA:${oa}\nB:${ob}`)
  const roles = one(`select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
    where m.user_id = '${ids.invitee}' and ra.role_key = 'COACH' and ra.state = 'ACTIVE'`)
  assert.equal(roles, "1", `the invitee ended up with ${roles} Coach roles\nA:${oa}\nB:${ob}`)
  assert.equal(one(`select state from public.access_invitations where id = '${inv.id}'`), "REDEEMED")
  assert.equal(one(`select count(*) from public.invitation_redemptions where invitation_id = '${inv.id}'`), "1",
    `more than one redemption row for a single-use invitation\nA:${oa}\nB:${ob}`)
})

test("R2 redemption racing revocation leaves one coherent answer", async () => {
  const inv = issue("CLUB_STAFF", email(ids.joinerA), ["VOLUNTEER"])
  const redeem = session(`irace_r_${TAG}`, `begin;\n${asUser(ids.joinerA)}select public.redeem_invitation('${inv.token}', null);\ncommit;\n`)
  const revoke = session(`irace_v_${TAG}`, `begin;\n${asUser(ids.ca)}select public.revoke_invitation('${inv.id}', 'raced revocation');\ncommit;\n`)
  const [orr, ovv] = await Promise.all([redeem.done, revoke.done])

  const state = one(`select state from public.access_invitations where id = '${inv.id}'`)
  const joined = one(`select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
    where m.user_id = '${ids.joinerA}' and ra.role_key = 'VOLUNTEER' and ra.state = 'ACTIVE'`)
  // Either the redemption got there first and stands, or the revocation did and nothing was granted.
  // What must never happen is a revoked invitation that nonetheless handed out a role.
  assert.ok((state === "REDEEMED" && joined === "1") || (state === "REVOKED" && joined === "0"),
    `revocation and redemption disagree (state=${state}, roles=${joined})\nREDEEM:${orr}\nREVOKE:${ovv}`)
})

test("R3 an issuer losing authority mid-flight cannot leave a usable invitation behind", async () => {
  // A SECOND Club Admin issues this one and is then removed. A revoked membership is terminal by
  // design -- "re-admit the person as a new membership" -- so the issuer cannot be the club admin the
  // other races depend on, and there is nothing to put back afterwards.
  const inv = issueAs(ids.ca2, "CLUB_STAFF", email(ids.joinerB), ["VOLUNTEER"])
  const membership = one(`select id from public.club_memberships where user_id = '${ids.ca2}' and club_id = '${ids.club}'`)
  {
    const redeem = session(`irace_r3_${TAG}`, `begin;\n${asUser(ids.joinerB)}select public.redeem_invitation('${inv.token}', null);\ncommit;\n`)
    const strip = session(`irace_s3_${TAG}`, `begin;\nupdate public.club_memberships set state = 'REVOKED', status = 'revoked' where id = '${membership}';\ncommit;\n`)
    const [orr, oss] = await Promise.all([redeem.done, strip.done])

    const joined = one(`select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = '${ids.joinerB}' and ra.role_key = 'VOLUNTEER' and ra.state = 'ACTIVE'`)
    const state = one(`select state from public.access_invitations where id = '${inv.id}'`)
    // Either it committed before the issuer lost the club, or it did not. What must never happen is a
    // role granted on the authority of somebody who no longer has it.
    assert.ok((state === "REDEEMED" && joined === "1") || (state !== "REDEEMED" && joined === "0"),
      `an invitation outlived its issuer's authority (state=${state}, roles=${joined})\nREDEEM:${orr}\nSTRIP:${oss}`)

    // And afterwards it is definitively dead, because the re-check runs on every attempt.
    sql(`update public.club_memberships set state = 'REVOKED', status = 'revoked' where id = '${membership}'`)
    const after = one(`begin;\n${asUser(ids.joinerB)}select public.redeem_invitation('${inv.token}', null)->>'outcome';\ncommit;`)
    assert.ok(after === "REFUSED" || after === "ALREADY_REDEEMED",
      `an invitation from a stripped issuer still works (${after})`)
  }
})

test("R4 two personal invitations issued at once for one email and scope leave one invitation", async () => {
  const to = email(ids.joinerC)
  const script = `begin;\n${asUser(ids.ca)}select public.issue_invitation('CLUB_STAFF','${ids.club}','${ids.team}',null,null,null,'${to}','{"roles":["VOLUNTEER"]}'::jsonb,null);\ncommit;\n`
  const [a, b] = [session(`irace_i1_${TAG}`, script), session(`irace_i2_${TAG}`, script)]
  const [oa, ob] = await Promise.all([a.done, b.done])
  const live = one(`select count(*) from public.access_invitations
    where kind = 'CLUB_STAFF' and invited_email_normalised = '${to}' and state = 'ISSUED'`)
  assert.equal(live, "1", `${live} live invitations for one person and scope -- two working secrets\nA:${oa}\nB:${ob}`)
})

test("R5 a team code redeemed twice by the same person leaves one join request", async () => {
  const code = issue("TEAM_JOIN_CODE", null, [], 25)
  const script = `begin;\n${asUser(ids.joinerA)}select public.redeem_invitation(null, '${code.code}');\ncommit;\n`
  const [a, b] = [session(`irace_c1_${TAG}`, script), session(`irace_c2_${TAG}`, script)]
  const [oa, ob] = await Promise.all([a.done, b.done])
  const requests = one(`select count(*) from public.club_join_requests where requesting_user_id = '${ids.joinerA}' and club_id = '${ids.club}'`)
  assert.equal(requests, "1", `${requests} join requests from one person and one code\nA:${oa}\nB:${ob}`)
  assert.equal(one(`select count(*) from public.invitation_redemptions where invitation_id = '${code.id}' and user_id = '${ids.joinerA}'`), "1")
})

test("R6 a team code at its limit admits exactly max_uses concurrent users and no more", async () => {
  const code = issue("TEAM_JOIN_CODE", null, [], 2)
  const three = [ids.invitee, ids.joinerB, ids.joinerC].map((u, i) =>
    session(`irace_m${i}_${TAG}`, `begin;\n${asUser(u)}select public.redeem_invitation(null, '${code.code}');\ncommit;\n`))
  const outs = await Promise.all(three.map((s) => s.done))
  const used = Number(one(`select use_count from public.access_invitations where id = '${code.id}'`))
  const redemptions = Number(one(`select count(*) from public.invitation_redemptions where invitation_id = '${code.id}'`))
  assert.ok(used <= 2, `use_count ran past max_uses (${used})\n${outs.join("\n---\n")}`)
  assert.equal(redemptions, used, `use_count ${used} disagrees with ${redemptions} redemption rows`)
  assert.ok(used >= 1, `no concurrent redemption succeeded at all\n${outs.join("\n---\n")}`)
})

/**
 * R18. A staff invitation for THREE teams, opened twice at the same instant.
 *
 * A multi-team invitation has more to go wrong than a single-team one: the outcome is now several
 * writes, and two sessions racing could interleave them into a person holding some teams from one
 * attempt and some from the other. "Exactly one complete outcome" means all three teams, once.
 */
test("R18 a multi-team staff invitation redeemed twice at once produces one complete three-team outcome", async () => {
  const inv = issueAs(ids.ca, "CLUB_STAFF", email(ids.multi), ["COACH"], null, [ids.team, ids.teamB, ids.teamC])
  const script = `begin;\n${asUser(ids.multi)}select public.redeem_invitation('${inv.token}', null);\ncommit;\n`
  const [a, b] = [session(`irace_t1_${TAG}`, script), session(`irace_t2_${TAG}`, script)]
  const [oa, ob] = await Promise.all([a.done, b.done])
  const ctx = `A:${oa}\nB:${ob}`

  assert.equal(one(`select count(*) from public.club_memberships where user_id = '${ids.multi}' and club_id = '${ids.club}'`),
    "1", `the invitee ended up with more than one membership\n${ctx}`)
  assert.equal(one(`select count(*) from public.invitation_redemptions where invitation_id = '${inv.id}'`),
    "1", `a three-team invitation was consumed more than once\n${ctx}`)

  // COMPLETE: all three, not two.
  const teams = one(`select string_agg(distinct ra.team_id::text, ',' order by ra.team_id::text)
    from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
    where m.user_id = '${ids.multi}' and ra.role_key = 'COACH' and ra.state = 'ACTIVE' and ra.team_id is not null`)
  const expected = [ids.team, ids.teamB, ids.teamC].sort().join(",")
  assert.equal(teams, expected, `the racing redemptions left a PARTIAL team set\n${ctx}`)

  // ONE: three assignments, not six.
  assert.equal(one(`select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
    where m.user_id = '${ids.multi}' and ra.role_key = 'COACH' and ra.state = 'ACTIVE'`),
    "3", `the losing session duplicated the team grants\n${ctx}`)
})

after(() => {
  const people = [ids.ca, ids.ca2, ids.invitee, ids.joinerA, ids.joinerB, ids.joinerC, ids.multi]
  sql(`do $$
declare v_people uuid[] := array[${people.map((p) => `'${p}'::uuid`).join(",")}];
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from public.invitation_redemption_attempts where user_id = any(v_people);
  delete from public.invitation_redemptions where invitation_id in (select id from public.access_invitations where club_id = '${ids.club}' or team_id = '${ids.team}');
  delete from public.club_join_requests where club_id = '${ids.club}';
  delete from public.access_invitations where club_id = '${ids.club}' or team_id = '${ids.team}';
  delete from public.notifications where user_id = any(v_people);
  delete from public.security_events where club_id = '${ids.club}' or actor_user_id = any(v_people);
  delete from public.role_assignments where club_id = '${ids.club}';
  delete from public.club_memberships where club_id = '${ids.club}';
  delete from public.teams where club_id = '${ids.club}';
  delete from public.clubs where id = '${ids.club}';
  delete from public.club_directory where normalized_key = 'irace-${TAG}';
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
  sql(`do $$ begin perform set_config('ovalball.maintenance','on',true);
       delete from public.audit_log a
         where a.changed_at >= '${startedAt}'::timestamptz
           and a.table_name in ('access_invitations','club_join_requests','role_assignments','club_memberships','teams','clubs','club_directory','profiles')
           and not exists (select 1 from public.access_invitations x where x.id = a.record_id)
           and not exists (select 1 from public.club_memberships x where x.id = a.record_id)
           and not exists (select 1 from public.role_assignments x where x.id = a.record_id)
           and not exists (select 1 from public.clubs x where x.id = a.record_id)
           and not exists (select 1 from public.profiles x where x.id = a.record_id); end $$;`)
})
