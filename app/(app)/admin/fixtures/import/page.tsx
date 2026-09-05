import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"
import { CsvUploadForm } from "@/components/fixtures/csv-upload-form"

import { createImportBatch } from "./actions"

export default async function ImportFixturesPage() {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/fixtures" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Fixture management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <h1 className="mt-3 font-display text-display-l text-ink">Import fixtures</h1>
      <p className="mt-2 text-sm text-ink/55">
        Nothing is published to live fixtures until you review and approve it. Every row is validated and matched
        against canonical club/team records first.
      </p>

      <div className="mt-8 rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm font-medium text-ink">How this works</p>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm text-ink/60">
          <li>1. Upload a CSV using the template below.</li>
          <li>2. Each row is matched against canonical clubs/teams &mdash; ambiguous or missing matches are flagged for review, never guessed.</li>
          <li>3. Any row that would conflict with an existing fixture is shown side by side so you can decide what happens.</li>
          <li>4. Nothing changes in Fixture Management until you explicitly publish.</li>
        </ol>
        <p className="mt-3 text-sm text-ink/60">
          Required columns: <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">home_club</code>,{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 text-xs">home_team</code>. Recommended:{" "}
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
        <CsvUploadForm createBatch={createImportBatch} redirectBase="/admin/fixtures/import" />
      </div>
    </div>
  )
}
