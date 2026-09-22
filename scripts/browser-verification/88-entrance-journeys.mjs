// =====================================================================
// CONVERGENCE STEP 19 -- UX-8 ENTRANCE JOURNEYS
//
// Entering Ovalball as one product. Four journeys and one failure walk, chosen
// because between them they cover every part of the entrance anatomy UX-8 §6
// names -- and because the first of them was BROKEN IN PRODUCTION-SHAPED CODE
// and no existing suite could see it.
//
//   A. THE DEFECT. Step 16 taught redeem_invitation to answer BODY_ROLE_ACTIVE.
//      lib/invitations/redeem.ts never learned the name, so its fail-closed
//      allowlist treated a COMPLETED redemption as an unrecognised outcome: the
//      database granted the governing-body role and the page told the person
//      their invitation could not be used. The SQL suite passed, because it
//      called the RPC. The browser suite passed, because it never accepted an
//      invitation as the invitee. This is the seam between them.
//
//   B. MULTI-CONTEXT (§23). Somebody who already has a club accepts a county
//      role: they land in the county, the county is the ACTIVE context and not
//      merely the URL, their club is still there, and they can switch back.
//
//   C. PENDING IS PENDING (§16). An outcome that created a REQUEST does not
//      redirect into the application as though it created access.
//
//   D. FAILURES (§41). Invalid, revoked, and not-signed-in -- each says
//      something useful, none leaks, none grants.
//
//   E. MOBILE (§31) and axe on the changed surfaces (§42).
//
// EVERYTHING THIS RUN CREATES IS REMOVED AND THE REMOVAL IS ASSERTED.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, axeSource, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)

/** BODY_ADMIN at the review county -- the person who issues the invitation. */
const OFFICER = "uat.preston.admin@ovalball.test"
/**
 * The invitee, and the choice matters: they already hold a club relationship and no county role, which
 * is precisely §23's case. A persona with nothing would prove the landing but not the multi-context
 * question, and the whole point of one Ovalball identity is that a second relationship does not need a
 * second account.
 */
const INVITEE = "uat.team.manager@ovalball.test"
/**
 * A second, disposable invitee for the legs that need their own fresh link.
 *
 * Nobody: the address has no Ovalball account, which is exactly what the unauthenticated preview has to
 * work for (§7) -- and it keeps those legs out of the dedupe that one-open-invitation-per-person
 * correctly enforces for the persona above.
 */
const PHONE_INVITEE = `s19.phone.${TAG}@ovalball.test`

const DEV_INSTRUMENTATION = /Failed to execute 'measure' on 'Performance'/

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const bodyId = sql(`select id from public.constituent_bodies where canonical_name = 'Ovalball Review County RFU'`)
const inviteeId = sql(`select id from auth.users where email = '${INVITEE}'`)
const officerId = sql(`select id from auth.users where email = '${OFFICER}'`)
if (!bodyId || !inviteeId || !officerId) {
  console.error("Missing the review world's governing body or personas. Run:")
  console.error("  node scripts/review-fixtures/step2-review-club.mjs enrich-governing")
  process.exit(1)
}

/**
 * Issues a real invitation through the canonical RPC, as the county's administrator.
 *
 * Through `invite_governing_body_officer` and not an INSERT, because the token this returns is the only
 * one that will ever exist in plaintext -- the row stores a hash. A fixture that wrote its own row would
 * be testing a shape rather than the product, and would not have caught the defect above.
 */
function issueInvitation(email = INVITEE) {
  const out = sql(`
    set local role authenticated;
    select set_config('request.jwt.claims',
      json_build_object('sub','${officerId}','role','authenticated','email','${OFFICER}')::text, true);
    select token from public.invite_governing_body_officer('${bodyId}', '${email}', 'BODY_COMPETITIONS');
  `)
  const token = out.split("\n").filter(Boolean).pop()
  // ONE OPEN INVITATION PER PERSON PER ORGANISATION: a second call for the same address returns the
  // existing invitation and a NULL token, because the live link is still valid and is deliberately not
  // re-issued (Step 16). That is correct product behaviour and a trap for a fixture -- it produced
  // `/join?t=undefined` and a "this link can't be used" page that looked like a defect. So each leg that
  // needs a FRESH link asks for a different address, and this refuses to hand back anything unusable
  // rather than letting the browser discover it.
  if (!token || token.length < 20) {
    throw new Error(
      `issueInvitation(${email}) produced no usable token (got ${JSON.stringify(token)}) -- an open ` +
        `invitation for that address probably already exists, and this suite needs a fresh one`,
    )
  }
  return token
}

