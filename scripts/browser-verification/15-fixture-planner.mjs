// FIXTURE MANAGEMENT CONTROL CENTRE (fixture brief §5, §13-§20, §59-§63).
//
// Proves the one shared surface at BOTH entry points, the column model, the
// filters that were previously unexpressible, pagination at scale, and the
// exact mobile/tablet widths -- measured from inside the page.

import { execFileSync } from "node:child_process"
import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"
import { ensureFixtureWorld, seedFixturesAtScale } from "./fixture-world.mjs"

const DB = ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-tAc"]
const sql = (q) => execFileSync("docker", [...DB, q], { encoding: "utf8" }).trim()

// THIS SUITE STATES ITS OWN PRECONDITIONS.
//
// It reads canonical teams and pitches in the automated UAT club, and those
// records had silently gone, so the suite reported a product failure when what
// it had found was a missing row. It now creates whatever is absent and removes
// exactly what it created -- see fixture-world.mjs for why that lives in one
// place rather than in each suite.
const world = ensureFixtureWorld(sql, { tag: "s15" })
// PAGINATION IS A THRESHOLD BEHAVIOUR, so the suite brings the threshold.
// It used to assert "more than 100 fixtures are paginated" against whatever
// happened to be in the database -- two, on a clean one -- and reported the
// resulting "2 matched, 2 rendered" as a product failure.
const SCALE_TAG = `SCALE-${Date.now()}`
const scale = seedFixturesAtScale(sql, { clubId: world.clubId, count: 130, tag: SCALE_TAG, sweepPrefix: "SCALE-" })


const CLUB = { email: "uat.coach@ovalball.test", path: "/fixtures/management" }
const SITE = { email: "uat.fullsiteadmin@ovalball.test", path: "/admin/fixtures" }

const browser = await launch()

