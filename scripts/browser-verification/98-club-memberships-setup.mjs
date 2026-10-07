// =====================================================================
// CLUB MEMBERSHIPS -- THE SETUP JOURNEY ON THE WEBSITE (Part 1:
// 20270748000000, 20270750000000, 20270751000000, 20270752000000)
//
// The server decides everything (membership_setup.sql, membership_fee_lifecycle.sql,
// gocardless_app_connect_intents.sql, family_membership_charge.sql,
// gocardless_verified_notice.sql). What only a browser can show is that a Club
// Admin can actually get from "nothing set up" to "memberships on" through the
// real pages, that every refusal reaches them as a sentence, and that the page
// cannot be talked into anything the server would not do:
//
//   A. Get Started -> Connect: Connect waits for the agreement (focusable, with
//      its reason); agreeing records it on the server.
//   B. THE GOCARDLESS BOUNDARY, at the layer it can be tested without a real
//      merchant: the start route sends the browser to GoCardless's sandbox
//      authorise page with a state, a redirect and the club cookie (captured,
//      not followed); GoCardless saying "cancelled" comes back as the cancelled
//      sentence with nothing connected; a return that is not this browser's is
//      refused as unverified; and text written into the address is never shown.
//   C. CONNECTED (the row the token exchange would have stored, at the data
//      layer -- a provider success is never manufactured in the browser) and
//      being verified: settings saved through the page, an invalid membership
//      refused inline with nothing written, two memberships priced, the money
//      for each shown on Review, and the finished "Waiting for GoCardless" ending.
//   D. GoCardless verifies (the server's own status door): the Club Admin is
//      notified; Activate opens; the confirmation lists each price; a double
//      click and a replayed request switch memberships on ONCE.
//   E. Membership Settings: pause needs a reason; resume re-checks; disconnect
//      needs a reason and leaves Reconnect.
//   F. Who may not: a Team Manager is turned away from the page and refused by
//      the server; a Club Admin cannot start a connection for another club, nor
//      agree or activate for it.
//   G. 390 wide: the journey and the settings fit with no sideways scroll; axe.
//
// EVERYTHING IS THIS RUN'S OWN: two isolated clubs, their Club Admins and a Team
// Manager -- removed at the end, on success or failure, and every uuid column is
// then scanned for anything still pointing at them. No persistent review
// identity is touched, and nothing reaches the owner's own login.
// =====================================================================

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { launch, newContext, signIn, APP, axeSource, measure, record, recordAxe, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: q,
    encoding: "utf8",
    // A refusal is an expected answer here (F2, F4): read from the error, never printed as if something broke.
    stdio: ["pipe", "pipe", "pipe"],
  }).trim()
const last = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT|SET)$/.test(l)).pop() ?? ""

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const file of [".env.local", ".env"]) {
    try {
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
    } catch {}
  }
  return ""
}
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL") || "http://127.0.0.1:54321"
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const PASSWORD = env("UAT_BROWSER_PASSWORD")
if (!SERVICE_KEY || !PASSWORD) {
  console.error("Missing the service key or UAT_BROWSER_PASSWORD.")
  process.exit(1)
}

const PEOPLE = `uat.mj.%.${TAG}@ovalball.test`
const CA = { email: `uat.mj.ca.${TAG}@ovalball.test`, first: "Rhian", surname: "Pritchard", dob: "1981-04-12" }
const TM = { email: `uat.mj.tm.${TAG}@ovalball.test`, first: "Theo", surname: "Marsh", dob: "1985-09-21" }
const OTHER = { email: `uat.mj.other.${TAG}@ovalball.test`, first: "Owen", surname: "Thomas", dob: "1979-03-08" }
const ids = { dirs: [], clubs: [], club: null, other: null, u12: null, g14: null, men: null }

async function person(p) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${p.email}: HTTP ${res.status}`)
  p.id = body.id
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth)
       values ('${p.id}', '${p.first}', '${p.surname}', '${p.email}', '${p.dob}')
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
       update public.profiles set setup_state = 'COMPLETE' where id = '${p.id}';
       select internal.refresh_account_security_state('${p.id}');`)
}

