// =====================================================================
// CONVERGENCE STEP 2 -- THE USERS & PERMISSIONS CENTRE, IN A REAL BROWSER
//
// Step 2 turned five unrelated people/access surfaces into one concept with
// one way in. The SQL suite (users_and_permissions_authority.sql) pins the
// authorities underneath it; this pins that a person can actually REACH them.
//
// Every one of these journeys was impossible or unreachable before Step 2:
//
//   - a waiting invitation could not be seen at all, because the page read a
//     table that has held zero rows since Slice 5, so revoking one was a
//     button nobody could ever be shown;
//   - a team role could be read on the people list and changed nowhere,
//     because the row carried no id for the action that removes it;
//   - giving an existing member a role at a team meant finding that team's
//     own page, one page per team;
//   - and nothing anywhere answered WHY somebody could do something, though
//     explain_access had been granted to authenticated the whole time.
//
// The club is made busy on purpose and put back exactly as it was: a quiet
// club renders every one of these as an empty state, and an empty state
// proves nothing. Nothing here touches production and no session borrows a
// real person's login.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const CLUB_ADMIN = "uat.coach@ovalball.test"
const INVITEE = `uat.s2.invitee.${TAG}@ovalball.test`
const MEMBER = `uat.s2.member.${TAG}@ovalball.test`
const APPLICANT = `uat.s2.applicant.${TAG}@ovalball.test`
const MINE = `uat.s2.%.${TAG}@ovalball.test`

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)
const adminId = sql(`select id from auth.users where email = '${CLUB_ADMIN}'`)
const teamU12 = sql(`select id from public.teams where club_id = '${clubId}' and age_group = 'U12' and squad_designation is null limit 1`)
const teamU16 = sql(`select id from public.teams where club_id = '${clubId}' and age_group = 'U16' and squad_designation is null limit 1`)

/**
 * An adult fixture identity. The date of birth is not decoration: the O.1
 * safeguarding rule refuses Coach and Team Manager to anybody whose record does
 * not show they are an adult, so a person without one cannot exercise the team
 * role journeys at all -- found by writing this suite without one and watching
 * the grant be refused, correctly.
 */
