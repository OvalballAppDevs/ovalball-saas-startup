// =====================================================================
// THE AGE DISPENSATION WORKFLOW -- THE WEB HALF (20270742000000)
//
// The server decides everything (supabase/tests/age_dispensation_workflow.sql).
// What only a browser can show is that the website carries those answers to
// the people they are for, and makes it unmistakable that a child does not
// normally fit, that the normal way in is closed, and that asking is not a
// grant:
//
//   A. A parent at a phone width opens the Under 12s' code. Their Under 11 child
//      is greyed with the reason and offered Request Dispensation; the reason is
//      required; sending says asking is not approval and who decides.
//   B. The team's manager is told nothing yet: one quiet waiting line, no name,
//      and the child's request record is not theirs to read.
//   C. The club's Safeguarding Officer finds it in the club's register, opens the
//      record -- the age-grade bridge, the mismatch, the amber band, the decision --
//      finds Decline waits for a reason, and approves.
//   D. The Club Admin is told who decided, and sees it decided, with nothing left
//      to decide.
//   E. Only now the team's manager sees the request, with the approval on it, and
//      places the child.
//   F. A second request: the Club Admin declines it with a reason; the parent reads
//      the declined record and the reason, and the place never happens.
//   G. The record fits a 320px phone; axe on every new surface.
//
// EVERYTHING IS THIS RUN'S OWN: an isolated club with its own Club Admin, a
// Safeguarding Officer confirmed by a throwaway Site Admin, a Team Manager, a
// parent and two children -- removed at the end, on success or failure, with the
// history that points at them. No persistent review identity is touched, and
// nothing reaches the owner's own login.
// =====================================================================

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { launch, newContext, signIn, APP, axeSource, measure, record, recordAxe, summarise, enrolAuthenticator } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const SHOTS = process.env.SHOT_DIR ?? path.resolve(import.meta.dirname, "../../.screenshots")
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: q,
    encoding: "utf8",
  }).trim()
const last = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT|SET)$/.test(l)).pop() ?? ""

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const file of [".env.local", ".env"]) {
    try {
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
    } catch {}
  }
  return ""
}
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const PASSWORD = env("UAT_BROWSER_PASSWORD")
if (!SERVICE_KEY || !PASSWORD) {
  console.error("Missing the service key or UAT_BROWSER_PASSWORD.")
  process.exit(1)
}

const PEOPLE = `uat.dw.%.${TAG}@ovalball.test`
const CA = { email: `uat.dw.ca.${TAG}@ovalball.test`, first: "Cara", surname: "Bell", dob: "1980-02-11" }
const SO = { email: `uat.dw.so.${TAG}@ovalball.test`, first: "Sol", surname: "Okafor", dob: "1978-06-03" }
const TM = { email: `uat.dw.tm.${TAG}@ovalball.test`, first: "Theo", surname: "Marsh", dob: "1985-09-21" }
const PARENT = { email: `uat.dw.parent.${TAG}@ovalball.test`, first: "Pat", surname: "Adams", dob: "1986-04-12" }
const SITE = { email: `uat.dw.site.${TAG}@ovalball.test`, first: "Sid", surname: "Admin", dob: "1975-01-01" }
const YAN = { first: "Yan", surname: "Adams" }
const KAI = { first: "Kai", surname: "Adams" }

const startedAt = sql("select now()")
const ids = { dir: null, club: null, u11: null, u12: null, invitation: null }

async function person(p) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${p.email}: HTTP ${res.status}`)
  p.id = body.id
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${p.id}', '${p.first}', '${p.surname}', '${p.email}', '${p.dob}')
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
       update public.profiles set setup_state = 'COMPLETE' where id = '${p.id}';
       select internal.refresh_account_security_state('${p.id}');`)
}

/** One statement as a person, in one transaction (the claims last for the transaction only). */
const as = (userId, statement) =>
  last(sql(`begin;
            select set_config('request.jwt.claims', json_build_object('sub','${userId}','role','authenticated')::text, true);
            ${statement};
            commit;`))

