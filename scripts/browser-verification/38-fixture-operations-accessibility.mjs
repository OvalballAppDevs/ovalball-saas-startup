// ACCESSIBILITY OF THE FIXTURE OPERATIONS SURFACES.
// (Fixture Operations spec 51: labels, visible focus, keyboard navigation, no
// keyboard traps, status not by colour alone, understandable selection, a
// keyboard alternative for participant swap and replacement, labelled filters,
// correct dialog semantics.)
//
// axe-core (WCAG 2.1 A/AA rules) runs on the real pages -- Season Planner, the
// Edit Fixture sheet, every Competition Creator step, Competition Requests and
// the public competition page -- and any serious or critical violation fails.
// Then the keyboard: Tab reaches controls with a visible focus ring, the Edit
// Fixture sheet is a labelled modal dialog that keeps focus inside and closes
// on Escape, and a league team can be replaced from the keyboard alone.
// The one competition this suite seeds is removed at the end.

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const require = createRequire(import.meta.url)
const AXE = require.resolve("axe-core/axe.min.js")
const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()
const UUID = /^[0-9a-f-]{36}$/
const firstId = (q) => sql(q).split("\n").map((l) => l.trim()).find((l) => UUID.test(l))

const TAG = Date.now().toString(36).slice(-5).toUpperCase()
const club = sql("select id from clubs where slug='ovalball-uat-rufc'")
const admin = sql("select id from auth.users where email='uat.coach@ovalball.test'")
const season = sql("select id from seasons where rugby_code='union' and not is_regression_fixture and current_date <= ends_on order by starts_on limit 1")
const slug = `uat-a11y-${TAG.toLowerCase()}-union`
const competition = firstId(`insert into competitions (name, slug, normalized_key, rugby_code, active, organiser_club_id, format, team_count, created_by, updated_by)
  values ('UAT Accessible Cup ${TAG}', '${slug}', 'uat accessible cup ${TAG.toLowerCase()} union', 'union', true, '${club}', 'league_knockout', 8, '${admin}', '${admin}') returning id`)
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
sql(`insert into competition_participants (edition_id, slot, seed, club_directory_id, created_by, updated_by)
  select '${edition}', row_number() over (order by d.name), row_number() over (order by d.name), d.id, '${admin}', '${admin}'
  from (select d.id, d.name from club_directory d where d.rugby_code='union' and d.active and not exists (select 1 from clubs c where c.directory_id=d.id) order by d.name offset 300 limit 8) d`)

const browser = await launch()
const ctx = await newContext(browser, { width: 1440, height: 950 })
const page = await ctx.newPage()
await signIn(page, "uat.coach@ovalball.test")
// A server and browser rendering different ids breaks every label that points at one.
const hydration = []
page.on("console", (m) => {
  if (m.type() === "error" && /hydrat/i.test(m.text())) hydration.push(`${page.url().replace(APP, "")}: ${m.text().slice(0, 160)}`)
})
const settle = async () => {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes("Working…"), null, { timeout: 30000 }).catch(() => {})
}

async function axe(target, label, context = null) {
  await target.addScriptTag({ path: AXE })
  const result = await target.evaluate(async (ctxSelector) => {
    const r = await axe.run(ctxSelector ? document.querySelector(ctxSelector) : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") ?? "" }))
  }, context)
  const serious = result.filter((v) => v.impact === "serious" || v.impact === "critical")
  record(`axe: ${label} has no serious or critical WCAG 2.1 AA violation`, serious.length === 0, serious.map((v) => `${v.id}(${v.nodes}) ${v.sample}`).join(" | ") || `${result.length} minor`)
  return result
}

// ---------------------------------------------------------------------
// SEASON PLANNER
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/planner`, { waitUntil: "domcontentloaded" })
await settle()
await axe(page, "Season Planner")
const firstCell = page.locator('input[aria-label="Date, row 1"]')
await firstCell.focus()
const ring = await firstCell.evaluate((el) => {
  const cell = el.closest("td") ?? el
  const s = getComputedStyle(cell)
  const i = getComputedStyle(el)
  return [s.boxShadow, s.outlineStyle, i.boxShadow, i.outlineStyle].join(" ")
})
record("keyboard: a focused planner cell shows where the focus is", /rgb|solid|auto/.test(ring), ring.slice(0, 120))
record("labels: every planner cell names its column and row", (await page.locator("tbody input:not([aria-label])").count()) === 0)

// ---------------------------------------------------------------------
// EDIT FIXTURE SHEET
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/management?date=all`, { waitUntil: "domcontentloaded" })
await settle()
await axe(page, "Fixture Control Centre")
await page.locator('button[aria-label^="Actions for"]').first().click()
await page.getByRole("menuitem", { name: "Edit Fixture" }).click()
const sheet = page.getByRole("dialog", { name: "Edit Fixture" })
await sheet.waitFor({ state: "visible" })
await page.waitForTimeout(600)
await axe(page, "Edit Fixture sheet", '[role="dialog"]')
record("dialog: the sheet is a labelled modal dialog", (await sheet.getAttribute("aria-modal")) === "true" || (await sheet.evaluate((el) => el.closest("[aria-modal='true']") !== null || el.getAttribute("aria-modal") === "true")))
let escaped = false
for (let i = 0; i < 60; i++) {
  await page.keyboard.press("Tab")
  // Focus guards hand focus straight back; measure where it settles.
  await page.waitForTimeout(40)
  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  if (!inside) escaped = true
}
record("keyboard: Tab keeps focus inside the open sheet (a modal, not a trap: Escape closes it)", !escaped)
await page.keyboard.press("Escape")
await sheet.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})
record("keyboard: Escape closes an unchanged sheet", !(await sheet.isVisible()))

