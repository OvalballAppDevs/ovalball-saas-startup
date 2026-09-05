import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AddClubDialog } from "./add-club-dialog"
import { ClubCrest } from "./club-crest"
import { ClubFilters } from "./club-filters"
import { ExportButton } from "./export-button"
import { getClubDirectoryGeocodingSummary } from "./geocoding-actions"
import { GeocodingPanel } from "./geocoding-panel"
import { Pagination } from "../pagination"
import { QualityBadges } from "./quality-badges"
import { QuickEditActiveToggle, QuickEditCell } from "./quick-edit-cell"
import { buildAdminClubQuery, mapAdminClubRow } from "./query"
import { parseAdminClubQuery } from "./types"

/**
 * Site Admin only -- club_directory/clubs RLS (is_site_admin() on both)
 * is the real boundary via admin_club_overview's security_invoker
 * inheritance; this redirect is the same UX courtesy /admin/claims
 * already uses, not the enforcement itself.
 */
export default async function AdminClubsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  const resolvedParams = await searchParams
  const query = parseAdminClubQuery(resolvedParams)
  const from = (query.page - 1) * query.size
  const to = from + query.size - 1

  const { data, count, error } = await buildAdminClubQuery(supabase, query).range(from, to)
  const rows = (data ?? []).map(mapAdminClubRow)
  const logoUrlByDirectoryId = new Map(
    rows
      .filter((r) => r.logoStoragePath)
      .map((r) => [
        r.directoryId,
        supabase.storage.from("club-logos").getPublicUrl(r.logoStoragePath as string).data.publicUrl,
      ])
  )
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / query.size))
  const geocodingSummary = await getClubDirectoryGeocodingSummary()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Club management</h1>
          <p className="mt-2 max-w-lg text-sm text-ink/55">
            Search, review and maintain every recognised club directly &mdash; no more round-tripping through SQL for
            routine changes.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/admin/clubs/data-quality"
            className="inline-flex h-9 items-center rounded-lg border border-ink/15 bg-white px-3.5 text-sm font-medium text-ink outline-none hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Data quality
          </Link>
          <ExportButton query={query} />
          <AddClubDialog />
        </div>
      </div>

      {geocodingSummary && <GeocodingPanel initialSummary={geocodingSummary} />}

      <div className="mt-6">
        <ClubFilters query={query} />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load clubs right now. Please try again.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/45">
          {total.toLocaleString()} club{total === 1 ? "" : "s"} match{total === 1 ? "es" : ""}
        </p>
        <p className="hidden text-xs text-ink/35 md:block">Click a highlighted field to quick-edit it directly.</p>
      </div>

      {/* Desktop table */}
      <div className="mt-3 hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
              <th scope="col" className="px-4 py-3">
                Club
              </th>
              <th scope="col" className="px-4 py-3">
                Code
              </th>
              <th scope="col" className="px-4 py-3">
                Town / County
              </th>
              <th scope="col" className="px-4 py-3">
                Postcode
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                Verification
              </th>
              <th scope="col" className="px-4 py-3">
                Updated
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.directoryId} className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <ClubCrest logoUrl={logoUrlByDirectoryId.get(row.directoryId) ?? null} name={row.name} />
                    <div className="min-w-0 flex-1">
                      <QuickEditCell directoryId={row.directoryId} field="name" value={row.name} />
                      <QualityBadges flags={row.flags} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/70">{row.rugbyCode === "union" ? "Union" : "League"}</td>
                <td className="px-4 py-3 text-ink/70">
                  <div className="flex flex-col gap-0.5">
                    <QuickEditCell directoryId={row.directoryId} field="town" value={row.town ?? ""} placeholder="No town" />
                    <QuickEditCell directoryId={row.directoryId} field="county" value={row.county ?? ""} placeholder="No county" />
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  <QuickEditCell directoryId={row.directoryId} field="postcode" value={row.postcode ?? ""} placeholder="No postcode" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <QuickEditActiveToggle directoryId={row.directoryId} active={row.directoryActive} />
                    <StatusPill isActivated={row.isActivated} directoryActive={row.directoryActive} />
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/60">{formatVerification(row.verificationStatus)}</td>
                <td className="px-4 py-3 text-ink/50">{formatDate(row.directoryUpdatedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/clubs/${row.directoryId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    View / Edit
                    <ChevronRight className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && (
          <div className="px-4 py-10 text-center text-sm text-ink/50">No clubs match these filters.</div>
        )}
      </div>

      {/* Mobile cards */}
      <ul className="mt-3 flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.directoryId}>
            <Link
              href={`/admin/clubs/${row.directoryId}`}
              className="flex items-start gap-3 rounded-lg border border-ink/10 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <ClubCrest logoUrl={logoUrlByDirectoryId.get(row.directoryId) ?? null} name={row.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink">{row.name}</p>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink/30" />
                </div>
                <p className="mt-0.5 text-sm text-ink/55">
                  {[row.town, row.county].filter(Boolean).join(", ") || "No location on file"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusPill isActivated={row.isActivated} directoryActive={row.directoryActive} />
                  <span className="text-xs text-ink/40">{row.rugbyCode === "union" ? "Union" : "League"}</span>
                </div>
                <QualityBadges flags={row.flags} />
              </div>
            </Link>
          </li>
        ))}
        {rows.length === 0 && !error && (
          <li className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center text-sm text-ink/50">
            No clubs match these filters.
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Pagination query={query} totalPages={totalPages} total={total} basePath="/admin/clubs" />
      </div>
    </div>
  )
}

function StatusPill({ isActivated, directoryActive }: { isActivated: boolean; directoryActive: boolean }) {
  if (!directoryActive) {
    return <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/50">Inactive</span>
  }
  return isActivated ? (
    <span className="rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">Activated</span>
  ) : (
    <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/60">Unclaimed</span>
  )
}

function formatVerification(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
