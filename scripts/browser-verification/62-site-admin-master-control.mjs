// =====================================================================
// SLICE 7 -- MASTER CONTROL, USERS & ACCESS, AND CREATE USER, IN A BROWSER
//
// The database proofs say a Read Only or Club Data Site Admin cannot do
// these things. This says the product agrees: the controls are not on the
// page for them, and the route behind the control refuses them too.
//
// That pairing is the whole point of the acceptance criterion. A hidden
// button is a courtesy; the refusal is the boundary. A screen that hides
// the control and serves the page anyway has only made the attack quieter.
//
// Local uat.* identities only. Everything this creates is removed at the
// end and the removal is asserted, so the suite is repeatable.
// =====================================================================

import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const NEW_EMAIL = `uat.s7.${TAG}@ovalball.test`

const FULL = "uat.fullsiteadmin@ovalball.test" // SITE_FULL
const DATA = "uat.siteadmin@ovalball.test" // SITE_DATA -- holds site.users.view, not site.users.create

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

/**
 * Every /admin/* page requires BOTH real Site Admin authority and that the
 * account has actively SWITCHED INTO Site Admin as its operating context --
 * an account that is also a club's admin must not reach these pages while
 * operating as that club. The cookie is how the product records the switch.
 *
 * Setting it cannot escalate anything: resolveActiveContext only ever returns
 * a context the session's real authority already contains, and falls back
 * silently otherwise. So the Club Data administrator below is in Site Admin
 * context and is still refused -- which is the assertion.
 */
async function asSiteAdmin(email) {
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await signIn(page, email)
  await ctx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
  return { ctx, page }
}

/** RFC 4648 base32 -- how an authenticator secret is written. */
function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(ch)
    if (v >= 0) bits += v.toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238. The same six digits the person's phone would be showing. */
function totp(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0")
}

/**
 * Enrols an authenticator through the product and verifies it with a REAL
 * code, computed from the secret the page shows with the standard algorithm.
 * Nothing is stubbed and no code is read out of the database.
 *
 * This is not scaffolding to get past a gate -- it is how master control is
 * actually reached. Every Q.3 RPC requires a second factor passed in the last
 * ten minutes, so an administrator who has merely signed in cannot do any of
 * it, which S7-06a below asserts before this runs.
 */
async function enrolAuthenticator(page) {
  await page.goto(`${APP}/security/enrol`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  const start = page.getByRole("button", { name: /start setup/i }).first()
  if (await start.isVisible().catch(() => false)) await start.click()
  await page.locator("#totp-code").waitFor({ state: "visible", timeout: 30000 })
  // Read from the element, not from the page text. The key is rendered in a
  // `break-all` mono paragraph, so innerText wraps it mid-string and a
  // "sixteen or more contiguous base32 characters" match finds only a fragment.
  const shown = (await page.locator("p.font-mono").first().textContent()) ?? ""
  const secret = shown.replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z2-7]{16,}$/.test(secret)) throw new Error(`no authenticator secret was shown (got ${JSON.stringify(shown.slice(0, 40))})`)
  await page.locator("#totp-code").fill(totp(secret))
  await page.getByRole("button", { name: /verify & continue/i }).click()
  await page.getByRole("button", { name: /saved them/i }).waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const saved = page.getByRole("button", { name: /saved them/i }).first()
  if (await saved.isVisible().catch(() => false)) await saved.click()
  await page.waitForLoadState("networkidle").catch(() => {})
  return secret
}

const browser = await launch()

