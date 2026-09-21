// =====================================================================
// CONVERGENCE STEP 13 / IDENTITY-AUTH SLICE 9 -- ACTING AS SOMEBODY
//
// Slice 9's seam was built in Slice 4 and left inert: effective_person() was a
// stub returning auth.uid(), and fifteen callers -- including internal.can --
// were already written for it. This walks what turning it on looks like.
//
//   a Full Site Admin -> a person's Site Admin page -> Act as This Person
//   -> gives a reason -> the banner says WHOSE account, whether anything can be
//      changed, and when it ends -> stops -> the banner goes, and the person is
//      told afterwards (AN-9)
//
//   and an ordinary member is never offered it.
//
// Sprint mode: the happy path, one mobile width, and the negative that matters.
// The full security matrix is step13_impersonation.sql, which is where it belongs.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, enrolAuthenticator, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const ADMIN = "uat.fullsiteadmin@ovalball.test"
const ORDINARY = "uat.team.manager@ovalball.test"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

async function waitForSql(query, expected, timeoutMs = 8000) {
  const started = Date.now()
  let last = ""
  while (Date.now() - started < timeoutMs) {
    last = sql(query)
    if (last === expected) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  return last
}

const adminId = sql(`select id from auth.users where email = '${ADMIN}'`)
const targetId = sql(`select id from auth.users where email = '${ORDINARY}'`)

// SECURITY EVENTS ARE NOT CLEANED UP, ON PURPOSE. public.security_events is append-only under
// internal.refuse_history_rewrite(), and that is correct: a test tidying its own audit trail would
// be the one thing an audit trail must not permit. This run's two impersonation events stay, naming
// the real actor -- which is exactly what they are for.
function teardown() {
  try {
    sql(`delete from public.notifications where user_id = '${targetId}' and type = 'impersonation_session_ended';
         delete from public.impersonation_sessions where actor_user_id = '${adminId}';
         delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id = s.id and s.user_id = '${adminId}';
         delete from auth.mfa_challenges c using auth.mfa_factors f where c.factor_id = f.id and f.user_id = '${adminId}';
         delete from auth.mfa_factors where user_id = '${adminId}';
         delete from public.account_recovery_codes where user_id = '${adminId}';`)
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
  await signIn(page, ADMIN)

  // AD REQUIRES RECENT AAL2, AND THE SERVER MEANS IT. An ordinary signed-in session cannot begin an
  // act-as session at all -- proven below -- so the journey first enrols an authenticator, exactly
  // as a real administrator would have to.
  await enrolAuthenticator(page, { email: ADMIN, sql })

  await page.goto(`${APP}/admin/users/${targetId}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const main = await page.locator("main").innerText()
  record("A1 a Full Site Admin is offered the control on a person's page", /act as this person/i.test(main))
  record("A2 and told what it means before pressing anything",
    /ends by itself|30 minutes|named in the audit|told afterwards/i.test(main))

  await page.getByRole("button", { name: "Act as This Person" }).first().click()
  const startBtn = page.getByRole("button", { name: /^Start Acting as/ })
  record("A3 the start button is refused until a reason is written", await startBtn.isDisabled())

  await page.locator("#act-as-reason").fill("Investigating the fixture they reported as missing")
  record("A4 and offered once there is one", !(await startBtn.isDisabled()))

  // THE SECURITY BOUNDARY, SEEN IN THE PRODUCT. Age the authenticator claim past the ten-minute
  // window and the server refuses, in words a person can act on -- no session is created.
  sql(`update auth.mfa_amr_claims set updated_at = now() - interval '11 minutes'
        where session_id in (select id from auth.sessions where user_id = '${adminId}')`)
  await startBtn.click()
  await page.waitForTimeout(1200)
  const refusal = await page.locator("main").innerText()
  record("A4b without a recent authenticator code the server refuses, and says so",
    /authenticator/i.test(refusal) &&
      sql(`select count(*) from public.impersonation_sessions where actor_user_id = '${adminId}'`) === "0")

  sql(`update auth.mfa_amr_claims set updated_at = now()
        where session_id in (select id from auth.sessions where user_id = '${adminId}')`)
  await startBtn.click()
  const started = await waitForSql(
    `select count(*) from public.impersonation_sessions where actor_user_id = '${adminId}' and ended_at is null`,
    "1"
  )
  record("A5 starting writes a real session, with its reason", started === "1", `${started} session(s)`)
  record("A6 and the reason is what was typed",
    sql(`select reason from public.impersonation_sessions where actor_user_id = '${adminId}' and ended_at is null`)
      === "Investigating the fixture they reported as missing")

  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const body = await page.locator("body").innerText()
  record("B1 the banner says whose account this is", /you are acting as/i.test(body))
  record("B2 whether anything can be changed", /you can look, not change|you can make changes as them/i.test(body))
  record("B3 when it ends by itself", /ends at \d{2}:\d{2}/i.test(body))
  record("B4 and that both people are named in the audit", /both of you are named in the audit/i.test(body))

  // AD's dual attribution, from the record rather than the page -- and asserted against THIS run's
  // session id, because security_events is append-only and earlier runs' rows are still there by
  // design. Counting them would make a correct audit trail look like a leak.
  const sessionId = sql(`select id from public.impersonation_sessions
                         where actor_user_id = '${adminId}' and ended_at is null limit 1`)
  record("B5 the audit names the real actor, not the person being acted as",
    sql(`select count(*) from public.security_events
         where event_type = 'impersonation.started'
           and actor_user_id = '${adminId}' and subject_user_id = '${targetId}'
           and metadata ->> 'session_id' = '${sessionId}'`) === "1")

  // Mobile sanity: the banner must survive, because it is the thing that must not be missable.
  const small = await newContext(browser, { width: 390, height: 844 })
  const m = await small.newPage()
  await signIn(m, ADMIN)
  await m.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await m.waitForLoadState("networkidle").catch(() => {})
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  record("C1 no horizontal overflow at 390px with the banner up", overflow <= 0, `${overflow}px over`)
  record("C2 and the banner is still there", /you are acting as/i.test(await m.locator("body").innerText()))
  await small.close()

  await page.getByRole("button", { name: "Stop Acting as Them" }).first().click()
  const ended = await waitForSql(
    `select count(*) from public.impersonation_sessions where actor_user_id = '${adminId}' and ended_at is null`,
    "0"
  )
  record("D1 stopping ends the session", ended === "0")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("D2 and the banner goes with it", !/you are acting as/i.test(await page.locator("body").innerText()))
  record("D3 AN-9: the person is told afterwards",
    sql(`select count(*) from public.notifications where user_id = '${targetId}' and type = 'impersonation_session_ended'`) === "1")

  await ctx.close()

  // ==================================================================
  // E. THE NEGATIVE THAT MATTERS
  // ==================================================================
  const octx = await newContext(browser, { width: 1440, height: 1100 })
  const opage = await octx.newPage()
  await signIn(opage, ORDINARY)
  await opage.goto(`${APP}/admin/users/${adminId}`, { waitUntil: "domcontentloaded" })
  await opage.waitForLoadState("networkidle").catch(() => {})
  const otext = await opage.locator("body").innerText()
  record("E1 somebody without the capability is never offered it", !/act as this person/i.test(otext))
  record("E2 and no session exists for them",
    sql(`select count(*) from public.impersonation_sessions where actor_user_id = '${targetId}'`) === "0")
  await octx.close()

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record(
  "cleanup: this run's session, notification and authenticator are gone (its audit events stay, by design)",
  sql(`select count(*) from public.impersonation_sessions where actor_user_id = '${adminId}'`) === "0" &&
    sql(`select count(*) from public.notifications where user_id = '${targetId}' and type = 'impersonation_session_ended'`) === "0"
)

process.exit(summarise() ? 0 : 1)
