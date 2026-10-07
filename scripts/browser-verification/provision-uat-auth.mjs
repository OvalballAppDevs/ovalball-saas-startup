// =====================================================================================================
// PROVISION BROWSER-UAT AUTHENTICATION.
//
// WHY THIS EXISTS. The browser harness used to sign in by magic link. The identity programme retired
// magic-link login platform-wide, so that path stopped working -- `signIn` simply stalled waiting for
// a verification navigation that can no longer happen. At the same time, `supabase/seeds/local_uat_*`
// insert `encrypted_password = ''`, so the UAT personas have no password either. The result was that
// there was NO supported way for an automated browser to authenticate at all.
//
// This repairs that properly rather than working around it:
//   * it uses Supabase's own Auth admin API to SET a password -- the platform's supported mechanism,
//     not a hand-written hash and not a test-only bypass of the login form;
//   * the harness then signs in through the REAL password login page, exercising real authentication;
//   * the password comes from `UAT_BROWSER_PASSWORD` in the gitignored `.env.local`, never source;
//   * it is LOCAL ONLY and refuses to run against anything that is not the local stack.
//
//   node scripts/browser-verification/provision-uat-auth.mjs
// =====================================================================================================
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

function envFromFile(file) {
  const out = {}
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].trim()
    }
  } catch {}
  return out
}

const env = { ...envFromFile(".env"), ...envFromFile(".env.local"), ...process.env }
const url = env.SUPABASE_URL || "http://127.0.0.1:54321"
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY
const password = env.UAT_BROWSER_PASSWORD

// THE GUARD: this may never touch a deployed project. A password provisioned for automated browser
// testing belongs to the local review world and nowhere else.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error(`REFUSING: ${url} is not the local Supabase stack. This script is local-only.`)
  process.exit(1)
}
if (!serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (local). Run `npx supabase status` and set it in .env.local.")
  process.exit(1)
}
if (!password) {
  console.error("Missing UAT_BROWSER_PASSWORD in .env.local.")
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
if (error) {
  console.error("Could not list users:", error.message)
  process.exit(1)
}

const personas = data.users.filter((u) => (u.email ?? "").endsWith("@ovalball.test"))
let done = 0
for (const u of personas) {
  const { error: updateError } = await admin.auth.admin.updateUserById(u.id, { password, email_confirm: true })
  if (updateError) console.error(`  ${u.email}: ${updateError.message}`)
  else { done += 1; console.log(`  provisioned ${u.email}`) }
}
console.log(`\n${done}/${personas.length} UAT personas can now sign in with a password.`)
