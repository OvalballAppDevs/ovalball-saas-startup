import { test, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

/**
 * SIGNUP'S DOORS, WITH A REAL SESSION (20270743000000).
 *
 * lib/signup/complete-signup.ts now makes a new person's claim through submit_club_claim and their request to
 * join a club through request_club_membership, and both refuse a session that is not live. The SQL suite
 * (one_door_for_claims_and_referrals) proves the rules with JWT claims alone; this signs a real person in
 * through GoTrue and makes exactly the calls signup makes, over the REST API a browser uses -- so the session
 * check is met by a real session id, and:
 *
 *   S1  the claim is made: the proposed teams kept, the referring club resolved by the server from the slug
 *   S2  a fourth claim in a day is refused -- the limit signup used to skip
 *   S3  the person cannot write a claim, a join request or a partnership themselves: the API refuses each
 *   S4  the join request is pending, and opens the pending membership
 *
 * Everything it creates is removed at the end -- including the "New club claim" notices its claims send every
 * Site Admin -- and the cleanup is verified.
 */

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = randomUUID().slice(0, 8)

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  } catch {}
  return ""
}
const URL_BASE = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
}
const one = (q: string) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const email = `signup-door-${TAG}@ovalball.test`
const password = randomBytes(18).toString("base64url")
const ids: { user: string; dirs: string[]; referrer: string; slug: string; joinClub: string } = { user: "", dirs: [], referrer: "", slug: `sod-ref-${TAG}`, joinClub: "" }
let token = ""

async function rest(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {}
  return { status: res.status, json }
}

const directory = (label: string) =>
  one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
       values ('SOD ${label} ${TAG} RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sod-${label.toLowerCase()}-${TAG}') returning id`)

test("signup's claim and join request go through the server's doors, with a real session", async (t) => {
  if (!PUBLISHABLE || !SERVICE) {
    t.skip("no publishable or service key in the environment")
    return
  }

  // A person, as signup makes them: confirmed, with a password, signed in through GoTrue.
  const created = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }).then((r) => r.json() as Promise<{ id?: string }>)
  assert.ok(created.id, "the person was created")
  ids.user = created.id as string
  sql(`update public.profiles set first_name = 'Sod', surname = 'Signup', date_of_birth = '1984-05-06' where id = '${ids.user}'`)

  // The clubs it meets: four directory entries to claim, a referring club with a slug, and a club to join.
  for (const label of ["A", "B", "C", "D"]) ids.dirs.push(directory(label))
  ids.referrer = one(`insert into public.clubs (directory_id, slug, status) values ('${directory("Ref")}', '${ids.slug}', 'active') returning id`)
  ids.joinClub = one(`insert into public.clubs (directory_id, slug, status) values ('${directory("Join")}', 'sod-join-${TAG}', 'active') returning id`)

  const session = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json() as Promise<{ access_token?: string }>)
  assert.ok(session.access_token, "the person signed in through GoTrue")
  token = session.access_token as string

  // S1: exactly what signup sends.
  const teams = [{ ageGroup: "U12", gender: "boys" }, { ageGroup: "U14", gender: "girls" }]
  const first = await rest("rpc/submit_club_claim", {
    p_directory_id: ids.dirs[0],
    p_claimed_role: "Club Secretary",
    p_authority_declaration: "I confirm that I have permission from this club to act on its behalf.",
    p_referral_slug: ids.slug.toUpperCase(),
    p_proposed_teams: teams,
  })
  assert.equal(first.status, 200, `the claim was refused: ${JSON.stringify(first.json)}`)
  const claim = one(`select referred_by_club_id || '|' || state || '|' || jsonb_array_length(proposed_teams) from public.club_claims where id = '${first.json}'`)
  assert.equal(claim, `${ids.referrer}|SUBMITTED|2`, "S1 the claim keeps its proposed teams, and the server resolved the referring club from the slug")

  // S2: three a day, however the claim is made.
  for (const dir of ids.dirs.slice(1, 3)) {
    const r = await rest("rpc/submit_club_claim", { p_directory_id: dir, p_claimed_role: "Club Secretary", p_authority_declaration: "me" })
    assert.equal(r.status, 200, `claim refused early: ${JSON.stringify(r.json)}`)
  }
  const fourth = await rest("rpc/submit_club_claim", { p_directory_id: ids.dirs[3], p_claimed_role: "Club Secretary", p_authority_declaration: "me" })
  assert.ok(fourth.status >= 400 && /too many claims today/.test(JSON.stringify(fourth.json)), `S2 a fourth claim in a day is refused (${fourth.status})`)

  // S3: the doors signup used to walk through itself are shut.
  const directClaim = await rest("club_claims", { directory_id: ids.dirs[3], claimant_user_id: ids.user, claimed_role: "Club Secretary", authority_declaration: "me", state: "APPROVED" })
  const directJoin = await rest("club_join_requests", { club_id: ids.joinClub, requesting_user_id: ids.user, requested_role: "Volunteer", status: "approved" })
  const directPartnership = await rest("club_partnerships", { requesting_club_id: ids.referrer, partner_club_id: ids.joinClub, status: "active", requested_by: ids.user })
  assert.ok(directClaim.status >= 400 && directJoin.status >= 400 && directPartnership.status >= 400,
    `S3 no direct write is accepted (${directClaim.status}, ${directJoin.status}, ${directPartnership.status})`)
  assert.equal(one(`select count(*) from public.club_claims where claimant_user_id = '${ids.user}'`), "3")

  // S4: the join request signup makes for a club already on Ovalball.
  const join = await rest("rpc/request_club_membership", { p_club_id: ids.joinClub, p_requested_role: "Volunteer" })
  assert.equal(join.status, 200, `the join request was refused: ${JSON.stringify(join.json)}`)
  const joined = one(`select r.status || '|' || coalesce(r.decided_by::text, '-') || '|' || coalesce(r.source_invitation_id::text, '-') || '|' || m.state || '|' || m.source
                        from public.club_join_requests r join public.club_memberships m on m.source_request_id = r.id where r.id = '${join.json}'`)
  assert.equal(joined, "pending|-|-|PENDING|JOIN_REQUEST", "S4 the join request is pending, decided by nobody, and opens the pending membership")
})

after(() => {
  const dirs = ids.dirs.map((d) => `'${d}'`).join(",") || "null"
  sql(`do $$
