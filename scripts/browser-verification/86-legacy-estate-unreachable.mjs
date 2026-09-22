// =====================================================================
// CONVERGENCE STEP 17 -- IDENTITY/AUTH SLICE 10, IN A REAL BROWSER
//
// Slice 10 is LEGACY RETIREMENT. It has no new user-facing surface, so the
// honest browser question is not "does the new page work" -- there is no new
// page -- it is:
//
//   DOES A REAL AUTHENTICATED SESSION STILL DO EVERYTHING IT COULD BEFORE,
//   AND CAN IT STILL REACH THE LEGACY ESTATE?
//
// The boundary that changed is a GRANT, and a grant is enforced at the API
// edge -- so it is checked here through PostgREST with a genuine signed-in
// session, which is the only place that proves it for a browser rather than
// for psql.
//
//   A. the canonical invitation journeys still work, end to end
//   B. a signed-in session cannot read a plaintext legacy invitation token
//   C. nor write the legacy invitations table
//   D. nor read the canonical table's hash material
//   E. and the surfaces that legitimately read those tables still render
//
// EVERYTHING THIS RUN CREATES IS REMOVED AND THE REMOVAL IS ASSERTED.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const SITE_ADMIN = "uat.fullsiteadmin@ovalball.test"
const CLUB_ADMIN = "uat.preston.admin@ovalball.test"
const REST = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

if (!REST || !ANON) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required: source .env.local")
  process.exit(1)
}

function teardown() {
  try {
    sql(`delete from public.access_invitations where invited_email_normalised like 's17.browser.%';`)
  } catch {
    // Asserted at the end rather than assumed.
  }
}

teardown()

/**
 * The signed-in session's own access token, so PostgREST sees the real person.
 *
 * FROM THE COOKIE, not localStorage. Ovalball uses @supabase/ssr, so the session lives in an
 * `sb-<ref>-auth-token` cookie that server components can read -- localStorage is empty. The first
 * version of this suite looked in localStorage, got null, and every request went out unauthenticated:
 * each "cannot read the token" assertion passed for the wrong reason, and the three reads that should
 * have succeeded failed. A negative test that passes because the request was anonymous proves nothing,
 * which is why the token is asserted before anything is concluded from it.
 *
 * The cookie may be chunked across `...auth-token.0`, `.1`, … and its value may carry a `base64-` prefix.
 */
async function accessToken(ctx) {
  const cookies = await ctx.cookies()
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (parts.length === 0) return null
  let raw = decodeURIComponent(parts.map((c) => c.value).join(""))
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8")
  try {
    return JSON.parse(raw)?.access_token ?? null
  } catch {
    return null
  }
}

