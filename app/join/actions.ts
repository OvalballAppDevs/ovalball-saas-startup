"use server"

import { revalidatePath } from "next/cache"

import { GENERIC_REFUSAL, redeemInvitation, type RedemptionResult } from "@/lib/invitations/redeem"
import { createClient } from "@/lib/supabase/server"

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
