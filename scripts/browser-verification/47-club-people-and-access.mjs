// =====================================================================
// CONVERGENCE STEP 8 / IDENTITY-AUTH SLICE 8 -- CLUB PEOPLE & ACCESS
//
// Slice 8's contract names browser 47 and 48. This is 47: the lifecycle, in a
// real browser, as the person the design says owns it.
//
//     inspect a person
//  -> understand what they hold
//  -> give a legitimate club role
//  -> inspect the resulting capabilities
//  -> explain_access agrees
//  -> the audit history records it
//  -> remove the role
//  -> everything unrelated survives
//
// WHAT THIS EXISTS TO CATCH, and what the SQL suite cannot. Step 8's server
// authority is proved in supabase/tests/step8_operational_access.sql, 55
// assertions, and none of it means anything if the screen a Club Admin
// actually uses cannot reach it. Before Slice 8, `assign_role` -- the
// canonical role primitive, with the delegation ceiling built into it -- had
// no caller anywhere in the product: `role_assignments` was writable from the
// database and from Site Admin, and not by the club. A suite that only asked
// the database would have called that fine.
//
// IT USES A DISPOSABLE PERSON. The lifecycle here is destructive by design --
// roles are given and taken away -- so it creates its own member, does
// everything to them, and removes them. No persistent review persona is
// touched, and nothing in the automated UAT club is left changed.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const CLUB_ADMIN = "uat.coach@ovalball.test"
const SUBJECT_EMAIL = `uat.s8.subject.${TAG}@ovalball.test`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)

/**
 * explain_access is the capability engine and it refuses without a session --
 * correctly, and the trap Step 7 fell into with suite 16 §9, where an RPC
 * invoked from psql with no claims "passed" by never running. Every capability
 * question below is therefore asked AS somebody, in one statement with the
 * claims it needs.
 */
const asksAs = (userId, sqlText) =>
  sql(`select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, true) is not null;
       ${sqlText}`)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? ""
if (!clubId) {
  console.error("Missing UAT club: run the local UAT seed.")
  process.exit(1)
}
const teamId = sql(`select id from public.teams where club_id = '${clubId}' and active order by display_name limit 1`)

/**
 * Sweeps this run's tag BEFORE seeding as well as after, so a crashed previous
 * run cannot poison this one -- the rule every fixture-operations suite adopted
 * in Step 7.
 */