declare
  v_user uuid := ${ids.user ? `'${ids.user}'::uuid` : "null::uuid"};
  v_clubs uuid[] := array(select id from public.clubs where slug in ('${ids.slug}', 'sod-join-${TAG}'));
  v_dirs uuid[] := array(select id from public.club_directory where normalized_key like 'sod-%-${TAG}');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array(select id from public.club_claims where claimant_user_id = v_user)
            || array(select id from public.club_join_requests where requesting_user_id = v_user)
            || array(select id from public.club_memberships where user_id = v_user or club_id = any(v_clubs))
            || v_clubs || v_dirs || array(select v_user where v_user is not null);
  -- A claim tells every Site Admin: those notices are this run's too.
  delete from public.notifications where user_id = v_user or data ->> 'directory_id' in (select unnest(v_dirs)::text)
     or data ->> 'club_id' in (select unnest(v_clubs)::text);
  delete from public.club_claim_messages where claim_id in (select id from public.club_claims where claimant_user_id = v_user);
  delete from public.club_claims where claimant_user_id = v_user or directory_id = any(v_dirs);
  delete from public.club_join_requests where requesting_user_id = v_user or club_id = any(v_clubs);
  delete from public.club_partnerships where requesting_club_id = any(v_clubs) or partner_club_id = any(v_clubs);
  delete from public.role_assignments where user_id = v_user or club_id = any(v_clubs);
  delete from public.club_memberships where user_id = v_user or club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where id = any(v_dirs);
  delete from public.security_events where actor_user_id = v_user or subject_user_id = v_user or club_id = any(v_clubs);
  delete from public.audit_log where changed_by = v_user or actor_user_id = v_user or record_id = any(v_records);
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
end $$;`)
  const left = one(`select (select count(*) from auth.users where email = '${email}')
                         + (select count(*) from public.club_directory where normalized_key like 'sod-%-${TAG}')
                         + (select count(*) from public.clubs where slug in ('${ids.slug}', 'sod-join-${TAG}'))
                         + (select count(*) from public.notifications where data ->> 'directory_id' in (${dirs}))`)
  if (left !== "0") throw new Error(`signup_one_door left ${left} rows behind`)
})
