// KNOCKOUT DRAW -- a bracket the organiser can shape before it is issued.
// (Fixture Operations brief, Knockout: random/seeded/manual draw, one or two legs,
// third place, final venue, byes, a visual bracket, and draft matches editable.)
//
// A six-team knockout is seeded directly (suite 31 proves how participants are
// entered). Then, as its organiser, with real clicks:
//   * before drawing, the draw names which teams will get byes;
//   * a seeded draw of six fills a draw of eight, the top two seeds taking byes
//     straight to the semi-finals;
//   * the bracket names what is not yet known ("Winner of Quarter-Final 2"), the
//     final is at the chosen venue, and the third-place playoff is drawn;
//   * choosing a team in one quarter-final and then a team in the other swaps them;
//   * the Ties table swaps home and away on a tie, and choosing a team from the
//     other tie swaps the two in one save;
//   * a redraw with two legs, neutral grounds and the final decided later, and
//     a manual slot-order draw, are stored as asked;
//   * every change is the stored Competition Match, not a browser copy.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const club = sql("select id from clubs where slug='ovalball-uat-rufc'")
const admin = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const season = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1")
const firstRound = sql(`select greatest(current_date + 21, starts_on + 60) from seasons where id='${season}'`)
const competition = firstId(`insert into competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, format, team_count, created_by, updated_by)
  values ('UAT Knockout ${TAG}', 'uat-knockout-${TAG.toLowerCase()}-union', 'uat knockout ${TAG.toLowerCase()} union', 'union', true, '${club}', 'knockout', 6, '${admin}', '${admin}') returning id`)
const edition = firstId(`insert into competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by) values ('${competition}', '${season}', 'union', true, '${admin}', '${admin}') returning id`)
sql(`insert into competition_participants (edition_id, slot, seed, club_directory_id, created_by, updated_by)
  select '${edition}', row_number() over (order by d.name), row_number() over (order by d.name), d.id, '${admin}', '${admin}'
  from (select d.id, d.name from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name offset 40 limit 6) d`)
const seeds = sql(`select d.name from competition_participants p join club_directory d on d.id=p.club_directory_id where p.edition_id='${edition}' order by p.seed`).split("\n")
record("seed: six seeded participants entered", seeds.length === 6)

// Pairings as stored: "round|slot|home|away", names or the slot's own label.
const pairings = () =>
  sql(`select m.round_number || '|' || m.bracket_slot || '|' || coalesce(hd.name, m.home_source->>'label') || '|' || coalesce(ad.name, m.away_source->>'label')
       from competition_matches m
       left join competition_participants hp on hp.id=m.home_participant_id left join club_directory hd on hd.id=hp.club_directory_id
       left join competition_participants ap on ap.id=m.away_participant_id left join club_directory ad on ad.id=ap.club_directory_id
       where m.edition_id='${edition}' order by m.round_number, m.bracket_slot, (m.home_source ? 'loser_of')`)
    .split("\n")
    .filter(Boolean)
const roundOne = () => pairings().filter((p) => p.startsWith("1|"))

const browser = await launch()
const ctx = await newContext(browser, { width: 1512, height: 950 })
const page = await ctx.newPage()
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
await signIn(page, "uat.coach@ovalball.test")
const settle = () => page.waitForLoadState("networkidle").catch(() => {})
// Each step is keyed by the workspace version, so the refresh that follows a
// save REMOUNTS it from the saved settings. A control changed while a save is
// still in flight is put back when that refresh lands, and the next draw uses
// the old settings. So before changing the draw settings, wait until the step
// is stable: the draw button enabled (nothing saving) and the same step still
// mounted a moment later (no refresh arriving).
const stepHandle = () => page.getByLabel("Legs").elementHandle()
async function stableStep() {
  for (let i = 0; i < 20; i += 1) {
    await settle()
    const handle = await stepHandle()
    await page.waitForTimeout(1500)
    const mounted = await handle.evaluate((el) => el.isConnected).catch(() => false)
    const ready = await page.getByRole("button", { name: /^(Redraw|Draw) Knockout$/ }).isEnabled().catch(() => false)
    if (mounted && ready) return
  }
}

