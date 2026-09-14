import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"

import { requireClubImportAccess } from "./actions"
import { ImportWizard } from "./import-wizard"

export const metadata = { title: "Import Fixtures" }

const STATE_WORD: Record<string, string> = {
  uploaded: "Staged",
  processing: "Processing",
  needs_review: "Needs review",
  ready_to_publish: "Ready to publish",
  publishing: "Publishing",
  completed: "Published",
  completed_with_exclusions: "Published with exclusions",
  failed: "Failed",
}

/**
 * IMPORT FIXTURES -- A DIFFERENT JOB FROM PLANNING A SEASON.
 *
 * The Season Planner is a grid somebody types a season into. Importing brings
 * a file somebody else made, so it goes Upload or Paste, Map (what each
 * column means), Preview, Validate, then Stage and Publish on the batch page.
 * Both front doors produce the same draft rows and use the same validation,
 * staging and publishing -- including asking every Ovalball opponent.
 *
 * Club fixture administrators only: requireClubImportAccess checks the active
 * club, fixture.import and bulk planning authority, and staging RLS enforces
 * the same rule again.
 */
export default async function ImportFixturesPage() {
  const clubId = await requireClubImportAccess()
  const supabase = await createClient()
  const [{ data: club }, { data: batches }] = await Promise.all([
    supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle(),
    supabase.from("fixture_import_batches").select("id, filename, row_count, state, created_at").eq("club_id", clubId).order("created_at", { ascending: false }).limit(5),
  ])

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/fixtures/management"
            className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="sr-only">Back to the Fixture Control Centre</span>
          </Link>
          <h1 className="font-display text-3xl text-ink">Import Fixtures</h1>
          <p className="hidden truncate text-sm text-ink-muted sm:block">{club?.club_directory?.name}</p>
        </div>
        <Link href="/fixtures/planner" className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          Typing a season in yourself? Plan Season
        </Link>
      </div>

      <div className="mt-5">
        <ImportWizard />
      </div>

      {batches && batches.length > 0 && (
        <section className="mt-10" aria-labelledby="recent-imports">
          <h2 id="recent-imports" className="text-sm font-semibold text-ink">
            Recent Imports
          </h2>
          <ul className="mt-2 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/fixtures/import/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-ink/[0.02]">
                  <span className="min-w-0 truncate text-ink">{b.filename}</span>
                  <span className="shrink-0 text-ink-muted tabular-nums">
                    {b.row_count} rows, {STATE_WORD[b.state] ?? b.state}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
