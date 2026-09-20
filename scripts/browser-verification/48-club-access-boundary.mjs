// =====================================================================
// CONVERGENCE STEP 8 / IDENTITY-AUTH SLICE 8 -- THE ACCEPTANCE BOUNDARY
//
// Slice 8's acceptance criterion, quoted from the programme reconciliation:
//
//     "a Club Admin cannot reach site controls or other clubs, directly or
//      via UI; delegation ceilings proven."
//
// "Directly or via UI" is the whole of it, and it is why this suite exists
// beside the SQL one. A matrix proves the database refuses. It cannot prove
// that a Club Admin who types the URL is refused, that the screen does not
// offer a control the server will reject, or that a Volunteer who has been
// handed a job cannot then hand it on.
//
// It also proves the two Step 8 surfaces do not widen anything:
//
//   the Pitch Allocation group is DISCOVERABILITY of a capability the club
//   always had -- the screen caught up, the authority did not change;
//
//   a preset is convenience over legitimate grants -- it can hand out no
//   permission the person applying it could not have handed out one at a
//   time, and it is not a new role bundle.
//
// Everything it creates is removed and the removal is asserted. No persistent
// review persona is touched.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const CLUB_ADMIN = "uat.coach@ovalball.test"
const TEAM_MANAGER = "uat.team.manager@ovalball.test"
const OUTSIDER = "uat.unrelated@ovalball.test"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)

/**
 * The capability engine refuses without a session, which is correct and is the
 * trap Step 7 met with suite 16 §9: an RPC invoked from psql with no claims
 * "passes" by never running. Every question below is asked AS somebody.
 */
const asksAs = (userId, sqlText) =>
  sql(`select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, true) is not null;
       ${sqlText}`)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? ""
const otherClubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                          where d.normalized_key <> 'ovalball-uat-rufc' and c.status = 'active' limit 1`)
if (!clubId || !otherClubId) {
  console.error("Missing UAT clubs: run the local UAT seed.")
  process.exit(1)
}

const VOL_EMAIL = `uat.s8.vol.${TAG}@ovalball.test`

function teardown() {
  try {
    sql(`
      delete from public.capability_overrides where user_id in (select id from auth.users where email like 'uat.s8.vol.%@ovalball.test');
      delete from public.role_assignments where membership_id in (
        select id from public.club_memberships where user_id in (select id from auth.users where email like 'uat.s8.vol.%@ovalball.test'));
      delete from public.club_memberships where user_id in (select id from auth.users where email like 'uat.s8.vol.%@ovalball.test');
      delete from public.profiles where email like 'uat.s8.vol.%@ovalball.test';
      delete from auth.identities where user_id in (select id from auth.users where email like 'uat.s8.vol.%@ovalball.test');
      delete from auth.users where email like 'uat.s8.vol.%@ovalball.test';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const volId = sql(`
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${VOL_EMAIL}', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '') returning id`)
sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
     values ('${volId}', 'Vera', 'Volunteer ${TAG}', '${VOL_EMAIL}', (current_date - interval '41 years')::date)`)
const volMembership = sql(`insert into public.club_memberships (club_id, user_id, role, status)
                           values ('${clubId}', '${volId}', 'BASIC_USER', 'active') returning id`)

const browser = await launch()
const pageErrors = []

try {
  // ==================================================================
  // A. THE CLUB ADMIN'S CEILING
  // ==================================================================
  const ctx = await newContext(browser, { width: 1440, height: 1000 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  await signIn(page, CLUB_ADMIN)

  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // Typed, not clicked: "directly or via UI" means the URL is part of the test.
  //
  // `/admin` itself is deliberately left out of this loop: it has no page.tsx,
  // so it is not a site control that could be reached -- it is a 404, and
  // asserting "you were redirected away from it" would be asserting something
  // that is not true about a route that does not exist. The real site controls
  // are the ones below, and each one must send a Club Admin away.
  for (const path of ["/admin/users", "/admin/site-admins", "/admin/permissions", "/admin/clubs"]) {
    await go(path)
    record(`A1 a Club Admin typing ${path} does not reach a site control`,
      !new URL(page.url()).pathname.startsWith("/admin"), new URL(page.url()).pathname)
  }
  await go("/admin")
  const adminRoot = await page.locator("body").innerText()
  record("A1b and /admin itself is not a page at all -- no site surface renders there",
    !/Site Admin/i.test(adminRoot) || /not found/i.test(adminRoot),
    adminRoot.replace(/\s+/g, " ").slice(0, 80))

  await go("/club/permissions")
  const permissionsText = await page.locator("main").innerText()
  record("A2 but their own club's permissions screen opens",
    page.url().includes("/club/permissions") && /Permissions/.test(permissionsText), page.url().replace(APP, ""))

  // ==================================================================
  // B. PITCH ALLOCATION IS DISCOVERABILITY, NOT NEW AUTHORITY
  // ==================================================================
  const adminId = sql(`select id from auth.users where email = '${CLUB_ADMIN}'`)
  const adminCould = asksAs(adminId,
    `select allowed from public.explain_access('${adminId}', 'venue.pitch_allocation.manage', 'club', '${clubId}', null, null);`)
  record("B2 the Club Admin could always manage pitch allocation -- the screen caught up, the authority did not change",
    adminCould === "t", adminCould)
  const memberCould = asksAs(volId,
    `select allowed from public.explain_access('${volId}', 'venue.pitch_allocation.manage', 'club', '${clubId}', null, null);`)
  record("B3 while an ordinary member still cannot, however the screen groups it", memberCould === "f", memberCould)

  // ==================================================================
  // C. A PRESET IS CONVENIENCE OVER LEGITIMATE GRANTS
  // ==================================================================
  const memberCard = page.getByRole("button").filter({ hasText: `Volunteer ${TAG}` }).first()
  await memberCard.waitFor({ state: "visible", timeout: 30000 })
  await memberCard.click()
  await page.waitForTimeout(600)
  const opened = await page.locator("main").innerText()
  // The groups render inside an opened person, which is where a club decides
  // about them, so this is where Pitch Allocation has to appear.
  record("B1 the permissions screen now groups Pitch Allocation, which it never offered before",
    /Pitch Allocation/i.test(opened))
  record("C1 opening a person offers the named jobs a club hands out", /Give them a job/i.test(opened))
  record("C2 including the three the design names",
    /Pitch Allocation/.test(opened) && /Calendar/.test(opened) && /Team Fixtures/.test(opened))

  await page.getByRole("button", { name: /Volunteer .* Pitch Allocation/ }).click()
  await page.waitForTimeout(2000)

  const granted = sql(`select count(*) from public.capability_overrides
                       where user_id = '${volId}' and club_id = '${clubId}' and status = 'active' and effect = 'grant'
                         and capability_key in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage')`)
  record("C3 applying one records an explicit decision per capability -- grants, not a new bundle",
    granted === "2", granted)
  const outside = sql(`select count(*) from public.capability_overrides
                       where user_id = '${volId}' and club_id = '${clubId}' and status = 'active'
                         and capability_key not like 'venue.pitch_allocation.%'`)
  record("C4 and nothing outside the preset's own list", outside === "0", outside)
  const presetEvent = sql(`select count(*) from public.security_events
                           where subject_user_id = '${volId}' and event_type = 'override.preset_applied'`)
  record("C5 with one event recording WHICH JOB was handed out", Number(presetEvent) >= 1, presetEvent)

  const nowCould = asksAs(volId,
    `select allowed from public.explain_access('${volId}', 'venue.pitch_allocation.manage', 'club', '${clubId}', null, null);`)
  record("C6 and the engine -- not the screen -- now says they may do it", nowCould === "t", nowCould)

  await ctx.close()

  // ==================================================================
  // D. THE DELEGATION CEILING: NOBODY HANDS ON WHAT THEY DO NOT HOLD
  // ==================================================================
  const volCtx = await newContext(browser, { width: 1440, height: 1000 })
  const vol = await volCtx.newPage()
  await signIn(vol, VOL_EMAIL)
  await go("/club/permissions", vol)
  record("D1 the Volunteer who was given a job cannot open the screen that hands jobs out",
    !vol.url().includes("/club/permissions"), new URL(vol.url()).pathname)
  await go("/people", vol)
  record("D2 nor Users & Permissions", !vol.url().includes("/people"), new URL(vol.url()).pathname)
  await volCtx.close()

  const tmCtx = await newContext(browser, { width: 1440, height: 1000 })
  const tm = await tmCtx.newPage()
  await signIn(tm, TEAM_MANAGER)
  await go("/club/permissions", tm)
  record("D3 nor does a Team Manager reach the club's permissions screen",
    !tm.url().includes("/club/permissions"), new URL(tm.url()).pathname)
  await tmCtx.close()

  // ==================================================================
  // E. ANOTHER CLUB IS NOT REACHABLE, BY URL OR OTHERWISE
  // ==================================================================
  const outsiderCtx = await newContext(browser, { width: 1440, height: 1000 })
  const outsider = await outsiderCtx.newPage()
  await signIn(outsider, OUTSIDER)
  await go(`/people/${volMembership}`, outsider)
  record("E1 an unrelated person naming a membership id in the URL is sent away",
    !new URL(outsider.url()).pathname.startsWith("/people/"), new URL(outsider.url()).pathname)
  await outsiderCtx.close()

  // The club timeline refuses another club at the server, whatever a URL says.
  // Asked AS the Club Admin, because a capability gate that is never reached
  // is not a gate that was proved.
  let crossClub = "(no refusal)"
  try {
    asksAs(adminId, `select count(*) from public.club_access_history('${otherClubId}', null, 10);`)
  } catch (e) {
    crossClub = String(e.stderr ?? e.message ?? e).split("\n")[0]
  }
  record("E2 a Club Admin is refused another club's access timeline, in the database",
    /not authorised/i.test(crossClub), crossClub.slice(0, 90))

  const ownClub = asksAs(adminId, `select count(*) from public.club_access_history('${clubId}', null, 10);`)
  record("E3 while their own club's timeline answers", Number(ownClub) >= 0, ownClub)

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record("cleanup: this run's disposable volunteer and every decision about them are gone",
  sql(`select count(*) from auth.users where email = '${VOL_EMAIL}'`) === "0" &&
    sql(`select count(*) from public.capability_overrides where user_id = '${volId}'`) === "0")

process.exit(summarise() ? 0 : 1)
