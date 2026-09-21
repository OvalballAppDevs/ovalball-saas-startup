// =====================================================================
// CONVERGENCE STEP 16 -- BOTH SIDES OF A COMPETITION, IN A REAL BROWSER
//
// Steps 14-15 built the organiser's half. This walks the relationship that
// closes it, in one journey, as the two people who actually live in it:
//
//   the county's administrator -> Overview -> Competitions -> the cup's real
//   RESULTS AND TABLE from Competition Match truth -> what the clubs have not
//   answered -> People & Access -> INVITE somebody who has no Ovalball account
//
//   then the club's own admin -> Competitions -> "Competitions You're In",
//   which until Step 16 did not exist: which competition, which season, which
//   teams, WHO RUNS IT, and what needs answering -> Competition Requests
//
// And the boundaries: a Viewer is told the truth rather than shown controls, a
// club sees no organiser controls, and affiliation opens no door either way.
//
// The authority matrix is supabase/tests/step16_governing_closure.sql.
// EVERYTHING THIS RUN CREATES IS REMOVED AND THE REMOVAL IS ASSERTED.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const OFFICER = "uat.preston.admin@ovalball.test"   // BODY_ADMIN at the review county
const VIEWER = "uat.adult.player@ovalball.test"     // BODY_VIEWER at the same county
const INVITEE = `s16.review.${TAG}@ovalball.test`   // nobody: the point is that they have no account

/**
 * REACT'S OWN DEVELOPMENT INSTRUMENTATION IS NOT AN APPLICATION ERROR.
 *
 * React 19 marks component renders on the performance timeline in development. Navigating out of a
 * client-side transition -- which this journey does, because that is what a person does -- can leave it
 * measuring a render it never finished, and it throws
 *
 *   Failed to execute 'measure' on 'Performance': '<Component>' cannot have a negative time stamp.
 *
 * Letting the transition settle made it rarer and not reliable, so it is filtered BY ITS EXACT TEXT and
 * nothing else: every other page error, including any thrown by this product, is still fatal below. It
 * is recorded in the hardening ledger rather than silently dropped.
 */
const DEV_INSTRUMENTATION = /Failed to execute 'measure' on 'Performance'/

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const bodyId = sql(`select id from public.constituent_bodies where canonical_name = 'Ovalball Review County RFU'`)
const competitionId = sql(`select id from public.competitions where organiser_constituent_body_id = '${bodyId}' limit 1`)
if (!bodyId || !competitionId) {
  console.error("Missing the review county's competition. Run:")
  console.error("  node scripts/review-fixtures/step2-review-club.mjs enrich-governing")
  console.error("  node scripts/review-fixtures/step2-review-club.mjs enrich-governing-competition")
  process.exit(1)
}
// A Club Admin of a club actually entered in that competition -- resolved, never assumed, and
// deliberately one who holds NO role at the county.
//
// The first run of this suite picked uat.coach, who is a Club Admin at an entered club AND the county's
// Competitions Officer, so section D's "affiliation opens no door" assertion failed correctly: that
// person's access comes from their county ROLE, not from their club's affiliation. Excluding a body role
// here is what makes D8 a test of affiliation rather than of a coincidence.
const clubAdminEmail = sql(`select u.email from public.competition_participants p
  join public.competition_editions e on e.id = p.edition_id
  join public.club_memberships cm on cm.club_id = p.club_id and cm.status = 'active' and cm.role = 'CLUB_ADMIN'
  join auth.users u on u.id = cm.user_id
  where e.competition_id = '${competitionId}' and p.status = 'entered'
    and not exists (select 1 from public.constituent_body_roles r
                     where r.user_id = u.id and r.state = 'ACTIVE')
  limit 1`)
if (!clubAdminEmail) {
  console.error("No Club Admin of an entered club exists; the club side cannot be walked.")
  process.exit(1)
}
const enteredClubId = sql(`select p.club_id from public.competition_participants p
  join public.competition_editions e on e.id = p.edition_id
  join public.club_memberships cm on cm.club_id = p.club_id and cm.status = 'active' and cm.role = 'CLUB_ADMIN'
  join auth.users u on u.id = cm.user_id
  where e.competition_id = '${competitionId}' and p.status = 'entered' and u.email = '${clubAdminEmail}' limit 1`)

