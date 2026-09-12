import Link from "next/link"
import { AlertTriangle, CalendarClock, ClipboardList, ShieldCheck, Table2, Upload } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { ExportClubFixturesButton } from "../../fixtures/export-button"
import { Pagination } from "../pagination"
import { AddFixtureDialog } from "./add-fixture-dialog"
import { ExportFixturesButton } from "./export-button"
import { FixtureFilters } from "./fixture-filters"
import { FixtureTableRow } from "./fixture-table-row"
import { MobileFixtureCard } from "./mobile-fixture-card"
import { PlannerStateProvider } from "./planner-state"
import { PlannerToolbar } from "./planner-toolbar"
import { attachClubLogos, attachGroupLabels, attachTeamAliases, buildAdminFixtureQuery, countFixtureAttention, mapAdminFixtureRow, type FixtureAttentionCounts } from "./query"
import { parseAdminFixtureQuery, type AdminFixtureQuery } from "./types"

export interface FixtureManagementScope {
  /** Present for a club-scoped surface -- filters to fixtures where this club is genuinely involved (owning or opponent side), server-side, via buildAdminFixtureQuery's existing clubId parameter. Absent for the global Site Admin surface. */
  clubId?: string
  clubName?: string
  eyebrow: string
  importHref: string
  /** Present only where a Mass Fixture Planner exists -- i.e. a club-scoped surface. Site Admin plans nothing; it administers what clubs have planned. */
  plannerHref?: string
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

  // THE FOUR OPTION LOOKUPS RUN TOGETHER, NOT IN A QUEUE.
  //
  // Competition options, seasons, the club's teams and the rugby-code check
  // are completely independent of one another, and each was awaited in turn
  // -- four sequential round trips before the page could render, on top of
  // the row enrichment that genuinely has to be ordered. They are issued as
  // one batch now; the slowest decides the wait instead of the sum.
  //
  // COMPETITION OPTIONS COME FROM A BOUNDED VIEW. This used to select
  // competition_edition_id from public.fixtures with no bound and
  // de-duplicate in Node -- O(every fixture) on every load of an otherwise
  // paginated screen, and for Site Admin not even club-scoped. The view does
  // the distinct in the database and returns one row per edition actually in
  // use; security_invoker keeps it to editions on fixtures the caller may
  // already read.
  let editionQuery = supabase
    .from("fixture_competition_edition_usage")
    .select("competition_edition_id, competition_name, season_name, club_ids")
  if (scope.clubId) editionQuery = editionQuery.contains("club_ids", [scope.clubId])

  const [editionResult, seasonResult, teamResult, codeResult, attention] = await Promise.all([
    editionQuery,
    // Only the seasons a fixture could actually be recorded against.
    supabase.from("seasons").select("id, name, is_regression_fixture").order("starts_on", { ascending: false }),
    // Club-scoped only: "which of our teams" is not a question the global
    // Site Admin view can ask, and listing every team on the platform would
    // be exactly the unbounded read this pass removed elsewhere.
    scope.clubId
      ? supabase.from("teams").select("id, display_name").eq("club_id", scope.clubId).eq("active", true).order("display_name")
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    scope.clubId
      ? supabase.from("teams").select("rugby_code").eq("club_id", scope.clubId).eq("active", true)
      : Promise.resolve({ data: null as { rugby_code: string }[] | null }),
    countFixtureAttention(supabase, query, scope.clubId),
  ])

  const competitionOptions = (editionResult.data ?? [])
    .map((r) => ({
      id: r.competition_edition_id ?? "",
      label: [r.competition_name, r.season_name].filter(Boolean).join(" \u00b7 "),
    }))
    .filter((c) => c.id && c.label)
    .sort((a, b) => a.label.localeCompare(b.label))

  const seasonOptions = (seasonResult.data ?? [])
    // Regression-fixture seasons exist for the test suite, not for a fixture
    // secretary choosing which season to look at.
    .filter((s) => !s.is_regression_fixture)
    .map((s) => ({ id: s.id, label: s.name }))

  const teamOptions = (teamResult.data ?? []).map((t) => ({ id: t.id, label: t.display_name }))

  // Live request: a club-scoped surface fielding only one rugby code has no
  // use for a "Union + League" choice -- Site Admin's own global view
  // (scope.clubId absent) genuinely spans both, so it always keeps it.
  // A club's own Control Centre drops the columns that only mean something
  // across clubs and codes. Site Admin keeps every one of them.
  const clubScoped = Boolean(scope.clubId)
  // select + when + team + H/A + opposition + venue + result + status + actions,
  // plus code/meet/source only where they are shown.
  const columnCount = 9 + (clubScoped ? 0 : 3)

