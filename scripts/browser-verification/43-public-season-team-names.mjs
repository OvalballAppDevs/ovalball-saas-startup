// PUBLIC SEASON TEAM NAMES ON THE CLUB DIGITAL HOME -- browser acceptance.
//
// Identity/Auth Slice 1 forward-fix. A signed-out visitor to a club's public
// home must see each upcoming fixture labelled with the team as it is in that
// fixture's season, without the page reading teams or running the broad
// signed-in resolver:
//
//   earlier season   a fixture rearranged past the end of last season shows
//                    the name Season Handover recorded for last season
//   current season   the team as it is now
//   next season      the team as it will be next season
//
// A pass on the current name alone proves nothing (it is also what the page
// shows when the lookup fails), so every label is checked against a season
// in which the right answer differs from today's team name. The API gateway
// log proves the lookup itself returned 200, not 401.
//
// Runs signed out on desktop and phone widths, with console and hydration
// errors captured. Everything this run creates is removed at the end.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/43-public-season-team-names.mjs

import { execFileSync } from "node:child_process"

import { APP, launch, newContext, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const KONG = process.env.SUPABASE_KONG_CONTAINER || CONTAINER.replace("supabase_db_", "supabase_kong_")
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const TAG = Date.now().toString(36).slice(-6)
const SLUG = `uat-season-names-${TAG}`
const OPP = { earlier: `Rearranged Vale ${TAG}`, current: `Current Park ${TAG}`, next: `Next Season Town ${TAG}` }
const made = { cleaned: false }

function cleanup() {
  if (made.cleaned) return
  made.cleaned = true
  sql(`
do $$
declare v_clubs uuid[] := array(select id from public.clubs where slug = '${SLUG}');
begin
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.team_season_identity where team_id in (select id from public.teams where club_id = any(v_clubs));
  delete from public.teams where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where normalized_key = '${SLUG}';
  delete from public.seasons where name like 'UAT Season Names % ${TAG}';
end $$;`)
}
process.on("SIGINT", () => { cleanup(); process.exit(1) })

const browser = await launch()
const startedAt = new Date()
try {
  // ---------------------------------------------------------------------
  // Deterministic data: the real current and next Union seasons from the
  // Seasons register, plus last season if the register has none.
  // ---------------------------------------------------------------------
  // The resolver's own rule for "current": the latest Union season that has
  // started. Test seasons are created only when the register has none (a
  // clean database), and removed again at the end.
  const seasonFor = (where) => one(`select id || '|' || season_year_start from public.seasons where rugby_code = 'union' and ${where} order by starts_on desc, is_regression_fixture asc, id asc limit 1`)
  const createSeason = (label, startsExpr, endsExpr, yearExpr) =>
    one(`insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
      values ('UAT Season Names ${label} ${TAG}', ${startsExpr}, ${endsExpr}, 'union', ${yearExpr}, true) returning id || '|' || season_year_start`)
  let current = seasonFor("starts_on < current_date")
  if (!current) current = createSeason("Current", "current_date - 30", "current_date + 300", "extract(year from current_date - 30)::int")
  const [currentId, currentYear] = current.split("|")
  const currentStarts = one(`select starts_on from public.seasons where id = '${currentId}'`)
  let next = seasonFor(`season_year_start = ${Number(currentYear) + 1}`)
  if (!next) next = createSeason("Next", `date '${currentStarts}' + interval '1 year'`, `date '${currentStarts}' + interval '1 year' + interval '300 days'`, Number(currentYear) + 1)
  const nextId = next.split("|")[0]
  let earlier = seasonFor(`season_year_start = ${Number(currentYear) - 1}`)
  if (!earlier) earlier = createSeason("Earlier", `date '${currentStarts}' - interval '1 year'`, `date '${currentStarts}' - interval '1 day'`, Number(currentYear) - 1)
  const earlierId = earlier.split("|")[0]
  record("setup: the Seasons register has a current and a next Union season", Boolean(currentId && nextId && earlierId), `current ${currentYear}`)

  const nextKickoff = one(`select greatest(starts_on + 7, current_date + 7) from public.seasons where id = '${nextId}'`)
  sql(`
do $$
declare v_dir uuid; v_club uuid; v_team uuid;
begin
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key, town)
  values ('UAT Season Names RFC ${TAG}', 'union', 'England', 'England', 'manual', 'verified', '${SLUG}', 'Seasonton') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, '${SLUG}', 'active') returning id into v_club;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
  values (v_club, 'union', 'youth', 'U13', 'boys', 'U13', 'u13-${TAG}', true) returning id into v_team;
  -- Last season this team was the Under 12s: the record Season Handover keeps.
  insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
  values (v_team, '${earlierId}', 'youth', 'U12', null, 'boys', 'Under 12 Boys');
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, raw_opposition_text, status) values
    (v_team, '${earlierId}', current_date + 3, '10:30', 'Home', '${OPP.earlier}', 'Booked'),
    (v_team, '${currentId}', current_date + 6, '11:00', 'Away', '${OPP.current}', 'Booked'),
    (v_team, '${nextId}', '${nextKickoff}', '10:00', 'Home', '${OPP.next}', 'Booked');
end $$;`)
  const liveName = one(`select t.display_name from public.teams t join public.clubs c on c.id = t.club_id where c.slug = '${SLUG}'`)
  record("setup: today's team is the Under 13 Boys", liveName === "Under 13 Boys", liveName)

  for (const [width, height, label] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
    const context = await newContext(browser, { width, height })
    const page = await context.newPage()
    const problems = []
    page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 160)) })
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`))

    const response = await page.goto(`${APP}/club/${SLUG}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const body = await page.locator("body").innerText()
    record(`${label}: the signed-out club home renders`, (response?.status() ?? 0) < 400 && !/Application error|Something went wrong/i.test(body) && !/\/login/.test(page.url()), `HTTP ${response?.status()}`)

    const labelFor = async (opponent) => {
      const card = page.locator(`article[aria-label*="${opponent}"]`).first()
      if (!(await card.count())) return null
      return (await card.getAttribute("aria-label")).split(" v ")[0]
    }
    const earlier = await labelFor(OPP.earlier)
    const now = await labelFor(OPP.current)
    const next = await labelFor(OPP.next)
    record(`${label}: a fixture from last season shows last season's team (Under 12 Boys), not today's`, earlier === "Under 12 Boys", String(earlier))
    record(`${label}: a current-season fixture shows the team as it is now (Under 13 Boys)`, now === "Under 13 Boys", String(now))
    record(`${label}: a next-season fixture shows the team as it will be (Under 14 Boys), not today's`, next === "Under 14 Boys", String(next))

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    record(`${label}: no horizontal page overflow`, overflow <= 1, `overflow ${overflow}px`)
    const hydration = problems.filter((p) => /hydrat|did not match|server rendered/i.test(p))
    record(`${label}: no console, page or hydration errors`, problems.length === 0, hydration.length ? hydration.join(" | ") : problems.join(" | ") || "none")

    // Links in the fixtures section (none for a signed-out visitor's Match
    // Centre; team and club links elsewhere on the page must still resolve).
    const hrefs = [...new Set(await page.locator(`a[href^="/club/${SLUG}"]`).evaluateAll((as) => as.map((a) => a.getAttribute("href"))))]
    const broken = []
    for (const href of hrefs.slice(0, 8)) {
      const r = await page.request.get(`${APP}${href}`)
      if (r.status() >= 400) broken.push(`${href} ${r.status()}`)
    }
    record(`${label}: club page links still resolve (${hrefs.length})`, broken.length === 0, broken.join(", ") || "all < 400")
    const matchCentreLinks = await page.locator('a:has-text("Match Centre")').count()
    record(`${label}: a signed-out visitor is offered no Match Centre link`, matchCentreLinks === 0, `${matchCentreLinks}`)
    await context.close()
  }

  // The lookup itself, as recorded by the local API gateway during this run.
  const since = Math.max(1, Math.ceil((Date.now() - startedAt.getTime()) / 1000) + 5)
  const gateway = execFileSync("docker", ["logs", "--since", `${since}s`, KONG], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const lines = gateway.split("\n")
  const publicCalls = lines.filter((l) => l.includes("/rest/v1/rpc/get_public_team_season_names"))
  const publicStatuses = [...new Set(publicCalls.map((l) => l.match(/HTTP\/[\d.]+" (\d{3})/)?.[1]))]
  const broad401 = lines.filter((l) => l.includes("/rest/v1/rpc/get_team_identities_for_season_batch") && /" 40[13] /.test(l))
  record("the public season name lookup returned 200 on every page load, never 401", publicCalls.length >= 2 && publicStatuses.length === 1 && publicStatuses[0] === "200", `${publicCalls.length} calls, statuses ${publicStatuses.join(",")}`)
  record("no signed-out call to the broad resolver was refused", broad401.length === 0, `${broad401.length}`)
} finally {
  try {
    cleanup()
    const left = one(`select (select count(*) from public.clubs where slug = '${SLUG}') + (select count(*) from public.club_directory where normalized_key = '${SLUG}') + (select count(*) from public.seasons where name like 'UAT Season Names % ${TAG}')`)
    record("cleanup: the club, team, fixtures, season identity and any season this run created are gone", left === "0", `remaining=${left}`)
  } catch (error) {
    record("cleanup", false, error.message.split("\n")[0])
  }
  await browser.close()
  summarise()
}
