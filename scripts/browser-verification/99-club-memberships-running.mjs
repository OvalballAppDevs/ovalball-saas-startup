// =====================================================================
// CLUB MEMBERSHIPS -- RUNNING THEM ON THE WEBSITE (Part 2: 20270753000000,
// 20270754000000)
//
// The server decides every standing, amount, reminder and refusal
// (running_club_memberships.sql, membership_lifecycle_journeys.sql,
// gocardless_payouts_reconcile.test.mts). What only a browser can show is that
// each person meets the same truth through the real pages, sees only what they
// may, and that a refusal reaches them as a sentence:
//
//   A. THE CLUB ADMIN: the overview fills the desktop (no narrow column, no
//      sideways scroll) and shows the standing and the month's money; Members
//      filters and finds; a member's page explains a failed payment in words and
//      shows who pays and how to reach them.
//   B. CHANGING WHO PAYS: refused, with the way forward, while GoCardless is
//      collecting; done (audited, the old payer told) where nothing is collecting.
//   T. A TEAM'S BULK REMINDER: the Team Manager sees every message first; Cancel sends nothing
//   C. REMINDERS: the preview shows exactly the words the server will send; Send
//      reminds the right families once; the history records it.
//   D. A MEMBER WHO MAY ONLY LOOK: sees who pays but not their email or phone, and
//      is offered no reminder or payer change.
//   E. THE TEAM MANAGER: the team's memberships with no money anywhere; reminds
//      their own team's player; the club's pages stay closed.
//   F. FAMILIES: a guardian who does not pay is told someone else looks after it,
//      and offered nothing to set up; the payer whose membership never started is
//      told to start it.
//   G. 390 wide: overview, members, a member and reminders fit; axe.
//
// EVERYTHING IS THIS RUN'S OWN: one isolated club, its people, players,
// memberships, Direct Debit records and reminders -- removed at the end, on
// success or failure, and every uuid column is then scanned for anything still
// pointing at them. No persistent review identity is touched, and nothing
// reaches the owner's own login. GoCardless is never called: the Direct Debit
// records are what GoCardless's reconciliation would have written.
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
    stdio: ["pipe", "pipe", "pipe"],
  }).trim()
const last = (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT|SET|ROLLBACK)$/.test(l)).pop() ?? ""

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

const PEOPLE = `uat.mr.%.${TAG}@ovalball.test`
const P = (key, first, surname, phone = null) => ({ key, email: `uat.mr.${key}.${TAG}@ovalball.test`, first, surname, dob: "1983-05-02", phone })
const CA = P("ca", "Rhian", "Pritchard", "07700 900412")
const TM = P("tm", "Tom", "Hale")
const VIEWER = P("viewer", "Sian", "Morgan")
const EMMA = P("emma", "Emma", "Hughes", "07700 900611")
const MARK = P("mark", "Mark", "Hughes")
const ANNA = P("anna", "Anna", "Fletcher")
const GARETH = P("gareth", "Gareth", "Barnes")
const MAIR = P("mair", "Mair", "Shaw")
const DEWI = P("dewi", "Dewi", "Davies")
const RHYS = P("rhys", "Rhys", "Evans")
const EVERYONE = [CA, TM, VIEWER, EMMA, MARK, ANNA, GARETH, MAIR, DEWI, RHYS]
const ids = { dir: null, club: null, programme: null, junior: null, players: {}, psp: {}, teams: {} }