  const showCodeFilter = scope.clubId
    ? new Set((codeResult.data ?? []).map((r) => r.rugby_code)).size > 1
    : true

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{scope.eyebrow}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Fixture Control Centre</h1>
          <p className="mt-2 max-w-lg text-sm text-ink-muted">
            {scope.clubId
              ? `Everything ${scope.clubName ?? "your club"} has arranged, and everything still to sort out. Change a kick-off, move a venue, record a result, or plan a whole season at once.`
              : "Every fixture on the platform, and everything still to sort out — kick-offs, venues, results and staged imports across all clubs."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {headerExtra}
          {scope.clubId ? <ExportClubFixturesButton /> : <ExportFixturesButton query={query} />}
          {/* IMPORT FIXTURES IS THE PLANNER.
              A club labelled control that says "Import" must land on the
              grid, not on a separate upload page -- the file goes into the
              same cells a paste does. Site Admin keeps its own global
              staging surface, which genuinely spans clubs. */}
          <Link
            href={scope.plannerHref ?? scope.importHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Upload className="size-4" />
            Import Fixtures
          </Link>
          <AddFixtureDialog lockedClubId={scope.clubId} lockedClubName={scope.clubName} />
          {/* THE MASS CASE IS THE PRIMARY ACTION. Arranging one fixture is
              the exception; a season arrives in a block, and burying that
              behind an "import" link was the single clearest sign this
              screen was built as an administrative table rather than as
              the place a fixture secretary does their work. */}
          {scope.plannerHref && (
            <Link
              href={scope.plannerHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-forest-800 px-4 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2"
            >
              <Table2 className="size-4" aria-hidden="true" />
              Plan Fixtures
            </Link>
          )}
        </div>
      </div>

      <AttentionBand counts={attention} basePath={scope.basePath} />

      <div className="mt-5">
        <FixtureFilters
          query={query}
          competitionOptions={competitionOptions}
          basePath={scope.basePath}
          showCodeFilter={showCodeFilter}
          seasonOptions={seasonOptions}
          teamOptions={teamOptions}
        />
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
          Couldn&apos;t load fixtures right now. Please try again.
        </p>
      )}

      <PlannerStateProvider>
      <PlannerToolbar rowLabels={Object.fromEntries(rows.map((r) => [r.id, `${r.owningTeamName} v ${r.opponentClubName ?? r.rawOppositionText}`]))} />

      <p className="mt-4 text-sm text-ink-muted">
        {total.toLocaleString()} fixture{total === 1 ? "" : "s"} match{total === 1 ? "es" : ""}
      </p>

      {/* `relative` is load-bearing. The table's sr-only spans are
          position:absolute, and without a positioned ancestor here their
          containing block resolves OUTSIDE this scroll container -- so at
          tablet width an invisible screen-reader label sat ~600px to the
          right and made the whole page scroll sideways, even though the
          table itself was scrolling correctly inside its own box. */}
      <div className="relative mt-3 hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">Select fixture</span>
              </th>
              {/* ONE "WHEN" COLUMN. Date leads, kick-off sits beneath it. */}
              <th scope="col" className="px-2 py-2">
                Date
              </th>
              {!clubScoped && (
                <th scope="col" className="px-3 py-2">
                  Code
                </th>
              )}
              {!clubScoped && (
                <th scope="col" className="px-2 py-2">
                  Meet
                </th>
              )}
              {/* The owning side, named for who is reading. A club-scoped
                  secretary is looking at their own teams; Site Admin is
                  looking at whichever club owns the fixture. */}
              <th scope="col" className="px-3 py-2">
                {clubScoped ? "Our Team" : "Owning Team"}
              </th>
              <th scope="col" className="px-3 py-2">
                H/A
              </th>
              <th scope="col" className="px-3 py-2">
                Opposition
              </th>
              <th scope="col" className="px-3 py-2">
                Venue
              </th>
              <th scope="col" className="px-3 py-2">
                Result
              </th>
              <th scope="col" className="px-3 py-2">
                Status
              </th>
              {!clubScoped && (
                <th scope="col" className="px-3 py-2">
                  Source
                </th>
              )}
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* NO MATCH-DAY HEADING ROW.
                Grouping by date and ALSO printing the date in every row
                inside the group said the same thing twice and spent a whole
                table row on each Saturday. The combined Date cell already
                carries the day and the kick-off together, the default sort
                is by date, so the season still reads in order -- with one
                fewer row per match day and nothing repeated. */}
            {rows.map((row) => (
              <FixtureTableRow
                key={row.id}
                row={row}
                clubScoped={clubScoped}
                columnCount={columnCount}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <EmptyState query={query} scope={scope} />}
      </div>

      <ul className="mt-3 flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <MobileFixtureCard row={row} clubScoped={clubScoped} />
          </li>
        ))}
        {rows.length === 0 && !error && (
          <li className="rounded-lg border border-dashed border-ink/15 bg-white/60">
            <EmptyState query={query} scope={scope} />
          </li>
        )}
      </ul>

      <div className="mt-6">
        <Pagination query={query} totalPages={totalPages} total={total} basePath={scope.basePath} />
      </div>
      </PlannerStateProvider>
    </div>
  )
}

