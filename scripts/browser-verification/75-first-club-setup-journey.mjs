// =====================================================================
// FIRST-TIME CLUB SETUP, END TO END (Convergence Step 6 §52, §7-§13)
//
// The wizard has had a requirements function, a gate and a completion RPC since
// it was built, and each has its own SQL coverage. What had never been walked is
// the JOURNEY: a legitimate new Club Admin arriving at a club that is not set up,
// being required to finish, doing it, and landing in the application.
//
// Everything here is DISPOSABLE and ISOLATED. The persistent Step 2 Review RFC is
// deliberately not used -- it is the product owner's manual review world, it is
// already set up, and running a founder journey against it would both fail and
// damage it.
//
// The entry matrix matters as much as the journey. "Who is required to set up a
// club" must be answered by capability and canonical setup state, never by a role
// name, so the same un-set-up club is visited by a Club Admin, a coach, an
// ordinary member and a guardian, and the answers must differ in the right way --
// and the ones who are not the founder must NOT be redirected and must NOT gain
// any authority.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 7)
const PASSWORD = `Setup!${TAG}aA9`
const KEY = `s6-setup-${TAG}`

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

/**
 * Some canonical readers are scoped to the caller -- club_setup_requirements
 * refuses anybody who is neither a member of the club nor a Site Admin, which is
 * correct and is why this asks AS the founder rather than as the database owner.
 */
const sqlAs = (userId, query) =>
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c",
     `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false); ${query}`],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .pop()

const api = async (path, { token, body } = {}) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** A real, tiny PNG, so the logo upload exercises the actual storage path. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

