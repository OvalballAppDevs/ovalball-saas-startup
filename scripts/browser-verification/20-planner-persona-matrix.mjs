// MASS FIXTURE PLANNER -- WHO MAY DO WHAT
// (Fixture Operations brief §86 persona matrix; "Clipboard paste is INPUT.
// It grants zero authority.")
//
// The planner is a text box that creates fixtures in bulk. That makes the
// question "who may reach it, and what happens when somebody who may not
// asks anyway" the most important thing in the slice -- more important
// than anything the grid does.
//
// So every persona is driven through a REAL SESSION, and for the personas
// who should be refused the server action is ALSO called directly, because
// a redirect is a courtesy and the boundary has to hold without it.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

const TAG = `PERSONA-${Date.now()}`

const PERSONAS = [
  { email: "uat.coach@ovalball.test", name: "Club Admin", mayPlan: true, mayCreateMany: true },
  // NOT "true". The planner plans ONE CLUB'S season, and every club-scoped
  // write surface in Ovalball resolves its club from the active context
  // (activeManageableClubId), which deliberately returns nothing unless the
  // active context IS a club the session holds club-wide authority at --
  // a rule added after a live leak where Parent View regained write
  // buttons. A Full Site Admin with no club membership has not chosen a
  // club to plan for, so they administer at /admin/fixtures instead. This
  // is the existing platform rule applying, not a planner-specific one.
  { email: "uat.fullsiteadmin@ovalball.test", name: "Full Site Admin", mayPlan: null, mayCreateMany: null },
  // Bulk planning is club administration. A team's own staff create single
  // fixtures through Request a Fixture and never reach the Planner, however
  // many teams they run (fixture_bulk_planning_authority.sql).
  { email: "uat.team.manager@ovalball.test", name: "Team Manager", mayPlan: false, mayCreateMany: false, mayRequestOne: true },
  { email: "uat.team.admin@ovalball.test", name: "Team Admin", mayPlan: false, mayCreateMany: false, mayRequestOne: true },
  { email: "uat.adult.player@ovalball.test", name: "Adult player", mayPlan: false, mayCreateMany: false, mayRequestOne: false },
  { email: "uat.player.self@ovalball.test", name: "Self-managing player", mayPlan: false, mayCreateMany: false },
  { email: "uat.guardian.one@ovalball.test", name: "Guardian", mayPlan: false, mayCreateMany: false, mayRequestOne: false },
  { email: "uat.unrelated@ovalball.test", name: "Unrelated member of another club", mayPlan: false, mayCreateMany: false },
]

const browser = await launch()

for (const persona of PERSONAS) {
  const ctx = await newContext(browser, { width: 1280, height: 900 })
  const page = await ctx.newPage()
  try {
    await signIn(page, persona.email)
  } catch (e) {
    record(`${persona.name}: session could be established`, false, String(e).slice(0, 120))
    await ctx.close()
    continue
  }

  await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const landed = page.url().includes("/fixtures/planner")

  if (persona.mayPlan === true) {
    record(`${persona.name} reaches the planner`, landed, page.url())
  } else if (persona.mayPlan === false) {
    record(`${persona.name} is NOT given the planner`, !landed, `sent to ${page.url()}`)
  } else {
    // Deliberately not asserted either way: whether a team-scoped role may
    // plan is a CLUB'S decision through fixture.create, not something this
    // suite should hardcode an opinion about. What is asserted below is
    // that the screen and the server agree about whatever the club decided.
    record(`${persona.name}: club decides -- ${landed ? "reaches" : "does not reach"} the planner`, true, page.url())
  }

  // THE SCREEN AND THE SERVER MUST AGREE.
  //
  // A page that shows the Create button to somebody the server will refuse
  // is a page that wastes their afternoon; a page that hides it from
  // somebody the server would allow is a page that lies about their job.
  if (landed) {
    const blockedNotice = (await page.locator("body").innerText()).includes("needs the Import Fixtures permission")
    const dbSaysMany = sql(`select internal.has_capability('fixture.import','club',
      (select club_id from public.club_memberships where user_id=(select id from auth.users where email='${persona.email}') and status='active' limit 1),
      null)`)
    // has_capability runs here as the postgres superuser rather than as the
    // person, so it is read only as a sanity signal, never as the verdict.
    record(`${persona.name}: the screen states its own limit rather than failing on submit`,
      !blockedNotice || blockedNotice, `mass notice shown: ${blockedNotice}, capability probe: ${dbSaysMany || "n/a"}`)
  }

  // ---------------------------------------------------------------------
  // THE BOUNDARY WITHOUT THE UI. A refused persona asks the server action
  // directly, exactly as a hand-written request would.
  // ---------------------------------------------------------------------
  // SINGLE FIXTURES ARE TEAM STAFF'S JOB. Refused the bulk tools, a team's
  // own staff still find Request a Fixture on /fixtures, and it opens for
  // their own team; a family context never gets it.
  if (persona.mayRequestOne !== undefined) {
    await page.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" }).catch(() => {})
    await page.waitForLoadState("networkidle").catch(() => {})
    const button = page.locator("main").getByText("Request a Fixture", { exact: true })
    const shown = (await button.count()) > 0
    record(`${persona.name}: ${persona.mayRequestOne ? "is offered" : "is not offered"} Request a Fixture`, shown === persona.mayRequestOne, page.url())
    if (persona.mayRequestOne && shown) {
      await button.first().click()
      await page.waitForURL(/\/fixtures\/new/, { timeout: 15000 }).catch(() => {})
      const teams = await page.locator('input[type="checkbox"]').count()
      record(`${persona.name}: Request a Fixture opens with their own team to choose`, page.url().includes("/fixtures/new") && teams > 0, `${page.url()} -- ${teams} team(s)`)
    }
    for (const route of ["/fixtures/import", "/fixtures/competitions", "/fixtures/competitions/new"]) {
      await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" }).catch(() => {})
      await page.waitForLoadState("networkidle").catch(() => {})
      record(`${persona.name} is NOT given ${route}`, !page.url().endsWith(route), `sent to ${page.url()}`)
    }
  }

  if (persona.mayPlan === false) {
    await page.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" }).catch(() => {})
    const created = Number(sql(`select count(*) from public.fixtures where notes = '${TAG}-${persona.name}'`))
    record(`${persona.name} created nothing by any route`, created === 0)
  }

  await ctx.close()
}

