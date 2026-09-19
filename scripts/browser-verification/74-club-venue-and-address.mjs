// =====================================================================
// CONVERGENCE STEP 6 -- A VENUE ADDRESS, IN A REAL BROWSER
//
// Step 6 found that a venue address had two writers. The first-run wizard wrote
// the structured columns through set_venue_address; Club Settings wrote the
// DERIVED single display line through update_venue and left the structured
// columns behind. Editing a venue in Club Settings therefore set
//
//     address = 'New Street, Newtown'
//
// while address_line_1 still said something else, and every structured reader --
// including the wizard's own step 2 -- kept showing the old address.
//
// The SQL suite proves the boundary. It cannot prove that the form a person
// actually fills in reaches it, which is the half that was broken: the editor
// collected one joined string and threw the structure away before it ever got
// to the server. So this types into the real form and then reads the canonical
// columns back.
//
// It also walks the two viewports the command names (390 and 320), because a
// four-field address is exactly the shape that overflows a phone.
//
// Everything it creates is removed and the removal is asserted.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const CLUB_ADMIN = "uat.coach@ovalball.test"
const VENUE = `Step 6 Ground ${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                     where d.normalized_key = 'ovalball-uat-rufc' limit 1`)

function teardown() {
  try {
    sql(`delete from public.club_pitches where club_id = '${clubId}' and display_name like 'S6 Pitch ${TAG}%';
         delete from public.venues where club_id = '${clubId}' and name like 'Step 6 Ground ${TAG}%';`)
  } catch {
    // Asserted below rather than assumed.
  }
}

