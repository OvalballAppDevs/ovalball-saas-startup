import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { resolveOnboardingState, reconcileSelectedKey, CONTEXT_KIND_LABEL } from "../../../packages/contracts/src/onboarding/state"
import { ENTRY_PATHS, FORBIDDEN_ENTRY_CHOICES } from "../../../packages/contracts/src/onboarding/entry"
import { AUTH_WORDING, FORBIDDEN_AUTH_WORDS } from "../../../packages/contracts/src/auth/wording"
import { MAX_TOTP_FACTORS, canAddFactor, canRemoveFactor, factorLabel, isCompleteTotpCode, normaliseTotpCode, pickChallengeFactor } from "../../../packages/contracts/src/auth/mfa"
import { SECURITY_CHANGE_KINDS, describeDevice, interpretAssurance, needsRecentAuth, otherSessions } from "../../../packages/contracts/src/auth/security"
import { ACTIONABLE_REASONS, GENERIC_REFUSAL, SUCCESSFUL_REDEMPTION_OUTCOMES, entranceOutcome, interpretRedemption } from "../../../packages/contracts/src/invitations/redeem"
import { INVITATION_PURPOSE, hasInvitationSecret, interpretPreview, invitationPurpose, normaliseInvitationCode, unusableInvitationWording } from "../../../packages/contracts/src/invitations/preview"
import { PASSWORD_MIN_LENGTH, checkPasswordComposition } from "../../../packages/contracts/src/password-policy"
import { resolveIntent, JOIN_PATH } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"
import type { SwitchableContext } from "../../../packages/contracts/src/active-context-rules"