/**
 * The three questions that bring somebody to this screen, answered before
 * they touch a filter -- and each one a way into the fixtures it counts.
 *
 * A count that is not a link is a fact a person then has to go and find.
 * A count of zero is still shown, quietly, because "nothing needs
 * attention" is genuinely reassuring and a band that appears and vanishes
 * is a band nobody trusts.
 */
function AttentionBand({ counts, basePath }: { counts: FixtureAttentionCounts; basePath: string }) {
  const items = [
    {
      key: "soon",
      icon: CalendarClock,
      value: counts.soon,
      label: "in the next 7 days",
      href: `${basePath}?date=upcoming&sort=date-asc`,
      tone: "text-forest-800",
    },
    {
      key: "incomplete",
      icon: AlertTriangle,
      value: counts.incomplete,
      label: "still missing a kick-off or a date",
      href: `${basePath}?date=upcoming&status=To Be Determined`,
      tone: counts.incomplete > 0 ? "text-amber-900" : "text-ink-muted",
    },
    {
      key: "results",
      icon: ClipboardList,
      value: counts.resultsOutstanding,
      label: "played, with no result recorded",
      href: `${basePath}?date=past&resultStatus=none&sort=date-desc`,
      tone: counts.resultsOutstanding > 0 ? "text-amber-900" : "text-ink-muted",
    },
  ]

  return (
    <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
      {items.map(({ key, icon: Icon, value, label, href, tone }) => (
        <Link
          key={key}
          href={href}
          className="flex items-center gap-3 rounded-xl border border-ink/12 bg-white px-4 py-3 outline-none hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <Icon className={`size-5 shrink-0 ${tone}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className={`block font-display text-2xl tabular-nums ${tone}`}>{value.toLocaleString()}</span>
            <span className="block text-xs text-ink-muted">{label}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

/**
 * NOTHING HERE IS NOT THE SAME AS NOTHING TO DO.
 *
 * "No fixtures match these filters" told a club with an empty season
 * exactly as much as it told somebody who had typed a bad search -- which
 * is nothing either of them could act on. These are different situations
 * and they get different words, and the genuinely empty one gets the way
 * in rather than a shrug.
 */
function EmptyState({ query, scope }: { query: AdminFixtureQuery; scope: FixtureManagementScope }) {
  const filtered =
    query.q.length > 0 ||
    query.status !== "all" ||
    query.code !== "all" ||
    query.source !== "all" ||
    query.resultStatus !== "all" ||
    Boolean(query.competitionEditionId) ||
    Boolean(query.teamId) ||
    query.homeAway !== "all"

  if (filtered) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-ink">No fixtures match what you are looking for.</p>
        <p className="mt-1 text-sm text-ink-muted">Clear a filter or widen the dates to see more.</p>
        <Link
          href={scope.basePath}
          className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Clear Filters
        </Link>
      </div>
    )
  }

  return (
    <div className="px-5 py-12 text-center">
      <p className="font-display text-xl text-ink">
        {query.date === "upcoming" ? "No fixtures coming up" : "No fixtures yet"}
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">
        {scope.plannerHref
          ? "A season usually arrives in a block — from a league, or from your own spreadsheet. Put the whole thing in at once, or arrange a single match."
          : "Nothing has been arranged for this scope yet."}
      </p>
      {scope.plannerHref && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href={scope.plannerHref}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-forest-800 px-4 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2"
          >
            <Table2 className="size-4" aria-hidden="true" />
            Plan a Season
          </Link>
          {query.date === "upcoming" && (
            <Link
              href={`${scope.basePath}?date=all`}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Show Past Fixtures
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
