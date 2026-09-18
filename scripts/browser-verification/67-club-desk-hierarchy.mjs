// =====================================================================
// UX-3 -- THE CLUB LANDING PAGE, IN THE ORDER IT IS MET
//
// UX-0 found this page arranged decoration-first: a branded band, a
// promotional next-match card inside it, and only then the urgent notice
// telling somebody a pitch had closed. Worse, every judgement about it had
// been made against a nearly empty club, because no busy one existed.
//
// So this suite builds one. A disposable club with an urgent notice, three
// ordinary notices, four stories (one members-only), three fixtures and a
// real outstanding fixture request -- then reads the page back IN DOM ORDER
// and asserts what comes before what.
//
// Order is the assertion. Not pixels, not classes: the sequence a person
// meets, which is the same sequence a screen reader and the keyboard meet.
//
// Everything it creates, it removes.
// =====================================================================

import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321"
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

const TAG = Math.random().toString(36).slice(2, 8)
const ADMIN = `uat.ux3.admin.${TAG}@ovalball.test`
const ADMIN_B = `uat.ux3.adminb.${TAG}@ovalball.test`
const MEMBER = `uat.ux3.member.${TAG}@ovalball.test`
const SLUG = `ux3-busy-${TAG}`
const SLUG_B = `ux3-other-${TAG}`

function seed() {
  sql(`
do $$
declare v_admin uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
        v_dir uuid; v_club uuid; v_team uuid; v_mem uuid; v_season uuid; v_group uuid; v_i int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','${ADMIN}','',now(),now(),now(),'{}','{}','','','','','','','',''),
         (v_member,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','${MEMBER}','',now(),now(),now(),'{}','{}','','','','','','','','');
  update public.profiles set first_name='Sam', surname='Ridley', setup_state='COMPLETE' where id = v_admin;
  update public.profiles set first_name='Jo', surname='Nolan', setup_state='COMPLETE' where id = v_member;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('UX3 Busy RUFC ${TAG}','Testbury','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','${SLUG}')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'${SLUG}','active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','${SLUG}-u12','youth','U12','boys','union',true) returning id into v_team;

  -- THE CLUB'S OWN COLOURS. Not decoration for the screenshot: the theme engine reads club_kits
  -- variant 'primary' and nothing else, so a club without one is themed as Ovalball and a club with
  -- one is themed as itself. Two clubs with two kits is what makes the assertion about DERIVATION
  -- rather than about a constant that happens to be green.
  insert into public.club_kits (club_id, variant, pattern, primary_colour, secondary_colour)
  values (v_club, 'primary', 'HOOPS', '#7f1d1d', '#fde68a');

  -- The admin holds club-wide authority; the member holds none. Neither is given a capability
  -- directly: authority comes from the membership row, exactly as it does for a real person.
  insert into public.club_memberships (club_id, user_id, role, status, source)
  values (v_club, v_admin, 'CLUB_ADMIN', 'active', 'SITE_ADMIN_ASSIGNMENT') returning id into v_mem;
  insert into public.club_memberships (club_id, user_id, role, status, source)
  values (v_club, v_member, 'BASIC_USER', 'active', 'SITE_ADMIN_ASSIGNMENT');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem, v_team, 'coach');

  insert into public.club_announcements (club_id, title, body, priority, status, visibility, published_at, created_by)
  values (v_club,'Pitch 2 is closed this weekend','Waterlogged after Friday''s rain.','URGENT','PUBLISHED','PUBLIC', now(), v_admin);
  for v_i in 1..3 loop
    insert into public.club_announcements (club_id, title, body, priority, status, visibility, published_at, created_by)
    values (v_club,'Club notice '||v_i,'Ordinary notice '||v_i||'.','NORMAL','PUBLISHED','PUBLIC', now() - (v_i||' hours')::interval, v_admin);
  end loop;

  for v_i in 1..3 loop
    insert into public.club_articles (club_id, slug, title, excerpt, body, status, visibility, published_at, first_published_at, created_by)
    values (v_club,'${SLUG}-story-'||v_i,'Saturday report '||v_i,'Excerpt '||v_i,'Body '||v_i,'PUBLISHED','PUBLIC', now()-(v_i||' days')::interval, now()-(v_i||' days')::interval, v_admin);
  end loop;
  insert into public.club_articles (club_id, slug, title, excerpt, body, status, visibility, published_at, first_published_at, created_by)
  values (v_club,'${SLUG}-members','Members-only update','Members only.','Body','PUBLISHED','MEMBERS', now(), now(), v_admin);

  select id into v_season from public.seasons where active order by starts_on desc limit 1;
  for v_i in 1..3 loop
    insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, raw_opposition_text, status, created_by, updated_by)
    values (v_team, v_season, current_date + v_i, '10:30', case when v_i % 2 = 0 then 'Away' else 'Home' end, 'UX3 Opposition '||v_i, 'Booked', v_admin, v_admin);
  end loop;

  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, proposed_date, created_by)
  values (v_club,'UX3 Opposition 4', current_date + 10, v_admin) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, created_by, status)
  values (v_group, v_team, 'home', v_admin, 'sent');
end $$;`)
  // A SECOND club, in a deliberately different kit, administered by a different person. Its only job
  // is to make the theme assertion mean something: one club proves a colour exists, two prove it came
  // from the kit.
  sql(`
do $$
declare v_b uuid := gen_random_uuid(); v_dir uuid; v_club uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','${ADMIN_B}','',now(),now(),now(),'{}','{}','','','','','','','','');
  update public.profiles set first_name='Ash', surname='Lowe', setup_state='COMPLETE' where id = v_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('UX3 Other RUFC ${TAG}','Testbury','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','${SLUG_B}')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'${SLUG_B}','active') returning id into v_club;
  insert into public.club_kits (club_id, variant, pattern, primary_colour, secondary_colour)
  values (v_club, 'primary', 'VERTICAL_STRIPES', '#1e3a8a', '#ffffff');
  insert into public.club_memberships (club_id, user_id, role, status, source)
  values (v_club, v_b, 'CLUB_ADMIN', 'active', 'SITE_ADMIN_ASSIGNMENT');
end $$;`)
}

