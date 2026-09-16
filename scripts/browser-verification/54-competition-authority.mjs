// COMPETITION AND TOURNAMENT AUTHORITY -- browser acceptance.
//
// Identity/Auth Slice 4D (Phase 2 AA.3 row 4d, design J.8 lines 482-491), driven through the
// running product with disposable identities and three disposable clubs:
//
//   an organiser Club Admin  issues the edition's matches; nobody else can
//   a participating club     answers a competition match through its Club Admin and the team's
//                            Team Manager -- and NOT through a Coach, which is 4D's intended change
//   a Team Manager           schedules THEIR OWN team's tournament day and not another team's,
//                            and does not get the parent occasion
//   the perimeter            a browser holds no write on competition_matches, so every change is
//                            a SECURITY DEFINER RPC that enforces its own contract
//   a non-organiser          reads none of a non-public edition's matches
//   a phone                  the competition surface fits 390px
//
// Everything this run creates is removed at the end, including its audit history.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/54-competition-authority.mjs

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP, launch, measure, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
const API = status.API_URL
const ANON_KEY = status.ANON_KEY
const SERVICE_KEY = status.SERVICE_ROLE_KEY

const TAG = Date.now().toString(36).slice(-6)
const people = {
  organiser: { label: "organising Club Admin", email: `uat.slice4d.organiser.${TAG}@ovalball.test`, first: "Olive", surname: `Organiser ${TAG}` },
  partAdmin: { label: "participating Club Admin", email: `uat.slice4d.partadmin.${TAG}@ovalball.test`, first: "Pat", surname: `PartAdmin ${TAG}` },
  manager: { label: "Team Manager", email: `uat.slice4d.manager.${TAG}@ovalball.test`, first: "Morgan", surname: `Manager ${TAG}` },
  manager2: { label: "other Team Manager", email: `uat.slice4d.manager2.${TAG}@ovalball.test`, first: "Max", surname: `Manager2 ${TAG}` },
  coach: { label: "Coach", email: `uat.slice4d.coach.${TAG}@ovalball.test`, first: "Casey", surname: `Coach ${TAG}` },
  member: { label: "club Member", email: `uat.slice4d.member.${TAG}@ovalball.test`, first: "Mel", surname: `Member ${TAG}` },
}

async function createIdentity(person) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${person.email}: HTTP ${res.status}`)
  person.id = body.id
  sql(`update public.profiles set first_name = '${person.first}', surname = '${person.surname}', setup_state = 'COMPLETE' where id = '${person.id}'`)
}

let cleaned = false
function cleanupTag(tag) {
  sql(`
