"use server"

import { revalidatePath } from "next/cache"

import { redirect } from "next/navigation"

import { setActiveContext } from "@/app/(app)/set-context"
import { safeNextPath } from "@/lib/auth/safe-next"
import { GENERIC_REFUSAL, redeemInvitation, type RedemptionResult } from "@/lib/invitations/redeem"
import { createClient } from "@/lib/supabase/server"

/**
 * Makes a newly granted context the active one, on the way out of an entrance.
 *
 * A thin pass-through to the shell's own setter, which UX-8 §27 requires: the shell owns context
 * switching and an entrance does not get its own parallel mechanism. Nothing is validated here because
 * nothing can be gained by setting it -- `resolveActiveContext` re-checks the key against the session's
 * real contexts on every server read and silently falls back when it does not name one.
 */
export async function adoptEntranceContext(key: string): Promise<void> {
  await setActiveContext(key)
}

/**
 * Signs out and comes straight back to the same invitation.
 *
 * UX-8 §26: somebody following a link intended for one address while signed in as another must not be
 * stranded. Redemption is bound to the session's CONFIRMED email and refuses -- correctly -- with the
 * generic message, which by design does not say who the invitation was for. So this offers the only
 * legitimate next action without revealing anything: end this session and return here, where the
 * invitation is still waiting and can be accepted by whoever it was actually sent to.
 *
 * The destination is rebuilt from the token or code the caller already holds, and goes through
 * `safeNextPath` like every other post-authentication target, so nothing arbitrary can be smuggled into
 * the redirect.
 */
export async function signOutAndReturnToInvitation(input: {
  token?: string | null
  code?: string | null
}): Promise<void> {
  const target = input.token
    ? `/join?t=${encodeURIComponent(input.token)}`
    : input.code
      ? `/join?c=${encodeURIComponent(input.code)}`
      : "/join"
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(safeNextPath(target))
}

/**
 * Accepting an invitation, from the one public entry point.
 *
 * This is a thin wrapper over `redeemInvitation`, which is the only module allowed to name the RPC.
 * It adds nothing to the answer: a refusal is passed through exactly as the database phrased it, so
 * the page cannot accidentally become the oracle the database went to some trouble not to be.
 */
export type RecordAgeResult = { ok: true } | { ok: false; error: string }

/**
 * The other half of the age gate. `record_own_date_of_birth` is the boundary: it will supply a date
 * of birth that has never been given and refuses to change one that has, because a date of birth that
 * can be edited at will is not evidence of anything and the gate above it would mean nothing.
 */
export async function recordOwnDateOfBirth(input: {
  dateOfBirth: string
  firstName?: string
  surname?: string
}): Promise<RecordAgeResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("record_own_date_of_birth", {
    p_date_of_birth: input.dateOfBirth,
    p_first_name: input.firstName?.trim() || undefined,
    p_surname: input.surname?.trim() || undefined,
  })
  if (error) {
    // These refusals are the person's own data being wrong, so they are worth saying plainly -- there
    // is nothing here anyone could learn about somebody else.
    return { ok: false, error: error.message || "We couldn't record that. Please check the date." }
  }
  return { ok: true }
}

export async function acceptInvitation(input: { token?: string | null; code?: string | null }): Promise<RedemptionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redemption raises rather than returns when there is no session, which is the one case the
  // generic answer would be actively unhelpful for -- the person can fix it.
  if (!user) return { ok: false, reason: "SIGN_IN_REQUIRED", message: "Sign in to accept this invitation." }

  const token = input.token?.trim() || null
  const code = input.code?.trim() || null
  if (!token && !code) return { ok: false, reason: null, message: GENERIC_REFUSAL }

  const result = await redeemInvitation(supabase, { token, code })
  if (result.ok) revalidatePath("/dashboard")
  return result
}
