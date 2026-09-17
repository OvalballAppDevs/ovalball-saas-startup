// =====================================================================
// SLICE 5 -- INVITATIONS, CODES AND CLAIMS, IN A REAL BROWSER
//
// The database proofs say the rules hold. This says a person can actually
// get through the door: a club invites somebody, the invitation arrives as
// a link, the link is opened by a stranger, and the outcome is exactly the
// one the club authorised -- no more.
//
// Every identity here is a local uat.* fixture. Nothing touches production,
// and no session borrows a real person's login.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const CLUB_ADMIN = "uat.coach@ovalball.test"   // this club's Club Admin in the local fixtures
const INVITEE = `uat.s5.invitee.${TAG}@ovalball.test`
const CODER = `uat.s5.coder.${TAG}@ovalball.test`

/** A local fixture identity, confirmed, with NO date of birth -- the D-S5-1 case. */
function makeIdentity(email) {
  return sql(`
    with u as (
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
        reauthentication_token)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        '${email}', '', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', '')
      returning id
    ) select id::text from u`)
}

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)
const adminId = sql(`select id from auth.users where email = '${CLUB_ADMIN}'`)
const teamA = sql(`select id from public.teams where club_id = '${clubId}' and age_group = 'U12' and squad_designation is null limit 1`)
const teamB = sql(`select id from public.teams where club_id = '${clubId}' and age_group = 'U16' and squad_designation is null limit 1`)

const inviteeId = makeIdentity(INVITEE)
makeIdentity(CODER)

const browser = await launch()