do $$
declare
  v_org uuid := (select id from public.clubs where slug = 'uat-s4d-org-${tag}');
  v_part uuid := (select id from public.clubs where slug = 'uat-s4d-part-${tag}');
  v_clubs uuid[] := array(select id from public.clubs where slug in ('uat-s4d-org-${tag}','uat-s4d-part-${tag}'));
  v_people uuid[] := array(select id from auth.users where email like 'uat.slice4d.%.${tag}@ovalball.test');
  v_eds uuid[] := array(select e.id from public.competition_editions e join public.competitions c on c.id = e.competition_id
                        where c.normalized_key = 'uat-s4d-cup-${tag}');
  v_tourns uuid[] := array(select id from public.tournaments where host_club_id = any(v_clubs));
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := v_people || v_clubs || v_eds || v_tourns
    || array(select id from public.competition_matches where edition_id = any(v_eds))
    || array(select id from public.competition_participants where edition_id = any(v_eds))
    || array(select id from public.competitions where normalized_key = 'uat-s4d-cup-${tag}')
    || array(select id from public.tournament_team_entries where tournament_id = any(v_tourns))
    || array(select id from public.teams where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs))
    || array(select id from public.role_assignments where club_id = any(v_clubs))
    || array(select id from public.club_directory where normalized_key in ('uat-s4d-org-${tag}','uat-s4d-part-${tag}'));
  delete from public.competition_match_verifications where match_id in (select id from public.competition_matches where edition_id = any(v_eds));
  delete from public.competition_match_fixtures where match_id in (select id from public.competition_matches where edition_id = any(v_eds));
  delete from public.competition_matches where edition_id = any(v_eds);
  delete from public.competition_participants where edition_id = any(v_eds);
  delete from public.competition_stages where edition_id = any(v_eds);
  delete from public.competition_editions where id = any(v_eds);
  delete from public.competitions where normalized_key = 'uat-s4d-cup-${tag}';
  delete from public.tournament_games where entry_id in (select id from public.tournament_team_entries where tournament_id = any(v_tourns));
  delete from public.tournament_entry_opponents where entry_id in (select id from public.tournament_team_entries where tournament_id = any(v_tourns));
  delete from public.tournament_team_entries where tournament_id = any(v_tourns);
  delete from public.tournament_participants where tournament_id = any(v_tourns);
  delete from public.tournament_pitches where tournament_id = any(v_tourns);
  delete from public.tournaments where id = any(v_tourns);
  delete from public.notifications where user_id = any(v_people);
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id = any(v_clubs));
  delete from public.role_assignments where club_id = any(v_clubs);
  delete from public.club_memberships where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key in ('uat-s4d-org-${tag}','uat-s4d-part-${tag}');
  delete from public.security_events where subject_user_id = any(v_people) or actor_user_id = any(v_people) or club_id = any(v_clubs);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}
async function cleanup() {
  if (cleaned) return
  cleaned = true
  cleanupTag(TAG)
  for (const person of Object.values(people)) {
    try {
      fs.unlinkSync(path.join(os.tmpdir(), "ovalball-uat-sessions", `${person.email.replace(/[^a-z0-9.@-]/gi, "_")}.json`))
    } catch {}
  }
  const left = one(`select (select count(*) from public.clubs where slug in ('uat-s4d-org-${TAG}','uat-s4d-part-${TAG}'))
    + (select count(*) from auth.users where email like 'uat.slice4d.%.${TAG}@ovalball.test')
    + (select count(*) from public.competitions where normalized_key = 'uat-s4d-cup-${TAG}')
    + (select count(*) from public.notifications n join auth.users u on u.id = n.user_id where u.email like 'uat.slice4d.%.${TAG}@ovalball.test')`)
  const cacheDir = path.join(os.tmpdir(), "ovalball-uat-sessions")
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.includes(`.${TAG}@`)).length : 0
  record("Z1 cleanup: every club, identity, competition, tournament, notification and history row this run created is gone", left === "0" && cached === 0, `remaining=${left} cached=${cached}`)
}
process.on("SIGINT", async () => { await cleanup(); process.exit(1) })

const pageProblems = []
function watch(context, label) {
  context.on("page", (p) => {
    p.on("pageerror", (e) => pageProblems.push(`${label} pageerror ${e.message.split("\n")[0]}`))
    p.on("console", (msg) => { if (msg.type() === "error") pageProblems.push(`${label} console ${msg.text().slice(0, 200)}`) })
    p.on("response", (r) => { if (r.status() >= 500) pageProblems.push(`${label} HTTP ${r.status()} ${r.url().replace(APP, "")}`) })
  })
  return context
}

