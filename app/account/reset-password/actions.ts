"use server"

import { checkPassword } from "@/lib/auth/password-policy"
import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

export type SetNewPasswordResult = { ok: true; next: string } | { ok: false; message: string }

/**
 * COMPLETE A PASSWORD RESET (Phase 2 E "Reset", G).
 *
 * "Recovery link -> set new password -> TOTP challenge -> AAL2. Other sessions revoked; security
 * event password.reset_completed."
 *
 * The recovery link has already been exchanged for a session by /auth/callback, so this runs on the
 * person's own session -- no service role, no user id from the caller.
 *
 * checkPassword is the SAME validator the Account -> Security surface uses: 12 characters, an
 * uppercase letter, a special character, 72 bytes maximum, and a HaveIBeenPwned check that fails
 * closed in production. Before Slice 6b this was the only place in the product that ran it, because
 * this was the only place a password could be set.
 */
export async function setNewPassword(password: string): Promise<SetNewPasswordResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // The recovery session IS the authorisation. Without one there is nothing to reset.
  if (!user) return { ok: false, message: "That link has expired. Ask for a new one." }

  const verdict = await checkPassword(password)
  if (!verdict.ok) return { ok: false, message: verdict.message }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error("setNewPassword failed:", error.code ?? error.message)
    return { ok: false, message: toPublicSubmissionError() }
  }

  await supabase.rpc("record_my_security_change", { p_change: "PASSWORD_RESET" })

  // E: other sessions revoked. Anybody who took the account while the password was unknown loses it
  // now -- which is the point of resetting, and is why this is not optional.
  //
  // NOT public.sign_out_my_other_devices(). That RPC guards itself with internal.recent_aal2(10),
  // which is right for the Account -> Security page it was built for -- ending somebody else's
  // sessions is a privileged act there -- and wrong here, because a person completing a recovery is
  // at AAL1 by definition: the TOTP challenge comes AFTER this, which is exactly what E describes.
  // On a real browser session with no TOTP claim recent_aal2 returns false, so the RPC raises 42501,
  // and rpc() surfaces that as an `error` field the first draft of this file ignored. It was dead
  // code that read like a security control.
  //
  // HOW THAT SURVIVED TESTING, stated plainly: GoTrue revokes a user's other sessions itself when
  // the password changes, so the browser journey saw the sessions correctly gone and the dead call
  // proved nothing either way. It would have failed silently for exactly the account that matters --
  // one holding a TOTP factor -- if GoTrue ever stopped doing it.
  //
  // The AAL gate is NOT weakened. GoTrue's own others-scoped sign-out is used instead: it is
  // authorised by holding the session rather than by AAL, and it is the right authority for "end the
  // sessions that are not the one I am sitting in". It also makes the revocation Ovalball's own act
  // rather than a side effect it happens to inherit.
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" })

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const needsMfa = Boolean(aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel)

  if (revokeError) {
    // FAIL CLOSED. The password is already changed, so this cannot be reported as a failed reset --
    // telling somebody to try again with a password that is now live would strand them. But leaving
    // the old sessions alive is the one outcome a reset exists to prevent, so everything goes,
    // including this one, and the person signs in again with the password they just chose. Nobody
    // keeps a session obtained under the old one.
    console.error("setNewPassword: other sessions were not revoked", revokeError.code ?? revokeError.message)
    await supabase.auth.signOut({ scope: "global" })
    return { ok: true, next: "/login?reset=1" }
  }

  // E: a reset ends at AAL2, so anybody holding a factor presents it before they reach the app.
  return { ok: true, next: needsMfa ? "/security/verify" : "/dashboard" }
}