try {
  // -------------------------------------------------------------------
  // 1. The control is rendered from the capability, not from "is a Site Admin"
  // -------------------------------------------------------------------
  {
    const { ctx, page } = await asSiteAdmin(FULL)
    await page.goto(`${APP}/admin/users`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    // Located by href rather than by role: the Button component renders as an
    // anchor through `render={<Link/>}`, and asking for role=link with an exact
    // name missed it while the words were plainly on the page.
    const visible = await page.locator('a[href="/admin/users/new"]').first().isVisible().catch(() => false)
    record("S7-01 a Full Site Admin sees Create User on Users & Access", visible)
    await ctx.close()
  }

  {
    const { ctx, page } = await asSiteAdmin(DATA)
    await page.goto(`${APP}/admin/users`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const onPage = await page.locator("h1").first().innerText().catch(() => "")
    const visible = await page.locator('a[href="/admin/users/new"]').first().isVisible().catch(() => false)
    record(
      "S7-02 a Club Data Site Admin reads the same page and sees NO Create User control",
      onPage.includes("User Management") && !visible,
      `h1="${onPage}" control=${visible}`
    )

    // ...and the route behind it refuses them, which is the half that matters.
    await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const url = page.url()
    record(
      "S7-03 and typing the address directly does not get them in either",
      !url.includes("/admin/users/new"),
      `landed on ${url}`
    )
    await ctx.close()
  }

  // -------------------------------------------------------------------
  // 2. Create User: the reason is required, the setup link is never shown
  // -------------------------------------------------------------------
  {
    const { ctx, page } = await asSiteAdmin(FULL)
    await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    // The form is a client component, so it does not exist until React mounts.
    // Waiting for the first field by id before touching anything keeps a slow
    // hydration from reading as a missing form.
    const formReady = async () => {
      await page.locator("#cu-email").waitFor({ state: "visible", timeout: 30000 })
    }
    // Located BY LABEL deliberately: if this stops working, the fields have lost
    // their label association and a screen reader has lost the form.
    const fill = async (label, value) => {
      const f = page.getByLabel(label).first()
      await f.waitFor({ state: "visible", timeout: 30000 })
      await f.click()
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type(value)
    }
    await formReady()
    await fill("Email Address", NEW_EMAIL)
    await fill("First Name", "Aoife")
    await fill("Surname", "Kelly")

    const submit = page.getByRole("button", { name: /^Create User$/ }).first()
    const disabledWithoutReason = await submit.isDisabled()
    record("S7-04 Create User stays disabled until a reason is given", disabledWithoutReason)

    const reason = page.getByRole("textbox", { name: /Reason/i }).first()
    await reason.click()
    await page.keyboard.type("short")
    const stillDisabled = await submit.isDisabled()
    record("S7-05 and a five-character reason is not enough", stillDisabled)

    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.type("Their club asked us to set them up; they cannot receive the signup email at work.")
    await submit.click()

    // The administrator has signed in and nothing more. Master control needs a
    // second factor passed in the last ten minutes, and says so in words a
    // person can act on. Waits for whichever outcome arrives rather than a fixed
    // pause, so a slow machine cannot turn "refused" into "nothing happened".
    const firstOutcome = await Promise.race([
      page.locator(".text-destructive-text").first().waitFor({ state: "visible", timeout: 30000 }).then(() => "refused"),
      page.getByText(/Account created/i).first().waitFor({ state: "visible", timeout: 30000 }).then(() => "created"),
    ]).catch(() => "nothing")
    const aalRefusal = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
    record(
      "S7-06a signing in is not enough -- master control asks for an authenticator code",
      firstOutcome === "refused" && /authenticator/i.test(aalRefusal),
      `${firstOutcome}: ${aalRefusal.slice(0, 120)}`
    )

    // So the administrator does what the message asks, with a real code.
    await enrolAuthenticator(page)

    await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await formReady()
    await fill("Email Address", NEW_EMAIL)
    await fill("First Name", "Aoife")
    await fill("Surname", "Kelly")
    const reason0 = page.getByRole("textbox", { name: /Reason/i }).first()
    await reason0.click()
    await page.keyboard.type("Their club asked us to set them up; they cannot receive the signup email at work.")
    await page.getByRole("button", { name: /^Create User$/ }).first().click()

    const created = await page
      .getByText(/Account created/i)
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    if (!created) {
      const shown = await page.locator("body").innerText()
      record("S7-06 POSITIVE CONTROL: with a fresh authenticator code, the identity is created", false,
        shown.replace(/\s+/g, " ").slice(0, 300))
    } else {
      record("S7-06 POSITIVE CONTROL: with a fresh authenticator code, the identity is created", true)
    }

    // PG-10 / Q.2 step 7: the plaintext never reaches the administrator, and
    // there is deliberately no Copy Setup Link.
    const body = await page.locator("body").innerText()
    const leaked = /setup link is|copy setup link|token=|\/invitation\/[A-Za-z0-9_-]{16,}/i.test(body)
    record("S7-07 and is never shown the setup link -- no token, no Copy Setup Link", !leaked)

    const state = sql(`select account_state || '|' || setup_state || '|' || created_source
                       from public.profiles where email = '${NEW_EMAIL}'`)
    record(
      "S7-08 the account is PENDING_SETUP and recorded as created by a Site Admin",
      state === "PENDING_SETUP|PENDING_DETAILS|SITE_ADMIN_CREATE",
      state
    )
    const events = sql(`select count(*) from public.security_events e join public.profiles p on p.id = e.subject_user_id
                        where p.email = '${NEW_EMAIL}' and e.event_type = 'site.user_created' and e.reason is not null`)
    record("S7-09 with one site.user_created event carrying the reason", events === "1", `events=${events}`)

    // -----------------------------------------------------------------
    // 3. ID-6: the same address again offers the existing person
    // -----------------------------------------------------------------
    await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    await formReady()
    await fill("Email Address", NEW_EMAIL)
    await fill("First Name", "Someone")
    await fill("Surname", "Else")
    const reason2 = page.getByRole("textbox", { name: /Reason/i }).first()
    await reason2.click()
    await page.keyboard.type("Creating the same person a second time by mistake.")
    await page.getByRole("button", { name: /^Create User$/ }).first().click()

    await page.locator(".text-destructive-text").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
    const dupMessage = (await page.locator(".text-destructive-text").allInnerTexts().catch(() => [])).join(" ")
    const openExisting = page.locator('a[href^="/admin/users/"]').filter({ hasText: /Open Existing User/i }).first()
    const offered = await openExisting.isVisible({ timeout: 15000 }).catch(() => false)
    record(
      "S7-10 ID-6: a known address is refused and offers Open Existing User",
      offered,
      `message="${dupMessage.slice(0, 140)}" link=${offered}`
    )
    const howMany = sql(`select count(*) from public.profiles where email = '${NEW_EMAIL}'`)
    record("S7-11 and no second identity was created", howMany === "1", `profiles=${howMany}`)

    // -----------------------------------------------------------------
    // 4. Account status now needs a reason, and records it
    // -----------------------------------------------------------------
    const userId = sql(`select id::text from public.profiles where email = '${NEW_EMAIL}'`)
    await page.goto(`${APP}/admin/users/${userId}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    await page.getByRole("button", { name: /^Suspend Account$/ }).first().click()
    const confirm = page.getByRole("button", { name: /^Confirm Suspend$/ }).first()
    await confirm.waitFor({ state: "visible", timeout: 10000 })
    record("S7-12 suspending an account asks for a reason before it will proceed", await confirm.isDisabled())

    const suspendReason = page.getByRole("textbox", { name: /Reason/i }).first()
    await suspendReason.click()
    await page.keyboard.type("The club reported this account was shared between two people.")
    await confirm.click()
    await page.getByText(/Suspended/).first().waitFor({ state: "visible", timeout: 20000 })

    const recorded = sql(`select e.reason from public.security_events e
                          where e.subject_user_id = '${userId}' and e.event_type = 'account.suspended'`)
    record(
      "S7-13 and the reason the administrator typed is what the audit line says",
      recorded === "The club reported this account was shared between two people.",
      recorded
    )
    const eventCount = sql(`select count(*) from public.security_events
                            where subject_user_id = '${userId}' and event_type = 'account.suspended'`)
    record("S7-14 exactly one audit line, not two", eventCount === "1", `events=${eventCount}`)

    await ctx.close()
  }

  // -------------------------------------------------------------------
  // 5. 320px. Every control still reachable, no horizontal scroll.
  // -------------------------------------------------------------------
  {
    const ctx = await newContext(browser, { width: 320, height: 720 })
    const page = await ctx.newPage()
    await signIn(page, FULL)
    await ctx.addCookies([{ name: "ovalball_ctx", value: "site_admin", url: APP }])
    await page.goto(`${APP}/admin/users/new`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})
    const m = await measure(page)
    record(
      "S7-15 Create User fits a 320px screen without sideways scrolling",
      m.innerWidth === 320 && m.scrollWidth <= 320,
      `inner=${m.innerWidth} scroll=${m.scrollWidth}`
    )
    const h1s = await page.locator("h1").count()
    record("S7-16 and the page has exactly one h1", h1s === 1, `h1 count=${h1s}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}

// ---------------------------------------------------------------------
// Clean up after itself, and prove it.
// ---------------------------------------------------------------------
// The authenticator this suite enrolled on the shared UAT administrator goes
// too, so the next run starts from the same place this one did.
sql(`do $$
declare v_admin uuid := (select id from public.profiles where email = '${FULL}');
begin
  delete from auth.mfa_amr_claims a using auth.sessions s where a.session_id = s.id and s.user_id = v_admin;
  delete from auth.mfa_factors where user_id = v_admin;
  delete from public.account_recovery_codes where user_id = v_admin;
end $$;`)

sql(`do $$
declare v uuid := (select id from public.profiles where email = '${NEW_EMAIL}');
begin
  if v is null then return; end if;
  perform set_config('ovalball.maintenance', 'on', true);
  delete from public.access_invitations where target_user_id = v;
  delete from public.security_events where subject_user_id = v or actor_user_id = v;
  delete from public.audit_log where record_id = v or changed_by = v or actor_user_id = v;
  delete from public.account_security_state where user_id = v;
  delete from public.profiles where id = v;
  delete from auth.users where id = v;
  delete from public.audit_log where record_id = v;
end $$;`)
const left = sql(`select count(*) from public.profiles where email = '${NEW_EMAIL}'`)
record("S7-17 the suite removed the identity it created", left === "0", `left=${left}`)

process.exit(summarise() ? 0 : 1)
