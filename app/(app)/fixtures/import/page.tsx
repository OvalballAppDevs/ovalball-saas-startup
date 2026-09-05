import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { CsvUploadForm } from "@/components/fixtures/csv-upload-form"

import { createClubImportBatch, requireClubImportAccess } from "./actions"

/**
 * Club-scoped fixture import -- the SAME staged Upload -> Parse ->
 * Validate -> Resolve -> Review -> Authorise -> Commit workflow as Site
 * Admin's global import (app/(app)/admin/fixtures/import), restricted to
 * the active club's own teams as the home side. Gated by
 * requireClubImportAccess() here (a friendly redirect) and, for real, by
 * RLS (internal.can_manage_club_fixtures) on every write underneath.
 */
export default async function ClubImportFixturesPage() {
  await requireClubImportAccess()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/fixtures" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Fixtures
      </Link>

      <h1 className="mt-4 font-display text-display-l text-ink">Import fixtures</h1>
      <p className="mt-2 text-sm text-ink/55">
        Nothing is published to your club&apos;s calendar until you review and approve it. Every row is validated and
        matched against canonical club/team records first.
      </p>

      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm font-medium text-ink">How this works</p>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm text-ink/60">
          <li>1. Upload a CSV using the template below.</li>
          <li>2. Each row is matched against canonical clubs/teams &mdash; ambiguous or missing matches are flagged for review, never guessed.</li>
          <li>3. Any row that would conflict with an existing fixture is shown side by side so you can decide what happens.</li>
          <li>4. Nothing changes on your Calendar until you explicitly publish.</li>
        </ol>
        <p className="mt-3 text-sm text-ink/60">
          Required columns: <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">home_club</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">home_team</code> &mdash; home_team must be one
          of your club&apos;s own active teams. Recommended:{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">away_club</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">away_team</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">fixture_date</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">kickoff_time</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">game_type</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">competition</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">venue</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">notes</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">source_reference</code>. game_type must be one
          of Friendly, League Fixture, Cup Fixture, or Scheduled Match.
        </p>
      </div>

      <div className="mt-6">
        <CsvUploadForm createBatch={createClubImportBatch} redirectBase="/fixtures/import" />
      </div>
    </div>
  )
}
