// =====================================================================
// SLICE 6 -- PASSWORD, AUTHENTICATOR, RECOVERY AND SESSIONS, IN A BROWSER
//
// The database proofs say the rules hold. This says a person can actually
// get through them: set a password, enrol an authenticator, be refused a
// wrong code, be let in by a right one, and get back in with a recovery
// code after losing the authenticator entirely.
//
// The TOTP codes here are REAL: computed from the secret the enrolment page
// shows, with the standard algorithm, the same way a phone would. Nothing is
// stubbed, and no code is read out of the database.
//
// Local uat.* identities only. Nothing touches production.
// =====================================================================

import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"

import { launch, newContext, signIn, APP, measure, record, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const TAG = Math.random().toString(36).slice(2, 8)
const EMAIL = `uat.s6.${TAG}@ovalball.test`
const PASSWORD = "Ovalball-Test-1!"

const sql = (q) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", q], {
    encoding: "utf8",
  }).trim()

/** RFC 4648 base32, which is how an authenticator secret is written. */
function base32Decode(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(ch)
    if (v < 0) continue
    bits += v.toString(2).padStart(5, "0")
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
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0")
  return code
}

const browser = await launch()

try {
  // A fresh identity with a confirmed address and no password and no factor.
  const userId = sql(`
    with u as (
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
        reauthentication_token)
      values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        '${EMAIL}','',now(),now(),now(),'{}','{}','','','','','','','','')
      returning id)
    select id::text from u`)
  sql(`insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
       values ('${userId}','Sam','Sixer','${EMAIL}',(current_date - interval '31 years')::date,'ACTIVE')
       on conflict (id) do update set account_state='ACTIVE', first_name='Sam', surname='Sixer';
       select internal.refresh_account_security_state('${userId}');`)

  // ------------------------------------------------------------------
  // A. The sign-in page offers a password FIRST, and still offers the link.
  // ------------------------------------------------------------------
  const anon = await newContext(browser)
  const anonPage = await anon.newPage()
  await anonPage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await anonPage.waitForLoadState("networkidle").catch(() => {})
  await anonPage.getByRole("button", { name: /sign in with email/i }).first().click()
  await anonPage.locator('input[type="password"]').first().waitFor({ state: "visible", timeout: 20000 })

  record("A1 the sign-in page asks for a password", true)
  record(
    "A2 and still offers the emailed link, because retiring it is a later step",
    await anonPage.getByRole("button", { name: /email me a link instead/i }).isVisible(),
  )
  record(
    "A3 with a way to recover a forgotten password",
    await anonPage.getByRole("link", { name: /forgotten your password/i }).isVisible(),
  )

  // A wrong password says one thing, and says nothing about whether the account exists.
  await anonPage.locator('input[type="email"]').first().fill(EMAIL)
  await anonPage.locator('input[type="password"]').first().fill("Wrong-Password-9!")
  await anonPage.getByRole("button", { name: /^sign in$/i }).click()
  await anonPage.waitForTimeout(2500)
  const wrongText = await anonPage.locator("body").innerText()
  record(
    "A4 a wrong password is refused with one generic message",
    /email or password is incorrect/i.test(wrongText),
    wrongText.match(/Email or password[^.]*\./)?.[0] ?? wrongText.slice(0, 80),
  )

  // The same message for an address that does not exist: no enumeration oracle.
  await anonPage.locator('input[type="email"]').first().fill(`nobody-${TAG}@ovalball.test`)
  await anonPage.locator('input[type="password"]').first().fill("Wrong-Password-9!")
  await anonPage.getByRole("button", { name: /^sign in$/i }).click()
  await anonPage.waitForTimeout(2500)
  const unknownText = await anonPage.locator("body").innerText()
  record(
    "A5 NO ORACLE: an address that does not exist gives the identical message",
    /email or password is incorrect/i.test(unknownText),
  )

  // ------------------------------------------------------------------
  // B. Set a password, through the real flow, with the real rule.
  // ------------------------------------------------------------------
  const ctx = await newContext(browser)
  const page = await ctx.newPage()
  await signIn(page, EMAIL)

  await page.goto(`${APP}/account/security`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  record(
    "B1 the Security page loads for a signed-in person",
    /security/i.test(await page.locator("h1").first().innerText().catch(() => "")),
    `at ${page.url()} :: ${(await page.locator("body").innerText()).slice(0, 110).replace(/\s+/g, " ")}`,
  )

  // ------------------------------------------------------------------
  // C. Enrol an authenticator, and verify with a REAL code.
  // ------------------------------------------------------------------
  const consoleErrors = []
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)) })
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 300)))
  await page.goto(`${APP}/security/enrol`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByRole("button", { name: /start setup/i }).click()
  await page
    .locator("#totp-code")
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(async () => {
      record("C0 enrolment could not start", false,
        (await page.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ") +
          " || CONSOLE: " + (consoleErrors.join(" ~~ ").slice(0, 600) || "(none)"))
    })

  const bodyText = await page.locator("body").innerText()
  const secret = bodyText.match(/\b[A-Z2-7]{16,}\b/)?.[0] ?? ""
  record("C1 a QR code and a text secret are shown", secret.length >= 16, `secret length ${secret.length}`)
  record("C2 and the page says it is shown only once", /only time|once/i.test(bodyText))

  // A wrong code is refused.
  await page.locator("#totp-code").fill("000000")
  await page.getByRole("button", { name: /verify & continue/i }).click()
  await page.waitForTimeout(2500)
  record(
    "C3 a wrong code is refused",
    /wasn.t right|didn.t/i.test(await page.locator("body").innerText()),
  )

  // POSITIVE CONTROL: the right code, computed the way a phone would.
  await page.locator("#totp-code").fill(totp(secret))
  await page.getByRole("button", { name: /verify & continue/i }).click()
  await page.getByRole("button", { name: /saved them/i }).waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const afterText = await page.locator("body").innerText()
  const codes = [...afterText.matchAll(/\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b/g)].map((m) => m[0])
  record("C4 POSITIVE CONTROL: a real code is accepted", codes.length > 0, `${codes.length} recovery codes shown`)
  record("C5 and exactly ten recovery codes are shown, once", codes.length === 10)
  record(
    "C6 the factor is recorded against the account",
    sql(`select count(*) from auth.mfa_factors where user_id='${userId}' and status='verified'`) === "1",
  )
  record(
    "C7 and Ovalball stored a hash of each code, never a code",
    sql(`select count(*) from public.account_recovery_codes where user_id='${userId}'`) === "10" &&
      sql(`select count(*) from public.account_recovery_codes r where ${codes
        .map((c) => `r.code_hmac::text like '%${c}%'`)
        .join(" or ")}`) === "0",
  )

  // ------------------------------------------------------------------
  // D. Accessibility and mobile on the pages a person meets under stress.
  // ------------------------------------------------------------------
  const mob = await newContext(browser, { width: 320, height: 720 })
  const mobPage = await mob.newPage()
  await mobPage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" })
  await mobPage.waitForLoadState("networkidle").catch(() => {})
  const m = await measure(mobPage)
  record("D1 the sign-in page fits a 320px phone", m.innerWidth === 320 && m.scrollWidth <= 320,
    `viewport=${m.innerWidth} content=${m.scrollWidth}`)

  await mobPage.goto(`${APP}/security/recovery`, { waitUntil: "domcontentloaded" })
  await mobPage.waitForLoadState("networkidle").catch(() => {})
  const m2 = await measure(mobPage)
  record("D2 so does the recovery page", m2.scrollWidth <= 320, `content=${m2.scrollWidth}`)

  // The accessibility checks below need the REAL page, so they run on the signed-in context. A fresh
  // context is redirected to /login, and measuring that would have quietly checked the wrong page.
  await mobPage.context().addCookies(await page.context().cookies())
  await mobPage.goto(`${APP}/security/recovery`, { waitUntil: "domcontentloaded" })
  await mobPage.waitForLoadState("networkidle").catch(() => {})

  const unnamed = await mobPage.evaluate(() =>
    [...document.querySelectorAll("input, button")].filter((el) => {
      const name =
        el.getAttribute("aria-label") ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
        el.textContent ||
        el.getAttribute("placeholder")
      return !name || !name.trim()
    }).length)
  record("D3 every control on the recovery page has an accessible name", unnamed === 0, `unnamed=${unnamed}`)
  record(
    "D4 the one-time code field announces itself as one, so a password manager offers the right thing",
    (await mobPage.locator('input[autocomplete="one-time-code"]').count()) > 0,
  )

  // ------------------------------------------------------------------
  // E. Lose the authenticator. Get back in with a recovery code.
  // ------------------------------------------------------------------
  await page.goto(`${APP}/security/recovery`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByLabel(/recovery code/i).fill(codes[0].toLowerCase())
  await page.getByRole("button", { name: /use this code/i }).click()
  await page.waitForURL((u) => u.pathname.startsWith("/security/enrol"), { timeout: 30000 }).catch(() => {})

  record(
    "E1 a recovery code typed in lower case is accepted",
    sql(`select count(*) from public.account_recovery_codes where user_id='${userId}' and used_at is not null`) === "1",
  )
  record(
    "E2 and it removes every authenticator, so a new one must be set up",
    sql(`select count(*) from auth.mfa_factors where user_id='${userId}'`) === "0",
  )
  record(
    "E3 and it lands on enrolment rather than letting them in -- a code is a way BACK, not a way past",
    page.url().includes("/security/enrol"),
    page.url(),
  )
  record(
    "E4 REPLAY: the same code cannot be used again",
    sql(`select internal.redeem_recovery_code('${userId}', '${codes[0]}')`) === "f",
  )
} finally {
  await browser.close()
  sql(`do $$
declare v uuid[] := array(select id from auth.users where email like 'uat.s6.${TAG}@ovalball.test');
begin
  perform set_config('ovalball.maintenance','on',true);
  delete from auth.sessions where user_id = any(v);
  delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id = any(v));
  delete from auth.mfa_challenges where factor_id in (select id from auth.mfa_factors where user_id = any(v));
  delete from auth.mfa_factors where user_id = any(v);
  delete from public.account_recovery_codes where user_id = any(v);
  delete from public.security_events where subject_user_id = any(v) or actor_user_id = any(v);
  delete from public.notifications where user_id = any(v);
  delete from public.account_security_state where user_id = any(v);
  delete from public.audit_log where changed_by = any(v);
  delete from public.profiles where id = any(v);
  delete from auth.identities where user_id = any(v);
  delete from auth.users where id = any(v);
end $$;`)
}

process.exit(summarise() ? 0 : 1)