const q = (v) => (v ? `'${v}'::uuid` : "null::uuid")
function cleanup() {
  sql(`
do $$
declare
  v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
  v_club uuid := ${q(ids.club)};
  v_players uuid[];
  v_places uuid[];
  v_disp uuid[];
  v_inv uuid[] := array(select id from public.access_invitations where id = ${q(ids.invitation)});
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_players := array(select id from public.players where created_by = any(v_people) or user_id = any(v_people)
                     or id in (select player_id from public.guardians where guardian_user_id = any(v_people)));
  v_places := array(select id from public.player_team_memberships where player_id = any(v_players)
                     or team_id in (select id from public.teams where club_id = v_club));
  v_disp := array(select id from public.player_team_dispensation where player_id = any(v_players) or club_id = v_club);
  v_records := v_people || v_players || v_places || v_disp || v_inv
    || array(select id from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people))
    || array(select id from public.club_memberships where user_id = any(v_people) or club_id = v_club)
    || array(select id from public.role_assignments where user_id = any(v_people) or club_id = v_club)
    || array(select id from public.teams where club_id = v_club)
    || array(select v_club where v_club is not null);

  delete from public.notifications where user_id = any(v_people)
     or (created_at >= '${startedAt}' and (data ->> 'player_id' in (select unnest(v_players)::text)
                                         or data ->> 'dispensation_id' in (select unnest(v_disp)::text)
                                         or data ->> 'membership_id' in (select unnest(v_places)::text)
                                         or data ->> 'club_id' = v_club::text));
  delete from public.invitation_redemption_attempts where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.invitation_redemptions where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.club_join_requests where requesting_user_id = any(v_people) or source_invitation_id = any(v_inv);
  delete from public.player_team_memberships where id = any(v_places);
  delete from public.player_team_dispensation where id = any(v_disp);
  delete from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people);
  delete from public.players where id = any(v_players);
  delete from public.club_safeguarding_officers where club_id = v_club;
  delete from public.role_assignments where user_id = any(v_people) or club_id = v_club;
  delete from public.club_memberships where user_id = any(v_people) or club_id = v_club;
  delete from public.invitation_teams where invitation_id = any(v_inv);
  delete from public.access_invitations where id = any(v_inv);
  delete from public.site_admins where user_id = any(v_people);
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = ${q(ids.dir)};
  delete from public.security_events where actor_user_id = any(v_people) or subject_user_id = any(v_people) or player_id = any(v_players)
     or club_id = v_club or metadata ->> 'dispensation_id' in (select unnest(v_disp)::text)
     or metadata ->> 'invitation_id' in (select unnest(v_inv)::text)
     or metadata ->> 'team_membership_id' in (select unnest(v_places)::text)
     or metadata ->> 'membership_id' in (select unnest(v_records)::text)
     or metadata ->> 'relationship_id' in (select unnest(v_records)::text);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}

const errors = []
const watch = (page, label) => page.on("pageerror", (e) => errors.push(`${label}: ${e.message.split("\n")[0]}`))
const go = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
}
const text = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ")
async function axe(page) {
  await page.addScriptTag({ content: axeSource() })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      target: `${v.nodes[0]?.target?.join(" ") ?? ""} ${(v.nodes[0]?.any?.[0]?.message ?? "").slice(0, 160)} ${(v.nodes[0]?.html ?? "").slice(0, 120)}`,
    }))
  })
}
const shot = async (page, name) => {
  mkdirSync(SHOTS, { recursive: true })
  // From the top: a full-page capture of a scrolled page draws the fixed sidebar where the scroll left it.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

let browser = null
try {
  // ------------------------------------------------------------------ an isolated club
  for (const p of [CA, SO, TM, PARENT, SITE]) await person(p)
  ids.dir = sql(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                 values ('Dispensation ${TAG} RUFC', 'Testford', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'dw-${TAG}') returning id`)
  ids.club = sql(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'dw-${TAG}', 'active') returning id`)
  const team = (key, label) =>
    sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, canonical_team_type_id)
         select '${ids.club}', '${label}', 'dw-${key}-${TAG}', 'youth', ct.age_group, ct.gender, 'union', true, ct.id
           from public.canonical_team_types_by_code ct where ct.rugby_code = 'union' and ct.key = '${key}' limit 1 returning id`)
  ids.u11 = team("u11", "Under 11 Mixed")
  ids.u12 = team("u12", "Under 12 Boys")
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${CA.id}', 'CLUB_ADMIN', 'active');
       insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${SO.id}', 'BASIC_USER', 'active');
       insert into public.site_admins (user_id, status, profile_key) values ('${SITE.id}', 'active', 'SITE_FULL');`)
  const tmMembership = sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${TM.id}', 'BASIC_USER', 'active') returning id`)
  sql(`select internal.grant_role('${tmMembership}', 'TEAM_MANAGER', '${ids.u12}', 'LEGACY_BACKFILL', 'suite 97')`)
  // The officer is appointed as a real one is: nominated by the Club Admin, confirmed by Ovalball.
  const nominated = JSON.parse(as(CA.id, `select public.nominate_club_safeguarding_officer('${ids.club}', '${SO.id}', 'primary', 'suite 97 officer')::text`))
  as(SITE.id, `select public.confirm_safeguarding_officer('${nominated.assignment_id}', 'suite 97: confirming the officer')`)
  record("setup: the officer is confirmed, and is not a Club Admin", sql(`select internal.is_active_safeguarding_officer('${SO.id}', '${ids.club}')`) === "t")

  // The parent's two children, a year young for the Under 12s (the canonical resolver's own date).
  const dob = sql(`select internal.date_of_birth_in_age_grade('union', 'U11')`)
  for (const child of [YAN, KAI]) {
    child.playerId = last(sql(`
      with p as (insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, created_by)
                 values ('${child.first}', '${child.surname}', '${dob}', true, 'MALE', '${PARENT.id}') returning id)
      insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
      select '${PARENT.id}', p.id, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD' from p returning player_id;`))
  }
  record("setup: the children are in the U11 grade, so the Under 12s are too old a side for them",
    sql(`select internal.team_code_fit('${ids.u12}', '${dob}'::date, 'MALE')`) === "TOO_YOUNG")
  const issued = as(TM.id, `select invitation_id || '|' || code from public.issue_invitation('TEAM_JOIN_CODE', null, '${ids.u12}', null, null, null, null, '{}'::jsonb, 20)`)
  const [invitationId, code] = issued.split("|")
  ids.invitation = invitationId
  record("setup: the Under 12s' code is issued by their manager through the real RPC", Boolean(code))

  browser = await launch()

  // ------------------------------------------------------------------ A. the parent, at a phone width
  const parentCtx = await newContext(browser, { width: 390, height: 844 })
  const parent = await parentCtx.newPage()
  watch(parent, "parent")
  await signIn(parent, PARENT.email)
  await go(parent, `/join?c=${encodeURIComponent(code)}`)
  let page = await text(parent)
  const yanName = `${YAN.first} ${YAN.surname}`
  record("A1 the child who does not fit is greyed with the reason", page.includes(yanName) && /Too young for Under 12\./.test(page))
  record("A2 and cannot be chosen the normal way", await parent.locator("label").filter({ hasText: yanName }).locator('input[type="radio"]').isDisabled())
  const ask = parent.getByRole("button", { name: `Request a dispensation for ${yanName}` })
  record("A3 Request Dispensation is offered beside them, as an exception", (await ask.count()) === 1 && /The club can make an exception\./.test(page))
  await shot(parent, "97-a-who-is-joining-phone")
  recordAxe("A4 Who Is Joining? with a dispensation offer has no new serious accessibility violation", await axe(parent))
  await ask.click()
  await parent.getByText(`Request Dispensation for ${YAN.first}`).waitFor({ timeout: 10000 })
  page = await text(parent)
  record("A5 the request step says the normal way in is closed, and that asking is not approval",
    /doesn't normally fit Under 12 Boys, so the normal way in is closed/.test(page) && /Asking is not approval\. Nothing changes until it is approved\./.test(page))
  const send = parent.getByRole("button", { name: "Send Request" })
  record("A6 a reason is required before anything is sent", await send.isDisabled())
  await parent.getByLabel(/Why Should Yan Play for Under 12 Boys\?/).fill("His brother plays for the Under 12s and he trains with them.")
  // Send Request has just become enabled: let its opacity transition finish before contrast is measured.
  await parent.waitForTimeout(500)
  await shot(parent, "97-a-request-dispensation-phone")
  recordAxe("A7 the request step has no new serious accessibility violation", await axe(parent))
  record("A8 the request step fits a phone with no sideways scroll", (await measure(parent)).scrollWidth <= 390)
  await send.click()
  await parent.getByText(/Request sent\./).waitFor({ timeout: 20000 }).catch(() => {})
  page = await text(parent)
  record("A9 sending says asking is not approval, and who decides next",
    /Request sent\. Asking is not approval: the club's Safeguarding Officer or a Club Admin decides the dispensation first, then the team decides\./.test(page), page.slice(0, 200))
  const yanDisp = sql(`select d.id || '|' || d.requested_as || '|' || d.status || '|' || m.state || '|' || (m.dispensation_id = d.id)::text
                         from public.player_team_dispensation d join public.player_team_memberships m on m.player_id = d.player_id and m.team_id = d.target_team_id
                        where d.player_id = '${YAN.playerId}'`)
  const [yanDispId, requestedAs, yanStatus, yanPlace, linked] = yanDisp.split("|")
  record("A10 the server holds a pending GUARDIAN request, and a place that waits on it", requestedAs === "GUARDIAN" && yanStatus === "requested" && yanPlace === "PENDING" && linked === "true", yanDisp)
  record("A11 the officer and the Club Admin are asked; the team's manager is told nothing yet",
    sql(`select string_agg(distinct u.email, ',' order by u.email) from public.notifications n join auth.users u on u.id = n.user_id
          where n.type = 'safeguarding_dispensation_requested' and n.data ->> 'dispensation_id' = '${yanDispId}'`) === [CA.email, SO.email].sort().join(",") &&
      sql(`select count(*) from public.notifications where user_id = '${TM.id}' and created_at >= '${startedAt}' and type in ('team_place_requested', 'safeguarding_dispensation_requested')`) === "0")
  // Kai's request is made the same way, from the server, for the decline journey below.
  const kai = JSON.parse(as(PARENT.id, `select public.redeem_invitation(null, '${code}', '${JSON.stringify({ for: "CHILD", player_id: KAI.playerId, dispensation_reason: "He wants to play with his brother." })}'::jsonb)::text`))
  const kaiDispId = kai.dispensation_id
  record("setup: a second request, for the decline journey", kai.outcome === "TEAM_PLACE_PENDING" && kai.awaiting_dispensation === true)

  // ------------------------------------------------------------------ B. the team's manager: nothing to see yet
  const tmCtx = await newContext(browser, { width: 1280, height: 1000 })
  const tm = await tmCtx.newPage()
  watch(tm, "team manager")
  await signIn(tm, TM.email)
  await go(tm, `/teams/${ids.u12}/people`)
  // Nothing is the team's to decide yet, so the page opens on its people; the waiting count is on Requests,
  // beside the existing "waiting for a parent" line.
  await tm.getByRole("tab", { name: /Requests/ }).click()
  page = await text(tm)
  record("B1 the team sees only a quiet count waiting on the club's decision", /2 more are waiting for the club to decide a dispensation\./.test(page), page.slice(0, 200))
  record("B2 and never the children's names", !page.includes(yanName) && !page.includes(`${KAI.first} ${KAI.surname}`))
  await go(tm, `/dispensations/${yanDispId}`)
  record("B3 a parent's pending request is not the receiving team's to read", /This dispensation isn't available to you\./.test(await text(tm)))

  // ------------------------------------------------------------------ C. the Safeguarding Officer decides
  const soCtx = await newContext(browser, { width: 1280, height: 1000 })
  const so = await soCtx.newPage()
  watch(so, "officer")
  await signIn(so, SO.email)
  await go(so, "/dispensations")
  page = await text(so)
  record("C1 the club's register shows both requests waiting for the officer's decision",
    /2 requests are waiting for your decision\./.test(page) && page.includes(yanName) && /Pending/.test(page), page.slice(0, 200))
  recordAxe("C2 the register has no new serious accessibility violation", await axe(so))
  await go(so, `/dispensations/${yanDispId}`)
  page = await text(so)
  record("C3 the record is titled by the child and shows the state in words", page.includes(`Dispensation for ${yanName}`) && /Pending/.test(page))
  record("C4 the age-grade bridge is drawn, and read as a sentence",
    (await so.locator("figure svg").count()) === 1 && /Yan is in the Under 11 age grade this season\. Under 12 Boys is an Under 12 side\. A dispensation is waiting for a decision\./.test(await so.locator("figure").innerText()))
  record("C5 the mismatch is said plainly, and the normal way in is closed",
    page.includes("Yan is in the Under 11 age grade this season. Under 12 Boys is an Under 12 side.") && page.includes("The normal way onto Under 12 Boys is closed to them."))
  record("C6 the amber band says asking is not approval", (await so.getByRole("status").filter({ hasText: "Asking is not approval" }).count()) >= 1)
  record("C7 the officer reads the reason and the date of birth, and is asked to decide as the officer",
    page.includes("His brother plays for the Under 12s") && /Date of Birth/.test(page) && page.includes("You decide this as the club's Safeguarding Officer. The first decision made is final."))
  await shot(so, "97-c-record-pending-desktop")
  recordAxe("C8 the record has no new serious accessibility violation", await axe(so))
  await so.getByRole("button", { name: "Decline", exact: true }).click()
  record("C9 declining waits for a reason", await so.getByRole("button", { name: "Decline Request" }).isDisabled())
  await so.getByRole("button", { name: "Cancel" }).click()
  // A DECISION NEEDS A RECENT AUTHENTICATOR CODE (decide_dispensation calls internal.require_recent_aal2, as
  // suspending a member does). The officer has never entered one: approving is refused with the way to enter
  // it, and nothing is decided. Then they set one up -- the product's own enrolment, which verifies a code --
  // come back, and the same press goes through.
  await so.getByRole("button", { name: "Approve", exact: true }).click()
  const askedForCode = so.getByRole("alert").filter({ hasText: "Enter a code from your authenticator to continue." })
  await askedForCode.waitFor({ timeout: 20000 }).catch(() => {})
  record("C9b with no recent authenticator code the officer is asked for one, shown how, and nothing is decided",
    (await askedForCode.count()) === 1 && (await so.getByRole("link", { name: "Verify Now" }).count()) === 1 &&
      sql(`select status from public.player_team_dispensation where id = '${yanDispId}'`) === "requested")
  await enrolAuthenticator(so, { email: SO.email, sql })
  await go(so, `/dispensations/${yanDispId}`)
  await so.getByRole("button", { name: "Approve", exact: true }).click()
  await so.getByText(/Approved by Sol Okafor \(Safeguarding Officer\)/).waitFor({ timeout: 20000 }).catch(() => {})
  page = await text(so)
  record("C10 approving says who, as what, and for this team and season only",
    /Approved by Sol Okafor \(Safeguarding Officer\) on .+\. Yan can be placed with Under 12 Boys for .+ only\./.test(page), page.slice(0, 240))
  record("C11 and nothing is left to decide", (await so.getByRole("button", { name: "Approve", exact: true }).count()) === 0)
  page = await text(so)
  record("C12 a governing body's reference this approval does not need is offered as optional, never as a step",
    page.includes("Not needed for this dispensation.") && !/call-ups waiting on it/i.test(page) &&
      (await so.getByRole("button", { name: "Add Governing Body Reference" }).count()) === 1 &&
      (await so.getByLabel("Reference", { exact: true }).count()) === 0)
  await shot(so, "97-c-record-approved-desktop")
  const soPhoneCtx = await newContext(browser, { width: 390, height: 844 })
  const soPhone = await soPhoneCtx.newPage()
  await signIn(soPhone, SO.email)
  await go(soPhone, `/dispensations/${kaiDispId}`)
  await shot(soPhone, "97-c-record-pending-phone")
  record("G1 the record fits a phone with no sideways scroll", (await measure(soPhone)).scrollWidth <= 390)
  await soPhone.setViewportSize({ width: 320, height: 720 })
  await soPhone.waitForTimeout(300)
  record("G2 and the narrowest phone", (await measure(soPhone)).scrollWidth <= 320, JSON.stringify(await measure(soPhone)))
  await soPhoneCtx.close()

  // ------------------------------------------------------------------ D. the Club Admin is told who decided
  record("D1 the Club Admin is told: the child, the decision and who made it",
    sql(`select count(*) from public.notifications where user_id = '${CA.id}' and type = 'safeguarding_dispensation_decided'
          and data ->> 'dispensation_id' = '${yanDispId}' and title = 'Dispensation approved for ${yanName} by Sol Okafor'`) === "1")
  const caCtx = await newContext(browser, { width: 1280, height: 1000 })
  const ca = await caCtx.newPage()
  watch(ca, "club admin")
  await signIn(ca, CA.email)
  await go(ca, `/dispensations/${yanDispId}`)
  page = await text(ca)
  record("D2 the Club Admin sees it decided by the officer, with its history, and nothing to decide",
    /Approved by Sol Okafor \(Safeguarding Officer\)/.test(page) && /History/.test(page) && /Requested/.test(page) &&
      (await ca.getByRole("button", { name: "Approve", exact: true }).count()) === 0)

  // ------------------------------------------------------------------ E. only now the team sees it, and places the child
  await go(tm, `/teams/${ids.u12}/people`)
  page = await text(tm)
  record("E1 the team now sees the request, with the approval on it",
    page.includes(yanName) && page.includes("Dispensation approved by Sol Okafor (Safeguarding Officer) for this team and season."), page.slice(0, 260))
  record("E2 the other request is still a quiet count", /1 more is waiting for the club to decide a dispensation\./.test(page) && !page.includes(`${KAI.first} ${KAI.surname}`))
  await shot(tm, "97-e-team-request-approved-desktop")
  const yanCard = tm.locator("li").filter({ hasText: yanName }).first()
  await yanCard.getByRole("button", { name: "Approve", exact: true }).click()
  await yanCard.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
  record("E3 one approval places the child", sql(`select state from public.player_team_memberships where player_id = '${YAN.playerId}' and team_id = '${ids.u12}' order by created_at desc limit 1`) === "ACTIVE")

  // ------------------------------------------------------------------ F. a decline, with its reason, read by the parent
  // Declining is a decision too, so the Club Admin enters a code first (C9b showed the refusal without one).
  await enrolAuthenticator(ca, { email: CA.email, sql })
  await go(ca, `/dispensations/${kaiDispId}`)
  await ca.getByRole("button", { name: "Decline", exact: true }).click()
  await ca.getByLabel("Reason for Declining").fill("Kai would be the youngest by two years. Not this season.")
  await ca.getByRole("button", { name: "Decline Request" }).click()
  await ca.getByText(/Declined by Cara Bell/).waitFor({ timeout: 20000 }).catch(() => {})
  record("F1 the Club Admin's decline is recorded with its reason", /Declined by Cara Bell on .+\. Reason: Kai would be the youngest by two years\. Not this season\./.test(await text(ca)))
  record("F2 the officer is told a Club Admin decided it",
    sql(`select count(*) from public.notifications where user_id = '${SO.id}' and type = 'safeguarding_dispensation_decided' and data ->> 'dispensation_id' = '${kaiDispId}'
          and title = 'Dispensation declined for ${KAI.first} ${KAI.surname} by Cara Bell'`) === "1")
  record("F3 and the place that waited on it can never happen",
    !["PENDING", "ACTIVE"].includes(sql(`select state from public.player_team_memberships where player_id = '${KAI.playerId}' and team_id = '${ids.u12}' order by created_at desc limit 1`)))
  await go(parent, `/dispensations/${kaiDispId}`)
  page = await text(parent)
  record("F4 the parent reads the declined record and the reason, with nothing to decide",
    /Declined/.test(page) && page.includes("Not this season.") && (await parent.getByRole("button", { name: "Approve", exact: true }).count()) === 0, page.slice(0, 220))
  await shot(parent, "97-f-record-declined-parent-phone")
  record("F5 the parent's record fits their phone", (await measure(parent)).scrollWidth <= 390)
  await caCtx.close()
  await tmCtx.close()
  await soCtx.close()
  await parentCtx.close()
} finally {
  if (browser) await browser.close()
  cleanup()
}

record("Z1 nothing of this run remains: people, club, children, places, dispensations or the code",
  sql(`select (select count(*) from auth.users where email like '${PEOPLE}')
            + (select count(*) from public.clubs where slug = 'dw-${TAG}')
            + (select count(*) from public.club_directory where normalized_key = 'dw-${TAG}')
            + (select count(*) from public.players where first_name in ('${YAN.first}', '${KAI.first}') and surname = 'Adams' and created_at >= '${startedAt}')
            + (select count(*) from public.player_team_dispensation where created_at >= '${startedAt}' and (reason like 'His brother%' or reason like 'He wants to play%'))
            + (select count(*) from public.access_invitations where ${ids.invitation ? `id = '${ids.invitation}'` : "false"})`) === "0")
record("Z2 nor any notification it caused",
  sql(`select count(*) from public.notifications where created_at >= '${startedAt}' and type in ('safeguarding_dispensation_requested', 'safeguarding_dispensation_decided', 'safeguarding_guardian_dispensation', 'team_place_requested', 'add_child_approved', 'add_child_declined')
          and (title like '%Yan Adams%' or title like '%Kai Adams%' or body like '%Yan Adams%' or body like '%Kai Adams%')`) === "0")
record("Z3 no uncaught error in any page", errors.length === 0, errors.join(" | ").slice(0, 240))

process.exit(summarise() ? 0 : 1)