function teardown() {
  try {
    sql(`delete from public.invitation_redemption_attempts a using public.access_invitations i
          where a.invitation_id = i.id and i.invited_email_normalised like 's16.review.%';
         delete from public.access_invitations where invited_email_normalised like 's16.review.%';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

const browser = await launch()
const pageErrors = []

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(page, OFFICER)

  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // ==================================================================
  // A. THE ORGANISER SEES WHAT ACTUALLY HAPPENED
  // ==================================================================
  await go(`/governing/${bodyId}/competitions`)
  const comps = await page.locator("main").innerText()
  record("A1 the organisation's competitions show real progress", /teams|matches|played/i.test(comps))
  await page.getByRole("link", { name: /Results & Table/i }).first().click()
  await page.waitForURL(new RegExp(`/governing/${bodyId}/competitions/[0-9a-f-]+`), { timeout: 30000 }).catch(() => {})
  record("A2 and open the competition's own results", page.url().includes(competitionId), page.url().replace(APP, ""))

  const detail = await page.locator("main").innerText()
  record("A3 with a table computed from Competition Match truth", /Table/i.test(detail) && /Pts/.test(detail))
  record("A4 the organiser's own points rule stated, not a hardcoded one", /for a win/i.test(detail))
  record("A5 the matches, with the scores that were recorded", /\d+\s*–\s*\d+/.test(detail), detail.replace(/\s+/g, " ").slice(0, 150))
  record("A6 and what is still waiting on the clubs -- which a county could not see at all before",
    /Waiting on the Clubs/i.test(detail))

  // THE TABLE AGREES WITH THE DATABASE. A second standings computation would show here.
  const dbResults = Number(sql(`select count(*) from public.competition_matches m
     join public.competition_editions e on e.id = m.edition_id
     where e.competition_id = '${competitionId}' and m.home_score is not null`))
  const shownPlayed = [...detail.matchAll(/(\d+)\s*–\s*\d+/g)].length
  record("A7 and shows exactly the results the database holds", shownPlayed === dbResults, `${shownPlayed} shown, ${dbResults} stored`)

  // ==================================================================
  // B. INVITING SOMEBODY WHO HAS NO OVALBALL ACCOUNT
  // ==================================================================
  await go(`/governing/${bodyId}/people`)
  await page.getByRole("button", { name: /^Invite Somebody$/i }).click()
  await page.getByLabel(/Email Address/i).fill(INVITEE)
  record("B1 the form does not ask whether they already have an account",
    /do not need an Ovalball account yet/i.test(await page.locator("main").innerText()))
  await page.getByRole("radio", { name: /Competitions Officer/i }).check()
  await page.getByRole("button", { name: /^Send Invitation$/i }).click()
  await page.waitForTimeout(2500)

  const created = sql(`select kind || '|' || (intended_outcome->>'role_key') || '|' || issued_level
                       from public.access_invitations where invited_email_normalised = '${INVITEE}'`)
  record("B2 one canonical invitation is created, at the organisation's own issuing level",
    created === "GOVERNING_BODY_OFFICER|BODY_COMPETITIONS|ORGANISATION", created || "(nothing)")
  const plaintext = sql(`select count(*) from public.access_invitations
                         where invited_email_normalised = '${INVITEE}' and token_sha256 is not null`)
  record("B3 with the token stored as a hash and never in the clear", plaintext === "1")

  const afterInvite = await page.locator("main").innerText()
  record("B4 the confirmation reveals nothing about whether the address is registered",
    !/no Ovalball account/i.test(afterInvite) && /Invitation created/i.test(afterInvite))
  record("B5 and gives a link, because Ovalball does not email these yet and says so", /\/join\?t=/.test(afterInvite))

  await go(`/governing/${bodyId}/people`)
  const waiting = await page.locator("main").innerText()
  record("B6 they appear as invited, NOT as somebody who has access",
    /Invited, Not Yet Accepted/i.test(waiting) && new RegExp(INVITEE, "i").test(waiting))
  const peopleSection = waiting.slice(0, waiting.indexOf("Invited, Not Yet Accepted"))
  record("B7 so the people list does not count them as an officer", !new RegExp(INVITEE, "i").test(peopleSection))

  // AND IT CAN BE WITHDRAWN. Two presses, and the row goes.
  await page.getByRole("button", { name: /^Withdraw$/i }).first().click()
  await page.getByRole("button", { name: /Yes, Withdraw/i }).click()
  await page.waitForTimeout(2500)
  const revoked = sql(`select state from public.access_invitations where invited_email_normalised = '${INVITEE}'`)
  record("B8 withdrawing it is a recorded state change, not a delete", revoked === "REVOKED", revoked || "(gone)")
  record("B9 and it stops being listed as waiting",
    !new RegExp(INVITEE, "i").test(await page.locator("main").innerText()))

  // ==================================================================
  // C. THE OVERVIEW STAYS DERIVED
  // ==================================================================
  await go(`/governing/${bodyId}`)
  const overview = await page.locator("main").innerText()
  record("C1 the Overview still leads with real work and no analytics",
    /needs attention/i.test(overview) && !/\d+%|trend|engagement/i.test(overview))
  await ctx.close()

  // ==================================================================
  // D. THE CLUB'S OWN SIDE -- the half that did not exist
  // ==================================================================
  const cctx = await newContext(browser, { width: 1440, height: 1100 })
  const club = await cctx.newPage()
  club.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(club, clubAdminEmail)
  await go("/fixtures/competitions", club)
  const clubView = await club.locator("main").innerText()
  record("D1 a club can see which competitions it is in", /Competitions You&?'?re In|Competitions You’re In/i.test(clubView) || /Competitions You/i.test(clubView))
  record("D2 named, with its season", /Review County Junior Cup/i.test(clubView))
  // THE FACT THAT WAS MISSING ENTIRELY.
  record("D3 and WHO RUNS IT", /Run by Ovalball Review County RFU/i.test(clubView), clubView.replace(/\s+/g, " ").slice(0, 200))
  record("D4 with its own teams named", /Under 12 Boys/i.test(clubView))
  record("D5 and what the club has to do about it", /needs? your answer|matches need an answer|of your matches played/i.test(clubView))

  // NO ENTER OR WITHDRAW CONTROL, because entry is not the club's act.
  const clubControls = await club.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((s) => /Competitions You/i.test(s.textContent ?? ""))
    return [...(section?.querySelectorAll("button, a") ?? [])].map((el) => (el.textContent ?? "").trim())
  })
  record("D6 and no control that would enter or withdraw a team -- that is the organiser's act",
    !clubControls.some((t) => /enter|withdraw|leave/i.test(t)), clubControls.join(" | ") || "(none)")

  // Into the canonical place an answer is actually given.
  await club.getByRole("link", { name: /^Answer \d+$/ }).first().click()
  await club.waitForURL(/\/fixtures\/competitions\/requests/, { timeout: 30000 }).catch(() => {})
  record("D7 and answering goes to the canonical Competition Requests, not a second surface",
    club.url().includes("/fixtures/competitions/requests"), club.url().replace(APP, ""))

  // AFFILIATION OPENS NO DOOR. This club is affiliated to the county and administers none of it.
  //
  // Settled first, deliberately. Navigating straight out of the client-side transition above left React's
  // development performance instrumentation measuring a render it never finished, and it threw
  // "cannot have a negative time stamp" -- a dev-tooling artefact that would otherwise have been
  // reported here as an application page error.
  await club.waitForLoadState("networkidle").catch(() => {})
  await club.waitForTimeout(500)
  await go(`/governing/${bodyId}`, club)
  const clubAtBody = await club.locator("body").innerText()
  record("D8 and being affiliated gives the club no access to the county's workspace",
    !/Needs Attention/i.test(clubAtBody) && !/Who Has Access/i.test(clubAtBody))
  await cctx.close()

  // ==================================================================
  // E. THE VIEWER NEGATIVE JOURNEY
  // ==================================================================
  const vctx = await newContext(browser, { width: 1440, height: 1100 })
  const v = await vctx.newPage()
  v.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(v, VIEWER)
  await go(`/governing/${bodyId}/competitions/${competitionId}`, v)
  const vDetail = await v.locator("main").innerText()
  record("E1 a Viewer understands the competition -- the table and the results are not hidden from them",
    /Table/i.test(vDetail) && /Pts/.test(vDetail))
  await go(`/governing/${bodyId}/people`, v)
  const vControls = await v.evaluate(() =>
    [...document.querySelectorAll("main button, main a")]
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => /invite|remove|withdraw|send again/i.test(t))
  )
  record("E2 and is offered no control they could not legitimately use", vControls.length === 0,
    vControls.join(" | ") || "(none)")

  // AND THE SERVER REFUSES ANYWAY -- hidden buttons are not the boundary.
  const viewerId = sql(`select id from auth.users where email = '${VIEWER}'`)
  // READ AS A VALUE, not as a notice: psql sends NOTICE to stderr, so the first version of this check
  // read an empty stdout and reported ALLOWED while the server was in fact refusing. The outcome is
  // parked in a session setting and selected back.
  const refused = sql(`do $$
    begin
      perform set_config('request.jwt.claims', jsonb_build_object('sub','${viewerId}','role','authenticated')::text, true);
      set local role authenticated;
      begin
        perform public.invite_governing_body_officer('${bodyId}', 's16.review.direct@ovalball.test', 'BODY_ADMIN');
        perform set_config('s16.outcome', 'ALLOWED', false);
      exception when others then
        perform set_config('s16.outcome', 'REFUSED', false);
      end;
      reset role;
    end $$;
    select current_setting('s16.outcome', true)`)
  record("E3 a Viewer's direct attempt to invite is refused by the server, not merely unoffered",
    refused === "REFUSED", refused)
  await vctx.close()

  // ==================================================================
  // F. MOBILE AND ACCESSIBILITY, CHANGED SURFACES ONLY
  // ==================================================================
  const actx = await newContext(browser, { width: 1440, height: 1100 })
  const a = await actx.newPage()
  await signIn(a, OFFICER)
  for (const [label, path] of [
    ["the competition results", `/governing/${bodyId}/competitions/${competitionId}`],
    ["People & Access", `/governing/${bodyId}/people`],
  ]) {
    await go(path, a)
    await a.addScriptTag({ content: axeSource() })
    const violations = await a.evaluate(async () => {
      const results = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
      return results.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, target: x.nodes[0]?.target?.join(" ") ?? "" }))
    })
    recordAxe(`axe: ${label}`, violations)
  }
  // The table is a real table with a caption and header cells, not a grid of divs.
  await go(`/governing/${bodyId}/competitions/${competitionId}`, a)
  const tableShape = await a.evaluate(() => {
    const t = document.querySelector("main table")
    return {
      table: Boolean(t),
      caption: Boolean(t?.querySelector("caption")),
      colHeaders: t?.querySelectorAll('th[scope="col"]').length ?? 0,
      rowHeaders: t?.querySelectorAll('th[scope="row"]').length ?? 0,
    }
  })
  record("F1 the table is a real table, with a caption and column and row headers",
    tableShape.table && tableShape.caption && tableShape.colHeaders >= 6 && tableShape.rowHeaders >= 1,
    JSON.stringify(tableShape))
  await actx.close()

  const small = await newContext(browser, { width: 390, height: 844 })
  const m = await small.newPage()
  await signIn(m, OFFICER)
  for (const [label, path] of [
    ["the competition results", `/governing/${bodyId}/competitions/${competitionId}`],
    ["People & Access", `/governing/${bodyId}/people`],
  ]) {
    await go(path, m)
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`F: ${label} does not overflow at 390px`, overflow <= 0, `${overflow}px over`)
  }
  await small.close()

  const cs = await newContext(browser, { width: 390, height: 844 })
  const cm = await cs.newPage()
  await signIn(cm, clubAdminEmail)
  await go("/fixtures/competitions", cm)
  const clubOverflow = await cm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  record("F: the club's own competitions do not overflow at 390px", clubOverflow <= 0, `${clubOverflow}px over`)
  await cs.close()

  const realErrors = pageErrors.filter((e) => !DEV_INSTRUMENTATION.test(e))
  record("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))
  if (pageErrors.length > realErrors.length) {
    record(`(React dev instrumentation noise filtered: ${pageErrors.length - realErrors.length})`, true)
  }
} finally {
  await browser.close()
  teardown()
}

// ====================================================================
// The review county, its officers and its cup are the owner's review material
// and are untouched. Only this run's invitation is removed.
// ====================================================================
record("cleanup: this run's invitation is gone",
  sql(`select count(*) from public.access_invitations where invited_email_normalised like 's16.review.%'`) === "0")
record("cleanup: the review county's competition is untouched",
  sql(`select count(*) from public.competition_matches m join public.competition_editions e on e.id = m.edition_id
       where e.competition_id = '${competitionId}'`) === "6" &&
    sql(`select count(*) from public.constituent_body_roles where constituent_body_id = '${bodyId}' and state = 'ACTIVE'`) === "3")
record("cleanup: and the entered club is still entered",
  sql(`select count(*) from public.competition_participants p join public.competition_editions e on e.id = p.edition_id
       where e.competition_id = '${competitionId}' and p.club_id = '${enteredClubId}' and p.status = 'entered'`) === "1")

process.exit(summarise() ? 0 : 1)
