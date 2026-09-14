"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight, Copy, MoreHorizontal, Pencil, Trophy } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { useFixtureEditor } from "@/components/fixtures/fixture-editor-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HomeAwayBadge } from "./home-away-badge"
import { PlannerCell, PlannerRowSelect } from "./planner-cell"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { duplicateFixture } from "./planner-actions"
import { RESULT_STATUS_LABEL, RUGBY_CODE_LABEL, SOURCE_LABEL } from "./format"
import type { AdminFixtureRow } from "./types"

/**
 * One fixture row of the Fixture Control Centre table. Editing opens the one
 * Edit Fixture sheet (components/fixtures/fixture-editor-sheet.tsx) -- the same
 * editor Calendar and fixture detail open -- rather than a row-local editor
 * with its own idea of which fields may change. Result correction lives on
 * fixture detail with the rest of the result history.
 */
export function FixtureTableRow({
  row,
  clubScoped = false,
  grouped = false,
}: {
  row: AdminFixtureRow
  /**
   * A club's own Control Centre. Drops the columns that only mean something
   * across clubs and codes -- Code, Meet, Source, and the club name repeated
   * under our own teams. Site Admin, which genuinely spans all of those,
   * passes false and keeps them.
   */
  clubScoped?: boolean
  /** Inside a match-day group the year is already stated overhead. */
  grouped?: boolean
}) {
  const router = useRouter()
  // One fixture detail surface for both scopes: /admin/fixtures/[id] already
  // admits any club involved in the fixture, so a Fixture Secretary reaches
  // the same record a Site Admin does rather than a parallel club copy.
  const detailHref = `/admin/fixtures/${row.id}`
  const { openEditor } = useFixtureEditor()
  const [duplicating, setDuplicating] = useState(false)

  /**
   * Duplicates to the next week this team is actually free, then lets the
   * date be corrected in place -- which the planner now supports. Asking
   * "which date?" in a modal only to refuse the obvious answer would be
   * worse than offering one that works.
   */
  const [duplicateError, setDuplicateError] = useState<string | null>(null)

  async function handleDuplicate() {
    setDuplicating(true)
    setDuplicateError(null)
    const result = await duplicateFixture(row.id)
    setDuplicating(false)
    if (!result.ok) setDuplicateError(result.error)
    else router.refresh()
  }

  const isHome = row.homeAway !== "Away"
  const opponentClubResolved = isHome ? row.awayClubResolved : row.homeClubResolved
  const opponentClubName = isHome ? row.awayClubName : row.homeClubName
  const opponentTeamName = isHome ? row.awayTeamName : row.homeTeamName
  const plannerLabel = `${row.owningTeamName} v ${opponentClubName || row.rawOppositionText}`
  const opponentClubLogoUrl = isHome ? row.awayClubLogoUrl : row.homeClubLogoUrl
  const owningClubLogoUrl = isHome ? row.homeClubLogoUrl : row.awayClubLogoUrl

  return (
    <>
      {/* THE ROW OPENS THE FIXTURE.
          Hunting for a "View >" at the far right of a wide table is work
          the row itself can absorb. The guard matters more than the
          convenience: a click that began on a checkbox, an editable cell,
          the actions menu or any other control is that control's click and
          must never also navigate. Keyboard and screen-reader users get a
          real link on the opposition name rather than this handler. */}
      <tr
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [role='menu'], [role='menuitem']")) return
          router.push(detailHref)
        }}
        className="cursor-pointer border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]"
      >
        <td className="px-2 py-3">
          <PlannerRowSelect fixtureId={row.id} label={plannerLabel} />
        </td>
        {/* WHEN -- ONE COLUMN, NOT TWO.
            A date and a kick-off are one answer to one question, and giving
            each its own primary column spent a fifth of the table's width
            saying it twice. The date leads; the kick-off sits under it in
            secondary type. Both remain individually editable in place. */}
        <td className="px-2 py-1.5 whitespace-nowrap">
          <PlannerCell
            fixtureId={row.id}
            field="kickoffDate"
            type="date"
            savedValue={row.kickoffDate}
            label={`Date, ${plannerLabel}`}
            dateStyle={grouped ? "short" : "medium"}
          />
          <PlannerCell
            fixtureId={row.id}
            field="kickoffTime"
            type="time"
            savedValue={row.kickoffTime}
            label={`Kick off time, ${plannerLabel}`}
            tone="secondary"
          />
        </td>
        {/* CODE, MEET AND SOURCE ARE NOT EVERYDAY CLUB INFORMATION.
            A Union club does not need to be told "Union" on every row of its
            own fixture list; meet time is secondary detail that belongs with
            the fixture, not in prime horizontal space; and source is
            provenance for an administrator, not a question a fixture
            secretary asks on a Tuesday. All three stay fully available in
            fixture detail and in the row editor below, and Site Admin --
            which genuinely spans codes and import sources -- keeps them. */}
        {!clubScoped && <td className="px-3 py-1.5 text-ink/60">{RUGBY_CODE_LABEL[row.rugbyCode] ?? row.rugbyCode}</td>}
        {!clubScoped && (
          <td className="px-2 py-1.5">
            <PlannerCell fixtureId={row.id} field="meetTime" type="time" savedValue={row.meetTime} label={`Meet time, ${plannerLabel}`} />
          </td>
        )}

        {/* OUR TEAM -- the fixture's owning side, which is what the database
            actually models (owning_team_id + home_away; home_team_id and
            away_team_id are generated FROM those two). Showing Home and Away
            as two columns made a secretary read both to find their own side
            on every row, and put the answer in a different column depending
            on where the match was played. */}
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-2.5">
            <ClubAvatar logoUrl={owningClubLogoUrl} name={row.owningClubName} size="xs" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{row.owningTeamName}</p>
              {/* The club name under every one of our own teams, on a page
                  that is already scoped to that club, is the same word
                  repeated down the screen. Site Admin genuinely spans clubs
                  and keeps it. */}
              {!clubScoped && <p className="truncate text-xs text-ink-muted">{row.owningClubName}</p>}
            </div>
          </div>
        </td>

        {/* HOME / AWAY -- always a word, never colour alone. */}
        <td className="px-3 py-1.5">
          <HomeAwayBadge value={row.homeAway} />
        </td>

        {/* OPPOSITION -- one column whichever side they played on. An
            opponent who is not an Ovalball tenant is named from the Club
            Directory or from the fixture's own opposition text; it is a
            legitimate fixture, not an error, so it is not dressed as one. */}
        <td className="px-3 py-1.5">
          {opponentClubResolved ? (
            <div className="flex items-center gap-2.5">
              <ClubAvatar logoUrl={opponentClubLogoUrl} name={opponentClubName} size="xs" />
              <div className="min-w-0">
                <Link
                  href={detailHref}
                  className="block truncate font-medium text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {opponentClubName}
                  <span className="sr-only"> — open this fixture</span>
                </Link>
                {opponentTeamName && <p className="truncate text-xs text-ink-muted">{opponentTeamName}</p>}
              </div>
            </div>
          ) : (
            /* The opponent's NAME is the information. Where they are
               recorded is provenance, and a full second line shouting
               "Not on Ovalball" under every external club made the
               provenance louder than the club. It is now a quiet mark
               beside the name, with the full phrase available to a screen
               reader and on hover. */
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                href={detailHref}
                className="truncate text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {opponentClubName || row.rawOppositionText}
                <span className="sr-only"> — open this fixture</span>
              </Link>
              <span
                title="Not on Ovalball"
                className="shrink-0 rounded border border-ink/15 px-1 text-[10px] leading-4 text-ink-subtle"
              >
                EXT
                <span className="sr-only"> — this club is not on Ovalball</span>
              </span>
            </div>
          )}
        </td>
        <td className="px-3 py-1.5 text-ink/60">
          {row.pitchName || row.pitchAllocation ? (
            <>
              <p className="text-ink">{row.pitchName ?? row.pitchAllocation}</p>
              {row.venueName && <p className="text-xs text-ink-muted">{row.venueName}</p>}
            </>
          ) : row.venueName ? (
            <p className="text-ink">{row.venueName}</p>
          ) : (
            <span className="text-ink-muted">&mdash;</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-ink/60">
          {row.homeScore !== null && row.awayScore !== null ? (
            <>
              <span className="font-medium text-ink">
                {row.homeScore}&ndash;{row.awayScore}
              </span>
              {row.resultStatus !== "final" && row.resultStatus !== "external_recorded" && (
                <span className="ml-1.5 text-xs text-ink-muted">({RESULT_STATUS_LABEL[row.resultStatus] ?? row.resultStatus})</span>
              )}
            </>
          ) : (
            <span className="text-ink-muted">&mdash;</span>
          )}
        </td>
        <td className="px-3 py-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${FIXTURE_STATUS_BADGE_CLASS[row.status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/8 text-ink-muted"}`}>{row.status}</span>
        </td>
        {!clubScoped && <td className="px-3 py-1.5 text-ink-muted">{SOURCE_LABEL[row.source] ?? row.source}</td>}
        {/* ONE CONTROL, NOT FOUR.
            Duplicate / Edit / Match Centre / View rendered side by side on
            every row cost more horizontal space than the opposition column
            and repeated twenty-four words down a screen whose subject is
            fixtures. They are the same four actions, in a menu, with the
            row itself opening the fixture. */}
        <td className="px-2 py-1.5 text-right">
          <div className="flex items-center justify-end gap-1">
            {duplicateError && (
              <span role="alert" className="text-xs text-destructive-text">
                {duplicateError}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Actions for ${plannerLabel}`}
                    className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLinkItem href={`/fixtures/${row.id}`}>
                  <Trophy className="size-4" aria-hidden="true" />
                  Open Match Centre
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem href={detailHref}>
                  <ChevronRight className="size-4" aria-hidden="true" />
                  View Fixture
                </DropdownMenuLinkItem>
                <DropdownMenuItem onClick={() => openEditor(row.id)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit Fixture
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
                  <Copy className="size-4" aria-hidden="true" />
                  {duplicating ? "Duplicating…" : "Duplicate"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>

    </>
  )
}