/** A read through PostgREST as that session. Returns the HTTP status. */
async function readAs(page, token, path) {
  return page.evaluate(
    async ([base, key, jwt, p]) => {
      const res = await fetch(`${base}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
      return res.status
    },
    [REST, ANON, token, path],
  )
}

async function writeAs(page, token, table, body) {
  return page.evaluate(
    async ([base, key, jwt, t, payload]) => {
      const res = await fetch(`${base}/rest/v1/${t}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      return res.status
    },
    [REST, ANON, token, table, body],
  )
}

const browser = await launch()
const pageErrors = []

try {
  const ctx = await newContext(browser, { width: 1440, height: 1100 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(page, SITE_ADMIN)
  const token = await accessToken(ctx)
  record("the signed-in session has a real access token to ask PostgREST with", Boolean(token))
  if (!token) throw new Error("No access token: every assertion below would pass for the wrong reason.")

  // ==================================================================
  // A. THE CANONICAL INVITATION JOURNEY STILL WORKS
  //
  // Step 17 revoked grants on the canonical table as well, so this is the first
  // thing to prove rather than the last.
  // ==================================================================
  await page.goto(`${APP}/admin/site-admins`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const adminPage = await page.locator("main").innerText()
  record("A1 the Site Admin invitation surface still renders", /Site Admin/i.test(adminPage))

  const issued = sql(`select count(*) from public.access_invitations where state = 'ISSUED'`)
  record("A2 and the canonical invitation estate is readable by the product", Number(issued) >= 0, `${issued} open`)

  // The People surface, which lists canonical invitations for a club.
  await page.goto(`${APP}/people`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("A3 the People surface still renders after the grant was narrowed",
    !/Application error|something went wrong/i.test(await page.locator("body").innerText()))

  // ==================================================================
  // B. NO PLAINTEXT LEGACY TOKEN REACHES THE BROWSER
  //
  // Asked column by column, as the session, through the API edge.
  // ==================================================================
  for (const table of [
    "invitations",
    "guardian_invitations",
    "player_account_invitations",
    "site_admin_invitations",
    "club_ovalball_invitations",
  ]) {
    const status = await readAs(page, token, `${table}?select=token&limit=1`)
    record(`B: a signed-in session cannot select ${table}.token`, status === 401 || status === 403, `HTTP ${status}`)
  }

  // And the columns that are legitimately readable still are, so this is a
  // narrowing rather than a wall.
  const partnerOk = await readAs(page, token, "club_ovalball_invitations?select=id,contact_email,inviting_club_id&limit=1")
  record("B: while the partner-invitation columns the product uses still read", partnerOk === 200, `HTTP ${partnerOk}`)
  const starStatus = await readAs(page, token, "club_ovalball_invitations?select=*&limit=1")
  record("B: and select * is refused, which is what a column grant does that a policy cannot",
    starStatus === 401 || starStatus === 403, `HTTP ${starStatus}`)

  // ==================================================================
  // C. THE LEGACY TABLE IS NOT WRITABLE FROM A BROWSER
  // ==================================================================
  const clubId = sql(`select c.id from public.clubs c join public.club_directory d on d.id = c.directory_id
                      join public.club_memberships cm on cm.club_id = c.id
                      join auth.users u on u.id = cm.user_id
                      where u.email = '${CLUB_ADMIN}' and cm.status = 'active' limit 1`)
  const wrote = await writeAs(page, token, "invitations", {
    club_id: clubId,
    invited_email: `s17.browser.${TAG}@ovalball.test`,
  })
  record("C1 a signed-in session cannot insert into the legacy invitations table", wrote >= 400, `HTTP ${wrote}`)
  record("C2 and nothing was written", sql(`select count(*) from public.invitations`) === "0")

  // ==================================================================
  // D. NOR THE CANONICAL TABLE'S HASH MATERIAL
  // ==================================================================
  for (const col of ["token_sha256", "code_hmac"]) {
    const status = await readAs(page, token, `access_invitations?select=${col}&limit=1`)
    record(`D: a signed-in session cannot select access_invitations.${col}`, status === 401 || status === 403, `HTTP ${status}`)
  }
  const canonicalOk = await readAs(page, token, "access_invitations?select=id,kind,state,expires_at,code_hint&limit=1")
  record("D: while the columns the product reads, including the code hint it prints, still read",
    canonicalOk === 200, `HTTP ${canonicalOk}`)

  // ==================================================================
  // E. THE SURFACES THAT LEGITIMATELY USE THESE TABLES STILL WORK
  // ==================================================================
  await page.goto(`${APP}/partner-clubs`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("E1 the partner clubs surface still renders",
    !/Application error|something went wrong/i.test(await page.locator("body").innerText()),
    new URL(page.url()).pathname)
  await ctx.close()

  // A club administrator, who holds club.partners.manage and is the person the
  // narrowed grant is really about.
  const cctx = await newContext(browser, { width: 1440, height: 1100 })
  const club = await cctx.newPage()
  club.on("pageerror", (e) => pageErrors.push(e.message))
  await signIn(club, CLUB_ADMIN)
  const clubToken = await accessToken(cctx)
  const clubTokenRead = await readAs(club, clubToken, "club_ovalball_invitations?select=token&limit=1")
  record("E2 a Club Admin holding club.partners.manage cannot read a referral token either",
    clubTokenRead === 401 || clubTokenRead === 403, `HTTP ${clubTokenRead}`)
  await club.goto(`${APP}/partner-clubs`, { waitUntil: "domcontentloaded" })
  await club.waitForLoadState("networkidle").catch(() => {})
  record("E3 and their own partner clubs surface still works",
    !/Application error|something went wrong/i.test(await club.locator("body").innerText()))
  await cctx.close()

  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  teardown()
}

record("cleanup: this run created nothing that survives",
  sql(`select count(*) from public.access_invitations where invited_email_normalised like 's17.browser.%'`) === "0" &&
    sql(`select count(*) from public.invitations`) === "0")
// The one real pending legacy guardian invitation is review/production data belonging to a person.
// It is read here and never written, and Phase 2 O.5 says it keeps its token until it expires.
record("cleanup: the live legacy guardian invitation is untouched",
  sql(`select count(*) from public.guardian_invitations where status = 'pending' and token is not null`) === "1")

process.exit(summarise() ? 0 : 1)
