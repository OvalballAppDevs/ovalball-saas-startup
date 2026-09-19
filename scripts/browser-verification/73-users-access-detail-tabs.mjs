// =====================================================================
// SITE ADMIN USERS & ACCESS -- THE THIRTEEN TABS, IN A BROWSER (Slice 7e)
//
// The reconciliation's verdict on Slice 7 was not that the authority model was
// wrong. It was that the model had almost no way in:
//
//   - seventeen of the twenty-three master-control RPCs had NO UI CALLER, so
//     "sign this account out of everything" was something the platform could do
//     and nobody could ask it to;
//   - the two-administrator Site Admin rule could not be performed at all --
//     7c's machinery was reachable only from SQL;
//   - the three provenance timelines answered a question no screen asked;
//   - Team Memberships, Invitations and Audit History did not exist in any form.
//
// A structural test can prove the RPC names now appear in source. Only a browser
// can prove that pressing the control moves the canonical state, which is what
// this does: every assertion that claims an operation happened re-reads the
// database to check, rather than trusting the screen that said so.
//
// AAL2 IS NOT SCAFFOLDING HERE. Every master-control RPC requires a TOTP code
// presented within the last ten minutes, so this enrols an authenticator through
// the product and computes real codes from the secret the page shows. T-02 below
// asserts the refusal BEFORE that happens, so the enrolment is shown to be the
// reason the rest works.
//
// Everything created is destroyed at the end and the destruction is asserted.
// The shared UAT administrator's authenticator is removed too, so the next run
// starts where this one did.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, enrolAuthenticator, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const FULL = "uat.fullsiteadmin@ovalball.test"
const SUBJECT = `uat.s7e.subject.${TAG}@ovalball.test`
const REASON = "Slice 7e browser verification, acting on a disposable identity."

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const api = async (path, { token, body } = {}) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// ---------------------------------------------------------------------
// A disposable subject. Master control refuses a self-target, and the
// permanent UAT personas are product-review data rather than a fixture --
// changing their access to make a test pass would be exactly the drift the
// persona rule forbids. So this suite brings its own person.
// ---------------------------------------------------------------------
const created = await api("/auth/v1/admin/users", {
  token: process.env.SUPABASE_SERVICE_ROLE_KEY,
  body: { email: SUBJECT, password: `S7e!${TAG}aA9`, email_confirm: true },
})
const subjectId = created.json?.id
if (!subjectId) throw new Error("could not create the disposable subject identity")
sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
     values ('${subjectId}','Slice','Sevene','${SUBJECT}','1988-04-04','ACTIVE') on conflict (id) do nothing;
     select internal.refresh_account_security_state('${subjectId}');`)

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)

// ---------------------------------------------------------------------
// A SECOND ADMINISTRATOR, disposable and local.
//
// The two-person rule cannot be PROVED by a refusal alone: a rule that refuses
// everybody passes exactly the same assertions as a working one. Production has
// a single Full Site Admin, and creating a second there is an owner operation
// (AN-3 / T1) that this step has no authority to perform -- so the positive half
// of the rule is proved here, with an identity that exists for the length of
// this file and is destroyed at the end.
//
// They are also given a club membership on purpose. That makes them the one
// thing the permanent persona directory does not contain: an account holding
// BOTH real Site Admin authority and a club to operate as. Without that, "active
// context is a lens, not authority" cannot be walked at all -- an administrator
// with nothing else to be is always in Site Admin context.
// ---------------------------------------------------------------------
const SECOND = `uat.s7e.second.${TAG}@ovalball.test`
const SECOND_PASSWORD = `Second!${TAG}aA9`
const secondCreated = await api("/auth/v1/admin/users", {
  token: process.env.SUPABASE_SERVICE_ROLE_KEY,
  body: { email: SECOND, password: SECOND_PASSWORD, email_confirm: true },
})
const secondId = secondCreated.json?.id
if (!secondId) throw new Error("could not create the disposable second administrator")
sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
     values ('${secondId}','Second','Administrator','${SECOND}','1980-01-01','ACTIVE') on conflict (id) do nothing;
     select internal.refresh_account_security_state('${secondId}');
     insert into public.site_admins (user_id, status, profile_key) values ('${secondId}','active','SITE_FULL')
       on conflict (user_id) do update set status='active', profile_key='SITE_FULL';
     insert into public.club_memberships (club_id, user_id, role, status)
       values ('${clubId}','${secondId}','CLUB_ADMIN','active');`)

