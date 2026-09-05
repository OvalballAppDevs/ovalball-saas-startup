"use server"

import { revalidatePath } from "next/cache"

import { researchClub } from "@/lib/directory-research/provider"
import { createClient } from "@/lib/supabase/server"

export type VerificationScope = "current_club" | "filtered" | "needs_review" | "missing_data" | "entire_directory"
export type FilterFlag = "missing_postcode" | "missing_town" | "missing_website" | "missing_logo" | "unverified" | "duplicate"

export type PreviewResult = { ok: true; count: number } | { ok: false; error: string }

/**
 * start_directory_verification_run (SECURITY DEFINER) re-checks Full Site
 * Admin / Club Data Admin authority and computes the real scoped count
 * itself -- this only forwards the call.
 */
export async function previewVerificationScopeAction(scope: VerificationScope, directoryId?: string, filterFlag?: FilterFlag): Promise<PreviewResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("preview_directory_verification_scope", {
    p_scope: scope,
    p_directory_id: directoryId,
    p_filters: filterFlag ? { flag: filterFlag } : undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, count: data ?? 0 }
}

export type StartRunResult = { ok: true; runId: string } | { ok: false; error: string }

export async function startVerificationRunAction(scope: VerificationScope, directoryId?: string, filterFlag?: FilterFlag): Promise<StartRunResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_directory_verification_run", {
    p_scope: scope,
    p_directory_id: directoryId,
    p_filters: filterFlag ? { flag: filterFlag } : undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/clubs/data-quality")
  return { ok: true, runId: data }
}

export interface RunProgress {
  status: "running" | "completed" | "failed" | "partial"
  totalRecords: number
  processedRecords: number
  proposalsCreated: number
  conflictsFound: number
  noResultCount: number
  failedCount: number
}

export type BatchResult = { ok: true; progress: RunProgress; done: boolean } | { ok: false; error: string }

const BATCH_SIZE = 10

/**
 * One bounded batch of real work per call -- the client calls this
 * repeatedly (see run-verification-panel.tsx) until `done`, rather than
 * this action looping over the entire scope in one request. Each club in
 * the batch goes through researchClub() (genuinely not connected to a
 * live provider locally -- see that module's own comment) and the result
 * is recorded via record_directory_verification_result, which is also
 * where duplicate-pending-proposal reuse and the counters live.
 */
export async function processVerificationBatchAction(runId: string): Promise<BatchResult> {
  const supabase = await createClient()

  const { data: batch, error: batchError } = await supabase.rpc("get_directory_verification_next_batch", { p_run_id: runId, p_batch_size: BATCH_SIZE })
  if (batchError) return { ok: false, error: batchError.message }

  for (const club of batch ?? []) {
    if (!club.directory_id) continue
    const { data: fullClub } = await supabase
      .from("club_directory")
      .select("id, name, town, county, postcode, website, constituent_body, rugby_code")
      .eq("id", club.directory_id)
      .maybeSingle()
    if (!fullClub) continue

    let result
    try {
      result = await researchClub({
        directoryId: fullClub.id,
        name: fullClub.name,
        town: fullClub.town,
        county: fullClub.county,
        postcode: fullClub.postcode,
        website: fullClub.website,
        constituentBody: fullClub.constituent_body,
        rugbyCode: fullClub.rugby_code,
      })
    } catch (err) {
      result = { status: "error" as const, message: err instanceof Error ? err.message : "Unknown research error." }
    }

    if (result.status === "not_configured" || result.status === "no_result") {
      await supabase.rpc("record_directory_verification_result", {
        p_run_id: runId,
        p_directory_id: club.directory_id,
        p_outcome: "no_result",
        p_detail: result.status === "not_configured" ? "No online research provider is configured in this environment." : "No authoritative source found.",
      })
    } else if (result.status === "ok") {
      await supabase.rpc("record_directory_verification_result", {
        p_run_id: runId,
        p_directory_id: club.directory_id,
        p_outcome: result.proposals.length > 0 ? "proposal_created" : "no_result",
        p_proposals: result.proposals.map((p) => ({
          field: p.field,
          current_value: p.currentValue,
          proposed_value: p.proposedValue,
          source: p.source,
          source_url: p.sourceUrl,
          confidence: p.confidence,
        })),
      })
    } else if (result.status === "conflict") {
      await supabase.rpc("record_directory_verification_result", {
        p_run_id: runId,
        p_directory_id: club.directory_id,
        p_outcome: "conflict",
        p_detail: result.reason,
        p_proposals: result.proposals.map((p) => ({
          field: p.field,
          current_value: p.currentValue,
          proposed_value: p.proposedValue,
          source: p.source,
          source_url: p.sourceUrl,
          confidence: p.confidence,
        })),
      })
    } else if (result.status === "rugby_code_conflict") {
      // Never proposed through the normal field pipeline (the staging
      // table's own CHECK constraint excludes rugby_code entirely) --
      // recorded as its own outcome so the dashboard can flag it as a
      // Critical Identity Conflict and point at the separate privileged
      // rugby-code correction workflow, never auto-applied here.
      await supabase.rpc("record_directory_verification_result", {
        p_run_id: runId,
        p_directory_id: club.directory_id,
        p_outcome: "rugby_code_conflict",
        p_detail: `Possible rugby code change: ${result.flag.currentValue ?? "unknown"} -> ${result.flag.proposedValue}. ${result.flag.reason}`,
      })
    } else {
      await supabase.rpc("record_directory_verification_result", {
        p_run_id: runId,
        p_directory_id: club.directory_id,
        p_outcome: "failed",
        p_detail: result.message,
      })
    }
  }

  const { data: run, error: runError } = await supabase.from("directory_verification_runs").select("*").eq("id", runId).single()
  if (runError || !run) return { ok: false, error: runError?.message ?? "Run not found." }

  const progress: RunProgress = {
    status: run.status as RunProgress["status"],
    totalRecords: run.total_records,
    processedRecords: run.processed_records,
    proposalsCreated: run.proposals_created,
    conflictsFound: run.conflicts_found,
    noResultCount: run.no_result_count,
    failedCount: run.failed_count,
  }

  revalidatePath("/admin/clubs/data-quality")
  return { ok: true, progress, done: run.status !== "running" }
}

export type RunHistoryRow = {
  id: string
  scope: string
  status: string
  totalRecords: number
  processedRecords: number
  proposalsCreated: number
  conflictsFound: number
  noResultCount: number
  failedCount: number
  startedAt: string
  completedAt: string | null
}

export async function listVerificationRunHistoryAction(): Promise<RunHistoryRow[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("list_directory_verification_runs", { p_limit: 10 })
  return (data ?? []).map((r) => ({
    id: r.id,
    scope: r.scope,
    status: r.status,
    totalRecords: r.total_records,
    processedRecords: r.processed_records,
    proposalsCreated: r.proposals_created,
    conflictsFound: r.conflicts_found,
    noResultCount: r.no_result_count,
    failedCount: r.failed_count,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }))
}