async function person(p) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`could not create ${p.email}: HTTP ${res.status}`)
  p.id = body.id
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, phone_number)
       values ('${p.id}', '${p.first}', '${p.surname}', '${p.email}', '${p.dob}', ${p.phone ? `'${p.phone}'` : "null"})
       on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth, phone_number = excluded.phone_number;
       update public.profiles set setup_state = 'COMPLETE' where id = '${p.id}';
       select internal.refresh_account_security_state('${p.id}');`)
}

/** One statement as a person, in one transaction. Returns the last line, or REFUSED: <message>. */
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

async function seed() {
  for (const p of EVERYONE) await person(p)
  ids.dir = sql(`insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
                 values ('Hollins Vale ${TAG} RFC', 'Hollinsby', 'Lancashire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mr-${TAG}') returning id`)
  ids.club = sql(`insert into public.clubs (directory_id, slug, status) values ('${ids.dir}', 'mr-${TAG}', 'active') returning id`)
  sql(`insert into public.club_setup_state (club_id, status, current_step, completed_at) values ('${ids.club}', 'COMPLETED', 3, now()) on conflict (club_id) do nothing`)
  const team = (key, label) =>
    sql(`insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
         select '${ids.club}', '${label}', 'mr-${key}-${TAG}', c.category, c.age_group, c.gender, 'union', c.id, true
           from public.canonical_team_types_by_code c where c.rugby_code = 'union' and c.key = '${key}' limit 1 returning id`)
  ids.teams.u12 = team("u12", "Under 12 Boys")
  ids.teams.g14 = team("girls_u14", "Under 14 Girls")
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${CA.id}', 'CLUB_ADMIN', 'active')`)
  const tmMs = sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${TM.id}', 'BASIC_USER', 'active') returning id`)
  sql(`select internal.grant_role('${tmMs}', 'TEAM_MANAGER', '${ids.teams.u12}', 'LEGACY_BACKFILL', 'suite 99')`)
  sql(`insert into public.club_memberships (club_id, user_id, role, status) values ('${ids.club}', '${VIEWER.id}', 'BASIC_USER', 'active');
       insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, reason)
       values ('${VIEWER.id}', 'finance.subscription.view', 'club', '${ids.club}', null, 'grant', 'active', '${CA.id}', 'CLUB', 'suite 99: sees the memberships')`)

  // The club's membership, through the Club Admin's own doors; members pay Ovalball's fee.
  ids.programme = last(as(CA.id, `select public.save_membership_settings('${ids.club}', 1, 'PRORATE_CURRENT_MONTH', 'PAYER')`))
  ids.junior = sql(`select id from public.membership_products where club_id = '${ids.club}' and status = 'active' order by created_at limit 1`)
  as(CA.id, `select public.rename_membership_product('${ids.junior}', 'Junior Membership')`)
  as(CA.id, `select public.set_membership_product_price('${ids.junior}', 1600, current_date)`)
  as(CA.id, `select public.accept_club_membership_terms('${ids.club}', 'club-memberships-2026-10-06-proposed')`)
  sql(`insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
       values ('${ids.club}', 'sandbox', 'OR_MR_${TAG}', null, 'read_write', 'successful', '${CA.id}', now())`)
  const on = as(CA.id, `select public.activate_membership_programme('${ids.club}')::text`)
  if (!/ACTIVATED/.test(on)) throw new Error(`seed: activation ${on}`)
  sql(`update public.club_subscription_pricing set effective_from = current_date - 90 where programme_id = '${ids.programme}'`)

  const player = (key, first, surname, age, teamKey, guardians) => {
    const id = sql(`insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
                    values ('${first}', '${surname}', internal.date_of_birth_in_age_grade('union', '${age}'), true, '${teamKey === "g14" ? "FEMALE" : "MALE"}') returning id`)
    for (const g of guardians) sql(`insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source) values ('${g.id}', '${id}', 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD')`)
    sql(`insert into public.player_team_memberships (player_id, team_id, status, state, source) values ('${id}', '${ids.teams[teamKey]}', 'active', 'ACTIVE', 'CLUB_CREATED')`)
    ids.players[key] = id
    return id
  }
  // The family door: the payer takes the membership on, priced and snapshotted by the server.
  const claim = (key, payer) => (ids.psp[key] = last(as(payer.id, `select public.claim_responsible_payer('${ids.players[key]}', '${ids.programme}')`)))
  const mandate = (key, payer, collecting) => {
    const cust = sql(`insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values ('${ids.club}', '${payer.id}', 'CU_MR_${TAG}_${payer.key}')
                      on conflict (club_id, payer_user_id) do update set updated_at = now() returning id`)
    const br = sql(`insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
                    values ('${ids.club}', '${ids.psp[key]}', 'BRQ_MR_${TAG}_${key}', 'fulfilled', '${payer.id}') returning id`)
    const md = sql(`insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status)
                    values ('${ids.club}', '${cust}', '${br}', 'MD_MR_${TAG}_${key}', 'active') returning id`)
    if (collecting)
      sql(`insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
           select '${ids.club}', id, '${md}', pricing_id, 'SB_MR_${TAG}_${key}', 1640, 'active' from public.player_subscription_payers where id = '${ids.psp[key]}'`)
  }
  const owe = (key, status, payment) => {
    const ob = sql(`insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, product_id, billing_period,
                      amount_due_minor, due_date, status, platform_fee_mode, platform_fee_bps, platform_fee_minor, payer_fee_minor)
                    select '${ids.programme}', '${ids.club}', player_id, id, pricing_id, product_id, date_trunc('month', current_date)::date, 1600, current_date - 10, '${status}',
                           'PAYER_SURCHARGE', 250, 40, 40 from public.player_subscription_payers where id = '${ids.psp[key]}' returning id`)
    if (payment) {
      const pay = sql(`insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, app_fee_minor)
                       values ('${ids.club}', '${ob}', 'PM_MR_${TAG}_${key}', 1640, '${payment}', 40) returning id`)
      sql(`update public.membership_obligations set gocardless_payment_id = '${pay}' where id = '${ob}'`)
    }
  }
  player("george", "George", "Hughes", "U12", "u12", [EMMA, MARK]); claim("george", EMMA); mandate("george", EMMA, true); owe("george", "FAILED", "failed")
  player("alfie", "Alfie", "Hughes", "U12", "u12", [EMMA]); claim("alfie", EMMA); mandate("alfie", EMMA, true); owe("alfie", "PAID", "confirmed")
  player("charlie", "Charlie", "Davies", "U12", "u12", [DEWI]); claim("charlie", DEWI); mandate("charlie", DEWI, true); owe("charlie", "PAID", "confirmed")
  player("dylan", "Dylan", "Evans", "U12", "u12", [RHYS]); claim("dylan", RHYS); mandate("dylan", RHYS, true); owe("dylan", "SUBMITTED", "submitted")
  player("leo", "Leo", "Barnes", "U12", "u12", [GARETH]); claim("leo", GARETH); mandate("leo", GARETH, false)
  player("ella", "Ella", "Walsh", "U14", "g14", [ANNA]); claim("ella", ANNA)
  player("hannah", "Hannah", "Bell", "U14", "g14", [MAIR])
}