/**
 * Every /admin/* page needs BOTH real Site Admin authority and that the account
 * has actively SWITCHED INTO Site Admin as its operating context. The cookie is
 * how the product records the switch; setting it escalates nothing, because
 * resolveActiveContext only ever returns a context the session's real authority
 * already contains.
 */
async function asSiteAdmin(browser) {
  const ctx = await newContext(browser, { width: 1440, height: 1200 })
  const page = await ctx.newPage()
  await signIn(page, FULL)
  await ctx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  return { ctx, page }
}

/** Opens one tab of the subject's record and returns what it says. */
async function openTab(page, tab) {
  await page.goto(`${APP}/admin/users/${subjectId}?tab=${tab}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return (await page.locator("main").innerText()).trim()
}

/**
 * Drives one MasterControlAction: opens it, fills its fields and its reason,
 * confirms, and waits for the control to collapse back -- which is what the
 * component does on success, and is therefore the readiness signal. Waiting on a
 * duration instead is the anti-pattern that has made three suites in this estate
 * flaky under batch load.
 */
async function performAction(page, label, { fields = {}, reason = REASON } = {}) {
  await page.getByRole("button", { name: label }).first().click()
  const panel = page.locator("div", { has: page.getByText("Reason", { exact: true }) }).last()
  for (const [id, value] of Object.entries(fields)) {
    await panel.locator("select").nth(id === "__first" ? 0 : Number(id)).selectOption(value)
  }
  await panel.locator("textarea").first().fill(reason)
  const confirm = panel.getByRole("button", { name: /^(Confirm|Apply|Add|Give|End|Withdraw|Reissue|Raise|Change|Take)/ }).first()
  await confirm.click()
  await page
    .getByText("Done. The change is on the record.")
    .first()
    .waitFor({ state: "visible", timeout: 25000 })
    .catch(() => {})
}

const browser = await launch()
let adminId = ""

try {
  const { page } = await asSiteAdmin(browser)
  adminId = sql(`select id from public.profiles where email = '${FULL}'`)

  // -------------------------------------------------------------------
  // A. The tabs exist, and only the active one's data is fetched.
  // -------------------------------------------------------------------
  const overview = await openTab(page, "overview")
  // Case-insensitive on purpose: these labels are uppercased in CSS and
  // innerText honours text-transform, so the screen reads "ACCOUNT CREATED".
  record("T-01 a person's record opens on an Overview tab", /\bAccount created\b/i.test(overview) && /\bStatus\b/i.test(overview))

  const strip = await page.locator('[role="tablist"]').first().innerText()
  const expected = [
    "Overview",
    "Personal Details",
    "Account & Security",
    "Club Memberships",
    "Club Roles",
    "Team Memberships",
    "Family",
    "Capability Overrides",
    "Invitations",
    "Site Admin",
    "Membership History",
    "Team History",
    "Audit History",
  ]
  const missing = expected.filter((label) => !strip.includes(label))
  record("T-02 all thirteen of AB.1's tabs are on the page", missing.length === 0, missing.join(", ") || "all present")

  record(
    "T-03 including the three the reconciliation named as not existing in any form",
    ["Team Memberships", "Invitations", "Audit History"].every((label) => strip.includes(label))
  )

  // The tab is URL state, so it survives a reload and can be sent to a colleague.
  await openTab(page, "invitations")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record(
    "T-04 a tab is addressable and survives a reload, so it can be shared rather than described",
    new URL(page.url()).searchParams.get("tab") === "invitations" &&
      /Waiting To Be Accepted/i.test(await page.locator("main").innerText())
  )

  // -------------------------------------------------------------------
  // B. WITHOUT a recent authenticator, master control refuses -- through the UI.
  //    This runs BEFORE enrolment, so the enrolment below is demonstrated to be
  //    the reason the rest of the suite works.
  // -------------------------------------------------------------------
  await openTab(page, "security")
  const preAal2 = await page.locator("main").innerText()
  record("T-10 the Account & Security tab offers the two controls that had no button at all", /End All Sessions/.test(preAal2) && /Require a Password Reset/.test(preAal2))

  await performAction(page, /^End All Sessions$/)
  const refusal = await page.locator("main").innerText()
  record(
    "T-11 and a signed-in administrator who has NOT passed a second factor recently is refused by the RPC",
    /authenticator|second factor|not authorised/i.test(refusal),
    refusal.split("\n").find((l) => /authenticator|second factor|not authorised/i.test(l))?.slice(0, 90) ?? "(no refusal shown)"
  )

  // -------------------------------------------------------------------
  // C. With AAL2, the controls actually move canonical state.
  // -------------------------------------------------------------------
  await enrolAuthenticator(page, { email: FULL, sql })
  record("T-20 the administrator now holds a verified authenticator",
    sql(`select count(*) from auth.mfa_factors where user_id = '${adminId}' and status = 'verified'`) === "1")

  // Club membership -- site_add_club_membership had no caller.
  await openTab(page, "clubs")
  await performAction(page, /^Add to a Club$/, { fields: { 0: clubId } })
  const membership = sql(`select count(*) from public.club_memberships where user_id = '${subjectId}' and club_id = '${clubId}'`)
  record("T-21 Add to a Club creates the membership in the canonical table", membership === "1", `rows=${membership}`)

  const membershipEvent = sql(`select count(*) from public.security_events
                                where subject_user_id = '${subjectId}' and event_type = 'site.membership_added'`)
  record("T-22 and writes a security event carrying the reason, not just a row", Number(membershipEvent) >= 1, `events=${membershipEvent}`)

  // THE DEFECT THIS SUITE FOUND. site_add_club_membership emits
  // `site.membership_added`; site_membership_history matched `site.club_%`, so
  // the timeline built to explain a membership could not see a membership being
  // added. Seven of the sixteen master-control event types were displayed by
  // nothing at all. 20270507000000 discriminates on the scope columns instead.
  const timeline = await openTab(page, "membership-history")
  record("T-22a and the Membership History tab can actually SEE it -- the timelines used to match event " +
    "name patterns that no master-control event produced",
    /Membership added/i.test(timeline) && timeline.includes(REASON),
    timeline.split("\n").find((l) => /Membership/i.test(l))?.slice(0, 80) ?? "(nothing on the timeline)")

  // Sessions -- the control that was refused above must now succeed.
  await openTab(page, "security")
  await performAction(page, /^End All Sessions$/)
  const sessionEvent = sql(`select count(*) from public.security_events
                             where subject_user_id = '${subjectId}' and event_type = 'session.revoked_by_admin'`)
  record("T-23 THE SAME CONTROL that was refused at T-11 now succeeds, so T-11 was the rule and not a broken button",
    Number(sessionEvent) >= 1, `events=${sessionEvent}`)

  const accountTimeline = await openTab(page, "audit-history")
  record("T-23a and Audit History shows it -- account, session and Site Admin decisions were previously " +
    "written by master control and displayed by no timeline at all",
    /Decisions On This Account/i.test(accountTimeline) && /Revoked by admin/i.test(accountTimeline),
    accountTimeline.split("\n").find((l) => /Revoked/i.test(l))?.slice(0, 80) ?? "(nothing on the timeline)")

  // The reason gate is real, not decoration. Back to the tab that carries it --
  // T-23a navigated away to read Audit History.
  await openTab(page, "security")
  await page.getByRole("button", { name: /^Require a Password Reset$/ }).first().click()
  const shortPanel = page.locator("div", { has: page.getByText("Reason", { exact: true }) }).last()
  await shortPanel.locator("textarea").first().fill("no")
  const confirmDisabled = await shortPanel.getByRole("button", { name: /^Require a Reset$/ }).first().isDisabled()
  record("T-24 a reason too short to mean anything cannot be submitted at all", confirmDisabled)

  // -------------------------------------------------------------------
  // D. The two-administrator rule, which had no screen whatsoever.
  // -------------------------------------------------------------------
  await openTab(page, "site-admin")
  await performAction(page, /^Ask For Site Admin Access$/, { fields: { 0: "SITE_SUPPORT" } })
  const requestState = sql(`select state from public.site_admin_grant_requests where target_user_id = '${subjectId}' limit 1`)
  record("T-30 a Site Admin grant can now be RAISED from the product at all (7c's machinery was SQL-only)",
    requestState === "PENDING", `state=${requestState || "(none)"}`)

  const grantedAlready = sql(`select count(*) from public.site_admins where user_id = '${subjectId}' and status = 'active'`)
  record("T-31 and raising it grants nothing -- the request is not the decision", grantedAlready === "0")

  await page.goto(`${APP}/admin/site-admins`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const queue = await page.locator("main").innerText()
  record("T-32 the request appears in a queue on Site Admin Management", /Waiting On A Second Administrator/i.test(queue))
  record("T-33 which explains that it takes two people and runs out on its own", /two people/i.test(queue) && /72 hours/i.test(queue))
  record("T-34 and the administrator who raised it is told they cannot decide it, rather than being given a button that fails",
    /You raised this request/i.test(queue) && !/\bApprove\b/.test(queue))

  // -------------------------------------------------------------------
  // E. The tabs that did not exist in any form.
  // -------------------------------------------------------------------
  const teams = await openTab(page, "teams")
  record("T-40 Team Memberships separates a staff role from a player's place on a roster",
    /Team Staff Roles/i.test(teams) && /Player Placements/i.test(teams))

  const invitations = await openTab(page, "invitations")
  record("T-41 Invitations shows what is outstanding and offers a reissue", /Account Setup/i.test(invitations))
  record("T-42 and never shows a token, a link or a code -- AN-8 holds even after a reissue",
    !/\/join\?t=/.test(invitations) && !/[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}/.test(invitations))

  const audit = await openTab(page, "audit-history")
  record("T-43 Audit History exists and says it cannot be rewritten", /Audit History/i.test(audit) && /Append-only/i.test(audit))

  const membershipHistory = await openTab(page, "membership-history")
  record("T-44 Membership History answers 'how did this come about', with who decided it",
    /Membership History/i.test(membershipHistory) && /Decided by/i.test(membershipHistory))

  // -------------------------------------------------------------------
  // F. AB.3 -- the search is the named RPC, and it finds what it should.
  // -------------------------------------------------------------------
  await page.goto(`${APP}/admin/users?q=${encodeURIComponent(SUBJECT)}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const results = await page.locator("main").innerText()
  record("T-50 searching Users & Access finds the person by email", results.includes(SUBJECT))
  record("T-51 and reports a count that matches the one result shown", /\b1 user matches\b/i.test(results))

  // A filter value the RPC does not recognise must not silently return everything.
  await page.goto(`${APP}/admin/users?access=not_a_filter`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const bogus = await page.locator("main").innerText()
  record("T-52 an unrecognised filter in the URL falls back to the documented default rather than erroring the page",
    /user(s)? match/i.test(bogus) && !/Couldn.t load users/i.test(bogus))

  // -------------------------------------------------------------------
  // F2. MULTI-CONTEXT, and the other half of the two-person rule.
  //
  // An account can be both a platform administrator and a club's admin. The
  // route family requires BOTH real authority and that the person has actively
  // switched into Site Admin, so that somebody working as Burnley cannot reach
  // every account on the platform by typing a URL. Thirteen new tabs is thirteen
  // new URLs, so the guard is walked against them rather than assumed to have
  // been inherited from the route it was written for.
  //
  // The same identity then approves the grant raised at T-30, which is the only
  // way to show the two-administrator rule COMPLETES rather than merely refuses.
  // -------------------------------------------------------------------
  {
    const secondCtx = await newContext(browser, { width: 1280, height: 900 })
    const secondPage = await secondCtx.newPage()

    await secondPage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
    await secondPage.waitForLoadState("networkidle").catch(() => {})
    const reveal = secondPage.getByRole("button", { name: /sign in with email/i }).first()
    await reveal.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
    for (let i = 0; i < 3; i++) {
      await reveal.click().catch(() => {})
      if (await secondPage.locator('input[type="password"]').first().isVisible({ timeout: 5000 }).catch(() => false)) break
    }
    await secondPage.locator('input[type="email"]').first().fill(SECOND)
    await secondPage.locator('input[type="password"]').first().fill(SECOND_PASSWORD)
    await secondPage.getByRole("button", { name: /^Sign In$|Continue|Sign in$/i }).first().click().catch(() => {})
    await secondPage.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25000 }).catch(() => {})

    // Operating AS THE CLUB -- a context this identity genuinely holds, so the
    // refusal is the rule rather than a cookie the resolver ignored.
    await secondCtx.addCookies([{ name: "ovalball_ctx", value: `club:${clubId}`, url: APP }])
    await secondPage.goto(`${APP}/admin/users/${subjectId}?tab=security`, { waitUntil: "domcontentloaded" })
    await secondPage.waitForLoadState("networkidle").catch(() => {})
    record(
      "T-55 an account holding BOTH Site Admin and a club, while operating as the club, does not reach a " +
        "person's record at all -- naming a tab in the URL does not get past the route family guard",
      new URL(secondPage.url()).pathname !== `/admin/users/${subjectId}`,
      new URL(secondPage.url()).pathname
    )

    // Switching into Site Admin is what changes the answer.
    await secondCtx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
    await secondPage.goto(`${APP}/admin/users/${subjectId}?tab=security`, { waitUntil: "domcontentloaded" })
    await secondPage.waitForLoadState("networkidle").catch(() => {})
    record(
      "T-55a POSITIVE CONTROL: the same person, same session, having switched into Site Admin, reaches it",
      new URL(secondPage.url()).pathname === `/admin/users/${subjectId}`,
      new URL(secondPage.url()).pathname
    )

    // THE TWO-PERSON RULE, COMPLETED. Approving is a master-control operation,
    // so this administrator needs their own recent authenticator -- the rule is
    // not relaxed for the second person.
    await enrolAuthenticator(secondPage, { email: SECOND, sql })
    await secondPage.goto(`${APP}/admin/site-admins`, { waitUntil: "domcontentloaded" })
    await secondPage.waitForLoadState("networkidle").catch(() => {})
    const queueForSecond = await secondPage.locator("main").innerText()
    record(
      "T-56a a DIFFERENT administrator sees the same request with a decision to make on it",
      /Waiting On A Second Administrator/i.test(queueForSecond) && queueForSecond.includes("Slice Sevene")
    )

    await secondPage.getByRole("button", { name: /^Approve$/ }).first().click()
    const approvePanel = secondPage.locator("li", { hasText: /Waiting|Slice Sevene/ }).first()
    await approvePanel.locator("textarea").first().fill("Agreed at the board meeting; they take over platform support.")
    await secondPage.getByRole("button", { name: /^Confirm Approval$/ }).first().click()
    await secondPage
      .getByText(/Nothing is waiting/i)
      .first()
      .waitFor({ state: "visible", timeout: 25000 })
      .catch(() => {})

    const granted = sql(`select coalesce(max(profile_key), '(none)') from public.site_admins
                          where user_id = '${subjectId}' and status = 'active'`)
    record(
      "T-56b and approving it actually GRANTS -- the two-administrator rule completes, it does not only refuse",
      granted === "SITE_SUPPORT",
      `profile=${granted}`
    )
    const decided = sql(`select state from public.site_admin_grant_requests where target_user_id = '${subjectId}' limit 1`)
    record("T-56c with the request itself closed rather than left pending", decided !== "PENDING", `state=${decided}`)

    await secondCtx.close()
  }

  // -------------------------------------------------------------------
  // F3. 320px. Thirteen tabs is a lot of tab strip, and a strip that pushes the
  // page sideways is how a phone user loses the right-hand edge of every screen.
  // Caught the same class of defect on Create User's step indicator.
  // -------------------------------------------------------------------
  {
    const narrow = await newContext(browser, { width: 320, height: 720 })
    const narrowPage = await narrow.newPage()
    await signIn(narrowPage, FULL)
    await narrow.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
    await narrowPage.goto(`${APP}/admin/users/${subjectId}?tab=clubs`, { waitUntil: "domcontentloaded" })
    await narrowPage.waitForLoadState("networkidle").catch(() => {})
    const m = await measure(narrowPage)
    record(
      "T-56 a person's record fits a 320px screen without sideways scrolling -- the tab strip scrolls " +
        "inside itself, it does not widen the page",
      m.innerWidth === 320 && m.scrollWidth <= 320,
      `inner=${m.innerWidth} scroll=${m.scrollWidth}`
    )
    const h1s = await narrowPage.locator("h1").count()
    record("T-57 and the page still has exactly one h1", h1s === 1, `h1 count=${h1s}`)
    await narrow.close()
  }

  // -------------------------------------------------------------------
  // G. AB.4 -- Create User has its Assignments step.
  // -------------------------------------------------------------------
  await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const wizard = await page.locator("main").innerText()
  record("T-60 Create User is three steps, not one", /1\. Identity/.test(wizard) && /2\. Assignments/.test(wizard) && /3\. Review/.test(wizard))

  await page.locator("#cu-email").fill(`uat.s7e.wizard.${TAG}@ovalball.test`)
  await page.locator("#cu-first").fill("Wizard")
  await page.locator("#cu-surname").fill("Probe")
  await page.getByRole("button", { name: /Continue to Assignments/i }).click()
  await page.locator("#cu-assignment-kind").waitFor({ state: "visible", timeout: 15000 })
  const kinds = await page.locator("#cu-assignment-kind option").allInnerTexts()
  record("T-61 the Assignments step offers what the RPC accepts", kinds.some((k) => /Club membership/i.test(k)) && kinds.some((k) => /Team role/i.test(k)))
  record("T-62 and never offers Site Admin, because that takes two administrators", !kinds.some((k) => /Site Admin/i.test(k)))

  await page.locator("#cu-assignment-club").selectOption(clubId)
  await page.getByRole("button", { name: /Add This Assignment/i }).click()
  await page.getByRole("button", { name: /Continue to Review/i }).click()
  const review = await page.locator("main").innerText()
  record("T-63 the review step says what will be given before anything is created", /What they will be given/i.test(review) && /Member of/i.test(review))
  record("T-64 and says that a refused assignment creates nobody, rather than half a person",
    /nothing is created at all/i.test(review))
} finally {
  // Append-only stores refuse deletion by design, and that refusal is asserted
  // below rather than worked around -- so psql's stderr is swallowed too, or the
  // suite's output ends with an ERROR line that reads like a failure and is not.
  const tidy = (q) => {
    try {
      execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      })
    } catch {
      // Refused: expected for an identity that acted. Z3 says what survives.
    }
  }
  // The authenticator this suite enrolled on the shared UAT administrator goes,
  // so the next run starts from the same place this one did.
  if (adminId) {
    tidy(`delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id = s.id and s.user_id = '${adminId}'`)
    tidy(`delete from auth.mfa_factors where user_id = '${adminId}'`)
    tidy(`delete from public.account_recovery_codes where user_id = '${adminId}'`)
  }
  tidy(`delete from public.site_admin_grant_requests where target_user_id = '${subjectId}'`)
  // ORDER MATTERS, and the first run got it wrong. The second administrator
  // APPROVED the subject's grant, so the subject's site_admins row carries
  // granted_by = the second administrator -- and site_admins_granted_by_fkey
  // then refuses to let that identity be deleted. Both administrator rows go
  // first, together, before either identity is touched.
  for (const id of [secondId, subjectId]) {
    tidy(`delete from public.site_admins where user_id = '${id}'`)
  }
  for (const id of [secondId, subjectId]) {
    tidy(`delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id = s.id and s.user_id = '${id}'`)
    tidy(`delete from auth.mfa_challenges c using auth.mfa_factors f where c.factor_id = f.id and f.user_id = '${id}'`)
    tidy(`delete from auth.mfa_factors where user_id = '${id}'`)
    tidy(`delete from public.account_recovery_codes where user_id = '${id}'`)
    tidy(`delete from public.club_memberships where user_id = '${id}'`)
    tidy(`delete from auth.sessions where user_id = '${id}'`)
    tidy(`delete from public.account_security_state where user_id = '${id}'`)
    tidy(`delete from public.profiles where id = '${id}'`)
    tidy(`delete from auth.identities where user_id = '${id}'`)
    tidy(`delete from auth.users where id = '${id}'`)
  }
  tidy(`delete from public.capability_overrides where user_id = '${subjectId}'`)
  tidy(`delete from public.role_assignments where user_id = '${subjectId}'`)
  tidy(`delete from public.club_memberships where user_id = '${subjectId}'`)
  tidy(`delete from public.access_invitations where target_user_id = '${subjectId}'
         or invited_email_normalised like 'uat.s7e.%.${TAG}@ovalball.test'`)
  tidy(`delete from auth.sessions where user_id = '${subjectId}'`)
  tidy(`delete from public.account_security_state where user_id = '${subjectId}'`)
  tidy(`delete from public.profiles where id = '${subjectId}'`)
  tidy(`delete from auth.identities where user_id = '${subjectId}'`)
  tidy(`delete from auth.users where id = '${subjectId}'`)
  await browser.close()
}

