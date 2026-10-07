// =====================================================================
// TEAM CODES PLACE PLAYERS -- THE WEB HALF (20270741000000)
//
// A team code asks for a place on THAT team. The server decides everything
// (supabase/tests/team_code_requests.sql); what only a browser can show is
// that the website's three surfaces carry those answers to the people they
// are for, in the approved layouts, and act through the one canonical path:
//
//   A. A brand-new parent with no club opens the code at a phone width:
//      Who Is Joining? offers a child not on Ovalball yet and a plain member
//      request; Add Your Child asks the server whether the date of birth fits
//      as they type, will not send a child who does not, and sends one who
//      does. The parent lands on /welcome, which says the request is waiting.
//   B. The team's Club Admin sees that request as a card saying who it is,
//      whether they fit, how it was asked and exactly what approving does --
//      and a child's own request still waiting for a parent only as one quiet
//      line, never by name.
//   C. That parent confirms on /parent/team-requests, and is told who decides
//      next in the shared words.
//   D. The Club Admin now sees the child's card, declines it with a reason
//      (asked for, as the phone asks), and approves the parent's: one approval
//      places the child, confirms the parent and admits them as a member.
//
// EVERYTHING IS THIS RUN'S OWN: three throwaway people, one team code issued
// through the real RPC, and every row the product makes from them -- removed
// at the end, on success or failure, with the history that points at them.
// The Club Admin is the UAT persona the other people suites use, never the
// owner.
// =====================================================================

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { launch, newContext, signIn, APP, axeSource, measure, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: q,
    encoding: "utf8",
  }).trim()
const last = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT)$/.test(l)).pop() ?? ""

/** The gate exports these; run on its own, the suite reads the same gitignored file the harness does. */
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

const CLUB_ADMIN = "uat.coach@ovalball.test"
const PEOPLE = `uat.tc.%.${TAG}@ovalball.test`
const PARENT = { email: `uat.tc.parent.${TAG}@ovalball.test`, first: "Sam", surname: "Carter", dob: "1986-04-12" }
const GUARDIAN = { email: `uat.tc.guardian.${TAG}@ovalball.test`, first: "Robin", surname: "Hale", dob: "1984-09-30" }
const CHILD = { email: `uat.tc.child.${TAG}@ovalball.test`, first: "Ollie", surname: "Hale" }
const NEW_CHILD = { first: "Leo", surname: "Carter" }

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' and c.status = 'active' limit 1`)
const adminId = sql(`select id from auth.users where email = '${CLUB_ADMIN}'`)
// A youth boys' side, so a parent may add a child and a child may ask: the UAT club's Under 13 Boys.
const teamRow = sql(`select t.id || '|' || t.display_name from public.teams t
                       join public.canonical_team_types ctt on ctt.id = t.canonical_team_type_id
                      where t.club_id = '${clubId}' and t.age_group = 'U13' and ctt.gender = 'boys'
                        and t.squad_designation is null and t.active limit 1`)
if (!clubId || !adminId || !teamRow || !SERVICE_KEY || !PASSWORD) {
  console.error("Missing the UAT club, its Club Admin, an Under 13 Boys side, the service key or UAT_BROWSER_PASSWORD.")
  process.exit(1)
}
const [teamId, teamLabel] = teamRow.split("|")
const clubName = sql(`select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = '${clubId}'`)

// THE CANONICAL FIT decides which birthdays the side takes, so the suite asks it rather than hard-coding a
// season: the middle of the band that fits, and a year before its oldest edge for a child who does not.
const band = sql(`with f as (select d::date as d from generate_series(current_date - interval '19 years', current_date - interval '4 years', interval '1 day') d
                              where internal.team_code_fit('${teamId}', d::date, 'MALE') = 'FITS')
                  select (min(d) + (max(d) - min(d)) / 2)::text || '|' || (min(d) - 400)::text from f`)
const [fitsDob, tooOldDob] = band.split("|")
const tooOldVerdict = sql(`select internal.team_code_fit('${teamId}', '${tooOldDob}'::date, 'MALE')`)

const startedAt = sql("select now()")
let invitationId = null

