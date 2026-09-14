"use client"

import { ChevronRight, Pencil, Trophy } from "lucide-react"

import { useFixtureEditor } from "@/components/fixtures/fixture-editor-provider"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { RUGBY_CODE_LABEL, formatFixtureDate } from "./format"
import type { AdminFixtureRow } from "./types"

/**
 * Fixture Control Centre, phone width. Editing opens the same Edit Fixture
 * sheet the desktop table and Calendar open -- one editor, sized for touch --
 * never the desktop table squeezed onto a small screen. Result correction and
 * history live on fixture detail.
 */
export function MobileFixtureCard({ row, clubScoped = false }: { row: AdminFixtureRow; clubScoped?: boolean }) {
  const { openEditor } = useFixtureEditor()
  const handleOpen = () => openEditor(row.id)

  // A side is its team and club; a fixture recorded against a club alone is
  // named by the club (or what was written), never by an empty pair of brackets.
  const side = (team: string, club: string) => (team && club ? `${team} (${club})` : team || club || row.rawOppositionText || "Opposition")
  const homeSide = side(row.homeTeamName, row.homeClubName)
  const awaySide = side(row.awayTeamName, row.awayClubName)

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 bg-white p-4">
        <button type="button" onClick={handleOpen} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
          <p className="text-xs text-ink-muted">
            {/* The rugby code belongs to a surface that spans codes. On a
                club's own phone it is the same word on every card, spending
                the narrowest line in the product to say nothing. */}
            {formatFixtureDate(row.kickoffDate)}
            {row.kickoffTime && ` · ${row.kickoffTime.slice(0, 5)}`}
            {!clubScoped && <> &middot; {RUGBY_CODE_LABEL[row.rugbyCode] ?? row.rugbyCode}</>}
          </p>
          <p className="mt-0.5 font-medium text-ink">
            {homeSide} vs {awaySide}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${FIXTURE_STATUS_BADGE_CLASS[row.status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/8 text-ink-muted"}`}>{row.status}</span>
            {row.gameType && <span className="text-xs text-ink-muted">{row.gameType}</span>}
            {row.homeScore !== null && row.awayScore !== null && (
              <span className="text-xs font-medium text-ink/60">
                {row.homeScore}&ndash;{row.awayScore}
              </span>
            )}
            {row.pitchAllocation && <span className="text-xs text-ink-muted">{row.pitchAllocation}</span>}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleOpen}
            aria-label={`Edit ${homeSide} vs ${awaySide}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-ink/15 text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Pencil className="size-4" />
          </button>
          {/* The SAME row.id on the one shared Match Centre -- 44px, because
              this is a phone and it sits beside two other icon targets. */}
          <a
            href={`/fixtures/${row.id}`}
            aria-label={`Open Match Centre for ${homeSide} versus ${awaySide}`}
            className="inline-flex size-11 items-center justify-center rounded-lg border border-ink/15 text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Trophy className="size-4" />
          </a>
          <a
            href={`/admin/fixtures/${row.id}`}
            aria-label="Open full details"
            className="inline-flex size-11 items-center justify-center rounded-lg text-ink-muted outline-none hover:text-ink/60 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronRight className="size-4" />
          </a>
        </div>
      </div>

    </>
  )
}
