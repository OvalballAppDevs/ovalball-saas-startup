// ONE VERSION, SET IN SITE ADMIN, SHOWN EVERYWHERE.
//
// Ovalball's version and Beta/Live state are controlled from Site Admin →
// Release & Platform Mode. Publishing a release there must change the version
// on every surface that shows one, and no surface may show package.json's
// version instead (it once read 0.0.1 on the Site Admin dashboard while the
// published release was 0.0.3).
//
// A Site Admin who may manage releases (manage_system, not Full -- so this run
// can remove it again) records and publishes a release through the real form.
// The public header badge and footer, the app shell badge, the Site Admin
// dashboard and System Health are read. A newer release is then published and
// every surface must follow. Everything this run creates is removed at the end.
//
//   APP_URL=http://localhost:3000 node scripts/browser-verification/41-release-version-sitewide.mjs
//
// Optional: SUPABASE_DB_CONTAINER (default supabase_db_ovalball-saas-startup), MAILPIT_URL.

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { APP, launch, newContext, record, signIn, summarise } from "./harness.mjs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const sql = (q) => execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"], { input: q, encoding: "utf8" }).trim()
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""

const TAG = Date.now().toString(36).slice(-6)
const EMAIL = `uat.release.admin.${TAG}@ovalball.test`
// Versions nobody would otherwise record, newest last.
const N = Number.parseInt(TAG.replace(/[^0-9]/g, "").slice(-4) || "1", 10)
const VERSION_A = `97.${N}.0`
const VERSION_B = `97.${N}.1`
const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "ovalball-release-version")
mkdirSync(SHOTS, { recursive: true })
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version

function seed() {
  sql(`
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${EMAIL}', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email) values (v_id, 'Uat', 'Release Admin', '${EMAIL}') on conflict (id) do nothing;
  -- Not Full: a Full Site Admin cannot be removed while it is the last one, and this run must clean up anywhere.
  insert into public.site_admins (user_id, status, admin_role, manage_system) values (v_id, 'active', 'user_access', true);
end $$;`)
}

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  sql(`
do $$
declare v_user uuid := (select id from auth.users where email = '${EMAIL}');
begin
  delete from public.audit_log where table_name = 'platform_releases' and record_id in (select id from public.platform_releases where version in ('${VERSION_A}', '${VERSION_B}'));
  delete from public.platform_releases where version in ('${VERSION_A}', '${VERSION_B}');
  delete from public.site_admins where user_id = v_user;
  delete from public.audit_log where changed_by = v_user;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
end $$;`)
  const left = one(`select (select count(*) from platform_releases where version in ('${VERSION_A}', '${VERSION_B}')) + (select count(*) from auth.users where email = '${EMAIL}')`)
  record("cleanup: the releases and the Site Admin this run created are gone", left === "0", `remaining=${left}`)
}

const text = async (page) => ((await page.locator("body").textContent()) ?? "").replace(/\s+/g, " ")
/** "BETA 1.2.3" in Beta, nothing in Live -- the badge is the Beta state, not a version label. */
const badgeFor = (mode, version) => (mode === "beta" ? `BETA ${version}` : null)
/** package.json's version must never be presented as the product version, unless it genuinely is the published one. */
const noPackageVersion = (body, published) => published === PACKAGE_VERSION || !new RegExp(`\\bv?${PACKAGE_VERSION.replace(/\./g, "\\.")}\\b`).test(body)

async function publishThroughSiteAdmin(page, version) {
  await page.goto(`${APP}/admin/releases`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Record a release/i }).click()
  const field = page.locator("#release-version")
  const suggested = await field.inputValue()
  await field.fill(version)
  await page.locator("#release-title").fill(`Release ${version}`)
  await page.getByLabel(/Publish these notes now/).check()
  await page.getByRole("button", { name: /^Record release$/i }).click()
  await page.getByText(version, { exact: false }).first().waitFor({ timeout: 30000 })
  return suggested
}

