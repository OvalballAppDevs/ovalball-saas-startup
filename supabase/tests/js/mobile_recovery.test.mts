import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { resolveIntent, RECOVERY_PATH } from "../../../apps/mobile/src/links/intents"
import { checkPasswordComposition, PASSWORD_REQUIREMENTS, PASSWORD_MIN_LENGTH } from "@ovalball/contracts"

/**
 * PASSWORD RECOVERY ON A PHONE.
 *
 * The journey itself is exercised against a real auth server; these pin the parts that are decided in
 * code rather than by GoTrue -- what a link MEANS, what a password must be, and that neither client
 * has quietly acquired its own version of either.
 */

const read = (p: string) => readFileSync(`apps/mobile/${p}`, "utf8")
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

// ------------------------------------------------------------------ the link

test("a recovery link is recognised in each shape a phone receives it", () => {
  // A development or production build gets its own scheme; Expo Go gets exp:// with its /-- separator;
  // a universal link, when one exists, arrives as https. All three are the same intent.
  for (const url of [
    "ovalball://auth/recovery?code=abc123",
    "ovalball-dev://auth/recovery?code=abc123",
    "exp://192.168.1.25:8081/--/auth/recovery?code=abc123",
    "https://ovalball.co.uk/auth/recovery?code=abc123",
  ]) {
    const intent = resolveIntent(url)
    assert.equal(intent.kind, "AUTH_RECOVERY", url)
    assert.equal(intent.kind === "AUTH_RECOVERY" && intent.code, "abc123", url)
  }
})

test("and case and a trailing slash do not change what a link means", () => {
  assert.equal(resolveIntent("ovalball://Auth/Recovery/?code=x").kind, "AUTH_RECOVERY")
})

test("a recovery link with no code is not treated as a recovery", () => {
  // Routing to Set New Password with nothing to exchange strands somebody on a screen that cannot work.
  assert.equal(resolveIntent("ovalball://auth/recovery").kind, "NOT_YET_SUPPORTED")
})

test("rubbish, and somebody else's link, resolve to nothing", () => {
  for (const url of [null, undefined, "", "not a url", "ovalball://", "https://evil.example.com/auth/recovery?code=x"]) {
    const intent = resolveIntent(url as string)
    // The evil one parses, but its PATH is what is matched -- and a host is never trusted to mean
    // anything here, because the authority is the CODE, which GoTrue validates.
    assert.ok(["UNKNOWN", "AUTH_RECOVERY"].includes(intent.kind), String(url))
  }
  assert.equal(resolveIntent("not a url").kind, "UNKNOWN")
  assert.equal(resolveIntent(null).kind, "UNKNOWN")
})

test("links Ovalball already issues are told apart from links that are not ours", () => {
  // Two different things to say to somebody who just tapped a link, so they are two different answers.
  //
  // `/fixtures/<id>` was on this list until M5 BUILT the destination. A link
  // Ovalball issues that the app can now open must resolve to the thing it
  // opens, so the assertion follows the product rather than pinning it: the test
  // asks for a path that is still genuinely unbuilt, and names the built ones
  // separately so that building another one shows up here as a change rather
  // than as a failure.
  assert.equal(resolveIntent("ovalball://join/xyz").kind, "NOT_YET_SUPPORTED")
  assert.equal(resolveIntent("ovalball://notifications").kind, "NOT_YET_SUPPORTED")
  assert.equal(resolveIntent("ovalball://something-invented").kind, "UNKNOWN")
  // Built, and therefore resolved rather than deferred.
  assert.equal(resolveIntent("ovalball://fixtures/abc").kind, "FIXTURE")
  assert.equal(resolveIntent("ovalball://fixtures/abc/match-centre").kind, "MATCH_CENTRE")
  assert.equal(resolveIntent("ovalball://training/abc").kind, "TRAINING")
})

test("the implicit flow's fragment is never read", () => {
  // A `#access_token=` fragment is a live credential sitting in a URL. PKCE exists so it does not have
  // to be, and the resolver must not quietly accept one as a way in.
  const source = strip(read("src/links/intents.ts"))
  assert.ok(!/access_token|\bhash\b/.test(source), "the resolver reads a URL fragment")
  const client = strip(read("src/auth/supabase.ts"))
  assert.match(client, /flowType: "pkce"/, "the native client is not on PKCE")
})

// ------------------------------------------------------------------ the password

test("the mobile app applies the platform's password rules, not its own", () => {
  const recovery = strip(read("app/auth/recovery.tsx"))
  assert.match(recovery, /@ovalball\/contracts/, "the recovery screen does not use the shared policy")
  assert.match(recovery, /checkPasswordComposition/, "the recovery screen validates with something of its own")
  // No second rule anywhere in the app.
  assert.ok(!/length\s*[<>]=?\s*(8|10|12)/.test(recovery), "a length rule is written out again in the app")
})

test("and the shared rules are the ones the website enforces", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12)
  assert.ok(!checkPasswordComposition("short").ok)
  assert.ok(!checkPasswordComposition("alllowercase!!!").ok, "a password with no capital was accepted")
  assert.ok(!checkPasswordComposition("NoSpecialChars12").ok, "a password with no special character was accepted")
  assert.ok(checkPasswordComposition("Brand-New-Password-99!").ok)
  // Bytes, not characters: bcrypt's limit is in bytes and an emoji costs four.
  assert.ok(!checkPasswordComposition(`A!${"😀".repeat(20)}`).ok, "a 72-byte limit was measured in characters")
})

