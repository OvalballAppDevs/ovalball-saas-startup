import Link from "next/link"
import { ShieldCheck, Upload } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { ExportClubFixturesButton } from "../../fixtures/export-button"
import { Pagination } from "../pagination"
import { AddFixtureDialog } from "./add-fixture-dialog"
import { ExportFixturesButton } from "./export-button"
import { FixtureFilters } from "./fixture-filters"
import { FixtureTableRow } from "./fixture-table-row"
import { MobileFixtureCard } from "./mobile-fixture-card"
import { attachClubLogos, attachGroupLabels, attachTeamAliases, buildAdminFixtureQuery, mapAdminFixtureRow } from "./query"
import { parseAdminFixtureQuery, type AdminFixtureQuery } from "./types"

export interface FixtureManagementScope {
  /** Present for a club-scoped surface -- filters to fixtures where this club is genuinely involved (owning or opponent side), server-side, via buildAdminFixtureQuery's existing clubId parameter. Absent for the global Site Admin surface. */
  clubId?: string
  clubName?: string
  eyebrow: string
  importHref: string
  basePath: string
}

/**
 * Section 25: the SAME Fixture Management surface for Site Admin and
 * Club Admin/Fixtures Secretary -- one component, scope/capabilities/actor
 * context control the differences (Section 14: "Do NOT build another
 * independent fixture-management implementation"). Site Admin's own
 * /admin/fixtures/page.tsx and the club-scoped page both call this with a
 * different `scope`, never a copy-pasted table/form.
 */
export async function FixtureManagementView({
  supabase,
  searchParams,
  scope,
  headerExtra,
}: {
  supabase: SupabaseClient<Database>
  searchParams: Record<string, string | string[] | undefined>
  scope: FixtureManagementScope
  /** Section 21: a "View Fixture Requests" control, rendered by the caller so it can wire in the actor's own request data without this shared view needing to know about it. */
  headerExtra?: React.ReactNode
}) {
  const query: AdminFixtureQuery = parseAdminFixtureQuery(searchParams)
  const from = (query.page - 1) * query.size
  const to = from + query.size - 1

  const { data, count, error } = await buildAdminFixtureQuery(supabase, query, scope.clubId).range(from, to)
  // Group labels resolve LAST so a Mini-Rugby Group's real display identity
  // always wins over a plain team alias on the same anchor team id -- the
  // same precedence Calendar and Pitch Allocation already use.
  const rows = await attachGroupLabels(supabase, await attachTeamAliases(supabase, await attachClubLogos(supabase, (data ?? []).map(mapAdminFixtureRow))))
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / query.size))

  const { data: usedEditionIdRows } = await supabase.from("fixtures").select("competition_edition_id").not("competition_edition_id", "is", null)
  const usedEditionIds = [...new Set((usedEditionIdRows ?? []).map((r) => r.competition_edition_id).filter((id): id is string => Boolean(id)))]
  const { data: editionRows } =
    usedEditionIds.length > 0
      ? await supabase.from("competition_editions").select("id, competitions(name), seasons(name)").in("id", usedEditionIds)
      : { data: [] as { id: string; competitions: { name: string } | null; seasons: { name: string } | null }[] }
  const competitionOptions = (editionRows ?? [])
    .map((r) => ({ id: r.id, label: [r.competitions?.name, r.seasons?.name].filter(Boolean).join(" · ") }))
    .filter((c) => c.label)
    .sort((a, b) => a.label.localeCompare(b.label))

  // Live request: a club-scoped surface fielding only one rugby code has no
  // use for a "Union + League" choice -- Site Admin's own global view
  // (scope.clubId absent) genuinely spans both, so it always keeps it.
  let showCodeFilter = true
  if (scope.clubId) {
    const { data: codeRows } = await supabase.from("teams").select("rugby_code").eq("club_id", scope.clubId).eq("active", true)
    const distinctCodes = new Set((codeRows ?? []).map((r) => r.rugby_code))
    showCodeFilter = distinctCodes.size > 1
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{scope.eyebrow}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Fixture management</h1>
          <p className="mt-2 max-w-lg text-sm text-ink/55">
            {scope.clubId
              ? `Search, review, and maintain ${scope.clubName ?? "your club"}'s fixtures directly, including tournaments and a staged CSV import workflow.`
              : "Search, review, and maintain every fixture directly — including a staged CSV import workflow for competition-published dates."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {headerExtra}
          {scope.clubId ? <ExportClubFixturesButton /> : <ExportFixturesButton query={query} />}
          <Link
            href={scope.importHref}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Upload className="size-4" />
            Import fixtures
          </Link>
          <AddFixtureDialog lockedClubId={scope.clubId} lockedClubName={scope.clubName} />
        </div>
      </div>

      <div className="mt-6">
        <FixtureFilters query={query} competitionOptions={competitionOptions} basePath={scope.basePath} showCodeFilter={showCodeFilter} />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load fixtures right now. Please try again.
        </p>
      )}

      <p className="mt-4 text-sm text-ink/45">
        {total.toLocaleString()} fixture{total === 1 ? "" : "s"} match{total === 1 ? "es" : ""}
      </p>

      <div className="mt-3 hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
              <th scope="col" className="px-4 py-3">
                Date
              </th>
              <th scope="col" className="px-4 py-3">
                Kick Off Time
              </th>
              <th scope="col" className="px-4 py-3">
                Code
              </th>
              <th scope="col" className="px-4 py-3">
                Home
              </th>
              <th scope="col" className="px-4 py-3">
                Away
              </th>
              <th scope="col" className="px-4 py-3">
                Pitch
              </th>
              <th scope="col" className="px-4 py-3">
                Result
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                Source
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FixtureTableRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <div className="px-4 py-10 text-center text-sm text-ink/50">No fixtures match these filters.</div>}
      </div>

      <ul className="mt-3 flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <MobileFixtureCard row={row} />
          </li>
        ))}
        {rows.length === 0 && !error && (
          <li className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center text-sm text-ink/50">
            No fixtures match these filters.
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Pagination query={query} totalPages={totalPages} total={total} basePath={scope.basePath} />
      </div>
    </div>
  )
}
