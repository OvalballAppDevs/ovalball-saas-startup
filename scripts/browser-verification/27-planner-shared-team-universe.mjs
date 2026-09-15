// FIXTURE AUTHORITY BY SCOPE -- single fixtures for team staff, bulk tools for the club
// (Fixture Operations consolidated direction: "TEAM STAFF MUST NOT HAVE MASS
// PLANNER ACCESS"; the "7/8 tags" case is the Mini-Rugby Group U7/U8 Tags.)
//
// Two authorities, on purpose:
//
//   A. A team's own staff create or request ONE fixture for a team they run --
//      Request a Fixture, Calendar in their team context.
//   B. The Season Planner, Import Fixtures and the Competition Creator are club
//      fixture administration: Club Admin, Fixture Secretary, Site Admin.
//
// The earlier slice widened the Planner to team staff; the product owner
// reversed that. This recreates the reported shape -- a Team Manager who runs
// both U7/U8 Tags teams -- and proves the Team Manager keeps single-fixture
// authority and is given none of the bulk tools, while the Club Admin finds the
// group's real member teams in the Planner by "U7", "U8", "7/8" or "Tags".
//
// SEEDED AND CLEANED UP BY THIS RUN. A U7 team (if the club has none), a
// "U7/U8" Mini-Rugby Group and two team_permissions rows are created at the
// start and removed at the end, found by this run's own tag.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** An INSERT ... RETURNING id, read as ids -- psql also prints its "INSERT 0 n" status line. */
const ids = (q) => sql(q).split("\n").map((l) => l.trim()).filter((l) => UUID.test(l))

const TAG = `UNIVERSE-${Date.now()}`
const MANAGER = "uat.team.manager@ovalball.test"
const ADMIN = "uat.coach@ovalball.test"

// ---------------------------------------------------------------------
// SEED -- the reported shape
// ---------------------------------------------------------------------
const clubId = sql(`select club_id from public.club_memberships where user_id=(select id from auth.users where email='${ADMIN}') and role='CLUB_ADMIN' and status='active' limit 1`)
const membershipId = sql(`select id from public.club_memberships where user_id=(select id from auth.users where email='${MANAGER}') and club_id='${clubId}' and status='active' limit 1`)
const seasonId = sql(`select id from public.seasons where rugby_code='union' and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on order by starts_on limit 1`)

let u7 = sql(`select id from public.teams where club_id='${clubId}' and active and age_group='U7' and squad_designation is null limit 1`)
const createdU7 = !u7
if (createdU7) {
  u7 = ids(`insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, active) values ('${clubId}', 'Under 7 Mixed', 'youth', 'U7', 'mixed', 'union', true) returning id`)[0]
}
const u8 = sql(`select id from public.teams where club_id='${clubId}' and active and age_group='U8' and squad_designation is null limit 1`)
const groupId = ids(`insert into public.scheduling_groups (club_id, display_tag, season_id, active, alias) values ('${clubId}', 'U7/U8', '${seasonId}', true, null) returning id`)[0]
sql(`insert into public.scheduling_group_members (group_id, team_id) values ('${groupId}', '${u7}'), ('${groupId}', '${u8}')`)
// Team roles are role assignments (Identity/Auth Slice 2); a team the manager
// already runs is left as it is, and only the roles this run adds are removed.
const seededPermissions = ids(`insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source)
  select cm.user_id, cm.club_id, t.id, cm.id, 'TEAM_MANAGER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'
  from public.club_memberships cm cross join public.teams t
  where cm.id = '${membershipId}' and t.id in ('${u7}', '${u8}')
    and not exists (select 1 from public.role_assignments x where x.membership_id = cm.id and x.team_id = t.id and x.state in ('ACTIVE', 'SUSPENDED'))
  returning id`)

const labelOf = (id) => sql(`select display_name from public.teams where id='${id}'`)
const U7 = labelOf(u7)
const U8 = labelOf(u8)
const expectedManagerTeams = sql(`select string_agg(t.display_name, '|' order by t.display_name) from public.teams t
  join public.team_permissions tp on tp.team_id=t.id where tp.membership_id='${membershipId}' and tp.permission <> 'view_only' and t.active`)
record("seed: the manager runs both U7/U8 Tags teams", expectedManagerTeams.includes(U7) && expectedManagerTeams.includes(U8), expectedManagerTeams)

const browser = await launch()

async function asPerson(email, contextKey) {
  const ctx = await newContext(browser, { width: 1512, height: 950 })
  const page = await ctx.newPage()
  await signIn(page, email)
  if (contextKey) {
    // The active context is a UI preference the server re-validates on every
    // read (set-context.ts); setting it names a context, it grants nothing.
    await ctx.addCookies([{ name: "ovalball_ctx", value: contextKey, url: APP }])
  }
  return { ctx, page }
}