function cleanup() {
  if (!ids.club) return
  sql(`
do $$
declare
  v_people uuid[] := array(select id from auth.users where email like '${PEOPLE}');
  v_club uuid := '${ids.club}';
  v_players uuid[] := array[${Object.values(ids.players).map((p) => `'${p}'::uuid`).join(",") || "null::uuid"}];
  v_progs uuid[] := array(select id from public.club_subscription_programmes where club_id = '${ids.club}');
  v_records uuid[];
begin
  perform set_config('ovalball.maintenance', 'on', true);
  v_records := array[v_club, '${ids.dir}'::uuid] || v_people || v_players || v_progs
    || array(select id from public.teams where club_id = v_club)
    || array(select id from public.club_memberships where club_id = v_club or user_id = any(v_people))
    || array(select id from public.role_assignments where club_id = v_club or user_id = any(v_people))
    || array(select id from public.player_subscription_payers where programme_id = any(v_progs))
    || array(select id from public.membership_obligations where club_id = v_club)
    || array(select id from public.membership_products where club_id = v_club)
    || array(select id from public.club_subscription_pricing where programme_id = any(v_progs))
    || array(select id from public.gocardless_merchant_connections where club_id = v_club)
    || array(select id from public.club_membership_terms_acceptances where club_id = v_club)
    || array(select id from public.capability_overrides where club_id = v_club)
    || array(select id from public.guardians where player_id = any(v_players));
  delete from public.notifications where user_id = any(v_people) or data ->> 'club_id' = v_club::text;
  delete from public.finance_audit_log where club_id = v_club or actor_user_id = any(v_people);
  delete from public.security_events where club_id = v_club or actor_user_id = any(v_people) or subject_user_id = any(v_people);
  update public.membership_obligations set gocardless_payment_id = null where club_id = v_club;
  delete from public.gocardless_payments where club_id = v_club;
  delete from public.gocardless_subscriptions where club_id = v_club;
  delete from public.gocardless_mandates where club_id = v_club;
  delete from public.gocardless_billing_requests where club_id = v_club;
  delete from public.gocardless_customers where club_id = v_club;
  delete from public.gocardless_merchant_connections where club_id = v_club;
  delete from internal.gocardless_connect_intents where club_id = v_club;
  delete from internal.gocardless_token_revocations where club_id = v_club;
  delete from public.club_membership_terms_acceptances where club_id = v_club;
  delete from public.membership_obligations where club_id = v_club;
  delete from public.membership_player_products where programme_id = any(v_progs);
  delete from public.player_subscription_payers where programme_id = any(v_progs);
  delete from public.membership_product_teams where club_id = v_club;
  delete from public.club_subscription_pricing where programme_id = any(v_progs);
  delete from public.club_subscription_sibling_rules where programme_id = any(v_progs);
  delete from public.membership_products where club_id = v_club;
  delete from public.club_subscription_programmes where id = any(v_progs);
  delete from public.capability_overrides where club_id = v_club or user_id = any(v_people);
  delete from public.player_team_memberships where player_id = any(v_players);
  delete from public.guardians where player_id = any(v_players);
  delete from public.players where id = any(v_players);
  delete from public.role_assignments where club_id = v_club or user_id = any(v_people);
  delete from public.club_memberships where club_id = v_club or user_id = any(v_people);
  delete from public.teams where club_id = v_club;
  delete from public.club_setup_state where club_id = v_club;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = '${ids.dir}';
  delete from public.audit_log where record_id = any(v_records) or changed_by = any(v_people) or actor_user_id = any(v_people);
  delete from public.profiles where id = any(v_people);
  delete from auth.sessions where user_id = any(v_people);
  delete from auth.identities where user_id = any(v_people);
  delete from auth.users where id = any(v_people);
  delete from public.audit_log where changed_at = now() and (record_id = any(v_records) or changed_by is null);
end $$;`)
}

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
  perform set_config('mr.residue', total::text, false);