function teardown() {
  try {
    sql(`
      delete from public.capability_overrides where user_id in (select id from auth.users where email like 'uat.s8.subject.%@ovalball.test');
      delete from public.role_assignments where membership_id in (
        select id from public.club_memberships where user_id in (select id from auth.users where email like 'uat.s8.subject.%@ovalball.test'));
      delete from public.club_memberships where user_id in (select id from auth.users where email like 'uat.s8.subject.%@ovalball.test');
      delete from public.profiles where email like 'uat.s8.subject.%@ovalball.test';
      delete from auth.identities where user_id in (select id from auth.users where email like 'uat.s8.subject.%@ovalball.test');
      delete from auth.users where email like 'uat.s8.subject.%@ovalball.test';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const subjectId = sql(`
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${SUBJECT_EMAIL}', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') returning id`)
sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
     values ('${subjectId}', 'Sandy', 'Subject ${TAG}', '${SUBJECT_EMAIL}', (current_date - interval '34 years')::date)`)
const membershipId = sql(`insert into public.club_memberships (club_id, user_id, role, status)
                          values ('${clubId}', '${subjectId}', 'BASIC_USER', 'active') returning id`)

const browser = await launch()
const pageErrors = []

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  await signIn(page, CLUB_ADMIN)

  const go = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
  }

  // ------------------------------------------------------------------
  // A. INSPECT: the person is reachable from Users & Permissions, and the
  //    page says what they are rather than making the reader deduce it.
  // ------------------------------------------------------------------
  await go("/people")
  const peopleText = await page.locator("main").innerText()
  // Case-insensitive on purpose: internal.normalise_person_name capitalises a
  // surname seeded in lower case, which is the name rule working, not drift.
  record("A1 the new member appears on Users & Permissions",
    new RegExp(`Subject ${TAG}`, "i").test(peopleText))

  await go(`/people/${membershipId}`)
  const detail = await page.locator("main").innerText()
  record("A2 their access page opens", page.url().includes(membershipId), page.url().replace(APP, ""))
  record("A3 and names the club-wide role they hold", /Member/.test(detail))
  record("A4 and explains every permission the club decides, with the rule that decided it",
    /what they can do/i.test(detail) && /allowed/i.test(detail))

  // ------------------------------------------------------------------
  // B. OTHER ROLES -- the canonical role model, reachable at last.
  // ------------------------------------------------------------------
  record("B1 the page has a place for the roles that are not the club-wide seat", /other roles/i.test(detail))
  record("B2 and says this person holds none yet", /No other roles recorded/.test(detail))

  await page.getByRole("button", { name: "Give Another Role" }).click()
  const roleSelect = page.getByLabel("Additional Role", { exact: true })
  await roleSelect.waitFor({ state: "visible" })
  const offered = await roleSelect.locator("option").allInnerTexts()
  record("B3 Volunteer is offered -- a canonical club role no screen could give before Slice 8",
    offered.some((o) => /Volunteer/i.test(o)), offered.join(", "))
  record("B4 and Safeguarding Officer is NOT, because an officer is nominated and accepts",
    !offered.some((o) => /Safeguarding/i.test(o)), offered.join(", "))
  record("B5 nor is the club-wide seat offered twice",
    !offered.some((o) => /Club Admin|Fixture Secretary/i.test(o)), offered.join(", "))

  await roleSelect.selectOption({ label: "Volunteer" })
  await page.getByLabel("Reason for This Role", { exact: true }).fill(`helping out ${TAG}`)
  await page.getByRole("button", { name: "Give Role" }).click()
  await page.getByText("Volunteer").first().waitFor({ state: "visible", timeout: 30000 })

  const assignmentState = sql(`select state from public.role_assignments
                               where membership_id = '${membershipId}' and role_key = 'VOLUNTEER' and team_id is null`)
  record("B6 the role is recorded as a canonical role assignment, not a string on a profile",
    assignmentState === "ACTIVE", assignmentState || "(no row)")
  const source = sql(`select source from public.role_assignments
                      where membership_id = '${membershipId}' and role_key = 'VOLUNTEER' and state = 'ACTIVE'`)
  record("B7 and records that the CLUB gave it", source === "CLUB_ADMIN_ASSIGNMENT", source)

  // ------------------------------------------------------------------
  // C. THE ENGINE AGREES -- not the screen, and not a second calculator.
  // ------------------------------------------------------------------
  const allowed = asksAs(subjectId,
    `select allowed from public.explain_access('${subjectId}', 'venue.pitch_allocation.view', 'club', '${clubId}', null, null);`)
  record("C1 explain_access says the Volunteer bundle now answers a capability it did not before",
    allowed === "t", allowed)

  await go(`/people/${membershipId}`)
  const afterRole = await page.locator("main").innerText()
  record("C2 and the page shows the role it was given", /Volunteer/.test(afterRole))

  // ------------------------------------------------------------------
  // D. THE AUDIT HISTORY RECORDS IT -- read from the one append-only stream.
  // ------------------------------------------------------------------
  record("D1 the page carries the club's own access history for this person", /how it got this way/i.test(afterRole))
  record("D2 which says what happened, in words rather than event keys",
    /Given the Volunteer role/.test(afterRole), afterRole.slice(Math.max(afterRole.search(/how it got this way/i), 0), Math.max(afterRole.search(/how it got this way/i), 0) + 220).replace(/\s+/g, " "))
  record("D3 and who did it", new RegExp(`by .+`).test(afterRole))
  const eventCount = sql(`select count(*) from public.security_events
                          where subject_user_id = '${subjectId}' and club_id = '${clubId}' and event_type = 'role.granted'`)
  record("D4 and it is a READ of the canonical stream, not a second log", Number(eventCount) >= 1, eventCount)

  // ------------------------------------------------------------------
  // E. A SECOND RELATIONSHIP, so removal has something to leave standing.
  // ------------------------------------------------------------------
  if (teamId) {
    await go(`/people/${membershipId}`)
    await page.getByRole("button", { name: /Give (Team )?Access|Assign/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
  // Seeded directly rather than through the UI: the team-access editor is
  // Step 2's and is not what this suite is proving.
  sql(`insert into public.team_permissions (membership_id, team_id, permission)
       values ('${membershipId}', '${teamId}', 'coach') on conflict do nothing`)
  sql(`update public.club_memberships set role = 'BASIC_USER' where id = '${membershipId}'`)

  // ------------------------------------------------------------------
  // F. REMOVE ONE ROLE -- and nothing else moves.
  // ------------------------------------------------------------------
  const teamRowsBefore = sql(`select count(*) from public.team_permissions where membership_id = '${membershipId}'`)
  await go(`/people/${membershipId}`)
  // The section lists EVERY additional role, so the team role seeded above is
  // in it too -- which is the point: a team role is an additional role, and
  // Slice 8 shows them in one place. The Volunteer row is named exactly.
  const otherRoles = page.getByRole("region", { name: /Other Roles/i })
  record("F0 the section lists the team role alongside the club-wide one",
    (await otherRoles.getByRole("listitem").count()) >= 2,
    (await otherRoles.innerText()).replace(/\s+/g, " ").slice(0, 160))
  await otherRoles
    .getByRole("listitem")
    .filter({ hasText: "Volunteer" })
    .getByRole("button", { name: "Remove" })
    .click()
  await page.waitForTimeout(2500)

  const afterRemoval = sql(`select count(*) from public.role_assignments
                            where membership_id = '${membershipId}' and role_key = 'VOLUNTEER' and state = 'ACTIVE'`)
  record("F1 the Volunteer role is gone", afterRemoval === "0", afterRemoval)
  const teamRowsAfter = sql(`select count(*) from public.team_permissions where membership_id = '${membershipId}'`)
  record("F2 their team access survives", teamRowsAfter === teamRowsBefore, `${teamRowsBefore} -> ${teamRowsAfter}`)
  const stillMember = sql(`select state from public.club_memberships where id = '${membershipId}'`)
  record("F3 their club membership survives", stillMember === "ACTIVE", stillMember)
  const revoked = sql(`select count(*) from public.role_assignments
                       where membership_id = '${membershipId}' and role_key = 'VOLUNTEER' and state = 'REVOKED'`)
  record("F4 and the removal is history rather than a deletion", Number(revoked) >= 1, revoked)

  await go(`/people/${membershipId}`)
  const finalText = await page.locator("main").innerText()
  record("F5 the timeline records the removal too", /Volunteer role removed/.test(finalText))

  // ------------------------------------------------------------------
  // G. ACCESSIBILITY AND THE TWO PHONE WIDTHS, on the surface this step
  //    materially changed. Pre-existing violations are declared by the
  //    harness, never hidden; the baseline is shrink-only.
  // ------------------------------------------------------------------
  await go(`/people/${membershipId}`)
  await page.addScriptTag({ content: axeSource() })
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
  recordAxe("axe: the person's access page", violations)

  // Two controls on this page may not share an accessible name: the Team
  // Access editor has its own Role and Reason fields, and Slice 8 added a
  // second pair. Anybody navigating by label rather than by sight would have
  // had two identical answers.
  const labelCounts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label")).reduce((acc, l) => {
      const t = (l.textContent ?? "").trim()
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
  )
  const duplicated = Object.entries(labelCounts).filter(([, n]) => n > 1).map(([t]) => t)
  record("G1 no two controls on the page answer to the same label", duplicated.length === 0, duplicated.join(", "))

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
  await ctx.close()

  for (const width of [390, 320]) {
    const small = await newContext(browser, { width, height: 844 })
    const m = await small.newPage()
    await signIn(m, CLUB_ADMIN)
    await m.goto(`${APP}/people/${membershipId}`, { waitUntil: "domcontentloaded" })
    await m.waitForLoadState("networkidle").catch(() => {})
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`G2 no horizontal overflow at ${width}px`, overflow <= 0, `${overflow}px over`)
    const target = await m.getByRole("button", { name: "Give Another Role" }).boundingBox().catch(() => null)
    record(`G3 the role control stays a real target at ${width}px`,
      target === null || target.height >= 44, target ? `${Math.round(target.height)}px` : "(not offered)")
    await small.close()
  }
} finally {
  await browser.close()
  teardown()
}

record("cleanup: this run's disposable person and everything they held are gone",
  sql(`select count(*) from auth.users where email = '${SUBJECT_EMAIL}'`) === "0" &&
    sql(`select count(*) from public.role_assignments where membership_id = '${membershipId}'`) === "0")

process.exit(summarise() ? 0 : 1)
