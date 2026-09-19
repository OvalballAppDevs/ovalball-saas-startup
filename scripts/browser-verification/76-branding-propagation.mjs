// =====================================================================
// A CLUB'S BRANDING IS RESOLVED, NOT COPIED (Convergence Step 6 §57, §14-§17)
//
// Step 6 converged ten hand-written club-logo fallbacks onto one resolver, and a
// structural test now fails an eleventh copy. That proves no surface RE-IMPLEMENTS
// the rule. It does not prove the product actually behaves as one thing.
//
// So this changes a disposable club's branding ONCE, through the canonical write
// path, and then looks at every surface that displays that club's identity. No
// screen is touched individually. If any surface had kept its own copy -- a
// snapshotted URL, a cached path, a second fallback -- it would still be showing
// the old crest.
//
// The fallback half matters as much: a club with NO crest of its own must show
// the Club Directory's, everywhere, by the same rule rather than by each screen
// inventing a placeholder.
//
// Everything is disposable and isolated; the persistent review world is untouched.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const KEY = `s6-brand-${TAG}`
const SLUG = KEY

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

// ---------------------------------------------------------------------
// SEED. A club with a DIRECTORY crest and no crest of its own, so the
// fallback is exercised before the club's own upload replaces it.
// ---------------------------------------------------------------------
const DIRECTORY_CREST = `${KEY}/directory-crest.png`
const CLUB_CREST = `${KEY}/club-crest.png`

const dirId = sql(`insert into public.club_directory
    (name, normalized_key, source, rugby_code, country, nation, verification_status, active, town, county, logo_storage_path)
  values ('Step 6 Brand RFC ${TAG}', '${KEY}', 'MANUAL', 'union', 'England', 'England', 'unverified', true,
          'Otley', 'West Yorkshire', '${DIRECTORY_CREST}')
  returning id`)