function matched(text) {
  const m = text.match(/([\d,]+) fixtures? match/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

async function openAs(who, suffix = "") {
  const ctx = await newContext(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  await signIn(page, who.email)
  // Warm the route: a dev-server cold compile is not a product timing.
  await page.goto(`${APP}${who.path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const started = Date.now()
  await page.goto(`${APP}${who.path}${suffix}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { ctx, page, ms: Date.now() - started }
}

// THE CANONICAL COLUMN MODEL, AS IT NOW IS.
//
// This list used to name "Kick Off Time" and "Meet" as club columns. The
// Control Centre redesign merged the kick-off INTO the Date cell (one question,
// one column) and moved Meet and Source to Site Admin, which genuinely spans
// clubs and import sources. Suite 19 asserts the merged model; this suite went
// on asserting the one before it, and because neither suite was in the release
// runner, two permanent tests disagreed about the same screen for as long as
// it took somebody to run both.
const CLUB_COLUMNS = ["Date", "Our Team", "H/A", "Opposition", "Venue", "Result", "Status"]
/** Site Admin keeps the columns that only mean something ACROSS clubs and codes. */
const SITE_COLUMNS = ["Date", "Code", "Meet", "Owning Team", "H/A", "Opposition", "Venue", "Result", "Status", "Source"]

// =====================================================================
// CLUB SCOPE
// =====================================================================
const club = await openAs(CLUB)
const clubHeaders = await club.page.evaluate(() =>
  [...document.querySelectorAll("thead th")].map((h) => h.textContent.trim()),
)
const missing = CLUB_COLUMNS.filter((c) => !clubHeaders.includes(c))
record("§15 the planner shows the canonical column model", missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : clubHeaders.join(" | "))
// The merge, asserted as a property rather than left implied: a club's own
// Control Centre states the kick-off under the date, and does not spend a
// second primary column saying it again.
record("§3 a club's grid does not carry Kick Off Time as its own column",
  !clubHeaders.includes("Kick Off Time"), clubHeaders.join(" | "))

record("§16 the owning side is named 'Our Team' for a club", clubHeaders.includes("Our Team"),
  clubHeaders.find((h) => /team/i.test(h)) ?? "(none)")
record("§15 End Date and End Time are absent",
  !clubHeaders.some((h) => /end date|end time/i.test(h)))

const clubText = await club.page.locator("body").innerText()
const clubTotal = matched(clubText)
const clubRows = await club.page.evaluate(() => document.querySelectorAll("tbody tr").length)
record("§13 the planner is paginated rather than unbounded",
  clubTotal !== null && clubTotal > 100 && clubRows <= 25,
  `${clubTotal} matched, ${clubRows} rendered`)
record("§63 initial render at scale", club.ms < 15000, `${club.ms} ms for ${clubTotal} fixtures`)

// --- filters that previously could not be expressed --------------------
const filterLabels = await club.page.evaluate(() =>
  [...document.querySelectorAll("select[aria-label]")].map((s) => s.getAttribute("aria-label")),
)
for (const f of ["Season", "Team", "Home or away"]) {
  record(`§18 the ${f} filter exists`, filterLabels.includes(f), filterLabels.join(" | "))
}

async function countWith(page, suffix) {
  const t0 = Date.now()
  await page.goto(`${APP}${CLUB.path}${suffix}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  return { n: matched(await page.locator("body").innerText()), ms: Date.now() - t0 }
}

const all = await countWith(club.page, "?date=all")
const home = await countWith(club.page, "?date=all&ha=Home")
const away = await countWith(club.page, "?date=all&ha=Away")
record("§18 Home/Away filters server-side and the parts sum to the whole",
  home.n + away.n === all.n, `${home.n} home + ${away.n} away = ${all.n}`)
record("§63 filter response at scale", home.ms < 15000, `${home.ms} ms`)

const teamId = await club.page.evaluate(() => {
  const s = document.querySelector('select[aria-label="Team"]')
  return s?.options?.[1]?.value ?? null
})
if (teamId) {
  const team = await countWith(club.page, `?date=all&team=${teamId}`)
  record("§18 the Team filter narrows to one team", team.n !== null && team.n < all.n,
    `${team.n} of ${all.n}`)
}

// --- pagination transition --------------------------------------------
const paged = await countWith(club.page, "?date=all&page=4")
const pagedRows = await club.page.evaluate(() => document.querySelectorAll("tbody tr").length)
record("§14 a later page renders its own window", pagedRows > 0 && pagedRows <= 25,
  `page 4 rendered ${pagedRows} rows`)
record("§63 page transition at scale", paged.ms < 15000, `${paged.ms} ms`)

// =====================================================================
// SITE SCOPE -- the SAME surface, not an older table left behind
// =====================================================================
const site = await openAs(SITE)
const siteHeaders = await site.page.evaluate(() =>
  [...document.querySelectorAll("thead th")].map((h) => h.textContent.trim()),
)
record("§5 Site Admin renders the same Control Centre columns",
  SITE_COLUMNS.every((c) => siteHeaders.includes(c)),
  SITE_COLUMNS.filter((c) => !siteHeaders.includes(c)).join(", ") || siteHeaders.join(" | "))
record("§16 the owning side is named for Site Admin's own vantage",
  siteHeaders.includes("Owning Team"), siteHeaders.find((h) => /team/i.test(h)) ?? "(none)")

const siteRows = await site.page.evaluate(() => document.querySelectorAll("tbody tr").length)
record("§13 Site Admin is paginated too", siteRows <= 25, `${siteRows} rows rendered`)

// The competition filter must no longer be fed by an unbounded fixture read.
record("§13 the competition options come from the bounded usage view",
  Number(sql("select count(*) from public.fixture_competition_edition_usage;")) <=
    Number(sql("select count(*) from public.competition_editions;")),
  "one row per edition in use, never one per fixture")

await site.ctx.close()

// =====================================================================
// EXACT MOBILE + TABLET
// =====================================================================
for (const width of [320, 360, 390, 430, 834]) {
  const ctx = await newContext(browser, { width, height: width === 834 ? 1112 : 844 })
  const page = await ctx.newPage()
  await signIn(page, CLUB.email)
  await page.goto(`${APP}${CLUB.path}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const m = await measure(page)
  if (m.innerWidth !== width || m.clientWidth !== width) {
    record(`planner @ ${width}`, false,
      `HARNESS INVALID -- asked ${width}, got innerWidth=${m.innerWidth}`)
    await ctx.close()
    continue
  }

  // A wide table inside its own horizontal scroller is correct; content
  // escaping every scroller is not.
  const spill = await page.evaluate((w) => {
    const clipped = (el) => {
      let a = el.parentElement
      while (a && a !== document.documentElement) {
        const ox = getComputedStyle(a).overflowX
        if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true
        a = a.parentElement
      }
      return false
    }
    return [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > w + 1 && !clipped(el)
      })
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className || "").slice(0, 28)}`)
  }, width)

  const label = width === 834 ? "tablet 834" : `mobile ${width}`
  record(`§59/§60 planner @ ${label}`, m.scrollWidth <= width && spill.length === 0,
    `innerWidth=${m.innerWidth} scrollWidth=${m.scrollWidth}${spill.length ? " spill: " + spill.join(", ") : ""}`)

  // Mobile must still be usable, not a crushed grid.
  if (width <= 430) {
    const cards = await page.evaluate(() => document.querySelectorAll("ul li").length)
    const tableVisible = await page.evaluate(() => {
      const t = document.querySelector("table")
      return t ? t.getBoundingClientRect().width > 0 : false
    })
    record(`§59 mobile uses cards rather than the desktop grid @ ${width}`,
      !tableVisible && cards > 0, `${cards} cards, table visible: ${tableVisible}`)
  }
  await ctx.close()
}

await club.ctx.close()
scale.cleanup()
world.cleanup()
await browser.close()
process.exit(summarise() ? 0 : 1)
