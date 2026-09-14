// SMALL CORRECTIONS TO A DRAWN LEAGUE -- without rebuilding it.
// (Fixture Operations spec 28-30: edit a generated match, replace either team,
// swap a team between two matches, move a round, change venue and pitch, add a
// match; warn when hand edits break the requested schedule.)
//
// A League competition of 8 is seeded directly -- Ovalball UAT RUFC's and
// Preston's Under 12 Boys and six clubs not on Ovalball -- in two groups of
// four (suites 31 and 32 prove how participants and groups are entered). Then,
// as the organising club's Club Admin, with real input:
//   * the schedule is generated, every opponent once;
//   * choosing a team who already plays that round swaps the two teams between
//     the matches, in ONE request, and nobody plays twice that round;
//   * a pitch is chosen at a club's ground;
//   * a match is moved to another round, taking that round's date;
//   * a draft match is removed, and a match is added to a round by hand, at the
//     home team's usual ground;
//   * choosing a team from another match of the round moves it in, and the team
//     it replaced takes its place;
//   * the hand edits that break "every opponent once" are said, not blocked.
// Everything this run creates is removed at the end.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const club = sql("select id from clubs where slug='ovalball-uat-rufc'")
const preston = sql("select id from clubs where slug='preston-grasshoppers-uat'")
if (!club || !preston) {
  console.error("Missing UAT data: run supabase/seeds/local_uat_fixture_operations.sql")
  process.exit(1)
}
const admin = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const season = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1")
const roundOneDate = sql(`select greatest(current_date + 35, starts_on + 70) from seasons where id='${season}'`)

const competition = firstId(`insert into competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, format, team_count, created_by, updated_by)
  values ('UAT League Edits ${TAG}', 'uat-league-edits-${TAG.toLowerCase()}-union', 'uat league edits ${TAG.toLowerCase()} union', 'union', true, '${club}', 'league', 8, '${admin}', '${admin}') returning id`)
const edition = firstId(`insert into competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by) values ('${competition}', '${season}', 'union', true, '${admin}', '${admin}') returning id`)

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

// Two Ovalball teams (with grounds) and six clubs not on Ovalball.
sql(`insert into competition_participants (edition_id, slot, club_directory_id, club_id, team_id, created_by, updated_by)
  select '${edition}', s, c.directory_id, c.id, t.id, '${admin}', '${admin}' from (values ('${club}'::uuid, 1), ('${preston}'::uuid, 2)) v(club, s)
  join clubs c on c.id = v.club join teams t on t.club_id = c.id and t.display_name = 'Under 12 Boys' and t.active`)
sql(`insert into competition_participants (edition_id, slot, club_directory_id, created_by, updated_by)
  select '${edition}', 2 + row_number() over (order by d.name), d.id, '${admin}', '${admin}'
  from (select d.id, d.name from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name offset 80 limit 6) d`)
const ids = sql(`select id from competition_participants where edition_id='${edition}' order by slot`).split("\n")
const stage = firstId(`insert into competition_stages (edition_id, kind, name, sort_order, settings) values ('${edition}', 'league', 'Group Stage', 1, '{}') returning id`)
const gA = firstId(`insert into competition_groups (stage_id, name, sort_order) values ('${stage}', 'Group A', 1) returning id`)
const gB = firstId(`insert into competition_groups (stage_id, name, sort_order) values ('${stage}', 'Group B', 2) returning id`)
// Group A: Ovalball UAT RUFC, two externals, Preston is in Group B.
const groupA = [ids[0], ids[2], ids[3], ids[4]]
const groupB = [ids[1], ids[5], ids[6], ids[7]]
sql(`insert into competition_group_members (group_id, stage_id, participant_id, position) values ${groupA.map((id, i) => `('${gA}', '${stage}', '${id}', ${i + 1})`).join(", ")}, ${groupB.map((id, i) => `('${gB}', '${stage}', '${id}', ${i + 1})`).join(", ")}`)
const nameOf = (id) => sql(`select d.name || coalesce(' ' || t.display_name, '') from competition_participants p join club_directory d on d.id=p.club_directory_id left join teams t on t.id=p.team_id where p.id='${id}'`)
record("seed: eight participants in two groups of four", sql(`select count(*) from competition_group_members where stage_id='${stage}'`) === "8")

