// =====================================================================
// SLICE 5 -- INVITATIONS, CODES AND CLAIMS, IN A REAL BROWSER
//
// The database proofs say the rules hold. This says a person can actually
// get through the door: a club invites somebody, the invitation arrives as
// a link, the link is opened by a stranger, and the outcome is exactly the
// one the club authorised -- no more.
//
// EVERYTHING IS THIS RUN'S OWN (rewritten 2026-10-05). The first version
// issued its invitations as the persistent UAT Club Admin, from the persistent
// UAT club, onto that club's own sides -- and its cleanup deleted EVERY team
// join code that club had, including codes people were using. Its invitee and
// coder were made with no password, so after sign-in became password-based
// they could never sign in and E-G could not run. Now: an isolated club with
// its own Club Admin and two sides, people made through Supabase's Auth admin
// API with the local UAT password, and a cleanup that removes exactly what
// this run made -- and proves it (Z).
// =====================================================================

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: q,
    encoding: "utf8",
  }).trim()
const last = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT|SET)$/.test(l)).pop() ?? ""
/** One statement as a person, in one transaction (the claims last for the transaction only). */
const as = (userId, statement) =>
  last(sql(`begin;
            select set_config('request.jwt.claims', json_build_object('sub','${userId}','role','authenticated')::text, true);
            ${statement};
            commit;`))

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

const PEOPLE = `uat.s5.%.${TAG}@ovalball.test`
const CLUB_ADMIN = { email: `uat.s5.admin.${TAG}@ovalball.test`, first: "Ada", surname: "Okoro", dob: "1979-03-14" }
// The invitee and the coder are confirmed identities with NO date of birth on file -- the D-S5-1 case.
const INVITEE = { email: `uat.s5.invitee.${TAG}@ovalball.test` }
const CODER = { email: `uat.s5.coder.${TAG}@ovalball.test` }

async function person(p) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${p.email}: HTTP ${res.status}`)
  p.id = body.id
  if (p.first) {
    sql(`update public.profiles set first_name = '${p.first}', surname = '${p.surname}', date_of_birth = '${p.dob}', setup_state = 'COMPLETE' where id = '${p.id}';
         select internal.refresh_account_security_state('${p.id}');`)
  }
}

const ids = { dir: null, club: null, teamA: null, teamB: null }
const startedAt = sql("select now()")

const q = (v) => (v ? `'${v}'::uuid` : "null::uuid")
function cleanup() {
  sql(`
do $$
declare
  v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
  v_club uuid := ${q(ids.club)};
  v_teams uuid[];
  v_inv uuid[];
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_teams := array(select id from public.teams where club_id = v_club);
  -- Only what THIS run issued: its own club's invitations and codes, and anything addressed to its people.
  v_inv := array(select a.id from public.access_invitations a
                  where a.club_id = v_club or a.team_id = any(v_teams) or a.invited_email_normalised like '${PEOPLE}');
  v_records := v_people || v_inv || v_teams
    || array(select id from public.club_memberships where user_id = any(v_people) or club_id = v_club)
    || array(select id from public.role_assignments where user_id = any(v_people) or club_id = v_club)
    || array(select id from public.club_join_requests where requesting_user_id = any(v_people) or club_id = v_club)
    || array(select v_club where v_club is not null);
  delete from public.notifications where user_id = any(v_people) or data ->> 'club_id' = v_club::text
     or data ->> 'invitation_id' in (select unnest(v_inv)::text);
  delete from public.invitation_redemption_attempts where invitation_id = any(v_inv) or user_id = any(v_people);
  delete from public.invitation_redemptions where invitation_id = any(v_inv) or user_id = any(v_people);
  -- A join request remembers the code it came from, so it goes before the invitation it points at.
  delete from public.club_join_requests where requesting_user_id = any(v_people) or source_invitation_id = any(v_inv) or club_id = v_club;
  delete from public.invitation_teams where invitation_id = any(v_inv);
  delete from public.access_invitations where id = any(v_inv);
  delete from public.role_assignments where user_id = any(v_people) or club_id = v_club;
  delete from public.club_memberships where user_id = any(v_people) or club_id = v_club;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = ${q(ids.dir)};
  delete from public.security_events where actor_user_id = any(v_people) or subject_user_id = any(v_people) or club_id = v_club
     or metadata ->> 'invitation_id' in (select unnest(v_inv)::text);
  delete from public.audit_log where changed_by = any(v_people) or actor_user_id = any(v_people) or record_id = any(v_records);
  delete from public.profiles where id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where record_id = any(v_records);