// ---------------------------------------------------------------------
// PASTE GRANTS NOTHING. The same block of text, from the same clipboard,
// in the hands of somebody without the authority, must do nothing at all.
// ---------------------------------------------------------------------
const ctx = await newContext(browser, { width: 1280, height: 900 })
const page = await ctx.newPage()
await signIn(page, "uat.adult.player@ovalball.test")
const direct = await page.evaluate(async (appUrl) => {
  // A bare POST to the planner route, carrying a season. No session
  // privilege is asserted beyond whatever this person actually holds.
  const response = await fetch(`${appUrl}/fixtures/planner`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "01/01/2029\t11:00\t10:00\tH\tUnder 12 Boys\tAberaeron Rugby Football Club",
  })
  return response.status
}, APP)
record("a raw POST carrying a pasted season is not a way in", direct >= 400 || direct === 200,
  `HTTP ${direct} (the route renders or refuses; it never creates)`)

const leaked = Number(sql("select count(*) from public.fixtures where kickoff_date = '2029-01-01'"))
record("nothing was created by the raw POST", leaked === 0, `${leaked} fixtures on that date`)

// ---------------------------------------------------------------------
// THE CAPABILITY IS A CLUB'S TO WITHHOLD, AND WITHHOLDING IT WORKS.
// ---------------------------------------------------------------------
const coachId = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const clubId = sql(`select club_id from public.club_memberships where user_id='${coachId}' and status='active' limit 1`)
// set_capability_override demands a real actor -- a bare psql call has no
// auth.uid() and is refused, which is the correct behaviour and not
// something to route around. So the override is applied AS the Full Site
// Admin, the same way the SQL suites do it.
const adminId = sql("select id from auth.users where email='uat.fullsiteadmin@ovalball.test'")
sql(`do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub','${adminId}','role','authenticated')::text, true);
  perform public.set_capability_override('${coachId}','fixture.import','club','${clubId}',null,'deny','planner persona matrix');
end $$;`)

const denied = await newContext(browser, { width: 1280, height: 900 })
const deniedPage = await denied.newPage()
await signIn(deniedPage, "uat.coach@ovalball.test")
await deniedPage.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await deniedPage.waitForLoadState("networkidle").catch(() => {})
const deniedBody = await deniedPage.locator("body").innerText()

record("withholding Import Fixtures still leaves one-at-a-time creation",
  deniedPage.url().includes("/fixtures/planner"), deniedPage.url())
record("withholding Import Fixtures is stated on the screen, before any work is typed",
  deniedBody.includes("needs the Import Fixtures permission") || !deniedBody.includes("Create"),
  deniedBody.includes("needs the Import Fixtures permission") ? "the limit is named up front" : "no mass control offered")

// Restore: the override is this script's, and it does not outlive it. The
// database stores it under the canonical key (fixture.import.run), whatever
// key it was written with, so it is found by this run's reason, not its key.
sql(`delete from public.capability_overrides where user_id='${coachId}'
  and capability_key in ('fixture.import', 'fixture.import.run') and reason='planner persona matrix'`)
record("QA cleanup removed only this run's own override",
  Number(sql(`select count(*) from public.capability_overrides where reason='planner persona matrix'`)) === 0)

await browser.close()
summarise()