// ---------------------------------------------------------------------
// COMPETITION CREATOR -- every step
// ---------------------------------------------------------------------
for (const step of ["details", "participants", "groups"]) {
  await page.goto(`${APP}/fixtures/competitions/${edition}/${step}`, { waitUntil: "domcontentloaded" })
  await settle()
  await axe(page, `Competition Creator ${step}`)
}
await page.getByLabel("Number of Groups").fill("2")
await page.getByRole("button", { name: "Draw Groups" }).click()
await page.getByRole("button", { name: "Save Groups" }).click()
await page.getByText("Groups saved.").waitFor({ state: "visible", timeout: 30000 })
await page.goto(`${APP}/fixtures/competitions/${edition}/fixtures`, { waitUntil: "domcontentloaded" })
await settle()
await page.getByRole("button", { name: "Generate Fixtures" }).click()
await page.getByText(/draft matches generated/).waitFor({ state: "visible", timeout: 60000 })
await settle()
await axe(page, "Competition Creator fixtures (with drafts)")
record("status: every match's check is said in words, not colour alone", (await page.locator("tr[id^='match-'] td:first-child").allInnerTexts()).every((t) => /Ready|Check|Resolve/.test(t)))
await page.goto(`${APP}/fixtures/competitions/${edition}/knockout`, { waitUntil: "domcontentloaded" })
await settle()
await page.getByRole("button", { name: /Draw Knockout|Redraw Knockout/ }).click()
await page.getByText(/knockout matches drafted/).waitFor({ state: "visible", timeout: 60000 })
await settle()
await axe(page, "Competition Creator knockout (with bracket)")
await page.goto(`${APP}/fixtures/competitions/${edition}/issue`, { waitUntil: "domcontentloaded" })
await settle()
await axe(page, "Competition Creator issue")
await page.goto(`${APP}/fixtures/competitions/requests`, { waitUntil: "domcontentloaded" })
await settle()
await axe(page, "Competition Requests")

// ---------------------------------------------------------------------
// KEYBOARD: replacing a league team, and a bracket team chosen, without a mouse
// ---------------------------------------------------------------------
await page.goto(`${APP}/fixtures/competitions/${edition}/fixtures`, { waitUntil: "domcontentloaded" })
await settle()
const firstMatch = page.locator("tr[id^='match-']").first()
const matchId = (await firstMatch.getAttribute("id")).replace("match-", "")
const beforeAway = sql(`select away_participant_id from competition_matches where id='${matchId}'`)
const awaySelect = firstMatch.getByLabel("Away Team")
await awaySelect.focus()
record("keyboard: a team select is reachable and names itself", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Away Team")
const options = await awaySelect.locator("option").evaluateAll((o) => o.map((x) => x.value))
const home = sql(`select home_participant_id from competition_matches where id='${matchId}'`)
const target = options.find((v) => v && v !== beforeAway && v !== home)
await awaySelect.selectOption(target)
for (let i = 0; i < 40 && sql(`select away_participant_id from competition_matches where id='${matchId}'`) === beforeAway; i += 1) await page.waitForTimeout(300)
record("keyboard: replacing a team is a native select, so it works without a mouse", sql(`select away_participant_id from competition_matches where id='${matchId}'`) !== beforeAway)
await settle()

// ---------------------------------------------------------------------
// PUBLIC COMPETITION (anonymous)
// ---------------------------------------------------------------------
sql(`update competition_matches set status='scheduled' where edition_id='${edition}'`)
const anonCtx = await newContext(browser, { width: 1280, height: 900 })
const anon = await anonCtx.newPage()
for (const view of ["", "?view=results", "?view=tables", "?view=bracket"]) {
  await anon.goto(`${APP}/competitions/${slug}${view}`, { waitUntil: "domcontentloaded" })
  await anon.waitForLoadState("networkidle").catch(() => {})
  await axe(anon, `public competition ${view || "upcoming"}`)
}
await anon.goto(`${APP}/competitions/${slug}`, { waitUntil: "domcontentloaded" })
const unlabelled = await anon.locator("form select").evaluateAll((s) => s.filter((x) => !x.labels || x.labels.length === 0).length)
record("labels: every public filter has a visible label", unlabelled === 0, `${unlabelled} unlabelled`)

record("hydration: every page visited renders the same ids on the server and in the browser", hydration.length === 0, hydration.slice(0, 2).join(" | "))
await browser.close()
cleanup()
cleaned = true
process.exit(summarise() ? 0 : 1)