async function ourTeamOptions(page, query = "") {
  await page.locator('input[aria-label="Our Team, row 1"]').click()
  if (query) await page.keyboard.type(query)
  await page.waitForTimeout(150)
  const texts = (await page.locator('ul[role="listbox"] [role="option"]').allInnerTexts()).map((t) => t.split("\n")[0])
  const list = await page.locator('ul[role="listbox"]').innerText().catch(() => "")
  await page.keyboard.press("Escape")
  if (query) {
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
  }
  return { texts, list }
}

// A week that is inside the canonical season window, so Calendar's own
// period gating (days outside the selected phase offer no create affordance)
// is not what a check below ends up measuring.
//
// And Calendar draws its lanes only in a week that holds at least one event --
// an empty week is a "No fixtures or training" state with no lanes at all. So
// the week is one with a club-wide event in it where there is one.
const eventWeek = sql(`select to_char(date_trunc('week', greatest(e.starts_on, current_date, s.starts_on))::date, 'YYYY-MM-DD')
  from public.club_events e, public.seasons s
  where e.club_id='${clubId}' and e.is_club_wide and s.id='${seasonId}'
    and e.ends_on >= greatest(current_date, s.starts_on) and e.starts_on <= s.ends_on
  order by greatest(e.starts_on, current_date) limit 1`)
// A day already holding an event offers no "+", so the create check uses a
// following week rather than the event's own.
const seasonWeek = sql(`select to_char(date_trunc('week', greatest(current_date + 7, starts_on))::date, 'YYYY-MM-DD') from public.seasons where id='${seasonId}'`)

// ---------------------------------------------------------------------
// §13 THE TEAM MANAGER, WHERE THEY ALREADY WORK
//
// Calendar SHOWS a team context the group's lane; its week-board "+" is a
// club-context affordance. A team's own staff create that team's fixtures
// through Request a Fixture, under the same database boundary
// (fixtures_insert_scoped -> can_manage_team) the Planner now shares.
// ---------------------------------------------------------------------
const manager = await asPerson(MANAGER, `team:${u7}`)
await manager.page.goto(`${APP}/calendar?week=${eventWeek || seasonWeek}&phase=season`, { waitUntil: "domcontentloaded" })
await manager.page.waitForLoadState("networkidle").catch(() => {})
const calendarText = await manager.page.locator("body").innerText()
if (eventWeek) {
  record("§13 Calendar shows the manager the U7/U8 Tags lane", calendarText.includes("U7/U8 Tags"), `week of ${eventWeek}`)
} else {
  record("§13 (not asserted) no club-wide event week exists, so Calendar draws no lanes to look for", true, "precondition absent")
}

await manager.page.goto(`${APP}/fixtures/new`, { waitUntil: "domcontentloaded" })
await manager.page.waitForLoadState("networkidle").catch(() => {})
const requestPage = await manager.page.locator("body").innerText()
record("§13 and the platform already lets them create fixtures for U7 (Request a Fixture)",
  manager.page.url().includes("/fixtures/new") && requestPage.includes(U7), manager.page.url())

// ---------------------------------------------------------------------
// B. THE SAME TEAM MANAGER IS GIVEN NO BULK TOOL
// ---------------------------------------------------------------------
for (const [path, name] of [
  ["/fixtures/planner", "the Season Planner"],
  [`/fixtures/planner?club=${clubId}`, "the Season Planner by naming the club"],
  ["/fixtures/import", "Import Fixtures"],
  ["/fixtures/competitions", "Competitions"],
  ["/fixtures/competitions/new", "the Competition Creator"],
  ["/fixtures/management", "the Fixture Control Centre"],
]) {
  await manager.page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
  await manager.page.waitForLoadState("networkidle").catch(() => {})
  const base = path.split("?")[0]
  record(`B. the Team Manager cannot open ${name}`, !manager.page.url().replace(APP, "").startsWith(base), manager.page.url().replace(APP, ""))
}
await manager.page.goto(`${APP}/fixtures`, { waitUntil: "domcontentloaded" })
await manager.page.waitForLoadState("networkidle").catch(() => {})
record("B. and their Fixtures page offers no Plan Season or Import control",
  (await manager.page.getByRole("link", { name: /Plan Season|Plan Fixtures|Import Fixtures/ }).count()) === 0)
const managerBatchesBefore = sql(`select count(*) from public.fixture_import_batches where uploaded_by=(select id from auth.users where email='${MANAGER}')`)
record("B. no import batch exists for the Team Manager", managerBatchesBefore === "0", managerBatchesBefore)
await manager.ctx.close()

