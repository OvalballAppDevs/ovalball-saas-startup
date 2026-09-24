"use server"

import { revalidatePath } from "next/cache"

import { guardAction } from "@/lib/auth/action-boundary"
import { createClient } from "@/lib/supabase/server"
import {
  applyPermissionPreset,
  decidePermission,
  isRecentAuthRefusal,
  permissionErrorMessage,
  restoreDefault,
  type DecisionEffect,
} from "@ovalball/contracts/club/permissions"

/**
 * THE CLUB'S PERMISSION DECISIONS, ON THE WEB (CA-M4).
 *
 * Every action goes through the shared contract to the two canonical operations,
 * set_capability_override and revoke_capability_override, which decide the
 * authority themselves -- a club administrator may only reach their own club,
 * only the operational capabilities, only somebody who works with the team
 * named, and never the delegation authority itself. These actions add no
 * permission of their own and cannot become a way around one.
 *
 * RECENT AUTHENTICATOR. The catalogue declares people.capability.manage `R`,
 * and the database now enforces it inside the operations (a code entered within
 * the last ten minutes, judged AFTER the capability). `guardAction` asks the
 * same question first so a person is sent to verify with a useful destination
 * rather than a bare refusal; the database remains the boundary of record, so
 * a refusal from it carries the same destination.
 *
 * THE REASON IS THE PERSON'S. The boilerplate "Set from the club's permissions
 * screen" is gone: a withhold needs a reason the server will record, and the
 * screen asks for it.
 */
export type DelegationResult = { ok: true } | { ok: false; error: string; href?: string }

const VERIFY = "/security/verify"

function refused(error: unknown, fallback: string): DelegationResult {
  return {
    ok: false,
    error: permissionErrorMessage(error, fallback),
    href: isRecentAuthRefusal(error) ? VERIFY : undefined,
  }
}

/** Allows or withholds ONE capability for ONE person at club scope. */
export async function setClubCapability(
  userId: string,
  capabilityKey: string,
  clubId: string,
  effect: DecisionEffect,
  reason = "",
): Promise<DelegationResult> {
  const supabase = await createClient()
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await decidePermission(supabase, { userId, key: capabilityKey, clubId, scope: { kind: "club" }, effect, reason })
  } catch (error) {
    return refused(error, "That permission could not be saved.")
  }
  revalidatePath("/club/permissions")
  return { ok: true }
}

/**
 * The same decision, for ONE TEAM. The same canonical operation at a team scope:
 * a club administrator may only reach a team at their own club, only capabilities
 * the catalogue allows at team scope, and only somebody who holds a role on it.
 */
export async function setTeamCapability(
  userId: string,
  capabilityKey: string,
  clubId: string,
  teamId: string,
  effect: DecisionEffect,
  reason = "",
): Promise<DelegationResult> {
  const supabase = await createClient()
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await decidePermission(supabase, {
      userId,
      key: capabilityKey,
      clubId,
      scope: { kind: "team", teamId, teamName: "" },
      effect,
      reason,
    })
  } catch (error) {
    return refused(error, "That permission could not be saved.")
  }
  revalidatePath("/club/permissions")
  return { ok: true }
}

/** Removes an explicit decision, returning the person to whatever their role gives them. */
export async function clearClubCapability(overrideId: string, reason = ""): Promise<DelegationResult> {
  const supabase = await createClient()
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await restoreDefault(supabase, overrideId, reason)
  } catch (error) {
    return refused(error, "That permission could not be returned to the role default.")
  }
  revalidatePath("/club/permissions")
  return { ok: true }
}

/**
 * Applies a named preset -- a whole job -- to one person at one club. The preset is
 * DATA: apply_capability_preset loops it through set_capability_override, so every
 * ceiling, age rule, Volunteer prohibition, recency check and audit event is
 * identical to granting them one at a time, and a refusal on any aborts all.
 */
export async function applyClubPreset(userId: string, presetKey: string, clubId: string, reason = ""): Promise<DelegationResult> {
  const supabase = await createClient()
  const gate = await guardAction({ recentMinutes: 10 }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error, href: gate.href }
  try {
    await applyPermissionPreset(supabase, userId, presetKey, clubId, reason)
  } catch (error) {
    return refused(error, "That preset could not be applied.")
  }
  revalidatePath("/club/permissions")
  return { ok: true }
}