function teardown() {
  sql(`
do $$
declare v_club uuid;
begin
  select id into v_club from public.clubs where slug = '${SLUG}';
  delete from public.fixture_requests where requesting_team_id in (select id from public.teams where club_id = v_club);
  delete from public.fixture_request_groups where requesting_club_id = v_club;
  delete from public.fixtures where owning_team_id in (select id from public.teams where club_id = v_club);
  delete from public.club_articles where club_id = v_club;
  delete from public.club_announcements where club_id = v_club;
  delete from public.team_permissions where membership_id in (select id from public.club_memberships where club_id = v_club);
  delete from public.club_memberships where club_id = v_club;
  delete from public.teams where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_kits where club_id = v_club;
  delete from public.club_directory where normalized_key = '${SLUG}';

  select id into v_club from public.clubs where slug = '${SLUG_B}';
  delete from public.club_kits where club_id = v_club;
  delete from public.club_memberships where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where normalized_key = '${SLUG_B}';

  delete from public.profiles where id in (select id from auth.users where email in ('${ADMIN}','${MEMBER}','${ADMIN_B}'));
  delete from auth.users where email in ('${ADMIN}','${MEMBER}','${ADMIN_B}');
end $$;`)
}

/**
 * A CONFIGURED CLUB LOGO, uploaded the way a club uploads one.
 *
 * The distinction this suite exists to protect is that a club's LOGO and a club's KIT are two
 * different things from two different places: `resolveClubLogoUrl` reads `clubs.logo_storage_path`
 * (falling back to the directory's), and `resolveClubTheme` reads `club_kits`. `CrestPlate` prefers
 * the logo and draws the shirt only when there is no logo at all -- an established rule it shares
 * with the public club page. Every club in the local database happens to have no logo configured,
 * which is why every screenshot ever taken here showed a shirt; so one is uploaded here, and the
 * other club is deliberately left without, so both halves of that rule are exercised.
 */
/**
 * A real 160x160 magenta PNG, and the size matters twice over.
 *
 * ClubAvatar degrades a BROKEN url to the club's shirt, so an invalid file would fall back to exactly
 * the thing this test distinguishes it from. And it has a second, deliberate rule: a crest that would
 * render below half its box gives way to the shirt rather than being shown as a speck on a blank tile.
 * An 8x8 upload therefore renders as a shirt -- correctly -- and a suite using one would report "the
 * strip is showing" while the product behaved perfectly. So the fixture uploads a crest a club could
 * plausibly have uploaded.
 */
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAABhUlEQVR4nO3RAQkAMAzAsPk3vasYhxKIgEJnZwmb7wWcMjjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4DiD4wyOMzjO4LgHq4NDqp+p9ZIAAAAASUVORK5CYII=",
  "base64",
)

async function uploadLogo(path) {
  const png = LOGO_PNG
  const res = await fetch(`${SUPABASE}/storage/v1/object/club-logos/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "image/png" },
    body: png,
  })
  if (!res.ok && res.status !== 409) throw new Error(`logo upload failed: ${res.status} ${await res.text()}`)
}

async function removeLogo(path) {
  await fetch(`${SUPABASE}/storage/v1/object/club-logos/${path}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

/** Everything the page says, in the order the DOM says it. */
async function outline(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("main h1, main h2, main section[aria-label]"))
      .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )
}
const indexOf = (rows, needle) => rows.findIndex((r) => new RegExp(needle, "i").test(r))

