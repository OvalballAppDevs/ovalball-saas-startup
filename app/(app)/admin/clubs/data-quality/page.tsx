import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { getDataQualityCounts, getPendingResearchProposals } from "./query"
import { ProposalReviewCard } from "./proposal-review"
import { RunVerificationPanel } from "./run-verification-panel"
import { listVerificationRunHistoryAction } from "./verification-actions"

const TILES: { key: keyof Awaited<ReturnType<typeof getDataQualityCounts>>; label: string; tone?: "good" | "warn" | "bad" }[] = [
  { key: "total", label: "Total clubs" },
  { key: "verified", label: "Verified", tone: "good" },
  { key: "needsReview", label: "Needs Review", tone: "warn" },
  { key: "conflicting", label: "Conflicting Sources", tone: "bad" },
  { key: "missingAddress", label: "Missing Address" },
  { key: "missingTown", label: "Missing Town" },
  { key: "missingCounty", label: "Missing County/Region" },
  { key: "missingCountry", label: "Missing Country" },
  { key: "missingPostcode", label: "Missing Postcode/Eircode" },
  { key: "missingHomeGround", label: "Missing Home Ground" },
  { key: "missingConstituentBody", label: "Missing Constituent Body" },
  { key: "missingWebsite", label: "Missing Website" },
  { key: "missingLogo", label: "Missing Logo" },
  { key: "potentialDuplicates", label: "Potential Duplicates" },
]

const TONE_CLASS: Record<string, string> = {
  good: "text-forest-800",
  warn: "text-amber-700",
  bad: "text-destructive",
}

/**
 * Every count here is real, computed live against the canonical
 * club_directory/admin_club_overview -- never a hand-typed or cached
 * summary. Nothing here hides an incomplete record from the report
 * (Section V's own explicit requirement): a club with a missing field
 * shows up in every relevant tile until it's genuinely fixed, and this
 * page never claims completion it hasn't earned.
 */
export default async function ClubDirectoryDataQualityPage() {
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
  const ctx = activeSiteAdmin.ctx

  const canRunVerification = ctx.siteAdminRole === "full" || ctx.siteAdminRole === "club_data"

  const [counts, proposals, recentRuns] = await Promise.all([
    getDataQualityCounts(supabase),
    getPendingResearchProposals(supabase),
    listVerificationRunHistoryAction(),
  ])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/clubs" className="inline-flex items-center gap-1 text-sm text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400">
        <ChevronLeft className="size-4" />
        Club management
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Club Directory data quality</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/55">
            Exact counts against the canonical directory of {counts.total} clubs. Nothing here is estimated or rounded.
          </p>
        </div>
        {canRunVerification && <RunVerificationPanel activeFilterFlag={null} recentRuns={recentRuns} />}
      </div>
      {!canRunVerification && recentRuns.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Recent verification runs</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/8 bg-white px-3 py-2 text-xs">
                <span className="text-ink/70">
                  {r.scope} &middot; {new Date(r.startedAt).toLocaleString()}
                </span>
                <span className="text-ink/50">
                  {r.status} &middot; {r.processedRecords}/{r.totalRecords} checked
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {TILES.map((tile) => (
          <div key={tile.key} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
            <p className={`text-2xl font-semibold ${tile.tone ? TONE_CLASS[tile.tone] : "text-ink"}`}>{counts[tile.key]}</p>
            <p className="mt-0.5 text-xs text-ink/50">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">
          Research proposals awaiting review ({proposals.length})
        </p>
        <p className="mt-1 text-xs text-ink/45">
          Every proposal here is evidence to review, not an applied change -- accepting one updates the canonical
          directory, rejecting one changes nothing.
        </p>
        {proposals.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/50">
            No pending research proposals. Nothing has been staged yet.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {proposals.map((p) => (
              <ProposalReviewCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