/** A throwaway person who can sign in through the real login form, with a whole profile. */
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
       values ('${p.id}', '${p.first}', '${p.surname}', '${p.email}', ${p.dob ? `'${p.dob}'` : "null"})
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname,
                                      date_of_birth = excluded.date_of_birth;
       update public.profiles set setup_state = 'COMPLETE' where id = '${p.id}';
       select internal.refresh_account_security_state('${p.id}');`)
}

/**
 * EVERYTHING THIS RUN MADE, from its own people and its own code. A player is this run's if one of its
 * people created it or IS it; a place, link, membership, notification or history row is this run's if it
 * points at one of those. Runs on success, on a failed assertion and on a thrown error alike.
 */
function cleanup() {
  sql(`
do $$
declare
  v_people uuid[] := array(select id from auth.users where email like 'uat.tc.%.${TAG}@ovalball.test');
  v_inv uuid[] := array(select id from public.access_invitations where id = ${invitationId ? `'${invitationId}'` : "null"});
  v_players uuid[];
  v_places uuid[];
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_players := array(select id from public.players where created_by = any(v_people) or user_id = any(v_people));
  v_places := array(select id from public.player_team_memberships where player_id = any(v_players) or source_invitation_id = any(v_inv));
  v_records := v_people || v_players || v_places || v_inv
    || array(select id from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people))
    || array(select id from public.club_memberships where user_id = any(v_people))
    || array(select id from public.role_assignments where user_id = any(v_people));

  delete from public.notifications where user_id = any(v_people)
     or (created_at >= '${startedAt}' and (data ->> 'player_id' in (select unnest(v_players)::text)
                                         or data ->> 'membership_id' in (select unnest(v_places)::text)));
  delete from public.invitation_redemption_attempts where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.invitation_redemptions where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.club_join_requests where requesting_user_id = any(v_people) or source_invitation_id = any(v_inv);
  delete from public.player_duplicate_reviews where requesting_guardian_user_id = any(v_people) or submitted_by = any(v_people);
  delete from public.player_team_memberships where id = any(v_places);
  delete from public.guardians where player_id = any(v_players) or guardian_user_id = any(v_people);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where user_id = any(v_people);
  delete from public.club_memberships where user_id = any(v_people);
  delete from public.invitation_teams where invitation_id = any(v_inv);
  delete from public.access_invitations where id = any(v_inv);
  delete from public.security_events where actor_user_id = any(v_people) or subject_user_id = any(v_people) or player_id = any(v_players)
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
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
}