async function readEverywhere(browser, version, mode, label) {
  // Signed-out public pages: header badge and footer.
  const anon = await newContext(browser, { width: 1280, height: 900 })
  const a = await anon.newPage()
  for (const route of ["/", "/clubs", "/about"]) {
    await a.goto(`${APP}${route}`, { waitUntil: "networkidle" })
    const body = await text(a)
    const badge = badgeFor(mode, version)
    record(
      `${label}: public ${route} shows version ${version} in the footer${badge ? " and the Beta badge" : ""}, never package.json's`,
      body.includes(`Ovalball v${version}`) && (!badge || body.includes(badge)) && noPackageVersion(body, version),
      body.match(/Ovalball v[\w.-]+/)?.[0] ?? "no footer version"
    )
  }
  await anon.close()

  // Signed in as the Site Admin: app shell, dashboard, System Health.
  const ctx = await newContext(browser, { width: 1280, height: 900 })
  const page = await ctx.newPage()
  await signIn(page, EMAIL)
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" })
  await page.screenshot({ path: path.join(SHOTS, `site-admin-dashboard-${version}.png`) })
  let body = await text(page)
  record(
    `${label}: the Site Admin dashboard shows ${version} top right, never package.json's version`,
    (mode === "beta" ? body.includes(`BETA ${version}`) : body.includes(`v${version}`)) && noPackageVersion(body, version),
    body.match(/BETA [\w.-]+|v\d+\.\d+\.\d+/g)?.slice(0, 3).join(", ") ?? "none"
  )
  await page.goto(`${APP}/admin/system-health`, { waitUntil: "networkidle" })
  body = await text(page)
  record(
    `${label}: System Health reports ${version} as the published release, with no separate stale application version`,
    new RegExp(`Published release\\s*${version.replace(/\./g, "\\.")}`).test(body),
    body.match(/Published release\s*[\w.-]+/)?.[0] ?? "no published release row"
  )
  record(`${label}: System Health no longer shows package.json's version as the application`, !/Application\s*v/.test(body) && noPackageVersion(body, version))
  await ctx.close()
}

let browser
process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})
try {
  seed()
  const mode = one(`select mode from public.platform_public_state()`)
  const highest = sql(`select version from platform_releases`).split("\n").map((v) => v.trim()).filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  browser = await launch()

  const ctx = await newContext(browser, { width: 1280, height: 900 })
  const page = await ctx.newPage()
  await signIn(page, EMAIL)
  const suggestedA = await publishThroughSiteAdmin(page, VERSION_A)
  const expected = (() => {
    const parsed = highest.map((v) => v.split(".").map(Number)).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]
    return parsed ? `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}` : ""
  })()
  record("Release & Platform Mode suggests the next version after the highest recorded, not package.json's", suggestedA === expected && (suggestedA !== PACKAGE_VERSION || expected === PACKAGE_VERSION), `suggested "${suggestedA}", expected "${expected}"`)
  record(`publishing ${VERSION_A} in Site Admin makes it the published release`, one(`select release_version from public.platform_public_state()`) === VERSION_A)
  await ctx.close()

  await readEverywhere(browser, VERSION_A, mode, "after publishing A")

  const ctx2 = await newContext(browser, { width: 1280, height: 900 })
  const page2 = await ctx2.newPage()
  await signIn(page2, EMAIL)
  const suggestedB = await publishThroughSiteAdmin(page2, VERSION_B)
  record("after publishing A, the form suggests the version after A", suggestedB === VERSION_B, `suggested "${suggestedB}"`)
  record(`publishing ${VERSION_B} replaces ${VERSION_A} as the published release`, one(`select release_version from public.platform_public_state()`) === VERSION_B)
  await ctx2.close()

  await readEverywhere(browser, VERSION_B, mode, "after publishing B")
} catch (error) {
  record("run completed without an unexpected error", false, String(error?.stack ?? error))
} finally {
  if (browser) await browser.close()
  try {
    cleanup()
  } catch (e) {
    record("cleanup ran", false, String(e))
  }
  process.exit(summarise() ? 0 : 1)
}