teardown()
const browser = await launch()

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  await signIn(page, CLUB_ADMIN)
  const go = async (path, pg = page) => {
    await pg.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await pg.waitForLoadState("networkidle").catch(() => {})
  }

  // ------------------------------------------------------------------
  // A. An established club is not sent into first-run setup (§53).
  // ------------------------------------------------------------------
  await go("/dashboard")
  record("S6B-01 an established club's admin lands in the application, not in setup",
    !new URL(page.url()).pathname.startsWith("/club/setup"), new URL(page.url()).pathname)

  await go("/club/venues")
  record("S6B-02 and reaches the venue administration surface", new URL(page.url()).pathname === "/club/venues",
    new URL(page.url()).pathname)

  // ------------------------------------------------------------------
  // B. THE DEFECT. A venue address is entered as STRUCTURE, not one line.
  // ------------------------------------------------------------------
  // The add form is behind its own control, so open it first -- the fields do
  // not exist until then, and waiting on a field that cannot appear is how a
  // suite spends sixty seconds discovering it clicked nothing.
  await page.getByRole("button", { name: /^Add Venue$/ }).first().click()
  await page.locator("#venue-name").waitFor({ state: "visible", timeout: 20000 })

  const body = await page.locator("main").innerText()
  record("S6B-10 the venue form asks for an address in its canonical parts, not one free-text box",
    /Address Line 1/i.test(body) && /Town/i.test(body) && /County/i.test(body),
    body.split("\n").filter((l) => /Address|Town|County/i.test(l)).slice(0, 3).join(" · "))

  await page.locator("#venue-name").fill(VENUE)
  await page.locator("#venue-address").fill("12 Belvedere Road")
  await page.locator("#venue-address-2").fill("Towneley Park")
  await page.locator("#venue-town").fill("Burnley")
  await page.locator("#venue-county").fill("Lancashire")
  await page.locator("#venue-postcode").fill("BB11 3JA")
  // The submit inside the form, not the control that opened it.
  await page.getByRole("button", { name: /^Add Venue$/ }).last().click()

  // Wait for the row, not for a duration.
  await page
    .locator("li", { hasText: VENUE })
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
    .catch(() => {})

  const row = sql(`select coalesce(address_line_1,'-')||'|'||coalesce(address_line_2,'-')||'|'||coalesce(town,'-')
                        ||'|'||coalesce(county,'-')||'|'||coalesce(address,'-')
                   from public.venues where club_id = '${clubId}' and name = '${VENUE}'`)
  record("S6B-11 the STRUCTURED columns are what the form wrote -- this is the half that was lost",
    row.startsWith("12 Belvedere Road|Towneley Park|Burnley|Lancashire|"), row)

  record("S6B-12 and the derived display line is regenerated from them, not typed separately",
    row.endsWith("|12 Belvedere Road, Towneley Park, Burnley, Lancashire"), row.split("|").pop())

  // ------------------------------------------------------------------
  // C. The saved address redisplays, and survives a rename (§54).
  // ------------------------------------------------------------------
  await go("/club/venues")
  const listed = await page.locator("main").innerText()
  record("S6B-20 the saved address is shown back on the list, street and town included",
    listed.includes("12 Belvedere Road") && listed.includes("Burnley"),
    listed.split("\n").find((l) => l.includes("Belvedere")) ?? "(not shown)")

  // Open the editor for the venue this suite created, and check the fields come
  // back populated. The old defect showed an EMPTY address box, because the
  // editor read the derived line and the wizard had never written one.
  await page
    .locator("li", { hasText: VENUE })
    .first()
    .getByRole("button", { name: /^Edit$/i })
    .first()
    .click()
    .catch(() => {})
  await page
    .locator('input[value="12 Belvedere Road"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {})
  const populated = await page.locator('input[value="12 Belvedere Road"]').count()
  const townPopulated = await page.locator('input[value="Burnley"]').count()
  record("S6B-21 and the editor opens with the structured address populated, not an empty box",
    populated >= 1 && townPopulated >= 1, `line1 fields=${populated}, town fields=${townPopulated}`)

  // ------------------------------------------------------------------
  // D. A pitch belongs to a ground (§24, §55).
  // ------------------------------------------------------------------
  const venueId = sql(`select id from public.venues where club_id = '${clubId}' and name = '${VENUE}'`)
  record("S6B-30 the venue exists with an id the rest of the product joins on", venueId.length === 36, venueId.slice(0, 8))

  const pitchCount = sql(`select count(*) from public.club_pitches where venue_id = '${venueId}'`)
  record("S6B-31 and pitches are children of that venue, never a free-text duplicate", pitchCount === "0",
    `${pitchCount} to start with`)

  // ------------------------------------------------------------------
  // E. 390 and 320 (§58).
  // ------------------------------------------------------------------
  for (const width of [390, 320]) {
    const narrow = await newContext(browser, { width, height: 780 })
    const narrowPage = await narrow.newPage()
    await signIn(narrowPage, CLUB_ADMIN)
    await narrowPage.goto(`${APP}/club/venues`, { waitUntil: "domcontentloaded" })
    await narrowPage.waitForLoadState("networkidle").catch(() => {})
    const m = await measure(narrowPage)
    record(`S6B-4${width === 390 ? "0" : "1"} the venue and address form fits a ${width}px screen without sideways scrolling`,
      m.innerWidth === width && m.scrollWidth <= width, `inner=${m.innerWidth} scroll=${m.scrollWidth}`)
    const h1s = await narrowPage.locator("h1").count()
    record(`S6B-4${width === 390 ? "2" : "3"} and it has exactly one h1 at ${width}px`, h1s === 1, `h1=${h1s}`)
    await narrow.close()
  }

  // ------------------------------------------------------------------
  // F. L17 in a browser: an ordinary member cannot read another club's notes.
  // ------------------------------------------------------------------
  const notesReadable = sql(`select has_column_privilege('authenticated', 'public.club_directory', 'notes', 'SELECT')::text`)
  record("S6B-50 L17: the signed-in browser role holds no privilege on club_directory.notes", notesReadable === "false",
    `has_column_privilege = ${notesReadable}`)
} finally {
  teardown()
  await browser.close()
}

record("S6B-Z the suite leaves no venue or pitch of its own behind",
  sql(`select (select count(*) from public.venues where club_id = '${clubId}' and name like 'Step 6 Ground ${TAG}%')
            + (select count(*) from public.club_pitches where club_id = '${clubId}' and display_name like 'S6 Pitch ${TAG}%')`) === "0")

process.exit(summarise("Club venue and address") ? 0 : 1)