const matchesOf = () =>
  sql(`select m.id || '|' || m.round_number || '|' || coalesce(m.home_participant_id::text, '') || '|' || coalesce(m.away_participant_id::text, '') || '|' || coalesce(m.venue_id::text, '') || '|' || coalesce(m.venue_text, '') || '|' || coalesce(m.pitch_id::text, '') || '|' || coalesce(m.match_date::text, '') || '|' || coalesce(m.group_id::text, '')
       from competition_matches m where m.edition_id='${edition}' order by m.round_number, m.group_id, m.id`)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [id, round, home, away, venueId, venueText, pitchId, date, group] = l.split("|")
      return { id, round: Number(round), home, away, venueId, venueText, pitchId, date, group }
    })

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")
// Settled means the step has finished its save AND its refresh ("Working…" gone).
const settle = async () => {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes("Working…"), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(400)
}
let posts = 0
page.on("request", (r) => {
  if (r.method() === "POST") posts += 1
})
const waitFor = async (check, ms = 15000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await page.waitForTimeout(300)
  }
  return check()
}

// ---------------------------------------------------------------------
// GENERATE
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/competitions/${edition}/fixtures`, { waitUntil: "domcontentloaded" })
await settle()
await page.getByLabel("Each Team Plays").selectOption("single")
await page.getByLabel("Round 1 Date").fill(roundOneDate)
await page.getByRole("button", { name: "Generate Fixtures" }).click()
await page.getByText(/12 draft matches generated/).waitFor({ state: "visible", timeout: 60000 })
await settle()
let all = matchesOf()
record("generate: every opponent once is 12 matches over 3 rounds", all.length === 12 && new Set(all.map((m) => m.round)).size === 3, `${all.length}`)

// ---------------------------------------------------------------------
// SWAP: in Group A's round 1 every team already plays, so choosing the other
// match's away team for the Ovalball UAT RUFC match swaps the two teams.
// ---------------------------------------------------------------------
const row = (id) => page.locator(`tr#match-${id}`)
const ourMatch = all.find((m) => m.round === 1 && m.group === gA && (m.home === ids[0] || m.away === ids[0]))
const ourSide = ourMatch.home === ids[0] ? "Home" : "Away"
const otherSide = ourSide === "Home" ? "Away" : "Home"
const otherId = ourSide === "Home" ? ourMatch.away : ourMatch.home
const otherGroupAMatch = all.find((m) => m.round === 1 && m.group === gA && m.id !== ourMatch.id)
const incoming = otherGroupAMatch.away
const postsBefore = posts
await row(ourMatch.id).getByLabel(`${otherSide} Team`).selectOption({ label: nameOf(incoming) })
await page.getByText(/swapped with/).waitFor({ state: "visible", timeout: 30000 })
await settle()
all = matchesOf()
const a1 = all.find((m) => m.id === ourMatch.id)
const b1 = all.find((m) => m.id === otherGroupAMatch.id)
record("swap: choosing a team who already plays that round swaps the two teams between the matches", (a1.home === incoming || a1.away === incoming) && (b1.home === otherId || b1.away === otherId), `${nameOf(incoming)} <-> ${nameOf(otherId)}`)
const roundOneTeams = all.filter((m) => m.round === 1 && m.group === gA).flatMap((m) => [m.home, m.away])
record("swap: nobody plays twice in that round, and nobody is left out", new Set(roundOneTeams).size === 4 && roundOneTeams.length === 4)
record("swap: both matches changed in one save (one request, not two)", posts - postsBefore <= 2, `${posts - postsBefore} POST requests including the page refresh`)
const scheduleText = (await page.locator("section[aria-labelledby='schedule-title']").innerText()).replace(/\s+/g, " ")
record("swap: the hand edit breaks 'every opponent once', and the page says so", /meet 2 times/.test(scheduleText), scheduleText.slice(-300) + " SETTINGS=" + sql(`select settings from competition_stages where id='${stage}'`))

// ---------------------------------------------------------------------
// PITCH at a club's ground: the Ovalball UAT RUFC home match
// ---------------------------------------------------------------------
let ourHome = all.find((m) => m.home === ids[0] && m.venueId)
if (!ourHome) {
  // Turn a match round so Ovalball UAT RUFC is at home, at its own ground.
  const any = all.find((m) => m.away === ids[0])
  await row(any.id).getByRole("button", { name: "Swap Home and Away" }).click()
  await waitFor(() => matchesOf().some((m) => m.id === any.id && m.home === ids[0]))
  await settle()
  ourHome = matchesOf().find((m) => m.id === any.id)
}
const pitch = row(ourHome.id).getByLabel("Pitch")
const pitchOptions = await pitch.locator("option").allInnerTexts()
record("pitch: a home match at a club's ground offers that ground's pitches", pitchOptions.length > 1, pitchOptions.join(", "))
await pitch.selectOption({ index: 1 })
await waitFor(() => Boolean(matchesOf().find((m) => m.id === ourHome.id)?.pitchId))
record("pitch: the chosen pitch is stored on the Competition Match", Boolean(matchesOf().find((m) => m.id === ourHome.id)?.pitchId))
await settle()