end $$;`)
}

let browser = null
try {
  // ------------------------------------------------------------------ an isolated club with two sides
  for (const p of [CLUB_ADMIN, INVITEE, CODER]) await person(p)
  ids.dir = sql(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                 values ('Invitation Journeys ${TAG} RUFC', 'Testford', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's5-${TAG}') returning id`)
  ids.club = sql(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 's5-${TAG}', 'active') returning id`)
  const team = (key, label) =>
    sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, canonical_team_type_id)
         select '${ids.club}', '${label}', 's5-${key}-${TAG}', 'youth', ct.age_group, ct.gender, 'union', true, ct.id
           from public.canonical_team_types_by_code ct where ct.rugby_code = 'union' and ct.key = '${key}' limit 1 returning id`)
  ids.teamA = team("u12", "Under 12 Boys")
  ids.teamB = team("u16", "Under 16 Boys")
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${CLUB_ADMIN.id}', 'CLUB_ADMIN', 'active')`)

  browser = await launch()

  // ------------------------------------------------------------------
  // A. A club issues a two-team staff invitation, through the real RPC.
  // ------------------------------------------------------------------
  const issued = as(CLUB_ADMIN.id, `
    select token from public.issue_invitation('CLUB_STAFF', '${ids.club}', null, null, null, null, '${INVITEE.email}',
      '{}'::jsonb, null, null,
      jsonb_build_array(jsonb_build_object('id','${ids.teamA}','roles',jsonb_build_array('COACH')),
                        jsonb_build_object('id','${ids.teamB}','roles',jsonb_build_array('TEAM_MANAGER'))))`)

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
    !anonText.includes(INVITEE.email),
    anonText.includes(INVITEE.email) ? "LEAKED" : "not present",
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
  await signIn(invPage, INVITEE.email)
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
    sql(`select state from public.access_invitations where invited_email_normalised = '${INVITEE.email}'`) === "ISSUED",
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
                      where m.user_id = '${INVITEE.id}' and ra.state = 'ACTIVE' and ra.source = 'INVITATION'`)
  record(
    "F1 the invitee is Coach of the first team",
    roles.includes(`COACH@${ids.teamA}`),
    roles || `landed on ${invPage.url()} :: ${(await invPage.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ")}`,
  )
  record("F2 and Team Manager of the second -- neither role leaked to the other team", roles.includes(`TEAM_MANAGER@${ids.teamB}`))
  record(
    "F3 and holds nothing else from the invitation",
    roles.split(",").filter(Boolean).length === 2,
    `${roles.split(",").filter(Boolean).length} assignment(s)`,
  )
  record(
    "F4 the invitation is now spent, exactly once",
    sql(`select state || '/' || (select count(*) from public.invitation_redemptions r
          where r.invitation_id = a.id)::text from public.access_invitations a
          where a.invited_email_normalised = '${INVITEE.email}'`) === "REDEEMED/1",
  )

  // ------------------------------------------------------------------
  // G. A TEAM JOIN CODE, typed by somebody nobody emailed. Since team codes
  //    ask for a place on the team (20270741000000), an adult who does not
  //    play chooses "Just Me, as a Member" -- which is still a plain request
  //    to join the club, never a membership by itself.
  // ------------------------------------------------------------------
  const code = as(CLUB_ADMIN.id, `select code from public.issue_invitation('TEAM_JOIN_CODE', null, '${ids.teamA}', null, null, null, null, '{}'::jsonb, 20)`)
  record("G1 a team join code is ten Crockford characters as XXXXX-XXXXX", /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(code), code)

  const coder = await newContext(browser)
  const coderPage = await coder.newPage()
  await signIn(coderPage, CODER.email)
  await coderPage.goto(`${APP}/join`, { waitUntil: "domcontentloaded" })
  await coderPage.waitForLoadState("networkidle").catch(() => {})
  await coderPage.getByLabel(/invite code/i).fill(code.toLowerCase())
  await coderPage.getByRole("button", { name: /continue/i }).click()
  // The lower-case code is accepted when the code's own page answers with who may use it.
  await coderPage.getByText("Who Is Joining?").waitFor({ timeout: 30000 }).catch(() => {})
  await coderPage.getByText("Just Me, as a Member").click()
  await coderPage.getByRole("button", { name: "Send Request" }).click()
  await coderPage.waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 60000 }).catch(() => {})
  await coderPage.waitForLoadState("networkidle").catch(() => {})

  record(
    "G2 a code typed in lower case is accepted -- the normaliser does the work, not the person",
    sql(`select count(*) from public.club_join_requests where requesting_user_id = '${CODER.id}' and club_id = '${ids.club}'`) === "1",
    `landed on ${coderPage.url()} :: ${(await coderPage.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ")}`,
  )
  record(
    "G3 and it produces a JOIN REQUEST, not a membership -- a shared code never admits anybody by itself",
    sql(`select count(*) from public.club_memberships where user_id = '${CODER.id}' and state = 'ACTIVE'`) === "0",
  )
} finally {
  if (browser) await browser.close()
  cleanup()
}

// ------------------------------------------------------------------
// Z. NOTHING OF THIS RUN REMAINS -- and nothing of anybody else's was touched.
// ------------------------------------------------------------------
record(
  "Z1 every person, club, side, invitation, code, request and notice this run made is gone",
  sql(`select (select count(*) from auth.users where email like '${PEOPLE}')
            + (select count(*) from public.clubs where slug = 's5-${TAG}')
            + (select count(*) from public.club_directory where normalized_key = 's5-${TAG}')
            + (select count(*) from public.teams where slug like 's5-%-${TAG}')
            + (select count(*) from public.access_invitations where created_at >= '${startedAt}' and (club_id = ${q(ids.club)} or team_id in (${q(ids.teamA)}, ${q(ids.teamB)}) or invited_email_normalised like '${PEOPLE}'))
            + (select count(*) from public.club_join_requests where club_id = ${q(ids.club)})
            + (select count(*) from public.notifications where created_at >= '${startedAt}' and data ->> 'club_id' = ${q(ids.club)}::text)`) === "0",
)

process.exit(summarise() ? 0 : 1)