const LOGO_PATH = `ux3/${TAG}-crest.png`
teardown()
seed()
await uploadLogo(LOGO_PATH)
sql(`update public.clubs set logo_storage_path = '${LOGO_PATH}' where slug = '${SLUG}'`)
const browser = await launch()
try {
  // ---------------- CLUB ADMIN, BUSY CLUB, DESKTOP ----------------
  const ctx = await newContext(browser, { width: 1440, height: 1000 })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})

  const rows = await outline(page)
  const urgent = indexOf(rows, "Urgent club notices")
  const requests = indexOf(rows, "^Requests$")
  const upNext = indexOf(rows, "Up Next")
  const week = indexOf(rows, "This Week")
  const news = indexOf(rows, "Club News")
  const hub = indexOf(rows, "Rugby Hub")

  record("UX3-01 the page leads with what is waiting on this person, not with decoration",
    urgent >= 0 && urgent < upNext && urgent < week, `urgent@${urgent} upNext@${upNext} week@${week}`)
  record("UX3-02 requests come before the schedule",
    requests >= 0 && requests < week, `requests@${requests} week@${week}`)
  record("UX3-03 what is next comes before the rest of the week",
    upNext >= 0 && upNext < week, `upNext@${upNext} week@${week}`)
  record("UX3-04 club information follows the operational work",
    news > week, `news@${news} week@${week}`)
  record("UX3-05 outward discovery links come last",
    hub > news, `hub@${hub} news@${news}`)

  record("UX3-06 the next match is in the page flow, not floating inside the header", await page.evaluate(() => {
    const h = document.querySelector("main header")
    return h ? !/Up Next/i.test(h.textContent ?? "") : false
  }))

  // The card and the list must not both claim the same fixture.
  const upNextText = await page.locator("section[aria-labelledby='desk-next']").innerText().catch(() => "")
  const weekText = await page.locator("main section:has(h2:text-is('This Week'))").innerText().catch(() => "")
  const firstOpponent = (upNextText.match(/v ([^\n]+)/) ?? [])[1]?.trim() ?? ""
  record("UX3-07 the week lists what is left, not the fixture already answered above",
    firstOpponent.length > 0 && !weekText.includes(firstOpponent), `next="${firstOpponent}"`)

  record("UX3-08 a Club Admin keeps the management action their capability grants",
    /Manage News/i.test(await page.locator("main").innerText()))
  record("UX3-09 exactly one page heading survives UX-1",
    (await page.locator("main h1").count()) === 1)
  record("UX3-10 the person is still named by the shell, per UX-2",
    /Sam Ridley/.test(await page.locator("body").innerText()))

  // ---------------- THE CLUB STILL LOOKS LIKE ITSELF ----------------
  //
  // The hierarchy became operational; the branding must not have become generic as a side effect.
  // These read COMPUTED styles, not class names: a variable that exists but paints nothing would pass
  // a class assertion and fail a person looking at the page.
  const heroPaint = async (p) =>
    p.evaluate(() => {
      const header = document.querySelector("main header")
      if (!header) return null
      const cs = getComputedStyle(header)
      const kit = header.querySelector("svg, [aria-hidden] svg, div[class*='absolute']")
      return {
        background: cs.backgroundColor,
        colour: cs.color,
        kitPainted: kit ? kit.getBoundingClientRect().width > 0 && kit.getBoundingClientRect().height > 0 : false,
        crest: Boolean(header.querySelector("img, [class*='Crest'], svg")),
        height: Math.round(header.getBoundingClientRect().height),
      }
    })

  const paintA = await heroPaint(page)
  record("UX3-16 the club hero is painted in a colour, not left to a default surface",
    Boolean(paintA) && paintA.background !== "rgba(0, 0, 0, 0)" && paintA.background !== "transparent",
    JSON.stringify(paintA))
  record("UX3-17 the kit graphic is actually drawn, not merely present in the markup", paintA?.kitPainted === true)
  record("UX3-18 the crest survived the slimmer hero", paintA?.crest === true)
  record("UX3-19 and the hero is slimmer than the decoration-first version it replaced",
    (paintA?.height ?? 999) < 200, `${paintA?.height}px`)
  // ---------------- THE LOGO IS NOT THE STRIP ----------------
  //
  // Two sources, two jobs. `resolveClubLogoUrl` answers "what is this club's logo"; `resolveClubTheme`
  // answers "what are this club's colours". The shirt is what CrestPlate draws when a club has no
  // logo at all -- a real rule, shared with the public club page, and not a substitute for one.
  // Scoped to the CREST PLATE, not the header: the hero's kit pattern is itself an SVG, so asking
  // "is there an svg in the header" would answer a question about the background while claiming to
  // answer one about the crest -- and would fail on a correctly-branded club.
  const identity = await page.evaluate(() => {
    const plate = document.querySelector("main header span.grid")
    const img = plate?.querySelector("img")
    return {
      imgSrc: img?.getAttribute("src") ?? null,
      // The shirt is an inline SVG inside the plate; a configured logo is an <img>. Not both.
      shirtDrawn: Boolean(plate?.querySelector("svg")),
    }
  })
  record("UX3-23 the configured club logo is what sits beside the club's name",
    Boolean(identity.imgSrc) && /club-logos/.test(decodeURIComponent(identity.imgSrc ?? "")),
    identity.imgSrc ?? "no image")
  record("UX3-24 and the kit graphic is not standing in for it while one is configured",
    identity.shirtDrawn === false, `shirtDrawn=${identity.shirtDrawn}`)

  record("UX3-20 the redundant standalone workspace word is gone from the hero", await page.evaluate(() => {
    const header = document.querySelector("main header")
    if (!header) return false
    // The heading still CARRIES it for assistive technology; what must be absent is a printed line.
    const printed = Array.from(header.querySelectorAll("p")).map((p) => p.textContent?.trim().toLowerCase())
    return !printed.includes("club")
  }))

  for (const [label, w] of [["1440", 1440], ["390", 390], ["320", 320]]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(250)
    const [sw, iw] = [await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => window.innerWidth)]
    record(`UX3-11 no horizontal overflow at ${label}px`, sw === iw, `${sw}/${iw}`)
  }
  await ctx.close()

  // ---------------- AN ORDINARY MEMBER OF THE SAME BUSY CLUB ----------------
  const ctx2 = await newContext(browser, { width: 1440, height: 1000 })
  const page2 = await ctx2.newPage()
  await signIn(page2, MEMBER)
  await page2.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page2.waitForLoadState("networkidle").catch(() => {})
  const memberText = await page2.locator("main").innerText()
  record("UX3-12 an ordinary member gains no management action from the redesign",
    !/Manage News/i.test(memberText))
  record("UX3-13 and no fixture-request negotiation either",
    !/^Requests$/im.test(memberText))
  record("UX3-14 the same page still renders for them", (await page2.locator("main h1").count()) === 1)
  await ctx2.close()

  // ---------------- TWO CLUBS, TWO KITS ----------------
  //
  // One club proves a colour exists. Two prove it came from the kit -- which is the only claim worth
  // making, because the failure this guards against is a hero that is branded for everybody the same.
  const ctx3 = await newContext(browser, { width: 1440, height: 900 })
  const page3 = await ctx3.newPage()
  await signIn(page3, ADMIN_B)
  await page3.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" })
  await page3.waitForLoadState("networkidle").catch(() => {})
  const paintB = await page3.evaluate(() => {
    const header = document.querySelector("main header")
    return header ? getComputedStyle(header).backgroundColor : null
  })
  record("UX3-21 a different club's home kit produces a different hero",
    Boolean(paintB) && paintB !== paintA?.background, `A=${paintA?.background} B=${paintB}`)
  record("UX3-22 and the club theme reaches the page through the one canonical scope", await page3.evaluate(() => {
    const scope = document.querySelector("[style*='--club-hero']")
    return Boolean(scope) && document.querySelectorAll("[style*='--club-hero']").length === 1
  }))

  // Club B has a kit and NO configured logo, which is the other half of the same rule.
  const identityB = await page3.evaluate(() => {
    const plate = document.querySelector("main header span.grid")
    return { imgSrc: plate?.querySelector("img")?.getAttribute("src") ?? null, shirtDrawn: Boolean(plate?.querySelector("svg")) }
  })
  record("UX3-25 a club with no configured logo falls back to its shirt, as it always has",
    identityB.imgSrc === null && identityB.shirtDrawn === true, JSON.stringify(identityB))
  record("UX3-26 the two are independent: same kit rules, different logo outcome",
    Boolean(paintB) && paintB !== paintA?.background && identity.imgSrc !== identityB.imgSrc,
    `themeA=${paintA?.background} themeB=${paintB}`)
  await ctx3.close()
} finally {
  await browser.close()
  await removeLogo(LOGO_PATH)
  teardown()
}

record("UX3-15 the suite removed the club and both identities it created",
  sql(`select count(*) from public.clubs where slug='${SLUG}'`) === "0" &&
  sql(`select count(*) from auth.users where email in ('${ADMIN}','${MEMBER}','${ADMIN_B}')`) === "0" &&
  sql(`select count(*) from public.club_kits k join public.clubs c on c.id=k.club_id where c.slug in ('${SLUG}','${SLUG_B}')`) === "0")

process.exit(summarise() ? 0 : 1)