// ---------------------------------------------------------------------
// MOVE ROUND: a round 3 match moves to round 2 and takes round 2's date
// ---------------------------------------------------------------------
all = matchesOf()
const roundTwoDate = all.find((m) => m.round === 2)?.date
// From Group A, so Group B's round 3 stays whole for the remove and replace steps below.
const mover = all.find((m) => m.round === 3 && m.group === gA)
await row(mover.id).getByLabel("Round").selectOption("2")
await waitFor(() => matchesOf().find((m) => m.id === mover.id)?.round === 2)
await settle()
const moved = matchesOf().find((m) => m.id === mover.id)
record("move round: the match is now in round 2", moved.round === 2)
record("move round: and it follows round 2's date", moved.date === roundTwoDate, `${moved.date} / ${roundTwoDate}`)
await settle()

// ---------------------------------------------------------------------
// REMOVE + ADD MATCH: a Group B round 3 draft match is removed, and the same two
// teams are added back by hand the other way round
// ---------------------------------------------------------------------
all = matchesOf()
const doomed = all.find((m) => m.round === 3 && m.group === gB)
await row(doomed.id).getByRole("button", { name: "Remove this draft match" }).click()
await waitFor(() => !matchesOf().some((m) => m.id === doomed.id))
await settle()
record("remove: a draft match is removed on its own", !matchesOf().some((m) => m.id === doomed.id))
const countBefore = matchesOf().length
await page.getByRole("heading", { name: /^Round 3/ }).locator("xpath=../..").getByRole("button", { name: "Add Match" }).click()
const form = page.getByRole("group", { name: "Add a Match to Round 3" })
await form.getByLabel("Group").selectOption({ label: "Group B" })
await form.getByLabel("Home Team").selectOption({ label: nameOf(doomed.away) })
await form.getByLabel("Away Team").selectOption({ label: nameOf(doomed.home) })
await form.getByRole("button", { name: "Add to Round 3" }).click()
await page.getByText(/added to Round 3/).waitFor({ state: "visible", timeout: 30000 })
await settle()
const added = matchesOf().find((m) => m.round === 3 && m.home === doomed.away && m.away === doomed.home && m.group === gB)
record("add match: a match is added to round 3 by hand", matchesOf().length === countBefore + 1 && Boolean(added))
const homeGround = sql(`select v.id from competition_participants p join venues v on v.club_id = p.club_id and v.is_default_home and v.active where p.id='${doomed.away}'`)
record("add match: its ground is the home team's usual ground, or the ground recorded for a club not on Ovalball", homeGround ? added?.venueId === homeGround : added?.venueId === "", `${added?.venueId}${added?.venueText} / ${homeGround}`)

// ---------------------------------------------------------------------
// REPLACE across matches: the added match's away team becomes a team from the
// other Group B round 3 match -- the two swap, and round 3 stays whole.
// ---------------------------------------------------------------------
const otherB = matchesOf().find((m) => m.round === 3 && m.group === gB && m.id !== added.id)
await row(added.id).getByLabel("Away Team").selectOption({ label: nameOf(otherB.away) })
await waitFor(() => matchesOf().find((m) => m.id === added.id)?.away === otherB.away)
await settle()
record("replace: the chosen team moves into the match, and the team it replaced takes its place", matchesOf().find((m) => m.id === added.id)?.away === otherB.away && matchesOf().find((m) => m.id === otherB.id)?.away === doomed.home)
record("replace: no team plays twice in round 3", (() => {
  const r3 = matchesOf().filter((m) => m.round === 3).flatMap((m) => [m.home, m.away])
  return new Set(r3).size === r3.length
})())

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
await browser.close()
cleanup()
cleaned = true
record("cleanup: this run's competition is gone", sql(`select count(*) from competitions where id='${competition}'`) === "0")
process.exit(summarise() ? 0 : 1)