// ---------------------------------------------------------------------
// §15 PARITY FOR CLUB-WIDE AUTHORITY
// ---------------------------------------------------------------------
const admin = await asPerson(ADMIN, `club:${clubId}`)
await admin.page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await admin.page.waitForLoadState("networkidle").catch(() => {})
let { texts } = await ourTeamOptions(admin.page)
const activeTeams = Number(sql(`select count(*) from public.teams where club_id='${clubId}' and active`))
record("§15 a Club Admin's Our Team is every active team at the club, U7/U8 included",
  texts.length === Math.min(activeTeams, 40) && texts.includes(U7) && texts.includes(U8), `${texts.length} of ${activeTeams}`)
for (const query of ["U7", "U8", "7/8", "Tags"]) {
  ;({ texts } = await ourTeamOptions(admin.page, query))
  const wants = query === "U7" ? [U7] : query === "U8" ? [U8] : [U7, U8]
  record(`§14 the Club Admin finds the real member teams by "${query}"`, wants.every((w) => texts.includes(w)), texts.join(", "))
  record(`§14 and "${query}" offers no synthetic group team`, texts.every((t) => !/tags|7\/8/i.test(t)), texts.join(", "))
}
await admin.page.goto(`${APP}/calendar?week=${seasonWeek}&phase=season`, { waitUntil: "domcontentloaded" })
await admin.page.waitForLoadState("networkidle").catch(() => {})
record("§15 and the same Club Admin can create on the U7/U8 Tags lane in Calendar",
  (await admin.page.locator('[aria-label^="Create fixture for U7/U8 Tags"]').count()) > 0)
await admin.ctx.close()

// ---------------------------------------------------------------------
// §16 NO AUTHORITY, NO PLANNER
// ---------------------------------------------------------------------
for (const email of ["uat.unrelated@ovalball.test", "uat.guardian.one@ovalball.test"]) {
  const person = await asPerson(email)
  await person.page.goto(`${APP}/fixtures/planner?club=${clubId}`, { waitUntil: "domcontentloaded" })
  await person.page.waitForLoadState("networkidle").catch(() => {})
  record(`§16 ${email.split("@")[0]} cannot reach this club's Planner by naming it`, !person.page.url().includes("/fixtures/planner"), person.page.url())
  await person.ctx.close()
}
// Another club's own administrator who names this club plans their own club,
// and the address stops naming a club that is not being shown.
{
  const other = await asPerson("uat.preston.admin@ovalball.test")
  await other.page.goto(`${APP}/fixtures/planner?club=${clubId}`, { waitUntil: "domcontentloaded" })
  await other.page.waitForLoadState("networkidle").catch(() => {})
  const shown = (await other.page.locator("main").innerText()).replace(/\s+/g, " ")
  const ownName = sql("select d.name from public.clubs c join public.club_directory d on d.id=c.directory_id where c.slug='preston-grasshoppers-uat'")
  const thisName = sql(`select d.name from public.clubs c join public.club_directory d on d.id=c.directory_id where c.id='${clubId}'`)
  record("§16 another club's admin naming this club sees only their own club's Planner", shown.includes(ownName) && !shown.includes(thisName), ownName)
  record("§16 and the address no longer names this club", !other.page.url().includes(clubId), other.page.url().replace(APP, ""))
  await other.ctx.close()
}

// ---------------------------------------------------------------------
// CLEANUP -- this run's rows only
// ---------------------------------------------------------------------
const batches = sql(`select distinct import_batch_id from public.fixtures where notes='${TAG}' and import_batch_id is not null`).split("\n").filter(Boolean)
const managerBatches = sql(`select id from public.fixture_import_batches where uploaded_by=(select id from auth.users where email='${MANAGER}') and filename like 'Mass Fixture Planner%' and created_at > now() - interval '1 hour'`).split("\n").filter(Boolean)
for (const b of new Set([...batches, ...managerBatches])) sql(`delete from public.fixture_import_rows where batch_id='${b}'`)
sql(`delete from public.fixture_source_refs where fixture_id in (select id from public.fixtures where notes='${TAG}')`)
sql(`delete from public.fixtures where notes='${TAG}'`)
for (const b of new Set([...batches, ...managerBatches])) sql(`delete from public.fixture_import_batches where id='${b}'`)
for (const id of seededPermissions) sql(`delete from public.role_assignments where id='${id}'`)
sql(`delete from public.scheduling_group_members where group_id='${groupId}'`)
sql(`delete from public.scheduling_groups where id='${groupId}'`)
if (createdU7) sql(`delete from public.teams where id='${u7}'`)
record("cleanup removed this run's seed and fixtures",
  sql(`select count(*) from public.scheduling_groups where id='${groupId}'`) === "0" && sql(`select count(*) from public.fixtures where notes='${TAG}'`) === "0")

await browser.close()
const ok = summarise()
process.exit(ok ? 0 : 1)