await page.goto(`${APP}/fixtures/competitions/${edition}/knockout`, { waitUntil: "domcontentloaded" })
await settle()
record("draw: six teams are placed in a draw of eight, two byes to the top seeds", (await page.getByText("6 teams in a draw of 8, 2 byes to the top seeds.").count()) === 1)

// ---------------------------------------------------------------------
// DRAW
// ---------------------------------------------------------------------
await page.getByLabel("Draw", { exact: true }).selectOption("seeded")
await page.getByLabel("First Round Date").fill(firstRound)
await page.getByLabel("Third-Place Playoff").check()
await page.getByLabel("Home Side").selectOption("seeded")
await page.getByLabel("Final Venue").selectOption("neutral")
await page.getByLabel("Neutral Ground").fill(`Final Ground ${TAG}`)
const byeLine = (await page.getByText(/^Byes to the next round:/).innerText()).trim()
record("byes: before drawing, the draw says which teams get byes", byeLine.includes(seeds[0]) && byeLine.includes(seeds[1]), byeLine)
await page.getByRole("button", { name: "Draw Knockout" }).click()
await page.getByText("6 knockout matches drafted, with 2 byes.").waitFor({ state: "visible", timeout: 30000 })
await settle()

const bracket = page.getByRole("region", { name: "Bracket" })
const bracketText = (await bracket.innerText()).replace(/\s+/g, " ")
record("bracket: quarter-finals, semi-finals and the final are drawn", ["Quarter-Finals", "Semi-Finals", "Final"].every((t) => bracketText.includes(t)), bracketText.slice(0, 160))
const r1 = roundOne()
record("byes: only two quarter-finals are played", r1.length === 2, r1.join(" / "))
const semis = pairings().filter((p) => p.startsWith("2|"))
record("byes: the top two seeds go straight to the semi-finals", semis.some((p) => p.includes(seeds[0])) && semis.some((p) => p.includes(seeds[1])) && semis.every((p) => /Winner of Quarter-Final \d/.test(p)), semis.join(" / "))
record("bracket: a place not yet known is named by where it comes from", bracketText.includes("Winner of Quarter-Final"))
record("third place: the semi-final losers meet", pairings().some((p) => p.includes("Loser of Semi-Final 1") && p.includes("Loser of Semi-Final 2")))
record("final: the chosen venue is on the final", sql(`select venue_text from competition_matches where edition_id='${edition}' and round_number=3 and bracket_slot=1`) === `Final Ground ${TAG}`)

// ---------------------------------------------------------------------
// SWAP TEAMS BETWEEN TIES
// ---------------------------------------------------------------------
const [, , aHome, aAway] = r1[0].split("|")
const [, , bHome, bAway] = r1[1].split("|")
const teamA = bracket.getByRole("button", { name: aAway, exact: true })
await teamA.click()
record("swap: the first team chosen is shown as chosen", (await teamA.getAttribute("aria-pressed")) === "true")
await bracket.getByRole("button", { name: bAway, exact: true }).click()
const expected = [`${r1[0].split("|").slice(0, 3).join("|")}|${bAway}`, `${r1[1].split("|").slice(0, 3).join("|")}|${aAway}`]
for (let i = 0; i < 40 && roundOne().join() !== expected.join(); i += 1) await page.waitForTimeout(300)
await settle()
const swapped = roundOne()
record("swap: the two teams change ties, and the stored matches say so", swapped.join() === expected.join(), swapped.join(" / "))
await page.getByRole("region", { name: "Bracket" }).getByRole("button", { name: aAway, exact: true }).waitFor({ state: "visible" })
record("swap: the bracket shows the new ties", (await bracket.locator("li").filter({ hasText: aAway }).first().innerText()).includes(bHome))
record("swap: the teams who did not move stay where they were", swapped[0].includes(aHome) && swapped[1].includes(bHome))

// ---------------------------------------------------------------------
// HOME AND AWAY IN THE TIES TABLE
// ---------------------------------------------------------------------
const ties = page.getByRole("table", { name: "Ties" })
record("ties: every knockout match is listed for dates and venues", (await ties.locator("tbody tr").count()) === 6)
await ties.locator("tbody tr").first().getByRole("button", { name: "Swap Home and Away" }).click()
const turned = `${swapped[0].split("|")[0]}|${swapped[0].split("|")[1]}|${bAway}|${aHome}`
for (let i = 0; i < 30 && roundOne()[0] !== turned; i += 1) await page.waitForTimeout(300)
record("ties: Swap Home and Away turns the tie round in the stored match", roundOne()[0] === turned, roundOne()[0])
record("ties: a knockout tie cannot be removed on its own", (await ties.getByRole("button", { name: /Remove/ }).count()) === 0)