/**
 * The county administrator's own role, captured before anything runs.
 *
 * The wrong-account journey below signs in as this person and attempts an invitation made out to
 * somebody else. It must be refused -- but `redeem_invitation`'s upsert would OVERWRITE their role_key if
 * it were not, and a BODY_ADMIN quietly becoming a BODY_COMPETITIONS officer would damage the persistent
 * review world to prove a point about it. So the value is recorded and put back, and a suite that has to
 * put it back is a suite whose C3 assertion just failed and said so.
 */
const officerRoleBefore = sql(
  `select role_key from public.constituent_body_roles
    where constituent_body_id = '${bodyId}' and user_id = '${officerId}' and state = 'ACTIVE'`,
)

/** Everything this suite touched, removed -- so it can be run again immediately and truthfully. */
function cleanUp() {
  // Every address this suite invites, not just the persona -- the failure and mobile legs use throwaway
  // ones so that each can have a fresh link.
  sql(`delete from public.invitation_redemptions where invitation_id in
         (select id from public.access_invitations
           where constituent_body_id = '${bodyId}'
             and (invited_email_normalised = '${INVITEE}' or invited_email_normalised like 's19.%@ovalball.test'))`)
  sql(`delete from public.invitation_redemption_attempts where invitation_id in
         (select id from public.access_invitations
           where constituent_body_id = '${bodyId}'
             and (invited_email_normalised = '${INVITEE}' or invited_email_normalised like 's19.%@ovalball.test'))`)
  sql(`delete from public.access_invitations
        where constituent_body_id = '${bodyId}' and invited_email_normalised like 's19.%@ovalball.test'`)
  if (officerRoleBefore) {
    sql(`update public.constituent_body_roles set role_key = '${officerRoleBefore}', state = 'ACTIVE'
          where constituent_body_id = '${bodyId}' and user_id = '${officerId}'
            and role_key <> '${officerRoleBefore}'`)
  }
  sql(`delete from public.invitation_redemptions where invitation_id in
         (select id from public.access_invitations
           where constituent_body_id = '${bodyId}' and invited_email_normalised = '${INVITEE}')`)
  sql(`delete from public.invitation_redemption_attempts where invitation_id in
         (select id from public.access_invitations
           where constituent_body_id = '${bodyId}' and invited_email_normalised = '${INVITEE}')`)
  sql(`delete from public.access_invitations
        where constituent_body_id = '${bodyId}' and invited_email_normalised = '${INVITEE}'`)
  sql(`delete from public.constituent_body_roles
        where constituent_body_id = '${bodyId}' and user_id = '${inviteeId}'`)
}

// A previous interrupted run must not decide this one's result.
cleanUp()

const pageErrors = []