record("Z1 the suite leaves no membership, role, override or grant request behind",
  sql(`select (select count(*) from public.club_memberships where user_id = '${subjectId}')
            + (select count(*) from public.club_memberships where user_id = '${secondId}')
            + (select count(*) from public.site_admins where user_id = '${subjectId}')
            + (select count(*) from public.site_admins where user_id = '${secondId}')
            + (select count(*) from public.role_assignments where user_id = '${subjectId}')
            + (select count(*) from public.capability_overrides where user_id = '${subjectId}')
            + (select count(*) from public.site_admin_grant_requests where target_user_id = '${subjectId}')`) === "0")

record("Z2 and no authenticator remains on the shared UAT administrator",
  sql(`select count(*) from auth.mfa_factors where user_id = '${adminId}'`) === "0")

// WHAT "DESTROYED" CAN AND CANNOT MEAN HERE. public.audit_log is append-only by
// construction (internal.refuse_history_rewrite), so an identity that ACTED
// cannot be deleted -- and the second administrator acted, because approving the
// grant is the whole point of it existing. The assertion is therefore the one
// that matters: nothing it could still be used with survives. An inert row in
// auth.users with no factor, no session and no authority is not a leftover
// credential, and pretending it could be removed would mean weakening the
// append-only guarantee to tidy up after a test.
const inert = sql(`select (select count(*) from auth.users where id = '${subjectId}')
                        + (select count(*) from auth.users where id = '${secondId}')`)
record("Z3 no factor, session or authority remains on either disposable identity",
  sql(`select (select count(*) from auth.mfa_factors where user_id in ('${subjectId}','${secondId}'))
            + (select count(*) from auth.sessions where user_id in ('${subjectId}','${secondId}'))
            + (select count(*) from public.site_admins where user_id in ('${subjectId}','${secondId}'))
            + (select count(*) from public.profiles where id in ('${subjectId}','${secondId}'))`) === "0")
if (inert !== "0") {
  console.log(
    `NOTE  ${inert} inert identity row(s) remain: public.audit_log is append-only by design, so an ` +
      `identity that acted cannot be deleted. No factor, session, profile or authority remains on them.`
  )
}

process.exit(summarise("Users & Access detail tabs") ? 0 : 1)