try {
  // ------------------------------------------------------------------
  // A. A club issues a two-team staff invitation, through the real RPC.
  // ------------------------------------------------------------------
  const issued = sql(`
    select set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
    select token from public.issue_invitation('CLUB_STAFF', '${clubId}', null, null, null, null, '${INVITEE}',
      '{}'::jsonb, null, null,
      jsonb_build_array(jsonb_build_object('id','${teamA}','roles',jsonb_build_array('COACH')),
                        jsonb_build_object('id','${teamB}','roles',jsonb_build_array('TEAM_MANAGER'))));`)
    .split("\n")
    .pop()

  record("A1 a club issues a two-team staff invitation and receives the link once", Boolean(issued), issued?.slice(0, 10))

  // ------------------------------------------------------------------
  // B. The link previews to a STRANGER without disclosing who was invited.
  // ------------------------------------------------------------------
  const anon = await newContext(browser)
  const anonPage = await anon.newPage()
  await anonPage.goto(`${APP}/join?t=${encodeURIComponent(issued)}`, { waitUntil: "domcontentloaded" })
  await anonPage.waitForLoadState("networkidle").catch(() => {})
  const anonText = await anonPage.locator("body").innerText()

  record("B1 a signed-out visitor can see what the invitation is for", /invit/i.test(anonText) && anonText.length > 40)
  record("B2 and is asked to sign in rather than shown an Accept button", /sign in/i.test(anonText))
  record(
    "B3 and the page never discloses the invited email address",
    !anonText.includes(INVITEE),
    anonText.includes(INVITEE) ? "LEAKED" : "not present",
  )

  // ------------------------------------------------------------------
  // C. MOBILE. 320px is the narrowest real phone; nothing may overflow.
  // ------------------------------------------------------------------
  const mob = await newContext(browser, { width: 320, height: 720 })
  const mobPage = await mob.newPage()
  await mobPage.goto(`${APP}/join?t=${encodeURIComponent(issued)}`, { waitUntil: "domcontentloaded" })
  await mobPage.waitForLoadState("networkidle").catch(() => {})
  const m = await measure(mobPage)
  record(
    "C1 /join fits a 320px phone with no horizontal scroll",
    m.innerWidth === 320 && m.scrollWidth <= 320,
    `viewport=${m.innerWidth} content=${m.scrollWidth}`,
  )

  // ------------------------------------------------------------------
  // D. ACCESSIBILITY. A code box that a screen reader cannot name is not usable.
  // ------------------------------------------------------------------
  const a11y = await newContext(browser)
  const a11yPage = await a11y.newPage()
  await a11yPage.goto(`${APP}/join`, { waitUntil: "domcontentloaded" })
  await a11yPage.waitForLoadState("networkidle").catch(() => {})
  const headings = await a11yPage.locator("h1").count()
  record("D1 the page has exactly one first-level heading", headings === 1, `h1 count=${headings}`)
  const unnamed = await a11yPage.evaluate(() =>
    [...document.querySelectorAll("input, button")].filter((el) => {
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
        el.textContent ||
        el.getAttribute("placeholder")
      return !name || !name.trim()
    }).length,
  )
  record("D2 every control on it has an accessible name", unnamed === 0, `unnamed=${unnamed}`)

  // ------------------------------------------------------------------
  // E. D-S5-1 IN THE BROWSER. The invitee has no date of birth on file, so
  //    the age gate refuses -- and must ASK rather than dead-end.
  // ------------------------------------------------------------------
  const inv = await newContext(browser)
  const invPage = await inv.newPage()
  await signIn(invPage, INVITEE)
  await invPage.goto(`${APP}/join?t=${encodeURIComponent(issued)}`, { waitUntil: "domcontentloaded" })
  await invPage.waitForLoadState("networkidle").catch(() => {})

  const accept = invPage.getByRole("button", { name: /accept invitation/i })
  await accept.first().waitFor({ state: "visible", timeout: 30000 })
  await accept.first().click()
  // The gate is a React transition, not a navigation: wait for the question itself rather than for
  // the network to go quiet, which it already has.
  await invPage
    .getByLabel(/date of birth/i)
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {})
  const gateText = await invPage.locator("body").innerText()

  record(
    "E1 an invitee whose age Ovalball has never asked for is asked for it",
    /date of birth/i.test(gateText),
    gateText.slice(0, 90).replace(/\s+/g, " "),
  )
  record(
    "E2 and the invitation is NOT spent by that refusal",
    sql(`select state from public.access_invitations where invited_email_normalised = '${INVITEE}'`) === "ISSUED",
  )

  // Answer it, the way the person would.
  await invPage.getByLabel(/first name/i).fill("Sam")
  await invPage.getByLabel(/last name/i).fill("Fixture")
  await invPage.locator('input[type="date"]').first().fill("1991-04-05")
  await invPage.getByRole("button", { name: /save & accept/i }).click()
  // Acceptance ends in a router.push, not a form post, so the proof that it worked is the URL
  // leaving /join -- waiting for the network to go quiet would pass whether or not anything happened.
  await invPage.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 60000 }).catch(() => {})
  await invPage.waitForLoadState("networkidle").catch(() => {})

  // ------------------------------------------------------------------
  // F. THE OUTCOME IS EXACTLY WHAT THE CLUB AUTHORISED.
  // ------------------------------------------------------------------
  const roles = sql(`select coalesce(string_agg(ra.role_key || '@' || ra.team_id::text, ',' order by ra.role_key), '')
                       from public.role_assignments ra
                       join public.club_memberships m on m.id = ra.membership_id
                      where m.user_id = '${inviteeId}' and ra.state = 'ACTIVE' and ra.source = 'INVITATION'`)
  record(
    "F1 the invitee is Coach of the first team",
    roles.includes(`COACH@${teamA}`),
    roles || `landed on ${invPage.url()} :: ${(await invPage.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ")}`,
  )
  record("F2 and Team Manager of the second -- neither role leaked to the other team", roles.includes(`TEAM_MANAGER@${teamB}`))
  record(
    "F3 and holds nothing else from the invitation",
    roles.split(",").filter(Boolean).length === 2,
    `${roles.split(",").filter(Boolean).length} assignment(s)`,
  )
  record(
    "F4 the invitation is now spent, exactly once",
    sql(`select state || '/' || (select count(*) from public.invitation_redemptions r
          where r.invitation_id = a.id)::text from public.access_invitations a
          where a.invited_email_normalised = '${INVITEE}'`) === "REDEEMED/1",
  )

  // ------------------------------------------------------------------
  // G. A TEAM JOIN CODE, typed by somebody nobody emailed.
  // ------------------------------------------------------------------
  const code = sql(`
    select set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
    select code from public.issue_invitation('TEAM_JOIN_CODE', null, '${teamA}', null, null, null, null, '{}'::jsonb, 20);`)
    .split("\n")
    .pop()
  record("G1 a team join code is ten Crockford characters as XXXXX-XXXXX", /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(code), code)

  const coder = await newContext(browser)
  const coderPage = await coder.newPage()
  await signIn(coderPage, CODER)
  await coderPage.goto(`${APP}/join`, { waitUntil: "domcontentloaded" })
  await coderPage.waitForLoadState("networkidle").catch(() => {})
  await coderPage.getByLabel(/invite code/i).fill(code.toLowerCase())
  await coderPage.getByRole("button", { name: /continue/i }).click()
  await coderPage.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 60000 }).catch(() => {})
  await coderPage.waitForLoadState("networkidle").catch(() => {})

  const coderId = sql(`select id from auth.users where email = '${CODER}'`)
  record(
    "G2 a code typed in lower case is accepted -- the normaliser does the work, not the person",
    sql(`select count(*) from public.club_join_requests where requesting_user_id = '${coderId}'`) === "1",
    `landed on ${coderPage.url()} :: ${(await coderPage.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ")}`,
  )
  record(
    "G3 and it produces a JOIN REQUEST, not a membership -- a shared code never admits anybody by itself",
    sql(`select count(*) from public.club_memberships where user_id = '${coderId}' and state = 'ACTIVE'`) === "0",
  )
} finally {
  await browser.close()
  // Self-cleaning: this run leaves nothing behind for the next one to trip over.
  sql(`do $$
declare
  v_people uuid[] := array(select id from auth.users where email like 'uat.s5.%.${TAG}@ovalball.test');
  v_club uuid := (select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                   where d.normalized_key = 'ovalball-uat-rufc');
  v_inv uuid[];
begin
  perform set_config('ovalball.maintenance','on',true);

  -- Everything this run issued, named once: the invitations to its own people, plus the team join
  -- codes it created for the fixture club. Children go before parents, or the foreign keys refuse.
  v_inv := array(
    select a.id from public.access_invitations a
     where a.invited_email_normalised like 'uat.s5.%.${TAG}@ovalball.test'
        or (a.kind = 'TEAM_JOIN_CODE' and a.team_id in (select t.id from public.teams t where t.club_id = v_club)));

  delete from public.invitation_redemption_attempts where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.invitation_redemptions where invitation_id = any(v_inv) or user_id = any(v_people);
  -- A join request REMEMBERS the code it came from (D-S5's source_invitation_id), so it has to go
  -- before the invitation it points at, not after the people who made it.
  delete from public.club_join_requests where requesting_user_id = any(v_people) or source_invitation_id = any(v_inv);
  delete from public.access_invitations where id = any(v_inv);

  delete from public.role_assignments
   where membership_id in (select id from public.club_memberships where user_id = any(v_people));
  delete from public.club_memberships where user_id = any(v_people);
  delete from public.security_events where actor_user_id = any(v_people);
  delete from public.notifications where user_id = any(v_people);
  delete from public.audit_log where changed_by = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
end $$;`)
}

process.exit(summarise() ? 0 : 1)