let browser = null
try {
  await person(PARENT)
  await person(GUARDIAN)
  await person({ ...CHILD, dob: fitsDob })
  CHILD.id = sql(`select id from auth.users where email = '${CHILD.email}'`)
  // The child's own record and the parent's link, as a family already on Ovalball has them.
  CHILD.playerId = last(sql(`
    with p as (insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id, created_by)
               values ('${CHILD.first}', '${CHILD.surname}', '${fitsDob}', true, 'MALE', '${CHILD.id}', '${GUARDIAN.id}') returning id)
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
    select '${GUARDIAN.id}', p.id, 'parent', 'active' from p returning player_id;`))

  // One transaction, so the caller's identity (set for the transaction only) is the issuer's.
  const issued = last(sql(`
    begin;
    select set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
    select invitation_id || '|' || code from public.issue_invitation('TEAM_JOIN_CODE', null, '${teamId}', null, null, null, null, '{}'::jsonb, 20);
    commit;`))
  const [issuedId, code] = issued.split("|")
  invitationId = issuedId
  record("setup: a team code is issued through the real RPC", /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(code ?? ""))
  record("setup: the canonical fit gives a birthday that fits and one that does not", Boolean(fitsDob) && tooOldVerdict === "TOO_OLD", `${fitsDob} fits, ${tooOldDob} is ${tooOldVerdict}`)

  // The child's own request, made from their own login: it waits for their parent.
  const own = last(sql(`
    begin;
    select set_config('request.jwt.claims', json_build_object('sub','${CHILD.id}','role','authenticated')::text, true);
    select public.redeem_invitation(null, '${code}', '{"for":"SELF"}'::jsonb)::text;
    commit;`))
  const ownPlace = JSON.parse(own)
  record("setup: the child's own request waits for their parent", ownPlace.outcome === "TEAM_PLACE_PENDING" && ownPlace.awaiting_guardian === true, own.slice(0, 120))

  browser = await launch()

  // ---------------------------------------------------------------- A. a brand-new parent, at a phone width
  const parentCtx = await newContext(browser, { width: 390, height: 844 })
  const parent = await parentCtx.newPage()
  watch(parent, "parent")
  await signIn(parent, PARENT.email)
  await go(parent, `/join?c=${encodeURIComponent(code)}`)
  let page = await text(parent)
  const radios = await parent.locator('input[name="team-code-who"]').count()
  record("A1 the code asks who is joining", /Who Is Joining\?/.test(page), `${radios} choices`)
  record("A2 a parent with no child here is offered a child not on Ovalball yet, and a plain member request",
    /A Child Not on Ovalball Yet/.test(page) && /Just Me, as a Member/.test(page) && radios === 2)
  record("A3 and never themselves as a player of an Under 13 side", !/\bMe\b(?!mber)/.test(page.replace(/Just Me, as a Member/g, "")))
  record("A4 the choices fit a phone with no sideways scroll", (await measure(parent)).scrollWidth <= 390, JSON.stringify(await measure(parent)))
  recordAxe("A5 Who Is Joining? has no new serious accessibility violation", await axe(parent))

  await parent.getByRole("button", { name: "Continue" }).click()
  await parent.locator("#team-code-first").waitFor({ timeout: 15000 })
  page = await text(parent)
  record("A6 Add Your Child asks for exactly a name, a date of birth and a gender",
    /Add Your Child/.test(page) && (await parent.locator("#team-code-last").count()) === 1 && (await parent.locator("#team-code-dob").count()) === 1 && /Gender/.test(page))
  record("A7 and says plainly what the one approval will do", new RegExp(`you join ${clubName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} as a member`).test(page))

  await parent.locator("#team-code-first").fill(NEW_CHILD.first)
  await parent.locator("#team-code-last").fill(NEW_CHILD.surname)
  await parent.locator("label").filter({ hasText: /^Male$/ }).click()
  await parent.locator("#team-code-dob").fill(tooOldDob)
  await parent.getByText(/Too old for Under 13\./).waitFor({ timeout: 10000 }).catch(() => {})
  page = await text(parent)
  record("A8 a child too old for the side is told so as the date is entered, by the server's rule", /Too old for Under 13\./.test(page))
  record("A9 and cannot be sent", await parent.getByRole("button", { name: "Send Request" }).isDisabled())

  await parent.locator("#team-code-dob").fill(fitsDob)
  await parent.getByText(/Fits Under 13/).waitFor({ timeout: 10000 }).catch(() => {})
  record("A10 a child who fits is told that too", /Fits Under 13/.test(await text(parent)))
  record("A11 the add-your-child step fits a phone too", (await measure(parent)).scrollWidth <= 390)
  recordAxe("A12 Add Your Child has no new serious accessibility violation", await axe(parent))
  await parent.getByRole("button", { name: "Send Request" }).click()
  await parent.getByText(/Request sent\./).waitFor({ timeout: 20000 }).catch(() => {})
  record("A13 sending says who decides next", /Request sent\. The team will let you know when it has decided\./.test(await text(parent)))

  const leo = sql(`select m.id || '|' || g.state || '|' || g.source || '|' || m.state || '|' || coalesce(m.guardian_confirmation, '-')
                     from public.players p join public.player_team_memberships m on m.player_id = p.id
                     join public.guardians g on g.player_id = p.id
                    where p.created_by = '${PARENT.id}' and m.team_id = '${teamId}'`)
  const [leoPlace, leoGuardianState, leoGuardianSource, leoPlaceState, leoAwaiting] = leo.split("|")
  record("A14 the server made the child, a guardian link waiting on the same approval, and a place for the team to decide",
    leoGuardianState === "PENDING_APPROVAL" && leoGuardianSource === "TEAM_CODE" && leoPlaceState === "PENDING" && leoAwaiting === "-", leo)
  record("A15 and told the team's approvers, not the parent's own inbox",
    sql(`select count(*) from public.notifications where type = 'team_place_requested' and data ->> 'membership_id' = '${leoPlace}' and user_id = '${adminId}'`) === "1")

  await parent.getByRole("button", { name: "Continue" }).click()
  await parent.waitForURL(/\/welcome/, { timeout: 20000 }).catch(() => {})
  await parent.waitForLoadState("networkidle").catch(() => {})
  page = await text(parent)
  record("A16 Continue lands a parent with no club on Welcome, which says the request is waiting",
    /\/welcome/.test(parent.url()) && new RegExp(`${NEW_CHILD.first}'s request to join ${teamLabel} at .+ is waiting for the team to decide\\.`).test(page), page.slice(0, 160))
  await parentCtx.close()

  // ---------------------------------------------------------------- B. the team's approver
  const adminCtx = await newContext(browser, { width: 1280, height: 1000 })
  const admin = await adminCtx.newPage()
  watch(admin, "club admin")
  await signIn(admin, CLUB_ADMIN)
  await go(admin, `/teams/${teamId}/people`)
  page = await text(admin)
  const leoName = `${NEW_CHILD.first} ${NEW_CHILD.surname}`
  const ollieName = `${CHILD.first} ${CHILD.surname}`
  record("B1 the team's people open on its requests while somebody is waiting", (await admin.getByRole("tab", { name: /Requests/ }).getAttribute("aria-selected")) === "true")
  record("B2 the parent's request is a card: who, and whether they fit by the canonical rule", page.includes(leoName) && /Fits Under 13\./.test(page))
  record("B3 it says how it was asked", page.includes(`Added by ${PARENT.first} ${PARENT.surname} (parent) with the team code.`))
  record("B4 and exactly what approving does",
    page.includes(`Approving adds ${NEW_CHILD.first} to ${teamLabel} and confirms ${PARENT.first} ${PARENT.surname} as ${NEW_CHILD.first}'s parent or guardian. ${PARENT.first} ${PARENT.surname} joins ${clubName} as a member.`))
  record("B5 a child's own request still waiting for a parent is one quiet line", /\d+ more (is|are) waiting for a parent to confirm\./.test(page))
  record("B6 and is never named before the parent confirms", !page.includes(ollieName))
  recordAxe("B7 the request cards have no new serious accessibility violation", await axe(admin))

  // ---------------------------------------------------------------- C. the parent confirms
  const guardianCtx = await newContext(browser, { width: 390, height: 844 })
  const guardian = await guardianCtx.newPage()
  watch(guardian, "guardian")
  await signIn(guardian, GUARDIAN.email)
  await go(guardian, `/parent/team-requests?request=${ownPlace.membership_id}`)
  page = await text(guardian)
  record("C1 the parent sees their child's request: who, which team, and that it came from the child's own account",
    page.includes(ollieName) && page.includes(`Asked to join ${teamLabel} at ${clubName}`) && page.includes(`Used the team's code from ${CHILD.first}'s own account`))
  record("C2 with what happens next, in the shared words",
    page.includes(`You confirm that ${CHILD.first} asked.`) && page.includes("The team's staff decide.") && page.includes(`If they approve, ${CHILD.first} joins ${teamLabel}.`))
  record("C3 and that nothing happens until they confirm", page.includes(`Nothing happens until you confirm. If ${CHILD.first} didn't ask, decline it.`))
  record("C4 it fits a phone", (await measure(guardian)).scrollWidth <= 390)
  recordAxe("C5 the confirm page has no new serious accessibility violation", await axe(guardian))
  await guardian.getByRole("button", { name: "Confirm", exact: true }).click()
  // The answer replaces the card: wait for its words, not for any status region the shell may have.
  await guardian.getByText(/staff decide next/).waitFor({ timeout: 20000 }).catch(() => {})
  page = await text(guardian)
  record("C6 confirming says who decides next, and never makes a possessive of the team's name",
    page.includes("Confirmed") && page.includes(`The ${teamLabel} staff decide next. You and ${CHILD.first} will both hear when they have.`) && !page.includes(`${teamLabel}'s`),
    page.slice(0, 220))
  record("C7 the server holds the parent's confirmation, and has now told the team's approvers",
    sql(`select guardian_confirmation || '|' || (guardian_confirmed_by = '${GUARDIAN.id}')::text from public.player_team_memberships where id = '${ownPlace.membership_id}'`) === "CONFIRMED|true" &&
      sql(`select count(*) from public.notifications where type = 'team_place_requested' and data ->> 'membership_id' = '${ownPlace.membership_id}' and user_id = '${adminId}'`) === "1")
  await guardianCtx.close()

  // ---------------------------------------------------------------- D. the approver decides both
  await go(admin, `/teams/${teamId}/people`)
  page = await text(admin)
  record("D1 the child's own request is now a card, saying the parent confirmed it",
    page.includes(ollieName) && page.includes(`Asked from ${CHILD.first}'s own account. ${GUARDIAN.first} ${GUARDIAN.surname} (parent) confirmed it.`))

  const ollieCard = admin.locator("li").filter({ hasText: ollieName }).first()
  await ollieCard.getByRole("button", { name: "Decline", exact: true }).click()
  const reason = ollieCard.getByLabel("Reason")
  await reason.waitFor({ timeout: 10000 })
  const declineButton = ollieCard.getByRole("button", { name: "Decline Request" })
  record("D2 declining asks why, as the phone does, and cannot be sent without a reason", await declineButton.isDisabled())
  await reason.fill("The squad is full this season.")
  await declineButton.click()
  await ollieCard.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
  record("D3 the declined request leaves the list",
    !(await text(admin)).includes(ollieName) &&
      sql(`select state from public.player_team_memberships where id = '${ownPlace.membership_id}'`) === "DECLINED")
  record("D4 and the child and their parent are both told",
    sql(`select count(distinct user_id) from public.notifications where type = 'add_child_declined' and user_id in ('${CHILD.id}', '${GUARDIAN.id}') and created_at >= '${startedAt}'`) === "2")

  const leoCard = admin.locator("li").filter({ hasText: leoName }).first()
  await leoCard.getByRole("button", { name: "Approve", exact: true }).click()
  await leoCard.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
  const after = sql(`select m.state || '|' || g.state || '|' || coalesce((select cm.state || '/' || cm.source from public.club_memberships cm
                                                                            where cm.user_id = '${PARENT.id}' and cm.club_id = '${clubId}'), 'none')
                       from public.player_team_memberships m join public.guardians g on g.player_id = m.player_id and g.guardian_user_id = '${PARENT.id}'
                      where m.id = '${leoPlace}'`)
  record("D5 one approval places the child, confirms the parent and admits them as a member", after === "ACTIVE|ACTIVE|ACTIVE/TEAM_CODE", after)
  record("D6 and the parent is told", sql(`select count(*) from public.notifications where user_id = '${PARENT.id}' and type = 'add_child_approved'`) === "1")
  await adminCtx.close()
} finally {
  if (browser) await browser.close()
  cleanup()
}

record("Z1 nothing of this run remains: people, players, places, links, memberships or the code",
  sql(`select (select count(*) from auth.users where email like '${PEOPLE}')
            + (select count(*) from public.players where first_name in ('${NEW_CHILD.first}', '${CHILD.first}') and created_at >= '${startedAt}')
            + (select count(*) from public.player_team_memberships where created_at >= '${startedAt}' and team_id = '${teamId}')
            + (select count(*) from public.access_invitations where ${invitationId ? `id = '${invitationId}'` : "false"})`) === "0")
record("Z2 nor any notification it caused",
  sql(`select count(*) from public.notifications where created_at >= '${startedAt}' and type in ('team_place_requested', 'team_place_confirm_requested', 'add_child_approved', 'add_child_declined')`) === "0")
record("Z3 no uncaught error in any page", errors.length === 0, errors.join(" | ").slice(0, 240))

process.exit(summarise() ? 0 : 1)