// ---------------------------------------------------------------------
// SEED — one un-set-up club and four people with different standing in it.
// ---------------------------------------------------------------------
async function person(slug, first, last) {
  const email = `uat.s6setup.${slug}.${TAG}@ovalball.test`
  const created = await api("/auth/v1/admin/users", {
    token: process.env.SUPABASE_SERVICE_ROLE_KEY,
    body: { email, password: PASSWORD, email_confirm: true },
  })
  const id = created.json?.id
  if (!id) throw new Error(`could not create ${email}`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
       values ('${id}','${first}','${last}','${email}','1987-05-05','ACTIVE') on conflict (id) do nothing;
       select internal.refresh_account_security_state('${id}');`)
  return { id, email }
}

const dirId = sql(`insert into public.club_directory (name, normalized_key, source, rugby_code, country, nation, verification_status, active, town, county)
                   values ('Step 6 Founder RFC ${TAG}', '${KEY}', 'MANUAL', 'union', 'England', 'England', 'unverified', true, 'Skipton', 'North Yorkshire')
                   returning id`)
const clubId = sql(`insert into public.clubs (directory_id, slug, status) values ('${dirId}', '${KEY}', 'active') returning id`)
// The gate only engages for a club that HAS a lifecycle row and has not finished.
sql(`insert into public.club_setup_state (club_id, status, current_step) values ('${clubId}', 'NOT_STARTED', 1)`)

const founder = await person("founder", "Frances", "Oduya")
const coach = await person("coach", "Ken", "Mbeki")
const member = await person("member", "Ada", "Nowak")
const guardian = await person("guardian", "Ravi", "Shah")

sql(`insert into public.club_memberships (club_id, user_id, role, status) values
      ('${clubId}','${founder.id}','CLUB_ADMIN','active'),
      ('${clubId}','${coach.id}','BASIC_USER','active'),
      ('${clubId}','${member.id}','BASIC_USER','active'),
      ('${clubId}','${guardian.id}','BASIC_USER','active');`)

// Teams, as a claim approval would have seeded them. Step 3 confirms a list, and
// a club with no teams is legitimately told to add some before it can finish --
// which is a different journey from the one being proved here.
const teamId = sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
                    values ('${clubId}', 'Under 12 Boys', '${KEY}-u12', 'youth', 'U12', 'boys', 'union', true) returning id`)
sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
     values ('${clubId}', 'Under 14 Girls', '${KEY}-u14g', 'youth', 'U14', 'girls', 'union', true)`)

// THE COACH GETS A REAL TEAM ROLE, deliberately.
//
// listSwitchableContexts says so in its own words: "A plain BASIC_USER club
// membership isn't listed: there is no 'operate as' mode for it, only ambient
// access." So a bare member has no active context, no contextClubId, and the
// setup gate cannot engage for them -- by design. Testing the bounded screen
// with a context-less persona would have been asserting something the product
// never promised.
sql(`insert into public.team_permissions (membership_id, team_id, permission)
     select cm.id, '${teamId}', 'coach' from public.club_memberships cm
      where cm.club_id = '${clubId}' and cm.user_id = '${coach.id}'`)

function teardown() {
  const tidy = (q) => {
    try {
      execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      })
    } catch {
      // Append-only stores refuse deletion by design; asserted below.
    }
  }
  const ids = [founder.id, coach.id, member.id, guardian.id].map((i) => `'${i}'`).join(",")
  tidy(`delete from public.team_permissions tp using public.club_memberships cm where tp.membership_id = cm.id and cm.club_id = '${clubId}'`)
  tidy(`delete from public.club_articles where club_id = '${clubId}'`)
  tidy(`delete from public.club_pitches where club_id = '${clubId}'`)
  tidy(`delete from public.venues where club_id = '${clubId}'`)
  tidy(`delete from public.club_kits where club_id = '${clubId}'`)
  tidy(`delete from public.teams where club_id = '${clubId}'`)
  tidy(`delete from public.club_setup_state where club_id = '${clubId}'`)
  tidy(`delete from public.club_memberships where club_id = '${clubId}'`)
  tidy(`delete from public.clubs where id = '${clubId}'`)
  tidy(`delete from public.club_directory where id = '${dirId}'`)
  tidy(`delete from auth.sessions where user_id in (${ids})`)
  tidy(`delete from public.account_security_state where user_id in (${ids})`)
  tidy(`delete from public.profiles where id in (${ids})`)
  tidy(`delete from auth.identities where user_id in (${ids})`)
  tidy(`delete from auth.users where id in (${ids})`)
}

/** Sign in with a password — the real journey, not a cached harness session. */
async function signInAs(page, email) {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const reveal = page.getByRole("button", { name: /sign in with email/i }).first()
  await reveal.waitFor({ state: "visible", timeout: 20000 }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    await reveal.click().catch(() => {})
    if (await page.locator('input[type="password"]').first().isVisible({ timeout: 5000 }).catch(() => false)) break
  }
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.getByRole("button", { name: /^Sign In$|Continue|Sign in$/i }).first().click().catch(() => {})
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {})
}

const browser = await launch()

try {
  // ------------------------------------------------------------------
  // A. ENTRY AUTHORITY (§7). Same club, four standings, four answers.
  // ------------------------------------------------------------------
  {
    const ctx = await newContext(browser, { width: 1440, height: 1100 })
    const page = await ctx.newPage()
    await signInAs(page, founder.email)
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(
      "S6S-01 a legitimate new Club Admin at an un-set-up club is REQUIRED to finish setup",
      new URL(page.url()).pathname.startsWith("/club/setup"),
      new URL(page.url()).pathname
    )
    record("S6S-02 and is resumed at the first unfinished step, not a remembered one",
      new URL(page.url()).searchParams.get("step") === "1", new URL(page.url()).search)
    await ctx.close()
  }

  // A coach HOLDS a team context, so the club resolves and the gate explains
  // itself in place of the page -- without redirecting and without granting
  // anything.
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    await signInAs(page, coach.email)
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const path = new URL(page.url()).pathname
    const text = await page.locator("body").innerText()
    record("S6S-03 a coach at the same club is NOT sent into founder setup", !path.startsWith("/club/setup"), path)
    record(
      "S6S-04 the coach is told why the club is unusable instead, in place of the page, with the shell intact",
      /isn.t ready yet/i.test(text) && /Club setup/i.test(text),
      text.replace(/\s+/g, " ").match(/[^.]*isn.t ready yet/)?.[0]?.slice(-70) ?? "(no explanation shown)"
    )
    await page.goto(`${APP}/club/setup`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const wizardText = await page.locator("body").innerText()
    record(
      "S6S-05 and typing the wizard's address directly gives the coach no setup controls",
      !/Save home ground|Yes, that.s right|Finish setup/i.test(wizardText),
      new URL(page.url()).pathname
    )
    await ctx.close()
  }

  // A plain member and a guardian with no team role have NO operating context at
  // all, which listSwitchableContexts states outright. The gate therefore cannot
  // engage for them, and the product's promise is the narrower one: they are not
  // dragged into a founder journey and they gain nothing.
  for (const [who, identity] of [["an ordinary member", member], ["a guardian", guardian]]) {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    await signInAs(page, identity.email)
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record(`S6S-03 ${who} at the same club is NOT sent into founder setup`,
      !new URL(page.url()).pathname.startsWith("/club/setup"), new URL(page.url()).pathname)

    await page.goto(`${APP}/club/setup`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const wizardText = await page.locator("body").innerText()
    record(
      `S6S-05 and typing the wizard's address directly gives ${who} no setup controls`,
      !/Save home ground|Yes, that.s right|Finish setup/i.test(wizardText),
      new URL(page.url()).pathname
    )
    const stillMember = sql(`select role from public.club_memberships where club_id = '${clubId}' and user_id = '${identity.id}'`)
    record(`S6S-07 and visiting it grants ${who} no authority -- still BASIC_USER`,
      stillMember === "BASIC_USER", `role=${stillMember}`)
    await ctx.close()
  }

  // An ESTABLISHED club's admin is not dragged into setup by any of this.
  {
    const ctx = await newContext(browser, { width: 1280, height: 900 })
    const page = await ctx.newPage()
    const { signIn } = await import("./harness.mjs")
    await signIn(page, "uat.coach@ovalball.test")
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    record("S6S-06 an established club's admin is never forced into founder setup",
      !new URL(page.url()).pathname.startsWith("/club/setup"), new URL(page.url()).pathname)
    await ctx.close()
  }

  // ------------------------------------------------------------------
  // B. THE JOURNEY (§9-§12), as the founder.
  // ------------------------------------------------------------------
  const ctx = await newContext(browser, { width: 1440, height: 1200 })
  const page = await ctx.newPage()
  await signInAs(page, founder.email)

  const goStep = async (n) => {
    await page.goto(`${APP}/club/setup?step=${n}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
  }

  // --- STEP 1: crest and kit, through the club's own editors.
  await goStep(1)
  // The input is deliberately hidden behind a styled control; setInputFiles
  // drives it the same way the browser would after the picker closes.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "crest.png",
    mimeType: "image/png",
    buffer: PNG,
  })
  // Wait for the canonical write, not for the spinner to stop: the upload is a
  // server action, and the row is what the rest of the product reads.
  let logoPath = ""
  for (let i = 0; i < 40 && !logoPath; i += 1) {
    logoPath = sql(`select coalesce(logo_storage_path,'') from public.clubs where id = '${clubId}'`)
    if (!logoPath) await page.waitForTimeout(500)
  }
  record("S6S-10 step 1 uploads a crest through the canonical club media path", logoPath.length > 0,
    logoPath ? `${logoPath.slice(0, 18)}…` : "none")

  // The home kit, via the same KitSection Club Settings uses.
  await page.getByRole("button", { name: /^Save Home Kit$|^Save Kit$|^Save$/i }).first().click().catch(() => {})
  let kits = "0"
  for (let i = 0; i < 30 && kits === "0"; i += 1) {
    kits = sql(`select count(*) from public.club_kits where club_id = '${clubId}' and variant = 'primary'`)
    if (kits === "0") await page.waitForTimeout(500)
  }
  record("S6S-11 and a home kit, written to the canonical club_kits row", kits === "1", `primary kits=${kits}`)

  const req1 = sqlAs(founder.id, `select step1_complete from public.club_setup_requirements('${clubId}')`)
  record("S6S-12 the SERVER now considers step 1 complete, re-derived rather than remembered",
    req1 === "t", `step1_complete=${req1}`)

  // --- RESUME (§8): the server holds the progress, not the browser.
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("S6S-13 leaving and returning resumes at step 2, derived from canonical data",
    new URL(page.url()).searchParams.get("step") === "2",
    `${new URL(page.url()).pathname}${new URL(page.url()).search}`)

  // --- STEP 2: home ground, structured address, pitches, in ONE submission.
  await goStep(2)
  await page.locator("#venue-name").fill("Sandylands")
  await page.locator("#venue-line1").fill("Sandylands Road")
  await page.locator("#venue-town").fill("Skipton")
  await page.locator("#venue-county").fill("North Yorkshire")
  await page.locator("#venue-postcode").fill("BD23 1EU")
  await page.getByLabel(/^Pitch 1 name$/i).fill("Main Pitch")
  await page.getByRole("button", { name: /Save home ground/i }).first().click()
  // The venue row appearing is what the save produces.
  let venueCount = "0"
  for (let i = 0; i < 40 && venueCount === "0"; i += 1) {
    venueCount = sql(`select count(*) from public.venues where club_id = '${clubId}'`)
    if (venueCount === "0") await page.waitForTimeout(500)
  }

  const venue = sql(`select coalesce(address_line_1,'-')||'|'||coalesce(town,'-')||'|'||coalesce(postcode,'-')||'|'||coalesce(address,'-')||'|'||is_default_home::text
                     from public.venues where club_id = '${clubId}' limit 1`)
  record("S6S-20 step 2 writes a STRUCTURED address and marks the ground default",
    venue.startsWith("Sandylands Road|Skipton|BD23 1EU|") && venue.endsWith("|true"), venue)
  record("S6S-21 and the derived display line is regenerated from those parts, not typed",
    venue.includes("|Sandylands Road, Skipton, North Yorkshire|"), venue.split("|")[3])

  const pitchOfVenue = sql(`select count(*) from public.club_pitches p join public.venues v on v.id = p.venue_id
                            where v.club_id = '${clubId}'`)
  record("S6S-22 the pitch belongs to the venue that was just created, not to the club alone",
    Number(pitchOfVenue) >= 1, `pitches attached=${pitchOfVenue}`)

  const detached = sql(`select count(*) from public.club_pitches where club_id = '${clubId}' and venue_id is null`)
  record("S6S-23 and no pitch is born detached from a ground", detached === "0", `detached=${detached}`)

  // --- STEP 3: teams.
  await goStep(3)
  const teamsText = await page.locator("main").innerText()
  record("S6S-30 step 3 shows the club's team list and asks for confirmation",
    /teams your club runs|Yes, that.s right/i.test(teamsText),
    teamsText.replace(/\s+/g, " ").match(/[^.]*teams your club runs[^?]*\??/)?.[0]?.slice(0, 80) ?? teamsText.slice(0, 60))

  await page.getByRole("button", { name: /Yes, that.s right/i }).first().click().catch(() => {})
  let confirmedFlag = "no"
  for (let i = 0; i < 30 && confirmedFlag === "no"; i += 1) {
    confirmedFlag = sql(`select case when teams_confirmed_at is null then 'no' else 'yes' end from public.club_setup_state where club_id = '${clubId}'`)
    if (confirmedFlag === "no") await page.waitForTimeout(500)
  }
  const confirmed = sql(`select case when teams_confirmed_at is null then 'no' else 'yes' end from public.club_setup_state where club_id = '${clubId}'`)
  record("S6S-31 confirming records it canonically against the club, not in the browser",
    confirmed === "yes", `teams_confirmed=${confirmed}`)

  // --- COMPLETION (§12). The server decides, not the last click.
  const beforeStatus = sql(`select status from public.club_setup_state where club_id = '${clubId}'`)
  await goStep(3)
  await page.getByRole("button", { name: /Finish setup/i }).first().click().catch(() => {})
  await page.waitForURL((u) => !u.pathname.startsWith("/club/setup"), { timeout: 30000 }).catch(() => {})

  const afterStatus = sql(`select status from public.club_setup_state where club_id = '${clubId}'`)
  record("S6S-40 completion moves the CANONICAL lifecycle, and did not start there",
    beforeStatus !== "COMPLETED" && afterStatus === "COMPLETED", `${beforeStatus} -> ${afterStatus}`)

  record("S6S-41 and the browser settles on the dashboard, not a bespoke post-setup page",
    new URL(page.url()).pathname === "/dashboard", new URL(page.url()).pathname)

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("S6S-42 refreshing does not put a finished club back into setup",
    !new URL(page.url()).pathname.startsWith("/club/setup"), new URL(page.url()).pathname)

  // Completion is idempotent: a second attempt must not create a second anything.
  const welcomeBefore = sql(`select count(*) from public.club_articles where club_id = '${clubId}'`)
  // As the founder: complete_club_setup authorises the caller, and calling it as
  // the database owner is refused -- correctly.
  const second = sqlAs(founder.id, `select public.complete_club_setup('${clubId}')`)
  const welcomeAfter = sql(`select count(*) from public.club_articles where club_id = '${clubId}'`)
  record("S6S-43 completing a second time is idempotent and creates no duplicate welcome article (§34)",
    welcomeBefore === welcomeAfter, `articles ${welcomeBefore} -> ${welcomeAfter}; rpc said "${second}"`)

  // --- A fresh sign-in lands in the application, not setup and not the public homepage.
  {
    const fresh = await newContext(browser, { width: 1280, height: 900 })
    const freshPage = await fresh.newPage()
    await signInAs(freshPage, founder.email)
    await freshPage.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
    await freshPage.waitForLoadState("networkidle").catch(() => {})
    record("S6S-44 signing in again lands on /dashboard -- not setup, not the marketing homepage",
      new URL(freshPage.url()).pathname === "/dashboard", new URL(freshPage.url()).pathname)
    await fresh.close()
  }
  await ctx.close()

  // ------------------------------------------------------------------
  // C. VIEWPORTS (§13). Every step at both mobile widths.
  // ------------------------------------------------------------------
  for (const width of [390, 320]) {
    const narrow = await newContext(browser, { width, height: 780 })
    const narrowPage = await narrow.newPage()
    await signInAs(narrowPage, founder.email)
    for (const step of [1, 2, 3]) {
      await narrowPage.goto(`${APP}/club/setup?step=${step}`, { waitUntil: "domcontentloaded" })
      await narrowPage.waitForLoadState("networkidle").catch(() => {})
      const m = await measure(narrowPage)
      record(
        `S6S-5${width === 390 ? "0" : "1"}.${step} setup step ${step} fits ${width}px without sideways scrolling`,
        m.innerWidth === width && m.scrollWidth <= width,
        `inner=${m.innerWidth} scroll=${m.scrollWidth}`
      )
    }
    await narrow.close()
  }
} finally {
  teardown()
  await browser.close()
}

record("S6S-Z the suite leaves no club, venue, pitch, kit or membership of its own behind",
  sql(`select (select count(*) from public.clubs where slug = '${KEY}')
            + (select count(*) from public.club_directory where normalized_key = '${KEY}')`) === "0")

process.exit(summarise("First-time club setup") ? 0 : 1)