/** One statement as a person, in one transaction (the claims last for the transaction only). Returns the SQLSTATE on refusal. */
function as(userId, statement) {
  try {
    return last(sql(`begin;
              select set_config('request.jwt.claims', json_build_object('sub','${userId}','role','authenticated')::text, true);
              set local role authenticated;
              ${statement};
              commit;`))
  } catch (e) {
    const m = String(e.stderr ?? e.message ?? "").match(/ERROR:\s+(.*)/)
    return `REFUSED: ${m ? m[1] : "?"}`
  }
}

function club(label) {
  const dir = sql(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                   values ('${label} ${TAG} RFC', 'Testford', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mj-${label.toLowerCase()}-${TAG}') returning id`)
  const id = sql(`insert into public.clubs (directory_id, slug, status) values ('${dir}', 'mj-${label.toLowerCase()}-${TAG}', 'active') returning id`)
  sql(`insert into public.club_setup_state (club_id, status, current_step, completed_at) values ('${id}', 'COMPLETED', 3, now()) on conflict (club_id) do nothing`)
  ids.dirs.push(dir)
  ids.clubs.push(id)
  return id
}
const team = (clubId, key, label) =>
  sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
       select '${clubId}', '${label.replace(/'/g, "''")}', 'mj-${key}-${TAG}', c.category, c.age_group, c.gender, 'union', c.id, true
         from public.canonical_team_types_by_code c where c.rugby_code = 'union' and c.key = '${key}' limit 1 returning id`)

const q = (v) => (v ? `'${v}'::uuid` : "null::uuid")
function cleanup() {
  const clubs = `array[${ids.clubs.map((c) => `'${c}'::uuid`).join(",")}]::uuid[]`
  const dirs = `array[${ids.dirs.map((c) => `'${c}'::uuid`).join(",")}]::uuid[]`
  sql(`
do $$
declare
  v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
  v_clubs uuid[] := ${clubs};
  v_progs uuid[];
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_progs := array(select id from public.club_subscription_programmes where club_id = any(v_clubs));
  v_records := v_clubs || v_people || v_progs || ${dirs}
    || array(select id from public.teams where club_id = any(v_clubs))
    || array(select id from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_people))
    || array(select id from public.role_assignments where club_id = any(v_clubs) or user_id = any(v_people))
    || array(select id from public.membership_products where club_id = any(v_clubs))
    || array(select id from public.club_subscription_pricing where programme_id = any(v_progs))
    || array(select id from public.club_subscription_sibling_rules where programme_id = any(v_progs))
    || array(select id from public.gocardless_merchant_connections where club_id = any(v_clubs))
    || array(select id from public.club_membership_terms_acceptances where club_id = any(v_clubs));
  delete from public.notifications where user_id = any(v_people) or data ->> 'club_id' in (select unnest(v_clubs)::text);
  delete from public.finance_audit_log where club_id = any(v_clubs) or actor_user_id = any(v_people);
  delete from public.security_events where club_id = any(v_clubs) or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  delete from internal.gocardless_connect_intents where club_id = any(v_clubs);
  delete from internal.gocardless_token_revocations where club_id = any(v_clubs);
  delete from public.gocardless_merchant_connections where club_id = any(v_clubs);
  delete from public.club_membership_terms_acceptances where club_id = any(v_clubs);
  delete from public.membership_obligations where club_id = any(v_clubs);
  delete from public.membership_player_products where programme_id = any(v_progs);
  delete from public.player_subscription_payers where programme_id = any(v_progs);
  delete from public.membership_product_teams where club_id = any(v_clubs);
  delete from public.club_subscription_pricing where programme_id = any(v_progs);
  delete from public.club_subscription_sibling_rules where programme_id = any(v_progs);
  delete from public.membership_products where club_id = any(v_clubs);
  delete from public.club_subscription_programmes where id = any(v_progs);
  delete from public.role_assignments where club_id = any(v_clubs) or user_id = any(v_people);
  delete from public.club_memberships where club_id = any(v_clubs) or user_id = any(v_people);
  delete from public.teams where club_id = any(v_clubs);
  delete from public.club_setup_state where club_id = any(v_clubs);
  delete from public.clubs where id = any(v_clubs);
  delete from public.club_directory where id = any(${dirs});
  delete from public.audit_log where record_id = any(v_records) or changed_by = any(v_people) or actor_user_id = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.identities where user_id = any(v_people);
  delete from auth.users where id = any(v_people);
  -- LAST: every delete above wrote its own audit row, all at this transaction's timestamp.
  delete from public.audit_log where changed_at = now() and (record_id = any(v_records) or changed_by is null);
