#!/usr/bin/env node
/**
 * Permanent guards for Ovalball's authentication surface.
 *
 * Two properties matter most and cannot be seen from the outside: Ovalball
 * stays passwordless, and the anti-bot gate is enforced by the server
 * rather than by a slider in the browser. Both are asserted here.
 *
 *   node scripts/verify-auth-security.mjs
 *   BASE_URL=http://localhost:3000 node scripts/verify-auth-security.mjs
 */

import { readFileSync, existsSync } from "node:fs"

const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "")

let pass = 0
let fail = 0

function check(name, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "")

const AUTH_SOURCES = [
  "app/login/login-form.tsx",
  "app/login/actions.ts",
  "app/login/page.tsx",
  "app/signup/signup-shell.tsx",
  "app/signup/submit-signup.ts",
  "app/signup/complete-authenticated-signup.ts",
  "app/auth/callback/route.ts",
  "app/auth/oauth-actions.ts",
  "lib/auth/safe-next.ts",
  "lib/auth/turnstile.ts",
  "lib/auth/oauth-providers.ts",
  "components/auth/human-check.tsx",
  "components/auth/social-sign-in.tsx",
]

const sources = Object.fromEntries(AUTH_SOURCES.map((p) => [p, read(p)]))
const all = Object.values(sources).join("\n")

console.log("Ovalball remains passwordless:\n")
check("no signInWithPassword anywhere in the auth surface", !/signInWithPassword/.test(all))
check("no signUp({ password }) call", !/signUp\s*\(/.test(all))
check("no password input field", !/type=["']password["']/.test(all))
check("no confirm-password field", !/confirmPassword|confirm_password/i.test(all))
check("no forgotten-password route or link", !/forgot[- ]?password/i.test(all.replace(/"forgot password" isn't a state/g, "")))
check("magic link / OTP is still the email path", /signInWithOtp/.test(read("lib/auth/check-account.ts") + read("app/signup/submit-signup.ts")))

console.log("\nAnti-bot verification is server-side, not the slider:")
const turnstile = sources["lib/auth/turnstile.ts"]
check("token is exchanged with Cloudflare server-side", /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/.test(turnstile))
check("verification module is server-only", /^import "server-only"/m.test(turnstile))
check("secret is read from a non-public env var", /process\.env\.TURNSTILE_SECRET_KEY/.test(turnstile))
check(
  "secret is NEVER exposed under a NEXT_PUBLIC_ name",
  !/NEXT_PUBLIC_[A-Z_]*SECRET/.test(all) && !/NEXT_PUBLIC_TURNSTILE_SECRET/.test(all)
)
check("secret never reaches a client component", !/TURNSTILE_SECRET_KEY/.test(sources["components/auth/human-check.tsx"]))
check("verification fails closed when Cloudflare cannot be reached", /verify-unavailable/.test(turnstile))
check("hostname is validated against the issued token", /hostname-mismatch/.test(turnstile))
check("failure message reveals no internal signal", /We couldn't complete the security check/.test(turnstile))
check(
  "slider completion alone is never accepted as proof",
  // The client sends a token; every protected action verifies it server-side.
  /verifyTurnstileToken/.test(sources["app/login/actions.ts"]) &&
    /verifyTurnstileToken/.test(sources["app/signup/submit-signup.ts"]) &&
    /verifyTurnstileToken/.test(sources["app/auth/oauth-actions.ts"])
)

console.log("\nOAuth initiation is server-authorised:")
const oauth = sources["app/auth/oauth-actions.ts"]
check("provider must be known AND enabled", /OAUTH_PROVIDERS\.find/.test(oauth) && /provider\.enabled/.test(oauth))
check("redirect target goes through the shared guard", /safeNextPath/.test(oauth))
check("callback origin comes from the canonical resolver", /getSiteUrl\(\)/.test(oauth))
check("providers request no extra scopes", !/scopes:\s*["'][^"']+["']/.test(sources["lib/auth/oauth-providers.ts"]))
check(
  "no provider is enabled by default",
  /=== "true"/.test(sources["lib/auth/oauth-providers.ts"]) &&
    !/enabled:\s*true/.test(sources["lib/auth/oauth-providers.ts"])
)

console.log("\nOpen-redirect guard:")
const safeNext = sources["lib/auth/safe-next.ts"]
check("resolves against a sentinel origin rather than pattern-matching", /SENTINEL_ORIGIN/.test(safeNext))
check("rejects anything that resolves off-origin", /url\.origin !== SENTINEL_ORIGIN/.test(safeNext))
check("rejects control characters", /u0000-\\u001F/.test(safeNext) || /CONTROL_CHARACTERS/.test(safeNext))
check("there is only ONE redirect guard implementation", !/function safeNextPath/.test(sources["app/auth/callback/route.ts"]))
check("the callback imports the shared guard", /from "@\/lib\/auth\/safe-next"/.test(sources["app/auth/callback/route.ts"]))

console.log("\nConsent is server-derived and cannot be forged:")
const complete = sources["app/signup/complete-authenticated-signup.ts"]
check("acting user comes from the session, never the client", /auth\.getUser\(\)/.test(complete))
check("no user id is accepted from the caller", !/userId|user_id\s*:/.test(complete.split("writeSignupRecords")[0]))
check("terms version is the server constant, not client input", /termsVersion: CURRENT_TERMS_VERSION/.test(complete))
check("repeat submission is idempotent", /existingProfile/.test(complete))
check(
  "consent version derives from the published legal version",
  /LEGAL_VERSION/.test(read("lib/signup/terms.ts"))
)
check(
  "one record-writing sequence, shared by both signup paths",
  /writeSignupRecords/.test(complete) && /writeSignupRecords/.test(read("lib/signup/complete-signup.ts"))
)
check("no second consent table was created", !existsSync("supabase/migrations/consent.sql"))

console.log("\nAuthentication is not authorisation:")
check(
  "no marketing/analytics SDK added alongside OAuth",
  !/googletagmanager|google-analytics|connect\.facebook\.net|fbq\(|gtag\(/i.test(all)
)
check(
  "nothing in the auth surface grants a club or site role",
  !/site_admins.*insert|club_memberships.*insert/i.test(all)
)

async function httpChecks() {
  if (!BASE) {
    console.log("\n(Set BASE_URL to also run live callback checks.)")
    return
  }
  console.log("\nLive callback rejects hostile redirect targets:")
  for (const hostile of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
    const res = await fetch(`${BASE}/auth/callback?next=${encodeURIComponent(hostile)}`, {
      redirect: "manual",
    })
    const location = res.headers.get("location") ?? ""
    const ok = !location.includes("evil.com")
    check(`next=${hostile} does not redirect off-site`, ok, `got ${location}`)
  }
}

await httpChecks()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