const clubId = sql(`insert into public.clubs (directory_id, slug, status) values ('${dirId}', '${SLUG}', 'active') returning id`)
// A team, so the club is a plausible one and the public page has something to
// render. The TEAM page itself is not visited here: it requires membership of
// this club, and adding a member to a disposable branding fixture would be
// testing the membership gate rather than the resolver.
sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
     values ('${clubId}', 'Under 12 Boys', '${KEY}-u12', 'youth', 'U12', 'boys', 'union', true)`)
sql(`insert into public.club_kits (club_id, variant, pattern, primary_colour, secondary_colour)
     values ('${clubId}', 'primary', 'HOOPS', '#123456', '#abcdef')`)

function teardown() {
  const tidy = (q) => {
    try {
      execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      })
    } catch {
      // asserted below
    }
  }
  tidy(`delete from public.club_kits where club_id = '${clubId}'`)
  tidy(`delete from public.teams where club_id = '${clubId}'`)
  tidy(`delete from public.clubs where id = '${clubId}'`)
  tidy(`delete from public.club_directory where id = '${dirId}'`)
}

/** Every club-logo URL on the page, reduced to the storage path it came from. */
async function crestPathsOn(page) {
  const srcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((i) => i.currentSrc || i.getAttribute("src") || "")
      .filter(Boolean)
  )
  return srcs
    .map((s) => decodeURIComponent(s))
    .map((s) => s.match(/club-logos\/(.+?)(?:\?|$)/)?.[1] ?? null)
    .filter(Boolean)
}

const browser = await launch()

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  await signIn(page, "uat.fullsiteadmin@ovalball.test")
  await ctx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])

  const visit = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    return crestPathsOn(page)
  }

  // ------------------------------------------------------------------
  // A. FALLBACK (§15). No club crest -- every surface shows the DIRECTORY one.
  // ------------------------------------------------------------------
  const publicBefore = await visit(`/club/${SLUG}`)
  record(
    "S6BR-01 with no crest of its own, the public Club Home shows the Club Directory's",
    publicBefore.includes(DIRECTORY_CREST),
    publicBefore.join(", ").slice(0, 90) || "(no club crest rendered)"
  )

  const adminBefore = await visit(`/admin/clubs/${dirId}`)
  record(
    "S6BR-02 and the Site Admin club surface resolves the same fallback, not its own placeholder",
    adminBefore.includes(DIRECTORY_CREST),
    adminBefore.join(", ").slice(0, 90) || "(none)"
  )

  // ------------------------------------------------------------------
  // B. ONE CHANGE (§14). The club uploads its own crest -- canonical write.
  // ------------------------------------------------------------------
  sql(`update public.clubs set logo_storage_path = '${CLUB_CREST}' where id = '${clubId}'`)

  const surfaces = [
    ["the public Club Home", `/club/${SLUG}`],
    ["the Site Admin club surface", `/admin/clubs/${dirId}`],
    ["the Site Admin club list", `/admin/clubs?q=${encodeURIComponent("Step 6 Brand RFC " + TAG)}`],
  ]

  for (const [label, path] of surfaces) {
    const paths = await visit(path)
    record(
      `S6BR-10 ${label} shows the club's OWN crest after one canonical change`,
      paths.includes(CLUB_CREST),
      paths.join(", ").slice(0, 90) || "(no club crest rendered)"
    )
    record(
      `S6BR-11 ${label} no longer shows the superseded directory crest`,
      !paths.includes(DIRECTORY_CREST),
      paths.includes(DIRECTORY_CREST) ? "STILL SHOWING THE OLD ONE" : "superseded"
    )
  }

  // ------------------------------------------------------------------
  // C. REMOVAL (§15). Take the club's crest away -- the fallback returns,
  //    everywhere, by the same rule rather than per screen.
  // ------------------------------------------------------------------
  sql(`update public.clubs set logo_storage_path = null where id = '${clubId}'`)
  const publicAfter = await visit(`/club/${SLUG}`)
  record(
    "S6BR-20 removing the club's crest falls back to the directory's again, with no screen-specific repair",
    publicAfter.includes(DIRECTORY_CREST) && !publicAfter.includes(CLUB_CREST),
    publicAfter.join(", ").slice(0, 90) || "(none)"
  )

  // ------------------------------------------------------------------
  // D. THEME (§16). One kit change reaches the themed surfaces.
  // ------------------------------------------------------------------
  const themeVarsOn = async (path) => {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    return page.evaluate(() => {
      const found = new Set()
      for (const el of Array.from(document.querySelectorAll("[style]"))) {
        const style = el.getAttribute("style") ?? ""
        for (const m of style.matchAll(/--club-[a-z-]+:\s*([^;]+)/g)) found.add(m[1].trim().toLowerCase())
      }
      return Array.from(found)
    })
  }

  const beforeTheme = await themeVarsOn(`/club/${SLUG}`)
  record(
    "S6BR-30 the public Club Home is themed from the canonical kit, through club theme variables",
    beforeTheme.some((v) => v.includes("#123456")),
    beforeTheme.join(" ").slice(0, 90) || "(no club theme variables found)"
  )

  sql(`update public.club_kits set primary_colour = '#654321' where club_id = '${clubId}' and variant = 'primary'`)
  const afterTheme = await themeVarsOn(`/club/${SLUG}`)
  record(
    "S6BR-31 changing the canonical home kit ONCE changes the theme, with no per-screen colour",
    afterTheme.some((v) => v.includes("#654321")) && !afterTheme.some((v) => v.includes("#123456")),
    afterTheme.join(" ").slice(0, 90) || "(none)"
  )

  // ------------------------------------------------------------------
  // E. NO STALE CACHE (§17). A refresh is enough -- no manual intervention.
  // ------------------------------------------------------------------
  sql(`update public.clubs set logo_storage_path = '${CLUB_CREST}' where id = '${clubId}'`)
  await page.goto(`${APP}/club/${SLUG}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const afterRefresh = await crestPathsOn(page)
  record(
    "S6BR-40 a branding change is visible after an ordinary refresh -- no cache workaround needed",
    afterRefresh.includes(CLUB_CREST),
    afterRefresh.join(", ").slice(0, 90) || "(none)"
  )

  // The structural half, restated here so a browser-only reader sees it too.
  const handWritten = execFileSync(
    "bash",
    ["-lc", `grep -rn "logo_storage_path ?? " app lib | grep -v "club-logo.ts" | grep -c "" || true`],
    { encoding: "utf8", cwd: process.cwd() }
  ).trim()
  record(
    "S6BR-50 and no surface re-implements the fallback in the first place",
    handWritten === "1",
    `${handWritten} hand-written chain(s) -- the one remaining is the directory-crest route, which has no club to fall back from`
  )
} finally {
  teardown()
  await browser.close()
}

record("S6BR-Z the suite leaves no club or directory row behind",
  sql(`select (select count(*) from public.clubs where slug = '${SLUG}')
            + (select count(*) from public.club_directory where normalized_key = '${KEY}')`) === "0")

process.exit(summarise("Branding propagation") ? 0 : 1)