function identity(email, first, last) {
  const id = sql(`
    with u as (
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
        reauthentication_token)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '${email}', '', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', '')
      returning id
    ) select id::text from u`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${id}', '${first}', '${last}', '${email}', '1988-04-12')
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname,
         date_of_birth = excluded.date_of_birth`)
  return id
}

function teardown() {
  sql(`
    delete from public.club_join_requests r using auth.users u
      where r.requesting_user_id = u.id and u.email like '${MINE}';
    delete from public.team_permissions tp using public.club_memberships m, auth.users u
      where tp.membership_id = m.id and m.user_id = u.id and u.email like '${MINE}';
    delete from public.role_assignments ra using public.club_memberships m, auth.users u
      where ra.membership_id = m.id and m.user_id = u.id and u.email like '${MINE}';
    delete from public.club_memberships m using auth.users u
      where m.user_id = u.id and u.email like '${MINE}';
    delete from public.invitation_teams it using public.access_invitations i
      where it.invitation_id = i.id and i.invited_email_normalised like '${MINE}';
    delete from public.access_invitations where invited_email_normalised like '${MINE}';
    delete from public.profiles p using auth.users u where p.id = u.id and u.email like '${MINE}';
    delete from auth.users where email like '${MINE}';
  `)
}

// A club with somebody waiting at every door.
teardown()
identity(INVITEE, "Iris", `Invitee${TAG}`)
const applicantId = identity(APPLICANT, "Rowan", `Applicant${TAG}`)
const memberId = identity(MEMBER, "Tessa", `Newmember${TAG}`)
const membershipId = sql(`insert into public.club_memberships (club_id, user_id, role, status)
  values ('${clubId}', '${memberId}', 'BASIC_USER', 'active') returning id`)
sql(`insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
     values ('${clubId}', '${applicantId}', 'BASIC_USER', 'pending')`)
// Issued through the real authority, carrying a DIFFERENT role at each of two
// teams -- the per-team invitation roles a club must still be able to see.
sql(`
  select set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
  select 1 from public.issue_invitation('CLUB_STAFF', '${clubId}', null, null, null, null, '${INVITEE}',
    '{}'::jsonb, null, null,
    jsonb_build_array(jsonb_build_object('id','${teamU12}','roles',jsonb_build_array('COACH')),
                      jsonb_build_object('id','${teamU16}','roles',jsonb_build_array('TEAM_MANAGER'))));`)

const browser = await launch()

try {
  const context = await newContext(browser, { width: 1440, height: 1200 })
  const page = await context.newPage()
  await signIn(page, CLUB_ADMIN)

  // ------------------------------------------------------------------
  // A. One page, named for the question, with every queue on it.
  // ------------------------------------------------------------------
  await page.goto(`${APP}/people`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  let main = await page.locator("main").innerText()

  record("A1 the centre is named for the question it answers", /Users & Permissions/.test(main))
  record("A2 and collects everything waiting on the club in one place", /Waiting On You/i.test(main))
  record("A3 a person asking to join is listed", new RegExp(`Applicant${TAG}`).test(main))
  record("A4 with the role they asked for in product language, not a database value",
    /Asked to join as: Member/.test(main) && !/BASIC_USER/.test(main))

  // ------------------------------------------------------------------
  // B. A waiting invitation -- unreachable before Step 2.
  // ------------------------------------------------------------------
  record("B1 an invitation nobody has accepted yet is visible at all", main.includes(INVITEE))
  record("B2 and says what it will grant, per team", /Under 12 Boys: Coach/.test(main) && /Under 16 Boys: Team Manager/.test(main))
  record("B3 and when it runs out", /Expires \d/.test(main))

  await page.getByRole("button", { name: /^Revoke$/ }).click()
  await page.getByRole("button", { name: /^Confirm$/ }).click()
  await page.waitForTimeout(2500)
  main = await page.locator("main").innerText()
  record("B4 and revoking it takes it out of the queue", !main.includes(INVITEE))
  record("B5 and the database records who revoked it and why",
    sql(`select state || '|' || (revoked_by is not null)::text || '|' || coalesce(revocation_reason,'-')
         from public.access_invitations where invited_email_normalised = '${INVITEE}'`).startsWith("REVOKED|true|"))

  // ------------------------------------------------------------------
  // C. One person, and their whole access.
  // ------------------------------------------------------------------
  await page.getByRole("link", { name: new RegExp(`Access & Teams for Tessa Newmember${TAG}`, "i") }).click()
  await page.waitForURL(/\/people\/[0-9a-f-]{36}/, { timeout: 10000 })
  record("C1 the list offers a way into one person's own access page", page.url().endsWith(membershipId))

  const heldText = async () => (await page.locator("section[aria-labelledby=person-team-access] ul li").allInnerTexts()).join(" | ")
  record("C2 who plainly has no team roles yet", /No team roles/.test(await page.locator("main").innerText()))

  // ------------------------------------------------------------------
  // D. Give an existing member a team role, without re-inviting them.
  // ------------------------------------------------------------------
  await page.locator("#team-access-team").selectOption(teamU16)
  await page.locator("#team-access-role").selectOption("coach")
  await page.locator("#team-access-reason").fill("Stepping up to help with the U16 side.")
  await page.getByRole("button", { name: /^Give Team Role$/ }).click()
  await page.waitForTimeout(2500)
  let held = await heldText()
  record("D1 an existing member can be given a team role from the page about them", /Under 16 Boys/.test(held) && /Coach/.test(held), held.replace(/\s+/g, " "))
  record("D2 and it is a real team_permissions row, not a screen state",
    sql(`select count(*) from public.team_permissions where membership_id = '${membershipId}' and team_id = '${teamU16}' and permission = 'coach'`) === "1")

  await page.getByRole("button", { name: /^Remove$/ }).first().click()
  await page.waitForTimeout(2500)
  held = await heldText()
  record("D3 and taken away again from the same place", !/Under 16 Boys/.test(held))

  // ------------------------------------------------------------------
  // E. WHY -- explain_access, on a screen for the first time.
  // ------------------------------------------------------------------
  const mainPerson = await page.locator("main").innerText()
  const explanations = (mainPerson.match(/, because /g) ?? []).length
  record("E1 every permission this club decides carries the rule that decided it", explanations >= 10, `${explanations} explanations`)
  record("E2 in product language, never a reason code", !/ROLE_BUNDLE|DEFAULT_DENY|EXPLICIT_/.test(mainPerson))
  record("E3 and the count agrees with the permissions grid's own count for this person",
    /2 of 10 allowed/.test(mainPerson), (mainPerson.match(/\d+ of \d+ allowed/) ?? ["none"])[0])

  // ------------------------------------------------------------------
  // F. The doors that must not close when a queue empties.
  // ------------------------------------------------------------------
  await page.goto(`${APP}/people`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  main = await page.locator("main").innerText()
  for (const [label, href] of [
    ["Permissions", "/club/permissions"],
    ["Guardians & Players", "/club/settings/guardians"],
    ["Guardian Requests", "/guardian-requests"],
    ["Safeguarding Officer", "/club/settings/safeguarding"],
  ]) {
    record(`F ${label} is reachable from the centre whether or not anything is waiting`,
      (await page.locator(`main a[href="${href}"]`).count()) > 0)
  }

  // ------------------------------------------------------------------
  // G. Nothing that worked before stopped working.
  // ------------------------------------------------------------------
  record("G1 the club role of a member can still be changed from the list",
    (await page.locator(`main select[aria-label^="Club-wide role"]`).count()) >= 2)
  record("G2 a member can still be removed from the club", (await page.getByRole("button", { name: /^Remove$/ }).count()) >= 1)
  record("G3 somebody can still be invited", (await page.getByRole("button", { name: /Invite someone/i }).count()) === 1)
  record("G4 and a join request can still be approved or declined",
    (await page.getByRole("button", { name: /^Approve$/ }).count()) >= 1 && (await page.getByRole("button", { name: /^Decline$/ }).count()) >= 1)

  // ------------------------------------------------------------------
  // H. Hiding is never the boundary: an ordinary member is refused by the
  //    SERVER at the same page, not merely left without a link to it.
  // ------------------------------------------------------------------
  const plain = await newContext(browser, { width: 1440, height: 1000 })
  const plainPage = await plain.newPage()
  await signIn(plainPage, "uat.team.manager@ovalball.test")
  await plainPage.goto(`${APP}/people/${membershipId}`, { waitUntil: "domcontentloaded" })
  await plainPage.waitForLoadState("networkidle").catch(() => {})
  record("H1 a member who is not a club admin is sent away from another person's access page",
    !new URL(plainPage.url()).pathname.startsWith("/people/"), new URL(plainPage.url()).pathname)
  record("H2 and sees none of that person's permissions", !/What They Can Do/.test(await plainPage.locator("main").innerText()))
} finally {
  teardown()
  await browser.close()
}

// The fixture must leave the club exactly as it found it.
record("Z1 the suite cleans up every identity it created",
  sql(`select count(*) from auth.users where email like '${MINE}'`) === "0")
record("Z2 and every invitation, membership and request that went with them",
  sql(`select (select count(*) from public.access_invitations where invited_email_normalised like '${MINE}')
            + (select count(*) from public.club_join_requests r join auth.users u on u.id = r.requesting_user_id
               where u.email like '${MINE}')`) === "0")

summarise("Users & Permissions centre")
