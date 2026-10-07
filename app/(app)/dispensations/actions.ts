"use server"

import { revalidatePath } from "next/cache"

import {
  decideDispensation,
  dispensationErrorMessage,
  recordDispensationReference,
  requestDispensation,
  revokeDispensation,
  withdrawDispensation,
} from "@ovalball/contracts/team/dispensation"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"

import { createClient } from "@/lib/supabase/server"

/**
 * THE DISPENSATION WORKFLOW'S WEBSITE ACTIONS (20270742000000) -- thin wrappers over the one implementation
 * in `@ovalball/contracts/team/dispensation`, which the phone calls too. Every one is re-decided in full by
 * the database: who may ask, who may decide (never the person who asked, never the child's family), the
 * first valid decision winning, a decline needing its reason. Nothing here is authority.
 */
export type DispensationActionResult = { ok: true; id?: string } | { ok: false; error: string; href?: string }

/** A decision needs a recent authenticator code (decide_dispensation and friends call require_recent_aal2), so a
 * refusal for that reason carries the way to enter one -- the same link the other privileged club actions give. */
const VERIFY = "/security/verify"
function refused(error: unknown, fallback: string): { ok: false; error: string; href?: string } {
  return { ok: false, error: dispensationErrorMessage(error, fallback), href: isRecentAuthRefusal(error) ? VERIFY : undefined }
}

type Contract = Parameters<typeof requestDispensation>[0]

function revalidate(id: string | null, teamId?: string | null) {
  if (id) revalidatePath(`/dispensations/${id}`)
  revalidatePath("/club/player-moves")
  if (teamId) {
    revalidatePath(`/teams/${teamId}/age-grade`)
    revalidatePath(`/teams/${teamId}`)
  }
}

export async function requestDispensationAction(input: {
  playerId: string
  teamId: string
  reason: string
  sourceTeamId?: string | null
}): Promise<DispensationActionResult> {
  if (!input.reason.trim()) return { ok: false, error: "Say why this dispensation is being requested." }
  const supabase = (await createClient()) as unknown as Contract
  try {
    const id = await requestDispensation(supabase, input)
    revalidate(id, input.teamId)
    return { ok: true, id }
  } catch (error) {
    return { ok: false, error: dispensationErrorMessage(error, "The request could not be sent. Try again.") }
  }
}

export async function decideDispensationAction(
  id: string,
  decision: { approve: boolean; note?: string | null; governingBodyReference?: string | null }
): Promise<DispensationActionResult> {
  if (!decision.approve && !decision.note?.trim()) return { ok: false, error: "Say why this dispensation is declined. The person who asked is told." }
  const supabase = (await createClient()) as unknown as Contract
  try {
    await decideDispensation(supabase, id, decision)
    revalidate(id)
    return { ok: true, id }
  } catch (error) {
    return refused(error, "The decision could not be saved. Try again.")
  }
}

export async function withdrawDispensationAction(id: string, reason?: string | null): Promise<DispensationActionResult> {
  const supabase = (await createClient()) as unknown as Contract
  try {
    await withdrawDispensation(supabase, id, reason)
    revalidate(id)
    return { ok: true, id }
  } catch (error) {
    return { ok: false, error: dispensationErrorMessage(error, "The request could not be withdrawn. Try again.") }
  }
}

export async function revokeDispensationAction(id: string, reason: string): Promise<DispensationActionResult> {
  if (!reason.trim()) return { ok: false, error: "A reason is required to revoke a dispensation." }
  const supabase = (await createClient()) as unknown as Contract
  try {
    await revokeDispensation(supabase, id, reason)
    revalidate(id)
    return { ok: true, id }
  } catch (error) {
    return refused(error, "The dispensation could not be revoked. Try again.")
  }
}

export async function recordDispensationReferenceAction(id: string, reference: string): Promise<DispensationActionResult> {
  if (!reference.trim()) return { ok: false, error: "Enter the governing body's reference." }
  const supabase = (await createClient()) as unknown as Contract
  try {
    await recordDispensationReference(supabase, id, reference)
    revalidate(id)
    return { ok: true, id }
  } catch (error) {
    return refused(error, "The reference could not be saved. Try again.")
  }
}