async function tokenFor(context) {
  // sb-<ref>-auth-token, optionally chunked .0/.1. The *-code-verifier cookies share the
  // "auth-token" substring and must be excluded, or the joined value is corrupt and every
  // request returns 401 -- which reads as a refusal rather than as a broken test.
  const parts = (await context.cookies())
    .filter((c) => /auth-token(\.\d+)?$/.test(c.name) && !c.name.includes("code-verifier"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
  if (parts.length === 0) throw new Error("no Supabase session cookie found for this context")
  const raw = parts.join("")
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : raw
  const token = JSON.parse(json).access_token
  if (!token) throw new Error("session cookie carried no access_token")
  return token
}

async function rpc(context, name, args) {
  const res = await context.request.post(`${API}/rest/v1/rpc/${name}`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(context)}` },
    data: args, failOnStatusCode: false,
  })
  return { status: res.status(), body: await res.text() }
}

async function open(page, route) {
  const response = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { status: response?.status() ?? 0, url: page.url() }
}

// ---------------------------------------------------------------------------
// Seed: an organising club, a participating club with two teams, one competition
// edition holding one match between the participating club's two teams, and a
// tournament the participating club hosts with both teams entered.
// ---------------------------------------------------------------------------
for (const stale of sql(`select distinct split_part(split_part(email, '@', 1), '.', 4) from auth.users where email like 'uat.slice4d.%@ovalball.test'`).split("\n").map((l) => l.trim()).filter(Boolean)) cleanupTag(stale)
for (const person of Object.values(people)) await createIdentity(person)

const ids = {}
ids.orgDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four D Organiser RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4d-org-${TAG}') returning id`)
ids.orgClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.orgDir}','uat-s4d-org-${TAG}','active') returning id`)
ids.partDir = one(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Slice Four D Participant RUFC ${TAG}','Testham','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','uat-s4d-part-${TAG}') returning id`)
ids.partClub = one(`insert into public.clubs (directory_id, slug, status) values ('${ids.partDir}','uat-s4d-part-${TAG}','active') returning id`)
ids.team = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.partClub}','Under 12 Boys','uat-s4d-u12-${TAG}','youth','U12','boys','union',true) returning id`)
ids.team2 = one(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values ('${ids.partClub}','Under 13 Boys','uat-s4d-u13-${TAG}','youth','U13','boys','union',true) returning id`)

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
  ('${ids.orgClub}','${people.organiser.id}','CLUB_ADMIN','active'),
  ('${ids.partClub}','${people.partAdmin.id}','CLUB_ADMIN','active'),
  ('${ids.partClub}','${people.manager.id}','BASIC_USER','active'),
  ('${ids.partClub}','${people.manager2.id}','BASIC_USER','active'),
  ('${ids.partClub}','${people.coach.id}','BASIC_USER','active'),
  ('${ids.partClub}','${people.member.id}','BASIC_USER','active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'manager' from public.club_memberships where club_id='${ids.partClub}' and user_id='${people.manager.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team2}', 'manager' from public.club_memberships where club_id='${ids.partClub}' and user_id='${people.manager2.id}';
insert into public.team_permissions (membership_id, team_id, permission)
  select id, '${ids.team}', 'coach' from public.club_memberships where club_id='${ids.partClub}' and user_id='${people.coach.id}';`)

ids.season = one(`select id from public.seasons where rugby_code='union' and not is_regression_fixture
  and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1`)
ids.comp = one(`insert into public.competitions (name, slug, normalized_key, organiser_club_id, rugby_code, created_by)
  values ('Slice Four D Cup ${TAG}','uat-s4d-cup-${TAG}','uat-s4d-cup-${TAG}','${ids.orgClub}','union','${people.organiser.id}') returning id`)
ids.edition = one(`insert into public.competition_editions (competition_id, season_id, rugby_code, created_by)
  values ('${ids.comp}','${ids.season}','union','${people.organiser.id}') returning id`)
ids.stage = one(`insert into public.competition_stages (edition_id, name, kind, sort_order) values ('${ids.edition}','League','league',1) returning id`)
ids.p1 = one(`insert into public.competition_participants (edition_id, club_id, club_directory_id, team_id, slot, created_by)
  values ('${ids.edition}','${ids.partClub}','${ids.partDir}','${ids.team}',1,'${people.organiser.id}') returning id`)
ids.p2 = one(`insert into public.competition_participants (edition_id, club_id, club_directory_id, team_id, slot, created_by)
  values ('${ids.edition}','${ids.partClub}','${ids.partDir}','${ids.team2}',2,'${people.organiser.id}') returning id`)
ids.match = one(`insert into public.competition_matches (edition_id, stage_id, status, round_number, home_participant_id, away_participant_id, created_by, is_public)
  values ('${ids.edition}','${ids.stage}','draft',1,'${ids.p1}','${ids.p2}','${people.organiser.id}',true) returning id`)

ids.tourn = one(`insert into public.tournaments (name, host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, created_by, season_id)
  values ('Slice Four D Festival ${TAG}','${ids.partClub}','${ids.partDir}','union',current_date+30,current_date+30,'confirmed','${people.partAdmin.id}','${ids.season}') returning id`)
ids.entry = one(`insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by)
  values ('${ids.tourn}','${ids.partClub}','${ids.team}','${people.partAdmin.id}') returning id`)
ids.entry2 = one(`insert into public.tournament_team_entries (tournament_id, club_id, team_id, created_by)
  values ('${ids.tourn}','${ids.partClub}','${ids.team2}','${people.partAdmin.id}') returning id`)

const browser = await launch()
const sessions = {}
try {
  for (const [key, person] of Object.entries(people)) {
    const context = watch(await newContext(browser), person.label)
    const page = await context.newPage()
    await signIn(page, person.email)
    sessions[key] = { context, page }
  }

  // A. issuing the edition's matches is the organiser's, and only the organiser's ------------
  {
    const r1 = await rpc(sessions.partAdmin.context, "issue_competition_matches", { p_edition_id: ids.edition })
    record("A1 the participating club's Club Admin cannot issue the organiser's matches", r1.status >= 400, `HTTP ${r1.status}`)
    const r2 = await rpc(sessions.coach.context, "issue_competition_matches", { p_edition_id: ids.edition })
    record("A2 nor a Coach", r2.status >= 400, `HTTP ${r2.status}`)
    const r3 = await rpc(sessions.organiser.context, "issue_competition_matches", { p_edition_id: ids.edition })
    record("A3 the organising Club Admin does", r3.status === 200, `HTTP ${r3.status} ${r3.body.slice(0, 120)}`)
    record("A4 and each participant got exactly one verification to answer",
      one(`select count(*) = count(distinct participant_id) and count(*) > 0 from public.competition_match_verifications where match_id = '${ids.match}'`) === "t")
  }

  // B. answering a competition match: J.8 line 488 ------------------------------------------
  {
    const v = one(`select id from public.competition_match_verifications where match_id='${ids.match}' and participant_id='${ids.p1}'`)
    const before = one(`select status from public.competition_match_verifications where id='${v}'`)
    const rc = await rpc(sessions.coach.context, "respond_competition_match", { p_verification_id: v, p_response: "confirmed" })
    record("B1 INTENDED CHANGE: a Coach may not answer a competition match", rc.status >= 400, `HTTP ${rc.status}`)
    record("B2 and the verification is untouched", one(`select status from public.competition_match_verifications where id='${v}'`) === before)
    const rm = await rpc(sessions.member.context, "respond_competition_match", { p_verification_id: v, p_response: "confirmed" })
    record("B3 nor an ordinary club Member", rm.status >= 400, `HTTP ${rm.status}`)
    const ro = await rpc(sessions.organiser.context, "respond_competition_match", { p_verification_id: v, p_response: "confirmed" })
    record("B4 nor the organiser answering on the club's behalf", ro.status >= 400, `HTTP ${ro.status}`)
    const rt = await rpc(sessions.manager.context, "respond_competition_match", { p_verification_id: v, p_response: "confirmed" })
    record("B5 the Team Manager of THAT team does", rt.status < 400, `HTTP ${rt.status} ${rt.body.slice(0, 120)}`)
    record("B6 and the answer is recorded", one(`select status from public.competition_match_verifications where id='${v}'`) === "confirmed")
  }

  // C. the tournament occasion is club-level; the entry is the team's -----------------------
  {
    const rtm = await rpc(sessions.manager.context, "save_tournament", {
      p_club_id: ids.partClub, p_name: `Slice Four D Festival ${TAG}`, p_starts_on: one(`select (current_date+30)::text`),
      p_ends_on: one(`select (current_date+30)::text`), p_rugby_code: "union", p_tournament_id: ids.tourn,
    })
    record("C1 INTENDED CHANGE: a Team Manager does not manage the tournament occasion", rtm.status >= 400, `HTTP ${rtm.status}`)
    const rca = await rpc(sessions.partAdmin.context, "save_tournament", {
      p_club_id: ids.partClub, p_name: `Slice Four D Festival ${TAG}`, p_starts_on: one(`select (current_date+30)::text`),
      p_ends_on: one(`select (current_date+30)::text`), p_rugby_code: "union", p_tournament_id: ids.tourn,
    })
    record("C2 the host club's Club Admin does", rca.status === 200, `HTTP ${rca.status} ${rca.body.slice(0, 160)}`)
    const rown = await rpc(sessions.manager.context, "remove_tournament_team_entry", { p_entry_id: ids.entry2 })
    record("C3 and a Team Manager cannot remove ANOTHER team's entry", rown.status >= 400, `HTTP ${rown.status}`)
    record("C4 which is still there", one(`select count(*) from public.tournament_team_entries where id='${ids.entry2}'`) === "1")
  }

  // D. the perimeter: no browser write on the competition tables ------------------------------
  {
    const res = await sessions.organiser.context.request.post(`${API}/rest/v1/competition_matches`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor(sessions.organiser.context)}`, Prefer: "return=representation" },
      data: { edition_id: ids.edition, stage_id: ids.stage, status: "scheduled" }, failOnStatusCode: false,
    })
    record("D1 a direct REST insert into competition_matches is refused even for the organiser", res.status() >= 400, `HTTP ${res.status()}`)
    record("D2 and left no row behind", one(`select count(*) from public.competition_matches where edition_id='${ids.edition}'`) === "1")
  }

  // E. reading a non-public edition ------------------------------------------------------------
  {
    sql(`update public.competition_editions set active = false where id = '${ids.edition}'`)
    const readAs = async (ctx) => {
      const res = await ctx.request.get(`${API}/rest/v1/competition_matches?edition_id=eq.${ids.edition}&select=id`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${await tokenFor(ctx)}` }, failOnStatusCode: false,
      })
      return JSON.parse(await res.text()).length
    }
    record("E1 the organiser reads the matches of a non-public edition", (await readAs(sessions.organiser.context)) === 1)
    record("E2 the participating club's Club Admin reads none of them", (await readAs(sessions.partAdmin.context)) === 0)
    record("E3 nor does an ordinary Member", (await readAs(sessions.member.context)) === 0)
    sql(`update public.competition_editions set active = true where id = '${ids.edition}'`)
  }

  // F. a phone -----------------------------------------------------------------------------------
  {
    const phoneCtx = watch(await newContext(browser, { width: 390, height: 844 }), "phone")
    const phone = await phoneCtx.newPage()
    await signIn(phone, people.organiser.email)
    await open(phone, "/fixtures/competitions")
    const m = await measure(phone)
    record("F1 the competition surface fits a 390px phone", m.scrollWidth <= m.innerWidth + 1, `scrollWidth=${m.scrollWidth}`)
    await phoneCtx.close()
  }

  record("I1 no page error, console error or 5xx response on any page", pageProblems.length === 0, pageProblems.slice(0, 5).join(" | "))
} finally {
  for (const s of Object.values(sessions)) await s.context.close().catch(() => {})
  await browser.close()
  await cleanup()
  summarise()
}
