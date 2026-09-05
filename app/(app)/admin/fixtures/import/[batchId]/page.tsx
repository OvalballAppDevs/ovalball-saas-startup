import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"
import { ImportReviewPanel, type ExistingFixtureSummary, type ImportRow } from "@/components/fixtures/import-review-panel"
import { listCompetitionEditionsForRugbyCode } from "@/lib/fixtures/competitions"

import { correctImportRow, excludeImportRow, publishBatch, resolveRowConflict } from "../actions"

const STATE_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  needs_review: "Needs review",
  ready_to_publish: "Ready to publish",
  publishing: "Publishing…",
  completed: "Completed",
  completed_with_exclusions: "Completed with exclusions",
  failed: "Failed",
}

export default async function ImportBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const { data: batch } = await supabase.from("fixture_import_batches").select("*").eq("id", batchId).maybeSingle()
  if (!batch) notFound()

  const { data: rows } = await supabase
    .from("fixture_import_rows")
    .select("*")
    .eq("batch_id", batchId)
    .order("row_number")

  const conflictingIds = [...new Set((rows ?? []).map((r) => r.conflicting_fixture_id).filter((id): id is string => Boolean(id)))]
  const { data: conflictingFixtures } =
    conflictingIds.length > 0
      ? await supabase.from("admin_fixture_overview").select("id, owning_team_name, opponent_team_name, raw_opposition_text, kickoff_date, kickoff_time, game_type, status").in("id", conflictingIds)
      : { data: [] }
  const existingById = new Map<string, ExistingFixtureSummary>(
    (conflictingFixtures ?? []).map((f) => [
      f.id!,
      {
        teamName: f.owning_team_name ?? "",
        opponentText: f.opponent_team_name ?? f.raw_opposition_text ?? "",
        date: f.kickoff_date ?? "",
        time: f.kickoff_time,
        gameType: f.game_type,
        status: f.status ?? "",
      },
    ])
  )

  const importRows: ImportRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    rowNumber: r.row_number,
    raw: r.raw as Record<string, string>,
    status: r.status,
    errors: (r.errors as string[]) ?? [],
    homeTeamResolved: Boolean(r.resolved_home_team_id),
    rawOppositionText: r.raw_opposition_text,
    normalizedGameType: r.normalized_game_type,
    fixtureDate: r.fixture_date,
    kickoffTime: r.kickoff_time,
    conflictingFixtureId: r.conflicting_fixture_id,
    conflictDecision: r.conflict_decision,
    publishedFixtureId: r.published_fixture_id,
  }))

  const counts = {
    ready: importRows.filter((r) => r.status === "ready").length,
    needsReview: importRows.filter((r) => r.status === "needs_review").length,
    conflict: importRows.filter((r) => r.status === "conflict").length,
    invalid: importRows.filter((r) => r.status === "invalid").length,
    excluded: importRows.filter((r) => r.status === "excluded").length,
    published: importRows.filter((r) => r.status === "published").length,
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/fixtures" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Fixture management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <h1 className="mt-3 font-display text-display-l text-ink">{batch.filename}</h1>
      <p className="mt-1 text-sm text-ink/55">
        {batch.row_count} rows &middot; {STATE_LABEL[batch.state] ?? batch.state}
      </p>

      <div className="mt-6">
        <ImportReviewPanel
          batchId={batchId}
          batchState={batch.state}
          rows={importRows}
          counts={counts}
          existingById={existingById}
          resolveRowConflict={resolveRowConflict}
          excludeImportRow={excludeImportRow}
          publishBatch={publishBatch}
          correctRow={correctImportRow}
          listCompetitionEditions={listCompetitionEditionsForRugbyCode}
        />
      </div>
    </div>
  )
}