/**
 * CA-M11 -- IDENTITY, PROFILE, SECURITY & ONBOARDING: the native person/account journey's promises.
 *
 * One identity, many contexts, no second identity model. Authority is never decided from user
 * metadata, a route, a selected context, a role label, a deep-link parameter or a cache. No secret --
 * TOTP seed, recovery code, invitation token, session token -- is persisted or logged by the phone.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const ctx = (key: string, kind: SwitchableContext["kind"], label = key): SwitchableContext =>
  ({ key, kind, id: null, playerId: null, label, switcherLabel: label, roleLabel: "Member", logoUrl: null, clubId: null }) as SwitchableContext

// ------------------------------------------------------------------ routing states

test("the onboarding router answers every session phase before it looks at contexts", () => {
  const many = [ctx("club:a:CLUB_ADMIN", "club"), ctx("team:t", "team")]
  assert.equal(resolveOnboardingState({ phase: "restoring", contexts: many, storedKey: null, pendingInvitation: false }).state, "RESTORING")
  assert.equal(resolveOnboardingState({ phase: "signed-out", contexts: many, storedKey: null, pendingInvitation: false }).state, "SIGNED_OUT")
  assert.equal(resolveOnboardingState({ phase: "needs-mfa", contexts: many, storedKey: null, pendingInvitation: false }).state, "MFA_REQUIRED")
  assert.equal(resolveOnboardingState({ phase: "recovering", contexts: many, storedKey: null, pendingInvitation: false }).state, "RECOVERY")
  assert.equal(resolveOnboardingState({ phase: "signed-in", contexts: many, storedKey: "team:t", pendingInvitation: true }).state, "INVITATION")
})

test("zero, one and many contexts: restore only what is still held, otherwise ask, never the broadest role", () => {
  const club = ctx("club:a:CLUB_ADMIN", "club")
  const team = ctx("team:t", "team")
  const family = ctx("family", "family")
  assert.deepEqual(resolveOnboardingState({ phase: "signed-in", contexts: [], storedKey: "club:a:CLUB_ADMIN", pendingInvitation: false }), { state: "NO_CONTEXT", activeKey: null, askToChoose: false })
  assert.deepEqual(resolveOnboardingState({ phase: "signed-in", contexts: [team], storedKey: null, pendingInvitation: false }), { state: "ONE_CONTEXT", activeKey: "team:t", askToChoose: false })
  assert.deepEqual(resolveOnboardingState({ phase: "signed-in", contexts: [club, team, family], storedKey: "family", pendingInvitation: false }), { state: "MULTI_CONTEXT_RESTORED", activeKey: "family", askToChoose: false })
  // A stale memory is not "close enough": the person is asked, and the club is NOT chosen for them.
  const stale = resolveOnboardingState({ phase: "signed-in", contexts: [club, team, family], storedKey: "team:gone", pendingInvitation: false })
  assert.deepEqual(stale, { state: "MULTI_CONTEXT_CHOOSE", activeKey: null, askToChoose: true })
  const nothing = resolveOnboardingState({ phase: "signed-in", contexts: [club, team, family], storedKey: null, pendingInvitation: false })
  assert.equal(nothing.state, "MULTI_CONTEXT_CHOOSE")
  assert.equal(nothing.activeKey, null, "no context is privileged by default")
})

test("a removed context reconciles: the stored key is dropped, a forged key is never adopted", () => {
  const held = [ctx("team:t", "team")]
  assert.equal(reconcileSelectedKey(held, "team:t"), "team:t")
  assert.equal(reconcileSelectedKey(held, "team:gone"), null)
  assert.equal(reconcileSelectedKey(held, "site_admin"), null, "a stored site_admin key grants nothing")
  assert.equal(reconcileSelectedKey([], "team:t"), null)
  const provider = code(join(MOBILE, "src/context/contexts.tsx"))
  assert.match(provider, /reconcileSelectedKey\(contexts, selectedKey\)/, "the provider reconciles through the shared rule")
  assert.match(provider, /AsyncStorage\.removeItem\(SELECTED_CONTEXT_KEY\)/, "and forgets the stale key on disk")
  assert.match(provider, /resolveOnboardingState\(\{ phase: status, contexts, storedKey: selectedKey, pendingInvitation: hasJoinSecret\(\) \}\)/, "one onboarding decision, made in the provider")
})

test("the switcher names the kind of each place in words -- never an enum, never an id", () => {
  for (const kind of ["site_admin", "club", "team", "parent", "player", "family", "governing"] as const) {
    assert.ok(CONTEXT_KIND_LABEL[kind].length > 0)
    assert.doesNotMatch(CONTEXT_KIND_LABEL[kind], /_|^[a-z]+$/, `${kind} reads as an enum`)
  }
  const sheet = code(join(MOBILE, "src/components/context-sheet.tsx"))
  assert.match(sheet, /CONTEXT_KIND_LABEL\[context\.kind\]/)
  assert.doesNotMatch(sheet, />\s*\{context\.(id|key|clubId|playerId)\}\s*</, "no id is drawn in a row")
})

test("site admin without a club and a governing body are named, never drawn as a family or a club", () => {
  const home = code(join(MOBILE, "app/(tabs)/index.tsx"))
  assert.match(home, /Site Admin is on the web/)
  assert.match(home, /onboarding\.state === "NO_CONTEXT"/, "the zero-context state is the onboarding router's, not a fallback club")
  assert.match(home, /<NoContextOnboarding \/>/)
  assert.match(home, /const clubContext = !noContext && active\?\.kind === "club"/, "the placeholder club is never drawn as Club Home")
  const none = code(join(MOBILE, "src/onboarding/no-context.tsx"))
  for (const forbidden of ["role", "signUp", "club_memberships", "insert(", "rpc("]) assert.ok(!none.includes(forbidden), `the no-context screen reaches for ${forbidden}`)
})

// ------------------------------------------------------------------ entry and invitations

test("Get Started offers the four real ways in and no role picker", () => {
  assert.deepEqual(ENTRY_PATHS.map((p) => p.key), ["INVITATION", "CODE", "CLUB", "SIGN_IN"])
  assert.equal(ENTRY_PATHS.find((p) => p.key === "CLUB")?.surface, "WEB", "account creation and club claim stay on the website")
  const screen = code(join(MOBILE, "app/get-started.tsx"))
  for (const forbidden of [...FORBIDDEN_ENTRY_CHOICES, "signUp(", "signInWithOtp", "role_key", "CLUB_ADMIN", "COACH"]) assert.ok(!screen.includes(forbidden), `Get Started offers "${forbidden}"`)
  assert.match(screen, /ENTRY_PATHS\.map/)
  const anyMobile = walk(join(MOBILE, "app")).concat(walk(join(MOBILE, "src"))).map((f) => code(f)).join("\n")
  assert.ok(!/auth\.signUp\(/.test(anyMobile), "the phone creates accounts")
})

test("an invitation link is a first-class intent; the secret rides in memory, never in storage", () => {
  assert.equal(JOIN_PATH, "/join")
  const link = resolveIntent("ovalball-dev://join?t=abc123&c=XYZ")
  assert.deepEqual(link, { kind: "JOIN", token: "abc123", code: "XYZ" })
  assert.deepEqual(resolveIntent("https://ovalball.co.uk/join?c=ABCD1234"), { kind: "JOIN", token: null, code: "ABCD1234" })
  assert.equal(resolveIntent("ovalball://join/xyz").kind, "NOT_YET_SUPPORTED", "a sub-path is not guessed at")
  assert.deepEqual(routeForIntent({ kind: "JOIN", token: "abc", code: null }), { pathname: "/join", params: { t: "abc" } })
  const store = code(join(MOBILE, "src/onboarding/join-secret.ts"))
  assert.doesNotMatch(store, /AsyncStorage|SecureStore|console\./, "the join secret touches disk or the log")
  const screen = code(join(MOBILE, "app/join.tsx"))
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|console\./, "the invitation screen stores or logs")
  assert.match(screen, /previewInvitation\(supabase, secret\)/)
  assert.match(screen, /redeemInvitation\(supabase, secret\)/)
  assert.match(screen, /reload\(\)/, "contexts are re-read from the server after acceptance")
  assert.match(screen, /leaveSession\(signOut, \{ keepInvitation: true \}\)/, "the wrong-account escape keeps the invitation and drops everything else")
  const gate = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(gate, /holdJoinSecret\(\{ token: intent\.token, code: intent\.code \}\)/)
  assert.match(gate, /status === "signed-in" && hasJoinSecret\(\) && !onJoin/, "a held invitation is returned to after sign-in")
  assert.match(gate, /intent\.kind === "TEAM"/, "a team link is delivered, not dropped")
})

test("redemption is interpreted once, fails closed, and lands somewhere for every success", () => {
  assert.ok(!(SUCCESSFUL_REDEMPTION_OUTCOMES as readonly string[]).includes("REFUSED"))
  assert.deepEqual(interpretRedemption({ outcome: "MEMBERSHIP_ACTIVE" }, null), { ok: true, outcome: "MEMBERSHIP_ACTIVE", detail: { outcome: "MEMBERSHIP_ACTIVE" } })
  assert.deepEqual(interpretRedemption({ outcome: "SOMETHING_NEW" }, null), { ok: false, reason: null, message: GENERIC_REFUSAL })
  assert.deepEqual(interpretRedemption({ outcome: "REFUSED", message: "the invited address was x@y" }, null), { ok: false, reason: null, message: GENERIC_REFUSAL })
  assert.deepEqual(interpretRedemption(null, { message: "boom" }), { ok: false, reason: null, message: GENERIC_REFUSAL })
  const actionable = interpretRedemption({ outcome: "REFUSED", reason: "AGE_ELIGIBILITY_REQUIRED", message: "Need a date of birth." }, null)
  assert.ok(!actionable.ok && actionable.message === "Need a date of birth." && actionable.reason === "AGE_ELIGIBILITY_REQUIRED")
  assert.deepEqual([...ACTIONABLE_REASONS].sort(), ["AGE_ELIGIBILITY_REQUIRED", "MEMBERSHIP_REQUIRED", "ORGANISATION_ACCESS_SUSPENDED"])
  for (const outcome of SUCCESSFUL_REDEMPTION_OUTCOMES) assert.ok(entranceOutcome(outcome, {}).landing, `${outcome} has no landing`)
  assert.equal(entranceOutcome("BODY_ROLE_ACTIVE", { constituent_body_id: "b1" }).contextKey, "governing:b1")
  assert.equal(entranceOutcome("SITE_ADMIN_ACTIVE", {}).contextKey, "site_admin")
  assert.equal(entranceOutcome("JOIN_REQUEST_PENDING", {}).landing, "PENDING", "a team code never grants access")
  // The website consumes the same interpretation.
  const web = read("lib/invitations/redeem.ts")
  assert.match(web, /from "@ovalball\/contracts\/invitations"/)
  assert.doesNotMatch(web.replace(/\/\*[\s\S]*?\*\//g, ""), /rpc\(/, "the website module no longer calls the RPC itself")
  assert.match(read("lib/invitations/entrance-landing.ts"), /entranceOutcome\(outcome, detail\)/)
})

test("a preview reveals what an invitation opens, never who it was for; an unusable one has one sentence per state", () => {
  const preview = interpretPreview([{ kind: "CLUB_STAFF", scope_label: "Ovalball UAT RUFC", inviter_label: "Ffion Meredith", expires_at: "2026-10-01T00:00:00Z", state: "usable" }])
  assert.equal(preview?.state, "usable")
  assert.equal(interpretPreview([]), null, "a token that matches nothing is nothing")
  assert.equal(interpretPreview([{ kind: "X", state: "weird" }])?.state, "expired", "an unknown state is not usable")
  assert.equal(unusableInvitationWording(preview, { token: "x" }), null)
  for (const state of ["expired", "revoked", "used", "redeemed"] as const) {
    const words = unusableInvitationWording({ ...preview!, state }, { token: "x" })
    assert.ok(words && words.title.length > 0)
    assert.doesNotMatch(words.body, /@/, "no address is ever named")
  }
  assert.match(unusableInvitationWording(null, { code: "ABC" })!.title, /code/i)
  assert.equal(normaliseInvitationCode(" ab cd-12 "), "ABCD-12")
  assert.equal(hasInvitationSecret({ token: " ", code: null }), false)
  assert.equal(invitationPurpose("TEAM_JOIN_CODE"), INVITATION_PURPOSE.TEAM_JOIN_CODE)
  assert.match(read("app/join/page.tsx"), /INVITATION_PURPOSE/, "the website reads the same purpose words")
})

// ------------------------------------------------------------------ password, MFA, security

test("both clients apply one password policy, and neither client's screen invents a rule", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12)
  assert.equal(checkPasswordComposition("short1!A").ok, false)
  assert.equal(checkPasswordComposition("A-very-long-passphrase-1!").ok, true)
  for (const screen of ["app/auth/recovery.tsx", "app/(tabs)/security/password.tsx"]) {
    const src = code(join(MOBILE, screen))
    assert.match(src, /checkPasswordComposition\(password\)/, `${screen} does not use the shared rule`)
    assert.match(src, /<PasswordRequirements password=\{password\} \/>/, `${screen} does not draw the shared checklist`)
    assert.doesNotMatch(src, /length\s*[<>]=?\s*(1[0-9]|[2-9][0-9])\b/, `${screen} hardcodes a password length`)
  }
  assert.match(code("lib/auth/password-policy.ts"), /from "@ovalball\/contracts\/password-policy"/)
  // FOUND BY THE PROOF: GoTrue refuses a password from an AAL1 session when a verified factor exists, and a
  // recovery session is AAL1. The native recovery screen therefore proves the factor BEFORE the form.
  const recovery = code(join(MOBILE, "app/auth/recovery.tsx"))
  assert.match(recovery, /getAuthenticatorAssuranceLevel\(\)/, "recovery does not ask the server whether a factor is required")
  assert.match(recovery, /pickChallengeFactor\(factors\?\.totp \?\? \[\]\)/, "recovery does not pick the factor by the shared rule")
  assert.ok(recovery.indexOf("mfa.verify(") < recovery.indexOf("updateUser({ password })"), "the factor is proved after the password, not before")
  assert.match(recovery, /assurance !== "ready"/, "the form is shown before the factor is proved")
  const data = code(join(MOBILE, "src/security/data.ts"))
  assert.match(data, /record_my_security_change", \{ p_change: "PASSWORD_SET" \}/, "a native password change is recorded as the website records it")
  assert.ok((SECURITY_CHANGE_KINDS as readonly string[]).includes("PASSWORD_SET"))
})

test("MFA: one factor rule for both challenges, the website's cap and last-factor rule, no secret persisted or logged", () => {
  assert.equal(MAX_TOTP_FACTORS, 3)
  assert.match(read("app/(app)/account/security/constants.ts"), /from "@ovalball\/contracts\/auth"/, "the website reads the shared cap")
  assert.equal(pickChallengeFactor([{ id: "a", status: "unverified" }, { id: "b", status: "verified" }])?.id, "b")
  assert.equal(pickChallengeFactor([{ id: "a", status: "unverified" }]), null, "a half-finished enrolment is never challenged")
  assert.equal(canRemoveFactor(1), false)
  assert.equal(canRemoveFactor(2), true)
  assert.equal(canAddFactor(3), false)
  assert.equal(normaliseTotpCode("12 34-56x"), "123456")
  assert.equal(isCompleteTotpCode("12345"), false)
  assert.equal(factorLabel({ id: "x", friendly_name: "Authenticator 2 (m1abc2)" }, 1), "Authenticator 2")
  for (const screen of ["app/verify.tsx", "app/step-up.tsx"]) {
    assert.match(code(join(MOBILE, screen)), /pickChallengeFactor\(data\?\.totp \?\? \[\]\)/, `${screen} picks its own factor`)
  }
  const enrol = code(join(MOBILE, "app/(tabs)/security/enrol.tsx"))
  assert.doesNotMatch(enrol, /AsyncStorage|SecureStore|console\.|Clipboard/, "the enrolment screen persists, logs or copies the secret")
  assert.match(enrol, /startTotpEnrolment\(supabase\)/)
  assert.match(enrol, /confirmTotpEnrolment\(supabase, step\.factorId, code\)/)
  const data = code(join(MOBILE, "src/security/data.ts"))
  assert.match(data, /issue_my_first_recovery_codes/)
  assert.match(data, /p_change: "MFA_ENROLLED"/)
  assert.match(data, /p_change: "MFA_FACTOR_REMOVED"/)
  assert.match(data, /canRemoveFactor\(verified\.length\)/, "the last factor cannot be removed natively either")
  assert.doesNotMatch(data, /AsyncStorage|SecureStore|console\./)
})

test("recent-auth is the server's: the two operations that need it are asked for a code before, never instead of, the refusal", () => {
  assert.equal(needsRecentAuth("SIGN_OUT_OTHER_DEVICES"), true)
  assert.equal(needsRecentAuth("REGENERATE_RECOVERY_CODES"), true)
  assert.equal(needsRecentAuth("CHANGE_PASSWORD"), false)
  const screen = code(join(MOBILE, "app/(tabs)/security/index.tsx"))
  assert.match(screen, /if \(result\.recentAuth\) stepUp\("SIGN_OUT_OTHER_DEVICES"\)/)
  assert.match(screen, /if \(result\.recentAuth\) stepUp\("REGENERATE_RECOVERY_CODES"\)/)
  assert.match(screen, /holdIntent<Resume>\(INTENT_KEY, \{ op \}\)/, "what the person meant to do is held, not performed by the step-up")
  assert.match(screen, /takeIntent<Resume>\(INTENT_KEY\)/, "and taken once, by this screen, afterwards")
  const stepUp = code(join(MOBILE, "app/step-up.tsx"))
  assert.match(stepUp, /discardIntents\(\)/, "a cancelled step-up discards the intent")
  assert.doesNotMatch(stepUp, /sign_out_my_other_devices|regenerate_my_recovery_codes|updateUser|unenroll/, "verification never performs the operation")
  assert.deepEqual(otherSessions([{ session_id: "a", is_current: true } as never, { session_id: "b", is_current: false } as never]).map((s) => s.session_id), ["b"])
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), "iPhone")
  assert.equal(interpretAssurance({ aal: "aal2", recent_aal2: true })?.recent_aal2, true)
  assert.equal(interpretAssurance("nope"), null)
})

// ------------------------------------------------------------------ sign-out, wording, logging

test("signing out is one list: context, child, drafts, caches, pending intents and the held invitation, then the session", () => {
  const leave = code(join(MOBILE, "src/auth/leave.ts"))
  for (const step of ["discardIntents()", "discardJoinSecret()", "forgetSelectedContext()", "forgetSelectedChild()", "clearAllDrafts()", "forgetHubTeamPreference()", "forgetRecentSearches()", "forgetHubCache()", "forgetHubExplanations()", "forgetAttentionCache()", "await signOut()"]) {
    assert.ok(leave.includes(step), `sign-out forgets to ${step}`)
  }
  assert.ok(leave.indexOf("await signOut()") > leave.lastIndexOf("forgetAttentionCache()"), "the session goes last")
  for (const screen of ["app/(tabs)/more.tsx", "app/(tabs)/security/index.tsx"]) assert.match(code(join(MOBILE, screen)), /leaveSession\(signOut\)/, `${screen} does not leave through the one list`)
  const session = code(join(MOBILE, "src/auth/session.tsx"))
  assert.match(session, /signOut\(\{ scope: "local" \}\)/, "a sign-out on one device is that device's")
})

test("auth wording is enumeration-safe and shared; the translator reads it rather than restating it", () => {
  const all = Object.values(AUTH_WORDING).join(" ")
  for (const word of FORBIDDEN_AUTH_WORDS) assert.doesNotMatch(all, new RegExp(word, "i"), `wording leaks "${word}"`)
  assert.equal(AUTH_WORDING.invalidCredentials, "Email or password is incorrect.")
  assert.match(AUTH_WORDING.recoveryRequested, /^If an Ovalball account exists/)
  const translate = code(join(MOBILE, "src/errors/translate.ts"))
  for (const key of ["invalidCredentials", "wrongCode", "tooManyAttempts", "sessionEnded", "network"]) assert.match(translate, new RegExp(`AUTH_WORDING\\.${key}`))
  assert.doesNotMatch(translate, /"Email or password is incorrect\."/, "the sentence is written once, in the contract")
  const web = read("app/login/actions.ts")
  assert.match(web, /Email or password is incorrect\./, "the website says the same sentence")
})

test("nothing on the phone logs a secret, and nothing decides authority from metadata, a route or a cache", () => {
  const files = walk(join(MOBILE, "app")).concat(walk(join(MOBILE, "src"))).filter((f) => /\.(ts|tsx)$/.test(f))
  for (const f of files) {
    const src = code(f)
    for (const m of src.matchAll(/console\.(log|info|debug|warn|error)\(([^)]*)\)/g)) {
      // `code: error.code` is a Postgres SQLSTATE, not a one-time code; a secret would be a value, not a diagnostic.
      assert.doesNotMatch(m[2], /token|password|secret|totp|qr|recovery/i, `${f} logs something that looks secret: ${m[0].slice(0, 80)}`)
    }
    assert.doesNotMatch(src, /user_metadata\.(role|roles|club|is_admin|isSiteAdmin)/, `${f} reads authority from user metadata`)
    assert.doesNotMatch(src, /app_metadata\.(role|roles|club|is_admin)/, `${f} reads authority from app metadata`)
  }
  const store = code(join(MOBILE, "src/auth/session-store.ts"))
  assert.doesNotMatch(store, /capabilit|role|context/i, "the secure store holds more than the session")
})