end $$;`)
}

/** Every uuid column in public, internal and auth, for anything still pointing at what this run created. */
function residue(everyId) {
  if (everyId.length === 0) return "0"
  return last(sql(`
do $$
declare r record; n bigint; total bigint := 0; v_ids uuid[] := array[${everyId.map((i) => `'${i}'::uuid`).join(",")}];
begin
  for r in select c.table_schema s, c.table_name t, c.column_name col from information_schema.columns c
            join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema in ('public','internal','auth') and c.data_type = 'uuid' loop
    execute format('select count(*) from %I.%I where %I = any($1)', r.s, r.t, r.col) into n using v_ids;
    if n > 0 then raise notice 'residue: %.%.% = %', r.s, r.t, r.col, n; total := total + n; end if;
  end loop;
  perform set_config('mj.residue', total::text, false);
end $$;
select current_setting('mj.residue', true);`))
}

const errors = []
const watch = (page, label) => page.on("pageerror", (e) => errors.push(`${label}: ${e.message.split("\n")[0]}`))
const go = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForLoadState("networkidle").catch(() => {})
}
const mainText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ")
async function axe(page) {
  await page.addScriptTag({ content: axeSource() })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
}
async function signedIn(browser, who, width = 1440, clubId = ids.club, role = "CLUB_ADMIN") {
  const context = await newContext(browser, { width, height: width > 600 ? 1000 : 844 })
  const page = await context.newPage()
  watch(page, `${who.first} ${width}`)
  await signIn(page, who.email)
  if (clubId) await context.addCookies([{ name: "ovalball_ctx", value: `club:${clubId}:${role}`, url: APP }])
  return { context, page }
}
const programme = () => sql(`select coalesce((select enabled::text || '|' || coalesce(platform_fee_mode, '') || '|' || collection_day from public.club_subscription_programmes where club_id = '${ids.club}'), 'none')`)

let browser = null
const everyId = []
try {
  // ------------------------------------------------------------------ two isolated clubs
  for (const p of [CA, TM, OTHER]) await person(p)
  ids.club = club("Membership")
  ids.other = club("Elsewhere")
  ids.u12 = team(ids.club, "u12", "Under 12 Boys")
  ids.g14 = team(ids.club, "girls_u14", "Under 14 Girls")
  ids.men = team(ids.club, "mens_1st", "Men's 1st Team")
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${CA.id}', 'CLUB_ADMIN', 'active');
       insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.other}', '${OTHER.id}', 'CLUB_ADMIN', 'active');`)
  const tmMembership = sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${TM.id}', 'BASIC_USER', 'active') returning id`)
  sql(`select internal.grant_role('${tmMembership}', 'TEAM_MANAGER', '${ids.u12}', 'LEGACY_BACKFILL', 'suite 98')`)
  everyId.push(CA.id, TM.id, OTHER.id, ...ids.clubs, ...ids.dirs, ids.u12, ids.g14, ids.men)

  browser = await launch()
  const { context, page } = await signedIn(browser, CA)

  // ------------------------------------------------------------------ A. Get Started -> Connect
  await go(page, "/club/settings/subscriptions")
  record("A1 a club with nothing set up is shown the setup journey at Get Started", (await page.getByRole("heading", { name: "Set Up Club Memberships" }).count()) === 1 && (await page.locator("h1").innerText()).trim() === "Club Memberships")
  recordAxe("A1 axe on Get Started (1440)", await axe(page))
  await page.getByRole("button", { name: "Get Started" }).click()
  await page.getByRole("heading", { name: "Connect GoCardless" }).waitFor({ timeout: 30000 })
  const connect = page.getByRole("button", { name: /Connect GoCardless/ })
  record("A2 Connect waits for the agreement, and stays reachable with its reason",
    (await connect.getAttribute("aria-disabled")) === "true" && (await connect.getAttribute("aria-describedby")) !== null,
    `aria-disabled=${await connect.getAttribute("aria-disabled")}`)
  const access = await mainText(page)
  record("A3 the whole-account access is said before anything is agreed, not folded away", access.includes("read and write access to the club's whole GoCardless account"))

  // ------------------------------------------------------------------ B. the GoCardless boundary
  let start = null
  await page.route("**/api/gocardless/oauth/start**", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 })
    start = { status: response.status(), location: response.headers()["location"] ?? "", cookies: response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value) }
    // Not followed: GoCardless's own page is GoCardless's. The browser goes where GoCardless sends a person who presses Cancel.
    const state = new URL(start.location || "https://x.invalid/").searchParams.get("state") ?? ""
    await route.fulfill({
      status: 302,
      headers: { location: `${APP}/api/gocardless/oauth/callback?error=access_denied&state=${state}`, "set-cookie": start.cookies.join("\n") },
    })
  })
  // The box sits beside the button it unlocks, so it says what is agreed to.
  await page.getByText(/I agree to Ovalball.s terms on behalf of/).click()
  await connect.click()
  await page.waitForURL(/gc_error=cancelled/, { timeout: 60000 })
  await page.unroute("**/api/gocardless/oauth/start**")
  await page.waitForLoadState("networkidle").catch(() => {})
  const authorize = start ? new URL(start.location) : null
  record("B1 agreeing is recorded on the server before the browser leaves",
    sql(`select count(*) from public.club_membership_terms_acceptances where club_id = '${ids.club}' and accepted_by = '${CA.id}'`) === "1")
  record("B2 the start route sends the browser to GoCardless's sandbox authorise page with a state and a return address",
    !!authorize && start.status === 307 && `${authorize.origin}${authorize.pathname}` === "https://connect-sandbox.gocardless.com/oauth/authorize"
      && (authorize.searchParams.get("state") ?? "").length >= 32 && (authorize.searchParams.get("redirect_uri") ?? "").endsWith("/api/gocardless/oauth/callback")
      && start.cookies.some((c) => c.startsWith("gc_oauth_state=")) && start.cookies.some((c) => c.startsWith(`gc_oauth_club_id=${ids.club}`)),
    start ? `${start.status} ${authorize?.origin}${authorize?.pathname}` : "start not reached")
  const cancelled = await mainText(page)
  record("B3 GoCardless's Cancel comes back as the cancelled sentence, with nothing connected",
    cancelled.includes("The connection was cancelled on GoCardless's page, so nothing was connected") && !cancelled.includes("access_denied")
      && sql(`select count(*) from public.gocardless_merchant_connections where club_id = '${ids.club}'`) === "0")
  await go(page, `/api/gocardless/oauth/callback?code=forged_${TAG}&state=${"a".repeat(48)}`)
  record("B4 a return that is not this browser's is refused as unverified, and stores nothing",
    page.url().includes("gc_error=unverified") && (await mainText(page)).includes("could not be verified")
      && sql(`select count(*) from public.gocardless_merchant_connections where club_id = '${ids.club}'`) === "0", page.url().replace(APP, ""))
  await go(page, `/club/settings/subscriptions?gc_error=${encodeURIComponent("Your club is suspended. Call 0800 000 000.")}`)
  const spoofed = await mainText(page)
  record("B5 words written into the address are never shown: only Ovalball's own sentence", !spoofed.includes("0800") && spoofed.includes("Could not complete the GoCardless connection"))

  // ------------------------------------------------------------------ C. connected and being verified
  // THE PROVIDER BOUNDARY AT THE DATA LAYER: the row the token exchange stores (store_gocardless_connection) for a
  // sandbox merchant, with no token -- what the page shows from it is under test, not GoCardless.
  sql(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
       values ('${ids.club}', 'sandbox', 'OR_MJ_${TAG}', null, 'read_write', 'in_review', '${CA.id}', now())`)
  await go(page, "/club/settings/subscriptions?step=connect")
  record("C1 connected and being verified: the page says so in GoCardless's own terms", (await mainText(page)).includes("Being verified"))
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByRole("heading", { name: "Collection Settings" }).waitFor({ timeout: 30000 })
  const save = page.getByRole("button", { name: "Save and Continue" })
  record("C2 Save and Continue waits for who pays Ovalball's fee", (await save.getAttribute("aria-disabled")) === "true")
  await page.getByLabel("Collection Day").selectOption("15")
  await page.getByText("Charge a pro-rata amount").click()
  await page.getByText("Members pay it").click()
  await page.getByText("£10.25").first().waitFor({ timeout: 30000 })
  record("C3 the receipt shows what members would pay, worked out by the server", (await mainText(page)).includes("£10.25"))
  await save.click()
  await page.getByRole("heading", { name: "Memberships", exact: true }).waitFor({ timeout: 30000 })
  record("C4 the settings are the server's now: the 15th, pro rata, members pay the fee", programme() === "false|PAYER_SURCHARGE|15", programme())

  // An invalid membership is refused inline and writes nothing.
  const pricesBefore = sql(`select count(*) from public.club_subscription_pricing p join public.club_subscription_programmes g on g.id = p.programme_id where g.club_id = '${ids.club}'`)
  await page.getByRole("button", { name: "Edit Club Membership" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor()
  await dialog.getByLabel("Name").fill("")
  await dialog.getByLabel("Monthly Price").fill("0.50")
  await dialog.getByRole("button", { name: "Save Membership" }).click()
  const invalid = (await dialog.innerText()).replace(/\s+/g, " ")
  record("C5 an invalid membership is refused beside its fields, and nothing is written",
    invalid.includes("Give the membership a name.") && invalid.includes("A monthly price must be at least £1.00.")
      && sql(`select count(*) from public.club_subscription_pricing p join public.club_subscription_programmes g on g.id = p.programme_id where g.club_id = '${ids.club}'`) === pricesBefore)
  await dialog.getByLabel("Name").fill("Junior Membership")
  await dialog.getByLabel("Monthly Price").fill("16")
  await dialog.getByText("Men's 1st Team", { exact: true }).click()
  await dialog.getByRole("button", { name: "Save Membership" }).click()
  await dialog.waitFor({ state: "hidden", timeout: 30000 })
  await page.getByRole("button", { name: /Add a Membership/ }).click()
  await dialog.waitFor()
  await dialog.getByLabel("Name").fill("Senior Membership")
  await dialog.getByLabel("Monthly Price").fill("22")
  await dialog.getByText("Men's 1st Team", { exact: true }).click()
  await dialog.getByRole("button", { name: "Add Membership" }).click()
  await dialog.waitFor({ state: "hidden", timeout: 30000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByText(/Members pay £22\.55 a month/).first().waitFor({ timeout: 30000 }).catch(() => {})
  const cards = (await mainText(page)).replace(/\u2019/g, "'")
  const at = cards.indexOf("Members pay")
  record("C6 each membership says what members pay, the fee included",
    cards.includes("Members pay £16.40 a month, including Ovalball's £0.40") && cards.includes("Members pay £22.55 a month, including Ovalball's £0.55"),
    at >= 0 ? cards.slice(at, at + 160) : cards.slice(0, 160))
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByRole("heading", { name: "Review and Activate" }).waitFor({ timeout: 30000 })
  const review = await mainText(page)
  const activate = page.getByRole("button", { name: "Activate Club Memberships" })
  // Review opens with where activation stands (the server's readiness); what members pay is said, per membership,
  // with Ovalball's fee.
  record("C7 Review leads with where activation stands, and says what members pay, per membership",
    review.includes("Waiting for GoCardless") && review.indexOf("Waiting for GoCardless") < review.indexOf("Collection Day")
      && review.includes("What Members Pay") && review.includes("£16.40") && review.includes("£22.55"))
  record("C8 waiting for GoCardless is a finished ending, not a dead end: Activate waits and says why",
    review.includes("Waiting for GoCardless") && review.includes("you'll get a notification when it is verified") && (await activate.getAttribute("aria-disabled")) === "true" && review.includes("Activate becomes available when GoCardless finishes verifying"))
  recordAxe("C9 axe on Review (1440)", await axe(page))

  // ------------------------------------------------------------------ D. verified -> Activate, once
  sql(`begin; set local role service_role; select public.update_gocardless_verification_status('${ids.club}', 'successful'); commit;`)
  record("D1 the Club Admin is told GoCardless verified the account, once",
    sql(`select count(*) from public.notifications where user_id = '${CA.id}' and type = 'membership_gocardless_verified' and data ->> 'club_id' = '${ids.club}'`) === "1"
      && sql(`select count(*) from public.notifications where user_id = '${TM.id}' and type = 'membership_gocardless_verified'`) === "0")
  await go(page, "/club/settings/subscriptions")
  await page.getByRole("heading", { name: "Review and Activate" }).waitFor({ timeout: 30000 })
  record("D2 with GoCardless verified, Activate opens", (await activate.getAttribute("aria-disabled")) !== "true")
  let activation = null
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] && !activation) activation = { url: r.url(), headers: r.headers(), body: r.postData() }
  })
  await activate.click()
  const confirm = page.getByRole("dialog")
  await confirm.waitFor()
  const confirmText = (await confirm.innerText()).replace(/\s+/g, " ")
  record("D3 the confirmation lists each membership's price", confirmText.includes("Junior Membership: members pay £16.40 a month") && confirmText.includes("Senior Membership: members pay £22.55 a month"))
  const go2 = confirm.getByRole("button", { name: "Activate", exact: true })
  await go2.click()
  await go2.click({ timeout: 2000 }).catch(() => {})
  await page.waitForURL(/activated=/, { timeout: 60000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("D4 memberships are on, and Membership Settings says so", programme().startsWith("true|") && (await page.locator("h1").innerText()).trim() === "Membership Settings" && (await mainText(page)).includes("Club Memberships are on."))
  if (activation) {
    const replay = await page.request.fetch(activation.url, { method: "POST", headers: activation.headers, data: activation.body })
    record("D5 a replayed activation request changes nothing", replay.status() < 500, String(replay.status()))
  } else {
    record("D5 a replayed activation request changes nothing", false, "no server action was captured")
  }
  record("D6 a double click and a replay switched memberships on exactly once",
    sql(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action = 'programme_activated'`) === "1")

  // ------------------------------------------------------------------ E. Membership Settings
  await page.getByRole("switch").click()
  const pauseDialog = page.getByRole("dialog")
  await pauseDialog.waitFor()
  const pauseButton = pauseDialog.getByRole("button", { name: "Pause New Memberships" })
  record("E1 pausing needs a reason", await pauseButton.isDisabled())
  await pauseDialog.getByLabel(/Reason/).fill("Suite 98: end of season")
  await pauseButton.click()
  await pauseDialog.waitFor({ state: "hidden", timeout: 30000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByText("Paused", { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {})
  record("E2 paused on the server, with the reason recorded", programme().startsWith("false|") && sql(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action = 'programme_paused'`) === "1")
  await page.getByRole("switch").click()
  const resumeDialog = page.getByRole("dialog")
  await resumeDialog.waitFor()
  await resumeDialog.getByRole("button", { name: "Take New Memberships" }).click()
  await resumeDialog.waitFor({ state: "hidden", timeout: 30000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  record("E3 resumed: the server re-checked readiness and switched new memberships back on", programme().startsWith("true|") && sql(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action = 'programme_resumed'`) === "1")
  await page.getByRole("button", { name: "Disconnect GoCardless" }).click()
  const disconnect = page.getByRole("dialog")
  await disconnect.waitFor()
  const confirmDisconnect = disconnect.getByRole("button", { name: "Disconnect GoCardless" })
  record("E4 disconnecting needs a reason", await confirmDisconnect.isDisabled())
  await disconnect.getByLabel(/Reason/).fill("Suite 98: switching accounts")
  await confirmDisconnect.click()
  await disconnect.waitFor({ state: "hidden", timeout: 60000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  // The page re-reads the club after the action; the button follows the server's answer when it arrives.
  await page.getByRole("button", { name: /Reconnect GoCardless/ }).waitFor({ timeout: 30000 }).catch(() => {})
  record("E5 disconnected on the server, and the page offers Reconnect",
    sql(`select (disconnected_at is not null)::text from public.gocardless_merchant_connections where club_id = '${ids.club}'`) === "true"
      && (await page.getByRole("button", { name: /Reconnect GoCardless/ }).count()) === 1)

  // ------------------------------------------------------------------ G. 390 wide
  const phone = await signedIn(browser, CA, 390)
  await go(phone.page, "/club/settings/subscriptions")
  let m = await measure(phone.page)
  record("G1 Membership Settings at 390: no sideways scroll", m.innerWidth === 390 && m.scrollWidth <= m.clientWidth, JSON.stringify(m))
  recordAxe("G2 axe on Membership Settings (390)", await axe(phone.page))
  await phone.context.close()
  const elsewhere = await signedIn(browser, OTHER, 390, ids.other)
  await go(elsewhere.page, "/club/settings/subscriptions")
  m = await measure(elsewhere.page)
  record("G3 the journey at 390 (another club, nothing set up): no sideways scroll", (await elsewhere.page.getByRole("heading", { name: "Set Up Club Memberships" }).count()) === 1 && m.scrollWidth <= m.clientWidth, JSON.stringify(m))
  recordAxe("G4 axe on Get Started (390)", await axe(elsewhere.page))
  await elsewhere.context.close()

  // ------------------------------------------------------------------ F. who may not
  const outsider = await page.request.get(`${APP}/api/gocardless/oauth/start?clubId=${ids.other}`, { maxRedirects: 0 })
  record("F1 a Club Admin cannot start a GoCardless connection for another club", outsider.status() === 403 && !outsider.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("gc_oauth_state=")), String(outsider.status()))
  const version = sql(`select internal.club_membership_terms_version()`)
  record("F2 nor agree to the terms, nor switch memberships on, for another club",
    as(CA.id, `select public.accept_club_membership_terms('${ids.other}', '${version}')`).startsWith("REFUSED")
      && as(CA.id, `select public.activate_membership_programme('${ids.other}')`).startsWith("REFUSED"))
  await context.close()
  const tm = await signedIn(browser, TM, 1440, ids.club, "TEAM_MANAGER")
  await go(tm.page, "/club/settings/subscriptions")
  record("F3 a Team Manager is turned away from the page", !tm.page.url().includes("/club/settings/subscriptions") && (await tm.page.getByRole("heading", { name: /Club Memberships|Membership Settings/ }).count()) === 0, tm.page.url().replace(APP, ""))
  record("F4 and the server refuses them the club's setup", as(TM.id, `select public.membership_setup_state('${ids.club}')`).startsWith("REFUSED"))
  await tm.context.close()
} catch (e) {
  record("the suite ran to the end", false, String(e?.message ?? e).split("\n")[0].slice(0, 240))
} finally {
  if (browser) await browser.close()
  try {
    cleanup()
  } catch (e) {
    record("clean-up ran", false, String(e?.message ?? e).split("\n")[0].slice(0, 240))
  }
}

const left = residue(everyId.filter(Boolean))
record("nothing of this run is left anywhere (every uuid column scanned)", left === "0", `${left} references`)
record("no uncaught error in any page", errors.length === 0, errors.join(" | ").slice(0, 240))

process.exit(summarise() ? 0 : 1)
