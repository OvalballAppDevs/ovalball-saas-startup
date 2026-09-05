"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { applyRowCorrection, stageImportBatch, type RowCorrectionInput } from "@/lib/fixtures/import-engine"
import { fullTeamLabel } from "@/lib/teams/compact-label"

export type ActionResult = { ok: true } | { ok: false; error: string }
export type CreateBatchResult = { ok: true; batchId: string } | { ok: false; error: string }
export interface PublishResult {
  ok: true
  published: number
  excluded: number
  failed: { rowId: string; error: string }[]
}
export interface ResolveConflictInput {
  rowId: string
  decision: "replace_and_notify" | "override_no_notify" | "keep_existing" | "keep_both"
}

/**
 * The one place this file resolves "which club is the current user
 * importing for" -- the active club/team-context switcher, same as every
 * other club-scoped page. `internal.can_manage_club_fixtures(clubId)` is
 * the REAL boundary (checked by RLS on fixture_import_batches/rows and
 * again inside publish_import_row) -- this is only a friendly early exit.
 */
async function resolveImportClubId(): Promise<{ clubId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in." }
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) return { error: "You don't have fixture management authority for a club right now." }
  return { clubId }
}

/** Club-scoped import -- home-team resolution is restricted to the active club's own teams (see lib/fixtures/import-engine.ts's `restrictHomeClubId`); the real authority boundary is RLS (internal.can_manage_club_fixtures), not this check. */
export async function createClubImportBatch(filename: string, rawRows: Record<string, string>[]): Promise<CreateBatchResult> {
  const resolved = await resolveImportClubId()
  if ("error" in resolved) return { ok: false, error: resolved.error }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const result = await stageImportBatch(supabase, user.id, filename, rawRows, resolved.clubId)
  if (result.ok) revalidatePath("/fixtures/import")
  return result
}

export async function resolveClubRowConflict(input: ResolveConflictInput): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const { error } = await supabase.from("fixture_import_rows").update({ conflict_decision: input.decision }).eq("id", input.rowId)
  if (error) {
    console.error("resolveClubRowConflict failed:", error)
    return { ok: false, error: "Couldn't record that decision. Please try again." }
  }
  return { ok: true }
}

/** Reconciliation complaint 26 -- corrects a staged row via real canonical pickers (never re-typed text), restricted to this club's own active teams/pitches; applyRowCorrection re-derives the row's status. */
export async function correctClubImportRow(rowId: string, correction: RowCorrectionInput): Promise<ActionResult> {
  const resolved = await resolveImportClubId()
  if ("error" in resolved) return { ok: false, error: resolved.error }
  const supabase = await createClient()
  return applyRowCorrection(supabase, rowId, correction, resolved.clubId)
}

export async function excludeClubImportRow(rowId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const { error } = await supabase.from("fixture_import_rows").update({ status: "excluded" }).eq("id", rowId)
  if (error) {
    console.error("excludeClubImportRow failed:", error)
    return { ok: false, error: "Couldn't exclude that row. Please try again." }
  }
  return { ok: true }
}

/** Same one-row-at-a-time atomic publish loop as the Site Admin path (see app/(app)/admin/fixtures/import/actions.ts's publishBatch) -- publish_import_row itself re-authorises against the batch's own club_id, so this never needs to trust the client. */
export async function publishClubBatch(batchId: string): Promise<PublishResult | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  await supabase.from("fixture_import_batches").update({ state: "publishing" }).eq("id", batchId)

  const { data: rows } = await supabase
    .from("fixture_import_rows")
    .select("id, status, conflict_decision")
    .eq("batch_id", batchId)
    .in("status", ["ready", "conflict", "update"])

  let published = 0
  let excluded = 0
  const failed: { rowId: string; error: string }[] = []

  for (const row of rows ?? []) {
    if (row.status === "conflict" && !row.conflict_decision) continue
    const { error } = await supabase.rpc("publish_import_row", { p_row_id: row.id })
    if (error) {
      failed.push({ rowId: row.id, error: error.message })
    } else if (row.conflict_decision === "keep_existing") {
      excluded += 1
    } else {
      published += 1
    }
  }

  const finalState = failed.length > 0 ? "completed_with_exclusions" : "completed"
  await supabase
    .from("fixture_import_batches")
    .update({ state: finalState, published_at: new Date().toISOString(), published_by: user.id })
    .eq("id", batchId)

  revalidatePath("/fixtures")
  revalidatePath(`/fixtures/import/${batchId}`)
  return { ok: true, published, excluded, failed }
}

export interface ImportTeamOption {
  id: string
  label: string
}

/** Reconciliation complaint 26/27 -- the club's own real active roster for the row-correction Home Team picker (fullTeamLabel, same canonical formatter every other selector uses), never the global Team Directory. */
export async function getMyClubTeamsForImport(): Promise<ImportTeamOption[]> {
  const resolved = await resolveImportClubId()
  if ("error" in resolved) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("teams")
    .select("id, category, age_group, gender, squad_designation")
    .eq("club_id", resolved.clubId)
    .eq("active", true)
    .order("category")
    .order("age_group")
  return (data ?? []).map((t) => ({ id: t.id, label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation }) }))
}

export interface ImportPitchOption {
  id: string
  displayName: string
}

/** Reconciliation complaint 26 remainder -- the club's own active pitches for the row-correction Pitch/Venue picker, same club_pitches_select read every other pitch control in this app already uses; restricted to the current import club via resolveImportClubId. */
export async function getMyClubPitchesForImport(): Promise<ImportPitchOption[]> {
  const resolved = await resolveImportClubId()
  if ("error" in resolved) return []
  const supabase = await createClient()
  const { data } = await supabase.from("club_pitches").select("id, display_name").eq("club_id", resolved.clubId).eq("active", true).order("sort_order")
  return (data ?? []).map((p) => ({ id: p.id, displayName: p.display_name }))
}

export async function requireClubImportAccess() {
  const resolved = await resolveImportClubId()
  if ("error" in resolved) redirect("/fixtures")
  return resolved.clubId
}
