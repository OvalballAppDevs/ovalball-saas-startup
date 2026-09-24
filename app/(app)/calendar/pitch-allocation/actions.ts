"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import {
  allocateFixtureOnPitch,
  createAllocationProposal,
  discardAllocationProposal,
  readAllocationProposal,
  type AllocateResult,
  type ProposalItemView,
  type ProposalResult,
} from "@ovalball/contracts/pitch-allocation/operations"

/**
 * PITCH ALLOCATION SERVER ACTIONS -- the website's gate around the SHARED operations (CA-M11.1).
 *
 * The reads, the placement write and the proposal builder moved to
 * `packages/contracts/src/pitch-allocation/operations.ts`, where the phone calls the same code. What
 * stays here is what only the website has: its active-context gate, and the cache revalidation.
 */
export type { AllocateResult, ProposalItemView, ProposalResult }

const CALENDAR_PATHS = ["/calendar", "/calendar/agenda", "/calendar/pitch-allocation", "/fixtures"]

export async function requirePitchAllocationAccess(clubId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // Active context must genuinely BE this club -- an account that also
  // happens to hold Site Admin or another club's authority must not
  // exercise Pitch Allocation for a club it isn't currently operating as
  // (the same "active context is a lens, not authority" rule already
  // enforced everywhere else in Calendar this session).
  const activeIsThisClub = activeContext.kind === "club" && activeContext.id === clubId
  const activeIsSiteAdmin = ctx.isSiteAdmin && activeContext.kind === "site_admin"
  if (!activeIsThisClub && !activeIsSiteAdmin) {
    return { ok: false as const, error: "You must be operating as this club (or as an active Site Admin) to manage Pitch Allocation." }
  }

  // No new capability invented (Section 22's own instruction to audit
  // first): fixture.edit at CLUB scope already means exactly "Club Admin
  // or Fixture Secretary for this club" -- the same two roles Section
  // 23/24 name as Pitch Allocation's intended managers -- and, being
  // club-SCOPED (not team-scoped), a Team Admin/Coach/Manager's
  // team-scoped fixture.edit grant does NOT satisfy this check, which is
  // exactly Section 25's "do not silently grant club-wide scheduling
  // power" requirement, for free, from the capability engine's own scope
  // model.
  const allowed = activeIsSiteAdmin || (await hasCapability(supabase, "fixture.edit", "club", { clubId }))
  if (!allowed) return { ok: false as const, error: "You do not have Pitch Allocation access for this club." }

  return { ok: true as const, supabase, user }
}

/**
 * One drag mutation -- Sections 14-16: horizontal = kickoff time,
 * vertical = pitch, and a single drop across both axes is one coherent
 * call. `kickoffTime: undefined` means "don't touch kickoff"; pass null
 * explicitly only if a future "clear kickoff" affordance is added (not
 * built this pass).
 */

export async function allocateFixture(clubId: string, fixtureId: string, changes: { pitchId?: string | null; kickoffTime?: string }): Promise<AllocateResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error, fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
  const result = await allocateFixtureOnPitch(auth.supabase, clubId, fixtureId, changes)
  if (result.ok) {
    for (const path of CALENDAR_PATHS) revalidatePath(path)
    revalidatePath(`/admin/fixtures/${fixtureId}`)
  }
  return result
}

export async function createPitchAllocationProposal(clubId: string, dateIso: string, recalculateAll = false): Promise<ProposalResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  return createAllocationProposal(auth.supabase, clubId, dateIso, auth.user.id, recalculateAll)
}

export async function getProposal(clubId: string, proposalId: string): Promise<{ ok: true; items: ProposalItemView[] } | { ok: false; error: string }> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  try {
    return { ok: true, items: await readAllocationProposal(auth.supabase, proposalId) }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Could not read the proposal." }
  }
}

export interface ApplyProposalResult {
  ok: boolean
  error?: string
  appliedCount: number
  failedCount: number
  failures: { fixtureId: string; reason: string }[]
}

/** Kept for parity with the earlier build; the board stages a reviewed proposal and discards it instead. */
export async function applyPitchAllocationProposal(clubId: string, proposalId: string): Promise<ApplyProposalResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error, appliedCount: 0, failedCount: 0, failures: [] }
  const { supabase, user } = auth
  const { data: proposal } = await supabase.from("pitch_allocation_proposals").select("club_id, status").eq("id", proposalId).maybeSingle()
  if (!proposal || proposal.club_id !== clubId) return { ok: false, error: "Proposal not found.", appliedCount: 0, failedCount: 0, failures: [] }
  if (proposal.status !== "draft") return { ok: false, error: "This proposal has already been applied or discarded.", appliedCount: 0, failedCount: 0, failures: [] }
  const items = await readAllocationProposal(supabase, proposalId)
  let appliedCount = 0
  const failures: { fixtureId: string; reason: string }[] = []
  for (const item of items) {
    if (item.isUnallocated || item.conflictSeverity === "hard") continue // never apply a hard-blocked or unallocated item
    const result = await allocateFixtureOnPitch(supabase, clubId, item.fixtureId, { pitchId: item.proposedPitchId, kickoffTime: item.proposedKickoffTime ?? undefined })
    if (result.ok) appliedCount++
    else failures.push({ fixtureId: item.fixtureId, reason: result.error ?? "Could not apply this fixture's proposed allocation." })
  }
  await supabase.from("pitch_allocation_proposals").update({ status: "applied", applied_at: new Date().toISOString(), applied_by: user.id }).eq("id", proposalId)
  for (const path of CALENDAR_PATHS) revalidatePath(path)
  return { ok: true, appliedCount, failedCount: failures.length, failures }
}

export async function discardPitchAllocationProposal(clubId: string, proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  return discardAllocationProposal(auth.supabase, clubId, proposalId)
}