end $$;
select current_setting('mr.residue', true);`))
}

async function axe(page) {
  await page.addScriptTag({ content: axeSource() })
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") ?? "" }))
  })
}

const errors = []
const watch = (page, label) => page.on("pageerror", (e) => errors.push(`${label}: ${e.message.split("\n")[0]}`))
const go = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForLoadState("networkidle").catch(() => {})
}
const mainText = async (page) => (await page.locator("main").innerText().catch(() => "")) || (await page.locator("body").innerText())

async function session(browser, who, width = 1440, context = null) {
  const ctx = await newContext(browser, { width, height: width > 600 ? 1000 : 844 })
  const page = await ctx.newPage()
  watch(page, who.key)
  await signIn(page, who.email)
  if (context) await ctx.addCookies([{ name: "ovalball_ctx", value: context, url: APP }])
  return { ctx, page }
}

const browser = await launch()
const created = []
try {
  await seed()
  created.push(ids.club, ids.dir, ...Object.values(ids.players), ...EVERYONE.map((p) => p.id))
  const clubCtx = `club:${ids.club}:CLUB_ADMIN`

  // ---- A. THE CLUB ADMIN ----------------------------------------------------------------------
  const a = await session(browser, CA, 1440, clubCtx)
  await go(a.page, "/club/finance")
  let text = await mainText(a.page)
  record("A1 the overview opens for the Club Admin with the club's memberships", /Junior Membership/.test(text), a.page.url())
  record("A2 it says how many need action and shows the month's money (Expected, Collected)", /need action/i.test(text) && /Expected/.test(text) && /Collected/.test(text), text.slice(0, 160))
  const m = await measure(a.page)
  record("A3 at 1440 the overview has no sideways scroll", m.scrollWidth <= m.clientWidth, `${m.scrollWidth}/${m.clientWidth}`)
  // The desktop is used: the page's panels reach well into the right half (the old page left it empty).
  const rightmost = await a.page.evaluate(() => Math.max(...[...document.querySelectorAll("main section, main [data-panel]")].map((e) => e.getBoundingClientRect().right), 0))
  record("A4 the overview uses the desktop width -- panels reach the right of the page, not one narrow column", rightmost > 1000, `rightmost panel edge ${Math.round(rightmost)}px`)
  recordAxe("A5 axe on the overview (1440)", await axe(a.page))

  await go(a.page, `/club/finance/members?segment=needs_action`)
  text = await mainText(a.page)
  record("A6 Members, filtered to Need Action, lists George, Leo, Ella and Hannah and not the paid Alfie",
    ["George Hughes", "Leo Barnes", "Ella Walsh", "Hannah Bell"].every((n) => text.includes(n)) && !text.includes("Alfie Hughes"), "")
  await go(a.page, `/club/finance/members?q=charl`)
  text = await mainText(a.page)
  record("A7 search finds Charlie and only Charlie", text.includes("Charlie Davies") && !text.includes("George Hughes"), "")

  await go(a.page, `/club/finance/members/${ids.players.george}`)
  text = await mainText(a.page)
  record("A8 George's page explains the failed payment in words, not codes", /Payment failed/.test(text) && /doesn't try it again on its own/.test(text) && !/PAYMENT_FAILED|PM_MR_/.test(text), "")
  record("A9 and shows who pays and how to reach her (the Club Admin may see contact details)", text.includes("Emma Hughes") && text.includes(EMMA.email), "")

  // ---- B. CHANGING WHO PAYS -------------------------------------------------------------------
  const changeOn = async (playerKey) => {
    await go(a.page, `/club/finance/members/${ids.players[playerKey]}`)
    await a.page.getByRole("button", { name: /Change (Payer|Who Pays)/ }).first().click()
    const dialog = a.page.getByRole("dialog")
    await dialog.waitFor({ timeout: 15000 })
    await dialog.getByLabel(/Reason/).fill("Suite 99: the other parent is paying")
    await dialog.getByRole("button", { name: "Change Who Pays" }).click()
    await a.page.waitForTimeout(2500)
    return { dialogText: await dialog.innerText().catch(() => ""), text: await mainText(a.page) }
  }
  let r = await changeOn("george")
  record("B1 changing who pays is refused while GoCardless is collecting, with the way forward",
    /Cancel the membership first/.test(r.dialogText + r.text) && sql(`select status from public.player_subscription_payers where id = '${ids.psp.george}'`) === "active", "")
  await a.page.keyboard.press("Escape").catch(() => {})
  r = await changeOn("ella")
  await go(a.page, `/club/finance/members/${ids.players.ella}`)
  text = await mainText(a.page)
  record("B2 where nothing is collecting the payer is released: Not set up, audited, and Anna is told",
    sql(`select status from public.player_subscription_payers where id = '${ids.psp.ella}'`) === "ended" &&
      sql(`select count(*) from public.finance_audit_log where club_id = '${ids.club}' and action = 'payer_released'`) === "1" &&
      sql(`select count(*) from public.notifications where user_id = '${ANNA.id}' and type = 'membership_payer_released'`) === "1" &&
      /No Direct Debit set up|Not set up/.test(text),
    "")

  // ---- T. A TEAM'S BULK REMINDER IS CONFIRMED FIRST ----------------------------------------------
  // Before C, while the Under 12s still have families to remind: the Team Manager's "Remind N Families" shows the
  // server's words for each situation first, and Cancel sends nothing.
  const everyone = Object.values(ids.players).map((p) => `'${p}'`).join(",")
  const bodiesOf = (who, call) => JSON.parse(last(as(who, `select coalesce(jsonb_agg(e ->> 'body'), '[]'::jsonb) from jsonb_array_elements(${call} -> 'examples') e`)) || "[]")
  const teamBodies = bodiesOf(TM.id, `public.membership_reminder_preview('${ids.club}', array[${everyone}]::uuid[], '${ids.teams.u12}')`)
  const t = await session(browser, TM, 1440, `team:${ids.teams.u12}:TEAM_MANAGER`)
  await go(t.page, `/teams/${ids.teams.u12}/subscriptions`)
  const sentBeforeT = sql(`select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'club_id' = '${ids.club}'`)
  await t.page.getByRole("button", { name: /^Remind \d+ Famil(y|ies)$/ }).first().click()
  await t.page.getByRole("heading", { name: /^Remind \d+ Famil(y|ies)$/ }).waitFor({ timeout: 15000 }).catch(() => {})
  await t.page.waitForTimeout(2000)
  const confirmText = (await t.page.locator("section[aria-labelledby='team-remind-confirm']").innerText().catch(() => "")) || ""
  record("T1 a Team Manager's bulk reminder shows every message the server would send, how many families get each, and no money",
    teamBodies.length > 0 && teamBodies.every((b) => confirmText.includes(b)) && /famil(y gets|ies get) this/.test(confirmText) && !/£\s?\d/.test(confirmText),
    `${teamBodies.length} messages`)
  await t.page.getByRole("button", { name: "Cancel" }).click()
  await t.page.waitForTimeout(1000)
  record("T2 and Cancel sends nothing",
    sql(`select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'club_id' = '${ids.club}'`) === sentBeforeT &&
      (await t.page.locator("section[aria-labelledby='team-remind-confirm']").count()) === 0,
    "")
  await t.ctx.close()

  // ---- C. REMINDERS ---------------------------------------------------------------------------
  // The server's own words for the page's audience (everybody who can be reminded: the preview skips the rest), one
  // message for each situation in it.
  const expected = bodiesOf(CA.id, `public.membership_reminder_preview('${ids.club}', array[${everyone}]::uuid[])`)
  await go(a.page, `/club/finance/reminders`)
  await a.page.getByRole("radio", { name: /needs action/i }).first().check().catch(() => {})
  await a.page.waitForTimeout(2500)
  text = await mainText(a.page)
  record("C1 the preview shows exactly the server's words for every situation in the audience, with how many families get each",
    expected.length > 1 && expected.every((b) => text.includes(b)) && /famil(y gets|ies get) this/.test(text),
    `${expected.length} messages`)
  const before = Number(sql(`select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'club_id' = '${ids.club}'`))
  const send = a.page.getByRole("button", { name: /^Send( \d+)? Reminders?$/ })
  await send.first().click()
  await a.page.waitForTimeout(3500)
  const after = Number(sql(`select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'club_id' = '${ids.club}'`))
  const toLeo = sql(`select count(*) from public.notifications where type = 'membership_reminder' and user_id = '${GARETH.id}' and data ->> 'player_id' = '${ids.players.leo}'`)
  record("C2 Send reminds the families who need action -- Leo's father once -- and nobody who is up to date",
    after > before && toLeo === "1" && sql(`select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'player_id' = '${ids.players.alfie}'`) === "0",
    `${after - before} sent`)
  await send.first().click().catch(() => {})
  await a.page.waitForTimeout(2500)
  record("C3 pressing Send again inside three days asks nobody twice",
    sql(`select count(*) from public.notifications where type = 'membership_reminder' and user_id = '${GARETH.id}' and data ->> 'player_id' = '${ids.players.leo}'`) === "1", "")
  await go(a.page, `/club/finance/reminders?tab=history`)
  await a.page.getByRole("tab", { name: /History/ }).click().catch(() => {})
  await a.page.waitForTimeout(1500)
  text = await mainText(a.page)
  record("C4 the history records who was reminded and by whom", text.includes("Leo Barnes") && text.includes("Rhian Pritchard"), "")
  await a.ctx.close()

  // ---- D. A MEMBER WHO MAY ONLY LOOK ----------------------------------------------------------
  // A member the club let see its memberships holds no club role, so has no club workspace to switch to (a known
  // limit of the context model, recorded in the report): they reach a member through the page's own club link.
  const d = await session(browser, VIEWER, 1440)
  await go(d.page, `/club/finance/members/${ids.players.george}?club=${ids.club}`)
  text = await mainText(d.page)
  const onMember = new URL(d.page.url()).pathname === `/club/finance/members/${ids.players.george}`
  record("D1 a member who may see the memberships sees who pays, but not their email or phone",
    onMember && text.includes("Emma Hughes") && !text.includes(EMMA.email) && !text.includes(EMMA.phone), new URL(d.page.url()).pathname)
  record("D2 and is offered no reminder and no payer change",
    onMember && (await d.page.getByRole("button", { name: /Send Reminder|Change (Payer|Who Pays)/ }).count()) === 0, "")
  await d.ctx.close()

  // ---- E. THE TEAM MANAGER --------------------------------------------------------------------
  const tmCtx = `team:${ids.teams.u12}:TEAM_MANAGER`
  const e = await session(browser, TM, 1440, tmCtx)
  await go(e.page, `/teams/${ids.teams.u12}/subscriptions`)
  text = await mainText(e.page)
  record("E1 the Team Manager sees the Under 12s' memberships", text.includes("George Hughes") && text.includes("Leo Barnes"), "")
  record("E2 with no money anywhere: no amounts, no payer, no bank", !/£\s?\d/.test(text) && !text.includes("Emma Hughes") && !/mandate/i.test(text), "")
  record("E3 and nobody from another team", !text.includes("Ella Walsh") && !text.includes("Hannah Bell"), "")
  await go(e.page, "/club/finance")
  const financeUrl = new URL(e.page.url()).pathname
  text = await mainText(e.page)
  record("E4 the club's Memberships pages stay closed to the Team Manager", financeUrl !== "/club/finance" || !/Expected|Collected/.test(text), financeUrl)
  await e.ctx.close()

  // ---- F. FAMILIES ----------------------------------------------------------------------------
  const f1 = await session(browser, MARK, 1440)
  await go(f1.page, `/parent/players/${ids.players.george}/subscription`)
  text = await mainText(f1.page)
  record("F1 a guardian who does not pay is told someone else looks after it",
    /Someone else looks after the payments/.test(text) && !text.includes("Emma Hughes") && (await f1.page.getByRole("button", { name: /Set Up Direct Debit/ }).count()) === 0, "")
  await f1.ctx.close()
  const f2 = await session(browser, GARETH, 1440)
  await go(f2.page, `/parent/players/${ids.players.leo}/subscription`)
  text = await mainText(f2.page)
  record("F2 the payer whose membership never started is told to start it", /membership hasn't started|Start it so the club can collect it/.test(text), "")
  await f2.ctx.close()

  // ---- G. 390 WIDE ----------------------------------------------------------------------------
  const g = await session(browser, CA, 390, clubCtx)
  for (const [label, path] of [["overview", "/club/finance"], ["members", "/club/finance/members"], ["member", `/club/finance/members/${ids.players.george}`], ["reminders", "/club/finance/reminders"]]) {
    await go(g.page, path)
    const mm = await measure(g.page)
    record(`G ${label} fits at 390 with no sideways scroll`, mm.scrollWidth <= mm.clientWidth, `${mm.scrollWidth}/${mm.clientWidth}`)
  }
  recordAxe("G5 axe on Reminders (390)", await axe(g.page))
  await g.ctx.close()

  record("Z1 no page error on any page", errors.length === 0, errors.slice(0, 3).join(" | "))
} catch (err) {
  record("Z0 the run completed", false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" "))
} finally {
  await browser.close().catch(() => {})
  try {
    cleanup()
    record("Z2 everything this run created is removed", residue(created.filter(Boolean)) === "0", "")
  } catch (err) {
    record("Z2 everything this run created is removed", false, String(err?.message ?? err))
  }
}
process.exit(summarise() ? 0 : 1)
