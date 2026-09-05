"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { applyRowCorrection, stageImportBatch, type RowCorrectionInput } from "@/lib/fixtures/import-engine"

import { requireSiteAdmin } from "../../require-site-admin"

export type ActionResult = { ok: true } | { ok: false; error: string }

export type CreateBatchResult = { ok: true; batchId: string } | { ok: false; error: string }

/** Site Admin global import -- unrestricted home-team matching (unchanged behaviour). Club-scoped import lives in app/(app)/fixtures/import/actions.ts, sharing the same lib/fixtures/import-engine.ts staging logic. */
export async function createImportBatch(filename: string, rawRows: Record<string, string>[]): Promise<CreateBatchResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const result = await stageImportBatch(supabase, auth.user.id, filename, rawRows)
  if (result.ok) revalidatePath("/admin/fixtures/import")
  return result
}

export interface ResolveConflictInput {
  rowId: string
  decision: "replace_and_notify" | "override_no_notify" | "keep_existing" | "keep_both"
}

export async function resolveRowConflict(input: ResolveConflictInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from("fixture_import_rows").update({ conflict_decision: input.decision }).eq("id", input.rowId)
  if (error) {
    console.error("resolveRowConflict failed:", error)
    return { ok: false, error: "Couldn't record that decision. Please try again." }
  }
  return { ok: true }
}

/** Reconciliation complaint 26 -- Site Admin global import correction; unrestricted club scope (matching this path's existing unrestricted home-team resolution), applyRowCorrection re-derives the row's status. */
export async function correctImportRow(rowId: string, correction: RowCorrectionInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }
  return applyRowCorrection(supabase, rowId, correction)
}

export async function excludeImportRow(rowId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from("fixture_import_rows").update({ status: "excluded" }).eq("id", rowId)
  if (error) {
    console.error("excludeImportRow failed:", error)
    return { ok: false, error: "Couldn't exclude that row. Please try again." }
  }
  return { ok: true }
}

export interface PublishResult {
  ok: true
  published: number
  excluded: number
  failed: { rowId: string; error: string }[]
}

/**
 * Loops publish_import_row() one row at a time -- each call is its own
 * atomic transaction, so a failure partway through a large batch is
 * always precisely visible per row (fixture_import_rows.status), never a
 * silent partial success. Only rows in 'ready' or 'conflict' (with a
 * decision) are attempted; anything still 'needs_review'/'invalid' is
 * left exactly as is.
 */
export async function publishBatch(batchId: string): Promise<PublishResult | { ok: false; error: string }> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }

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
    .update({ state: finalState, published_at: new Date().toISOString(), published_by: auth.user.id })
    .eq("id", batchId)

  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/import/${batchId}`)
  return { ok: true, published, excluded, failed }
}