// ---------------------------------------------------------------------
// REPLACE A TEAM FROM THE TIES TABLE: a team from the other tie swaps in one save
// ---------------------------------------------------------------------
const beforeReplace = roundOne()
const [, , r0Home, r0Away] = beforeReplace[0].split("|")
const [, , r1Home] = beforeReplace[1].split("|")
await ties.locator("tbody tr").first().getByLabel("Away Team").selectOption({ label: r1Home })
const replaced = [`${beforeReplace[0].split("|").slice(0, 3).join("|")}|${r1Home}`, `${beforeReplace[1].split("|").slice(0, 2).join("|")}|${r0Away}|${beforeReplace[1].split("|")[3]}`]
for (let i = 0; i < 40 && roundOne().join() !== replaced.join(); i += 1) await page.waitForTimeout(300)
record("replace: choosing a team from the other tie swaps the two teams, and nobody plays twice", roundOne().join() === replaced.join(), roundOne().join(" / "))
record("replace: the team that was chosen over keeps a tie", roundOne().some((p) => p.includes(r0Away)) && roundOne().some((p) => p.includes(r0Home)))
await stableStep()

// ---------------------------------------------------------------------
// REDRAW: two legs, neutral grounds, the final decided later
// ---------------------------------------------------------------------
await page.getByLabel("Legs").selectOption("2")
await page.getByLabel("Home Side").selectOption("neutral")
await page.getByLabel("Final Venue").selectOption("later")
await page.getByRole("button", { name: "Redraw Knockout" }).click()
await page.getByText(/knockout matches drafted, with 2 byes/).waitFor({ state: "visible", timeout: 30000 })
// The notice from the first draw reads the same: wait for the stored redraw itself.
for (let i = 0; i < 60 && sql(`select count(*) from competition_matches where edition_id='${edition}' and round_number=1`) !== "4"; i += 1) await page.waitForTimeout(300)
const legs = sql(`select count(*) filter (where round_number = 1) || '|' || count(*) filter (where round_number = 2) || '|' || count(*) filter (where venue_id is not null or venue_text is not null) from competition_matches where edition_id='${edition}'`)
record("two legs: each quarter-final and semi-final is two matches, the final and third place one each", legs.startsWith("4|4|"), legs)
record("neutral grounds and a final decided later: no match is given a club's ground", legs.endsWith("|0"), legs)
await settle()
const savedByeLine = await page.getByText(/^Byes in this draw, straight into round two:/).innerText()
record("byes: the saved two-legged draw names who went straight through, each team once", savedByeLine.split(seeds[0]).length === 2 && savedByeLine.split(seeds[1]).length === 2, savedByeLine)

await stableStep()
await page.getByLabel("Draw", { exact: true }).selectOption("manual")
await page.getByLabel("Legs").selectOption("1")
await page.getByRole("button", { name: "Redraw Knockout" }).click()
await page.getByText(/knockout matches drafted/).waitFor({ state: "visible", timeout: 30000 })
// As above, the earlier notice still matches: wait (up to the notice's own 30s) for the stored redraw.
for (let i = 0; i < 100 && sql(`select count(*) from competition_matches where edition_id='${edition}' and round_number=1`) !== "2"; i += 1) await page.waitForTimeout(300)
const manual = sql(`select count(*) from competition_matches where edition_id='${edition}' and round_number = 1 and home_participant_id is not null and away_participant_id is not null`)
record("manual draw: slot order gives two played ties and no tie of two byes", manual === "2", manual)

record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))

sql(`delete from competition_matches where edition_id='${edition}'`)
sql(`delete from competition_stages where edition_id='${edition}'`)
sql(`delete from competition_participants where edition_id='${edition}'`)
sql(`delete from competition_editions where id='${edition}'`)
sql(`delete from competitions where id='${competition}'`)
await browser.close()
process.exit(summarise() ? 0 : 1)
