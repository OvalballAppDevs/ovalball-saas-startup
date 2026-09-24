import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts"
import { checkPasswordComposition } from "@ovalball/contracts"
import { MAX_TOTP_FACTORS, canRemoveFactor, staleTotpFactors, verifiedTotpFactors, type FactorLike } from "@ovalball/contracts/auth"
import { interpretAssurance, otherSessions, type SessionAssurance, type SessionRow } from "@ovalball/contracts/auth"

type Client = SupabaseClient<Database>

/**
 * SECURITY, ON THE PHONE, THROUGH THE SAME DOORS THE WEBSITE USES.
 *
 * Every operation here is the website's own: the same GoTrue calls, the same RPCs, the same recorded
 * changes, the same refusals. Nothing is a mobile shortcut. What the server demands a recent second
 * factor for (`sign_out_my_other_devices`, `regenerate_my_recovery_codes`) it refuses here exactly as
 * it refuses there, and the screen asks for the code rather than pretending.
 *
 * NO SECRET IS KEPT. The enrolment secret and QR are returned to the screen that shows them once and
 * are never written to storage, never logged and never carried past that screen. Recovery codes are
 * returned once, the same way.
 */

export type SecurityOverview = {
  factors: FactorLike[]
  staleFactors: number
  assurance: SessionAssurance | null
  sessions: SessionRow[]
  otherDevices: number
  recoveryCodesLeft: number
  /** True when the account holds a verified factor and the session is at AAL2. */
  atAal2: boolean
}

export async function readSecurityOverview(supabase: Client): Promise<SecurityOverview> {
  const [factors, sessions, codes, assurance] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.rpc("my_sessions"),
    supabase.rpc("my_recovery_code_count"),
    supabase.rpc("my_session_assurance"),
  ])
  if (factors.error) throw factors.error
  if (sessions.error) throw sessions.error
  const verified = verifiedTotpFactors(factors.data?.totp ?? [])
  const rows = (sessions.data ?? []) as SessionRow[]
  const read = interpretAssurance(assurance.data)
  return {
    factors: verified,
    staleFactors: staleTotpFactors(factors.data?.all ?? []).length,
    assurance: read,
    sessions: rows,
    otherDevices: otherSessions(rows).length,
    recoveryCodesLeft: typeof codes.data === "number" ? codes.data : 0,
    atAal2: read?.aal === "aal2",
  }
}

export type Outcome = { ok: true } | { ok: false; message: string; recentAuth?: boolean }

/** The sentence `sign_out_my_other_devices` and `regenerate_my_recovery_codes` raise at 42501. */
function isRecentAuthRefusal(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && error.code === "42501" && /authenticator/i.test(error.message ?? ""))
}

/**
 * CHANGE PASSWORD. Mirrors `setAccountPassword` on the website: the shared composition rule, then
 * GoTrue's own `updateUser`, then the recorded change. GoTrue re-applies its minimum on the server.
 */
export async function setMyPassword(supabase: Client, password: string): Promise<Outcome> {
  const composition = checkPasswordComposition(password)
  if (!composition.ok) return { ok: false, message: composition.message }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { ok: false, message: /password/i.test(error.message) ? error.message : "We couldn't change your password. Try again." }
  }
  await supabase.rpc("record_my_security_change", { p_change: "PASSWORD_SET" })
  return { ok: true }
}

/** REMOVE AN AUTHENTICATOR. Never the last verified one: replace, don't remove -- the website's rule. */
export async function removeMyFactor(supabase: Client, factorId: string): Promise<Outcome> {
  const { data } = await supabase.auth.mfa.listFactors()
  const verified = verifiedTotpFactors(data?.totp ?? [])
  if (!verified.some((f) => f.id === factorId)) return { ok: false, message: "That authenticator is not on your account." }
  if (!canRemoveFactor(verified.length)) {
    return { ok: false, message: "That is your only authenticator. Add another one before removing it." }
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, message: "We couldn't remove that authenticator. Try again." }
  await supabase.rpc("record_my_security_change", { p_change: "MFA_FACTOR_REMOVED" })
  return { ok: true }
}

/** SIGN OUT EVERYWHERE ELSE. The server demands a recent second factor; the refusal is passed back as such. */
export async function signOutMyOtherDevices(supabase: Client): Promise<Outcome & { revoked?: number }> {
  const { data, error } = await supabase.rpc("sign_out_my_other_devices")
  if (error) {
    if (isRecentAuthRefusal(error)) return { ok: false, message: error.message, recentAuth: true }
    return { ok: false, message: "We couldn't sign out your other devices. Try again." }
  }
  return { ok: true, revoked: typeof data === "number" ? data : 0 }
}

/** NEW RECOVERY CODES. Shown once by the caller; the server keeps only their hashes. */
export async function regenerateMyRecoveryCodes(supabase: Client): Promise<{ ok: true; codes: string[] } | { ok: false; message: string; recentAuth?: boolean }> {
  const { data, error } = await supabase.rpc("regenerate_my_recovery_codes")
  if (error) {
    if (isRecentAuthRefusal(error)) return { ok: false, message: error.message, recentAuth: true }
    return { ok: false, message: "We couldn't create new codes. Try again." }
  }
  return { ok: true, codes: (data ?? []) as string[] }
}

export type EnrolmentStart = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; message: string }

/**
 * START ENROLMENT. Identical to the website's `startTotpEnrolment`: the cap, the stale half-enrolments
 * removed first, then GoTrue's `enroll`. The secret and QR are returned to the screen and to nothing else.
 */
export async function startTotpEnrolment(supabase: Client): Promise<EnrolmentStart> {
  const { data: existing } = await supabase.auth.mfa.listFactors()
  const verified = verifiedTotpFactors(existing?.totp ?? [])
  if (verified.length >= MAX_TOTP_FACTORS) {
    return { ok: false, message: `You can have up to ${MAX_TOTP_FACTORS} authenticators. Remove one first.` }
  }
  for (const stale of staleTotpFactors(existing?.all ?? [])) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${verified.length + 1} (${Date.now().toString(36)})`,
  })
  if (error || !data) return { ok: false, message: "We couldn't start setup. Please try again." }
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

export type EnrolmentFinish = { ok: true; recoveryCodes: string[] } | { ok: false; message: string }

/** FINISH ENROLMENT: challenge, verify, the first recovery codes, the recorded change -- the website's order. */
export async function confirmTotpEnrolment(supabase: Client, factorId: string, code: string): Promise<EnrolmentFinish> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) return { ok: false, message: "We couldn't start the check. Try again." }
  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.replace(/\s/g, "") })
  if (verifyError) return { ok: false, message: "That code wasn't right. Try the next one your app shows." }
  const { data: codes, error: codesError } = await supabase.rpc("issue_my_first_recovery_codes")
  if (codesError || !codes) {
    return { ok: false, message: "Your authenticator is set up, but we couldn't create recovery codes. Open Security to try again." }
  }
  await supabase.rpc("record_my_security_change", { p_change: "MFA_ENROLLED" })
  return { ok: true, recoveryCodes: codes as string[] }
}
