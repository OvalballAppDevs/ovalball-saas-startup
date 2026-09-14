// A COMPETITION, IN PUBLIC -- read by somebody who is not signed in.
// (Fixture Operations spec 34-38 and 50: anonymous access; built from
// Competition Matches; Stage, Group, Round, Date and Club filters; upcoming and
// results; tables that count external v external results; a bracket that
// progresses through clubs not on Ovalball; usable at 390px.)
//
// A League + Knockout competition for Under 12 Boys is seeded: two groups of
// three (one Ovalball team, the rest clubs not on Ovalball), results recorded
// through the organiser's own result operation -- so an external v external
// result is the canonical Competition Match result -- a semi-final won by a
// club not on Ovalball, and upcoming matches still to play. Then an anonymous
// browser reads it. Everything this run creates is removed at the end.

import { execFileSync } from "node:child_process"
import { launch, newContext, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const club = sql("select id from clubs where slug='ovalball-uat-rufc'")
const siteAdmin = sql("select id from auth.users where email='uat.fullsiteadmin@ovalball.test'")
const season = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on order by starts_on limit 1")
const u12 = sql("select id from canonical_team_types_by_code where rugby_code='union' and age_group='U12' and gender='boys' and is_offered limit 1")
const past = sql("select (current_date - 14)::text")
const future = sql("select (current_date + 21)::text")
const later = sql("select (current_date + 35)::text")

const slug = `uat-public-${TAG.toLowerCase()}-union`
const competition = firstId(`insert into competitions (name, slug, normalized_key, rugby_code, active, format, team_count, canonical_team_type_id, organiser_name, created_by, updated_by)
  values ('UAT Public Cup ${TAG}', '${slug}', 'uat public cup ${TAG.toLowerCase()} union', 'union', true, 'league_knockout', 6, ${u12 ? `'${u12}'` : "null"}, 'Lancashire RFU', '${siteAdmin}', '${siteAdmin}') returning id`)
const edition = firstId(`insert into competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by) values ('${competition}', '${season}', 'union', true, '${siteAdmin}', '${siteAdmin}') returning id`)

function cleanup() {
  sql(`delete from competition_matches where edition_id='${edition}'`)
  sql(`delete from competition_stages where edition_id='${edition}'`)
  sql(`delete from competition_participants where edition_id='${edition}'`)
  sql(`delete from competition_editions where id='${edition}'`)
  sql(`delete from competitions where id='${competition}'`)
}
let cleaned = false
process.on("exit", () => {
  if (cleaned) return
  cleaned = true
  try {
    cleanup()
  } catch (e) {
    console.error("cleanup failed:", e)
  }
})

// Participants: slot 1 is Ovalball UAT RUFC's Under 12 Boys; the other five are not on Ovalball.
sql(`insert into competition_participants (edition_id, slot, club_directory_id, club_id, team_id, created_by, updated_by)
  select '${edition}', 1, c.directory_id, c.id, t.id, '${siteAdmin}', '${siteAdmin}' from clubs c join teams t on t.club_id = c.id and t.display_name = 'Under 12 Boys' and t.active where c.id = '${club}' limit 1`)
sql(`insert into competition_participants (edition_id, slot, club_directory_id, created_by, updated_by)
  select '${edition}', 1 + row_number() over (order by d.name), d.id, '${siteAdmin}', '${siteAdmin}'
  from (select d.id, d.name from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name offset 120 limit 5) d`)
const p = sql(`select id from competition_participants where edition_id='${edition}' order by slot`).split("\n")
const name = (id) => sql(`select d.name from competition_participants p join club_directory d on d.id = p.club_directory_id where p.id='${id}'`)
const league = firstId(`insert into competition_stages (edition_id, kind, name, sort_order, settings) values ('${edition}', 'league', 'Group Stage', 1, '{}') returning id`)
const ko = firstId(`insert into competition_stages (edition_id, kind, name, sort_order, settings) values ('${edition}', 'knockout', 'Knockout', 2, '{}') returning id`)
const gA = firstId(`insert into competition_groups (stage_id, name, sort_order) values ('${league}', 'Group A', 1) returning id`)
const gB = firstId(`insert into competition_groups (stage_id, name, sort_order) values ('${league}', 'Group B', 2) returning id`)
sql(`insert into competition_group_members (group_id, stage_id, participant_id, position) values
  ('${gA}', '${league}', '${p[0]}', 1), ('${gA}', '${league}', '${p[1]}', 2), ('${gA}', '${league}', '${p[2]}', 3),
  ('${gB}', '${league}', '${p[3]}', 1), ('${gB}', '${league}', '${p[4]}', 2), ('${gB}', '${league}', '${p[5]}', 3)`)

const match = (stage, group, round, slot, home, away, date, extra = "") =>
  firstId(`insert into competition_matches (edition_id, stage_id, group_id, round_number, bracket_slot, home_participant_id, away_participant_id, match_date, kickoff_time, status, verification_state, venue_text ${extra ? ", home_source, away_source" : ""})
    values ('${edition}', '${stage}', ${group ? `'${group}'` : "null"}, ${round}, ${slot ?? "null"}, ${home ? `'${home}'` : "null"}, ${away ? `'${away}'` : "null"}, '${date}', '11:00', 'scheduled', 'not_required', 'Ground ${TAG}' ${extra}) returning id`)
// Group A: external v external played (p1 beats p2); Ovalball v external still to play.
const eVe = match(league, gA, 1, null, p[1], p[2], past)
match(league, gA, 2, null, p[0], p[1], future)
// Group B: external v external played (p4 beats p3).
const bPlayed = match(league, gB, 1, null, p[3], p[4], past)
// Knockout: semi-finals already played between externals; the final waits for the winners.
const sf1 = match(ko, null, 1, 1, p[1], p[4], past)
const sf2 = match(ko, null, 1, 2, p[2], p[3], past)
const finalId = match(ko, null, 2, 1, null, null, later, `, '{"winner_of": "${sf1}", "label": "Winner of Semi-Final 1"}'::jsonb, '{"winner_of": "${sf2}", "label": "Winner of Semi-Final 2"}'::jsonb`)
match(ko, null, 2, 2, null, null, later, `, '{"loser_of": "${sf1}", "label": "Loser of Semi-Final 1"}'::jsonb, '{"loser_of": "${sf2}", "label": "Loser of Semi-Final 2"}'::jsonb`)

// Results through the canonical operation, as the organiser (a Full Site Admin).
const asOrganiser = (statement) => sql(`begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '${siteAdmin}', 'role', 'authenticated')::text, true); ${statement}; commit;`)
asOrganiser(`select public.record_competition_match_result('${eVe}', 24, 10)`)
asOrganiser(`select public.record_competition_match_result('${bPlayed}', 5, 19)`)
asOrganiser(`select public.record_competition_match_result('${sf1}', 31, 12)`)
asOrganiser(`select public.record_competition_match_result('${sf2}', 7, 22)`)
const finalParticipants = sql(`select coalesce(home_participant_id::text, '') || '|' || coalesce(away_participant_id::text, '') from competition_matches where id='${finalId}'`)
record("seed: the final receives both semi-final winners -- clubs not on Ovalball -- by the result operation", finalParticipants === `${p[1]}|${p[3]}`, finalParticipants)

const browser = await launch()
const pageErrors = []
const ctx = await newContext(browser, { width: 1280, height: 900 })
const anon = await ctx.newPage()
anon.on("pageerror", (e) => pageErrors.push(String(e)))
const open = async (query = "") => {
  await anon.goto(`${APP}/competitions/${slug}${query}`, { waitUntil: "domcontentloaded" })
  await anon.waitForLoadState("networkidle").catch(() => {})
  return (await anon.locator("main").innerText()).replace(/\s+/g, " ")
}
const applyFilters = async (choices) => {
  for (const [label, option] of Object.entries(choices)) await anon.getByLabel(label, { exact: true }).selectOption(option)
  await anon.getByRole("button", { name: "Apply Filters" }).click()
  await anon.waitForLoadState("networkidle").catch(() => {})
  return (await anon.locator("main").innerText()).replace(/\s+/g, " ")
}

// ---------------------------------------------------------------------
// ANONYMOUS, UPCOMING
// ---------------------------------------------------------------------
let text = await open()
record("public: opens without signing in", !anon.url().includes("/login") && text.includes(`UAT Public Cup ${TAG}`), anon.url().replace(APP, ""))
const header = (await anon.locator("main p").first().innerText()).trim()
record("public: the age and category are shown", Boolean(u12) && header.includes("Under 12 Boys"), header)
record("public: Upcoming lists matches still to play, and not the ones already played", text.includes(name(p[0])) && !text.includes("24 – 10"))

// ---------------------------------------------------------------------
// FILTERS
// ---------------------------------------------------------------------
await open("?view=results")
const roundOptions = await anon.getByLabel("Round", { exact: true }).locator("option").allInnerTexts()
record("filters: Round names league and knockout rounds apart", roundOptions.includes("League, Round 1") && roundOptions.includes("Knockout, Semi-Finals") && !roundOptions.includes("Round 1"), roundOptions.join(" | "))
text = await applyFilters({ Stage: "knockout" })
record("filters: Stage Knockout shows only knockout results", text.includes("31 – 12") && !text.includes("24 – 10"), text.slice(-240))
await applyFilters({ Stage: "" })
text = await applyFilters({ Round: "League, Round 1" })
record("filters: League, Round 1 shows only that round, never the knockout's first round", text.includes("24 – 10") && text.includes("5 – 19") && !text.includes("31 – 12"))
text = await applyFilters({ Round: "", Group: "Group B" })
record("filters: Group B shows Group B's result only", text.includes("5 – 19") && !text.includes("24 – 10"))
await open("?view=results")
const dateOption = await anon.getByLabel("Date", { exact: true }).locator("option").nth(1).innerText()
text = await applyFilters({ Date: dateOption })
record("filters: a date shows that day's results", text.includes("24 – 10") && text.includes("31 – 12"), dateOption)
await open("?view=results")
text = await applyFilters({ Club: name(p[4]) })
record("filters: a club shows that club's matches only", text.includes("5 – 19") && text.includes("31 – 12") && !text.includes("24 – 10"), name(p[4]))

// ---------------------------------------------------------------------
// RESULTS, TABLES, BRACKET
// ---------------------------------------------------------------------
text = await open("?view=results")
record("results: an external v external result is public", text.includes(name(p[1])) && text.includes("24 – 10"))
record("results: nothing on the page calls a club 'not in Ovalball'", !/not in ovalball/i.test(text))
await open("?view=tables")
const groupA = (await anon.getByRole("region", { name: "Group A" }).innerText().catch(async () => anon.locator("section").filter({ hasText: "Group A" }).first().innerText())).split("\n").map((l) => l.trim()).filter(Boolean)
const leader = groupA.find((l) => l.startsWith("1"))
record("tables: the external v external result counts -- its winner tops Group A", groupA.join(" ").includes(name(p[1])) && (groupA.join("\t").indexOf(name(p[1])) < groupA.join("\t").indexOf(name(p[0]))), groupA.slice(0, 8).join(" / "))
record("tables: four points for the win, one played", /\b1\b.*\b1\b.*\b0\b.*\b0\b.*14.*\b4\b/.test(groupA.join(" ")), leader ?? "")
text = await open("?view=bracket")
record("bracket: the final shows both semi-final winners, clubs not on Ovalball", text.includes("Final") && text.includes(name(p[1])) && text.includes(name(p[3])))
record("bracket: the third-place playoff is named as such", text.includes("Third Place"))

// ---------------------------------------------------------------------
// 390px
// ---------------------------------------------------------------------
await anon.setViewportSize({ width: 390, height: 844 })
for (const view of ["", "?view=results", "?view=tables", "?view=bracket"]) {
  await open(view)
  const overflow = await anon.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record(`390px: ${view || "upcoming"} does not scroll sideways`, overflow <= 1, `${overflow}px`)
}
await open("?view=results")
const filterBox = await anon.getByLabel("Club", { exact: true }).boundingBox()
record("390px: the filters are usable (on screen, tappable)", Boolean(filterBox && filterBox.x >= 0 && filterBox.x + filterBox.width <= 390 && filterBox.height >= 36), JSON.stringify(filterBox))
await open("?view=bracket")
const scroller = await anon.evaluate(() => {
  const box = [...document.querySelectorAll("main div")].find((d) => getComputedStyle(d).overflowX === "auto" && d.scrollWidth > d.clientWidth)
  return box ? { client: box.clientWidth, scroll: box.scrollWidth } : null
})
record("390px: the bracket scrolls sideways inside its own box", Boolean(scroller), JSON.stringify(scroller))

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
await browser.close()
cleanup()
cleaned = true
process.exit(summarise() ? 0 : 1)