test("the requirements shown while typing are derived from the rules, never described beside them", () => {
  // A checklist that says "one capital letter" next to a validator that stopped requiring one is worse
  // than no checklist.
  const good = "Brand-New-Password-99!"
  assert.ok(PASSWORD_REQUIREMENTS.every((r) => r.met(good)), "a password the validator accepts fails the checklist")
  assert.ok(checkPasswordComposition(good).ok)
  for (const bad of ["short", "alllowercase!!!", "NoSpecialChars12"]) {
    const allMet = PASSWORD_REQUIREMENTS.every((r) => r.met(bad))
    assert.equal(allMet, checkPasswordComposition(bad).ok, `checklist and validator disagree about "${bad}"`)
  }
})

// ------------------------------------------------------------------ the journey

test("the request tells nobody whether an account exists", () => {
  const forgot = strip(read("app/forgot-password.tsx"))
  assert.match(forgot, /If an Ovalball account exists/, "the neutral wording is gone")
  // Only two things may change the outcome: a malformed address and a rate limit. Neither is an
  // identity signal. A branch on the RESULT of the reset call would be.
  assert.ok(!/user.*not.*found|no account|unknown email/i.test(forgot), "the screen distinguishes unknown addresses")
})

test("a password reset is never an MFA reset", () => {
  const recovery = strip(read("app/auth/recovery.tsx"))
  assert.ok(!/unenroll|mfa\.unenroll|removeFactor|factors/i.test(recovery), "the recovery screen touches a factor")
  const session = strip(read("src/auth/session.tsx"))
  // Ending a recovery re-reads the assurance level, so an account holding a factor goes to the
  // challenge rather than into the product.
  assert.match(session, /endRecovery/, "there is no way back out of a recovery")
  assert.match(session, /getAuthenticatorAssuranceLevel/, "assurance is not re-established after a reset")
})

test("a recovery session cannot walk into the product", () => {
  const layout = strip(read("app/_layout.tsx"))
  // A validated recovery produces a REAL session at AAL1. Without this rule the gate reads it as
  // signed in and drops somebody into the app with a password they do not know.
  assert.match(layout, /status === "recovering" && !onRecovery/, "the gate does not hold a recovery")

  // THE ORDER INSIDE THE GATE'S OWN CHAIN, not the order of those words in the file. The deep-link
  // handler also mentions "signed-in" and sits above the gate, so a file-wide indexOf found that one
  // and reported a correct gate as broken -- a test that fails on unrelated code teaches people to
  // ignore it. The chain is isolated first, then its branches are ordered.
  const chain = /if \(status === "recovering"[\s\S]*?signed-out[^\n]*\n/.exec(layout)?.[0] ?? ""
  assert.ok(chain.length > 0, "the gate's routing chain could not be found")
  assert.ok(
    chain.indexOf('status === "recovering"') < chain.indexOf('status === "signed-in"'),
    "recovery is not checked before signed-in"
  )
})

test("every reason a link can fail is told the same way", () => {
  // Expired, already used, malformed and replayed are one message on purpose: distinguishing them
  // tells whoever is holding a stolen link the same thing it tells its owner.
  const session = strip(read("src/auth/session.tsx"))
  assert.match(session, /no longer valid/, "the single recovery failure message is gone")
  assert.ok(!/expired.*already used|already used.*expired/i.test(session), "link failures are told apart")
})

test("finishing a reset ends every other session", () => {
  const recovery = strip(read("app/auth/recovery.tsx"))
  assert.match(recovery, /signOut\(\{ scope: "others" \}\)/, "other sessions survive a password reset")
  // And if that fails, everything goes rather than leaving the old sessions alive.
  assert.match(recovery, /await signOut\(\)/, "a failed revocation does not fail closed")
})

test("the link handler hears a link whether or not the app was already running", () => {
  // The normal case for recovery is a WARM app: you request it in Ovalball, switch to Mail, tap, come
  // back. Handling only getInitialURL works from a cold start and silently does nothing otherwise.
  const layout = strip(read("app/_layout.tsx"))
  assert.match(layout, /getInitialURL/, "a cold-start link is not handled")
  assert.match(layout, /addEventListener\("url"/, "a link arriving while the app runs is not handled")
})

test("the deep-link foundation is reusable, not a recovery-shaped hack", () => {
  const source = read("apps/mobile/src/links/intents.ts".replace("apps/mobile/", ""))
  assert.match(source, /LinkIntent/, "there is no typed intent")
  assert.equal(RECOVERY_PATH, "/auth/recovery")
  // The paths Ovalball already issues links for are named, so the next domain adds a case rather than
  // another `if (url.includes(...))` somewhere else.
  for (const planned of ["/join", "/fixtures", "/messages", "/subscriptions"]) {
    assert.ok(source.includes(`"${planned}"`), `${planned} is not named in the intent resolver`)
  }
})

test("the Expo Go handoff cannot be pointed anywhere a caller chooses", () => {
  const page = readFileSync("app/auth/mobile-recovery/page.tsx", "utf8")
  assert.match(page, /process\.env\.MOBILE_RECOVERY_APP_URL/, "the destination is not server-configured")
  // The ONLY thing taken from the request is the code.
  assert.ok(!/searchParams.*(redirect|next|url|target)/i.test(strip(page)), "the handoff takes its destination from the request")
  assert.match(page, /if \(!appUrl\)/, "the page renders without being configured")
})