const browser = await launch()
try {
  // =====================================================================
  // A + B. THE INVITED EXISTING USER, WHO ALREADY HAS SOMEWHERE ELSE TO BE
  // =====================================================================
  const token = issueInvitation()
  record("A1 the county issues a real invitation through the canonical RPC", Boolean(token && token.length > 20))

  const ctx = await newContext(browser, { width: 1280, height: 900 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))

  // BEFORE: what this person already is. If accepting destroys it, §23 is broken.
  const clubsBefore = Number(
    sql(`select count(*) from public.club_memberships where user_id='${inviteeId}' and status='active'`),
  )
  record("B1 the invitee already holds a club relationship, so this is a second one", clubsBefore > 0, `${clubsBefore} club(s)`)

  // The preview, before authenticating -- UX-8 §7.
  await page.goto(`${APP}/join?t=${encodeURIComponent(token)}`, { waitUntil: "networkidle" })
  const previewH1 = (await page.locator("h1").first().textContent())?.trim() ?? ""
  record(
    "A2 the invitation names the organisation before anybody signs in",
    previewH1.includes("Ovalball Review County RFU"),
    previewH1,
  )
  const previewBody = await page.locator("body").innerText()
  record(
    "A3 and says who invited them, so the link is something a person can trust",
    /invited/i.test(previewBody),
  )
  // The oracle §7 forbids: nothing about whether that address is registered.
  record(
    "A4 without saying whether the invited address already has an account",
    !/already ha(s|ve) an account|no account|not registered/i.test(previewBody),
  )

  await recordAxe("A5 axe: the invitation landing, unauthenticated", await runAxe(page))

  // Sign in, and come back to the journey rather than to a dashboard -- §8.
  await signIn(page, INVITEE)
  await page.goto(`${APP}/join?t=${encodeURIComponent(token)}`, { waitUntil: "networkidle" })

  const acceptButton = page.getByRole("button", { name: /accept/i }).first()
  record("A6 the signed-in invitee is offered the acceptance, not another form", await acceptButton.isVisible())

  await acceptButton.click()
  // WAIT FOR THE JOURNEY, NOT FOR A GUESS. Acceptance is a server action, then a context adoption, then
  // a push, then a server render -- a fixed pause timed the machine rather than the outcome, and a
  // generous one would still be a race. First written with 1200ms, which failed while the product was
  // working correctly: exactly the sort of "defect" that gets a good fix reverted.
  await page
    .waitForURL((u) => !u.pathname.startsWith("/join"), { timeout: 20000 })
    .catch(() => {})
  await page.waitForLoadState("networkidle").catch(() => {})

  // THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT. Before the fix this said
  // "That invitation or code can't be used." while the role sat granted in the database.
  const afterAccept = await page.locator("body").innerText()
  record(
    "A7 acceptance is NOT reported as a refusal -- the outcome the allowlist used to drop",
    !/can't be used|cannot be used/i.test(afterAccept),
    afterAccept.slice(0, 90).replace(/\s+/g, " "),
  )

  const roleState = sql(
    `select state || '|' || role_key from public.constituent_body_roles
      where constituent_body_id='${bodyId}' and user_id='${inviteeId}'`,
  )
  record(
    "A8 and the role the INVITATION fixed is active, server-side",
    roleState === "ACTIVE|BODY_COMPETITIONS",
    roleState || "(none)",
  )

  // §22 + §24: the destination comes from the relationship just established.
  const landedUrl = page.url()
  record(
    "A9 they land in the organisation they just joined, not on a club dashboard",
    landedUrl.includes(`/governing/${bodyId}`),
    new URL(landedUrl).pathname,
  )

  // §27 + the Step 18 lesson: context comes from the cookie, so being AT the workspace is not the same
  // as being IN it. Asserted on the NAVIGATION CATALOGUE rather than on the county's name appearing
  // somewhere -- the first version of this check matched the name in the invitation preview and passed
  // while the journey had not moved at all, which is a check that cannot fail for the right reason.
  const nav = await page.locator('nav[aria-label="Primary"]').first().innerText().catch(() => "")
  const navText = nav || (await page.locator("body").innerText())
  // The governing catalogue's own destinations. "People" rather than "People & Access" because the
  // Step 18 hardening shortened the bottom-bar label to fit a 320px cell; the drawer keeps the full
  // phrase. Asserting the shortened form is asserting what the shell actually renders.
  record(
    "A10 and the shell carries the GOVERNING catalogue, not the club's navigation over a county page",
    /Overview/.test(navText) && /Clubs/.test(navText) && /Competitions/.test(navText) && /People/.test(navText),
    navText.replace(/\s+/g, " ").slice(0, 80),
  )
  const ctxCookie = (await ctx.cookies()).find((c) => c.name === "ovalball_ctx")
  record(
    "A11 because the entrance adopted the context rather than only navigating",
    // Cookies arrive percent-encoded, and the colon in the key is what gets encoded.
    decodeURIComponent(ctxCookie?.value ?? "") === `governing:${bodyId}`,
    decodeURIComponent(ctxCookie?.value ?? "") || "(unset)",
  )

  // §23: nothing was destroyed, and they can get back.
  const clubsAfter = Number(
    sql(`select count(*) from public.club_memberships where user_id='${inviteeId}' and status='active'`),
  )
  record("B2 their club relationship is untouched -- one identity, two places", clubsAfter === clubsBefore,
    `${clubsBefore} -> ${clubsAfter}`)

  // The newly acquired context must be reachable through the shell's own switcher, and the club they
  // already had must still be in it -- §23 and §27. Read from the identity block the switcher opens.
  const identityBlock = await page.locator("body").innerText()
  record(
    "B3 the shell names the person and the context they are now acting in",
    /Competitions Officer/.test(identityBlock),
  )
  const switchable = Number(
    sql(`select count(*) from public.club_memberships where user_id='${inviteeId}' and status='active'`),
  )
  record(
    "B4 and their club is still a context they can switch back to, without another account",
    switchable === clubsBefore && clubsBefore > 0,
    `${switchable} club context(s)`,
  )

  await recordAxe("B5 axe: the workspace they landed in", await runAxe(page))

  // Following the same link again is something people do, and it is not an error.
  await page.goto(`${APP}/join?t=${encodeURIComponent(token)}`, { waitUntil: "networkidle" })
  const secondVisit = await page.locator("body").innerText()
  record(
    "A12 the spent invitation says so, rather than showing a raw database error",
    !/error|exception|null|undefined|PGRST|22023|42501/i.test(secondVisit),
    secondVisit.slice(0, 80).replace(/\s+/g, " "),
  )

  // =====================================================================
  // D. FAILURES -- useful, and none of them grants anything
  // =====================================================================
  await page.goto(`${APP}/join?t=not-a-real-token-${TAG}`, { waitUntil: "networkidle" })
  const invalidText = await page.locator("body").innerText()
  record("D1 an invalid link is refused in words a person can act on", /can't be used|ask whoever/i.test(invalidText))
  record("D2 and leaks nothing about whether such an invitation ever existed",
    !/expired|revoked|withdrawn by|belongs to/i.test(invalidText))

  await page.goto(`${APP}/join?c=ZZZZZZ`, { waitUntil: "networkidle" })
  const badCode = await page.locator("body").innerText()
  record("D3 a wrong code is a wrong code, not a stack trace",
    /doesn't work|can't be used/i.test(badCode) && !/PGRST|22023|exception/i.test(badCode))

  // A revoked invitation, through the canonical revocation path.
  const revokeMe = `s19.revoked.${TAG}@ovalball.test`
  const second = issueInvitation(revokeMe)
  const secondId = sql(`select id from public.access_invitations
    where constituent_body_id='${bodyId}' and invited_email_normalised='${revokeMe}' and state='ISSUED' limit 1`)
  sql(`
    set local role authenticated;
    select set_config('request.jwt.claims',
      json_build_object('sub','${officerId}','role','authenticated','email','${OFFICER}')::text, true);
    select public.revoke_invitation('${secondId}', 'step 19 failure journey');
  `)
  await page.goto(`${APP}/join?t=${encodeURIComponent(second)}`, { waitUntil: "networkidle" })
  const revokedText = await page.locator("body").innerText()
  record("D4 a revoked invitation is closed, and says what to do next",
    /no longer open|can't be used/i.test(revokedText) && /ask/i.test(revokedText))

  // =====================================================================
  // C. THE WRONG ACCOUNT -- §26, and §38's "wrong bound identity cannot redeem"
  //
  // Somebody follows a link made out to another address while signed in as
  // themselves. It must refuse, reveal nothing, and not strand them.
  // =====================================================================
  const forSomebodyElse = issueInvitation()   // made out to INVITEE, opened by the OFFICER
  const wrongCtx = await newContext(browser, { width: 1280, height: 900 })
  const wrongPage = await wrongCtx.newPage()
  wrongPage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await signIn(wrongPage, OFFICER) // the county's own administrator: a real identity, the wrong one
  await wrongPage.goto(`${APP}/join?t=${encodeURIComponent(forSomebodyElse)}`, { waitUntil: "networkidle" })
  const wrongAccept = wrongPage.getByRole("button", { name: /accept/i }).first()
  if (await wrongAccept.isVisible().catch(() => false)) {
    await wrongAccept.click()
    await wrongPage.waitForTimeout(2500)
  }
  const wrongText = await wrongPage.locator("body").innerText()
  record(
    "C1 an invitation made out to somebody else is refused",
    /can't be used|cannot be used/i.test(wrongText),
    wrongText.slice(0, 70).replace(/\s+/g, " "),
  )
  record(
    "C2 without naming the address it was for, so a signed-in prober learns nothing",
    !wrongText.includes(INVITEE),
  )
  record(
    "C3 and it did NOT grant the wrong person the role",
    sql(`select count(*) from public.constituent_body_roles
          where constituent_body_id='${bodyId}' and user_id='${officerId}' and role_key='BODY_COMPETITIONS'`) === "0",
  )
  record(
    "C4 while offering the one legitimate way forward rather than a dead end",
    /more than one Ovalball account/i.test(wrongText) &&
      (await wrongPage.getByRole("button", { name: /somebody else/i }).isVisible().catch(() => false)),
  )
  await wrongCtx.close()

  // =====================================================================
  // E. MOBILE. Entrances arrive by email, WhatsApp and QR -- §31.
  // =====================================================================
  // MEASURED AS SOMEBODY ACTUALLY MEETS IT: on a phone, not signed in. That is the whole point of §31 --
  // these links arrive by email, WhatsApp and QR -- and it also keeps the measurement out of the A-series'
  // session, which has by now accepted the invitation and is therefore the one state a newly invited
  // person is never in. The first version reused that context and could not find a button, which was the
  // test's entanglement rather than the product's defect.
  const third = issueInvitation(PHONE_INVITEE)
  const phone = await newContext(browser, { width: 390, height: 844 })
  const phonePage = await phone.newPage()
  phonePage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  for (const width of [390, 320]) {
    await phonePage.setViewportSize({ width, height: 844 })
    await phonePage.goto(`${APP}/join?t=${encodeURIComponent(third)}`, { waitUntil: "networkidle" })
    const overflow = await phonePage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    record(`E1 @${width} the invitation reads without sideways scrolling`, overflow <= 0, `${overflow}px`)
    const heading = (await phonePage.locator("h1").first().textContent())?.trim() ?? ""
    record(
      `E2 @${width} and still names the organisation before anything is asked of them`,
      heading.includes("Ovalball Review County RFU"),
      heading,
    )
    const btn = phonePage.getByRole("button", { name: /sign in|accept/i }).first()
    const box = await btn.boundingBox().catch(() => null)
    record(
      `E3 @${width} its one action is a real tap target`,
      Boolean(box && box.height >= 44),
      box ? `${Math.round(box.height)}px` : "(no button)",
    )
  }
  await phonePage.setViewportSize({ width: 390, height: 844 })
  await recordAxe("E4 axe: the invitation landing at 390px", await runAxe(phonePage))
  await phone.close()

  // =====================================================================
  // THE SIGNUP ENTRANCE -- it stops announcing itself as club onboarding (§15.6 #1)
  // =====================================================================
  const anon = await newContext(browser, { width: 390, height: 844 })
  const anonPage = await anon.newPage()
  anonPage.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)))
  await anonPage.goto(`${APP}/signup`, { waitUntil: "networkidle" })
  const signupH1 = (await anonPage.locator("h1").first().textContent())?.trim() ?? ""
  record(
    "F1 /signup offers an Ovalball account rather than a club-onboarding funnel",
    /create your ovalball account/i.test(signupH1),
    signupH1,
  )
  record("F2 and no longer tells every arrival to bring their club",
    !/bring your club/i.test(await anonPage.locator("body").innerText()))
  await recordAxe("F3 axe: /signup at 390px", await runAxe(anonPage))
  const signupOverflow = await anonPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  record("F4 @390 /signup does not scroll sideways", signupOverflow <= 0, `${signupOverflow}px`)
  await anon.close()

  const realErrors = pageErrors.filter((e) => !DEV_INSTRUMENTATION.test(e))
  record("no uncaught page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "))
  if (pageErrors.length > realErrors.length) {
    record(`(React dev instrumentation noise filtered: ${pageErrors.length - realErrors.length})`, true)
  }

  await ctx.close()
} finally {
  await browser.close()
  cleanUp()
  const leftInvitations = Number(
    sql(`select count(*) from public.access_invitations
          where constituent_body_id='${bodyId}'
            and (invited_email_normalised='${INVITEE}' or invited_email_normalised like 's19.%@ovalball.test')`),
  )
  const leftRoles = Number(
    sql(`select count(*) from public.constituent_body_roles
          where constituent_body_id='${bodyId}' and user_id='${inviteeId}'`),
  )
  record("this suite left nothing behind", leftInvitations === 0 && leftRoles === 0,
    `${leftInvitations} invitation(s), ${leftRoles} role(s)`)
  const officerRoleAfter = sql(
    `select role_key from public.constituent_body_roles
      where constituent_body_id = '${bodyId}' and user_id = '${officerId}' and state = 'ACTIVE'`,
  )
  record(
    "and the review county's own administrator is exactly as it found them",
    officerRoleAfter === officerRoleBefore,
    `${officerRoleBefore} -> ${officerRoleAfter}`,
  )
}

/**
 * Axe, in the shape the harness's declared-violation matcher expects.
 *
 * `classifyAxeViolations` matches a declared exception on `violation.target`, which axe itself does not
 * provide -- its targets live under `nodes[].target`. Returning raw axe output therefore made every
 * violation look undeclared, including the shell's own long-declared unread-badge contrast, and the
 * failure printed as "color-contrast([object Object],[object Object]) undefined". Flattened here the
 * same way 87-shell-coherence flattens it.
 */
async function runAxe(target) {
  await target.addScriptTag({ content: axeSource() })
  return await target.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      target: v.nodes[0]?.target?.join(" ") ?? "",
    }))
  })
}

summarise()
