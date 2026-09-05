"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronRight, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

import { FixtureStatusControl } from "./[fixtureId]/fixture-status-control"
import { OpponentTeamEditor } from "./[fixtureId]/opponent-team-editor"
import { OwningTeamEditor } from "./[fixtureId]/owning-team-editor"
import { PitchInline } from "./[fixtureId]/pitch-inline"
import { resolveFixtureResultDisputeAction } from "./[fixtureId]/result-admin-actions"
import { getClubPitches, updateFixture, updateFixtureCompetition, type PitchOption, type TeamSearchResult } from "./actions"
import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"
import { RUGBY_CODE_LABEL, SOURCE_LABEL, formatFixtureDate } from "./format"
import type { AdminFixtureRow } from "./types"

/**
 * Site Admin Fixture Management, mobile (Reconciliation complaint 36 --
 * previously view-only, tap-through to the full detail page for any edit).
 * Reuses the exact same edit components/actions the desktop grid row uses
 * (FixtureStatusControl, PitchInline, the home/away team editors, result
 * correction) inside a bottom Sheet, sized for touch -- never the desktop
 * <table> squeezed onto a small screen.
 */
export function MobileFixtureCard({ row }: { row: AdminFixtureRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pitches, setPitches] = useState<PitchOption[]>([])
  const [competitions, setCompetitions] = useState<CompetitionEditionOption[]>([])
  const [loaded, setLoaded] = useState(false)

  const [date, setDate] = useState(row.kickoffDate)
  const [time, setTime] = useState(row.kickoffTime ?? "")
  const [competitionEditionId, setCompetitionEditionId] = useState<string | null>(null)
  const [dateSaving, setDateSaving] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)
  const dateDirty = date !== row.kickoffDate || time !== (row.kickoffTime ?? "")

  const [homeScore, setHomeScore] = useState(row.homeScore !== null ? String(row.homeScore) : "")
  const [awayScore, setAwayScore] = useState(row.awayScore !== null ? String(row.awayScore) : "")
  const [resultReason, setResultReason] = useState("")
  const [resultSaving, setResultSaving] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)

  const isHome = row.homeAway !== "Away"
  const homeClubIdForPitch = row.homeAway === "Away" ? null : row.owningClubId
  const isHomeFixtureForPitch = row.homeAway === "Home"

  const opponentTeamForEditor: TeamSearchResult | null =
    row.opponentTeamId && row.opponentTeamCategory
      ? {
          teamId: row.opponentTeamId,
          teamName: row.opponentTeamName ?? "",
          clubId: row.opponentClubId ?? "",
          clubName: row.opponentClubName ?? "",
          town: null,
          rugbyCode: row.opponentTeamRugbyCode ?? row.rugbyCode,
          category: row.opponentTeamCategory,
          ageGroup: row.opponentTeamAgeGroup,
          teamNumber: null,
          squadDesignation: row.opponentTeamSquadDesignation,
          gender: row.opponentTeamGender,
        }
      : null

  function handleOpen() {
    setOpen(true)
    if (!loaded) {
      setLoaded(true)
      Promise.all([homeClubIdForPitch ? getClubPitches(homeClubIdForPitch) : Promise.resolve([]), listCompetitionEditionsForRugbyCode(row.rugbyCode)]).then(([p, c]) => {
        setPitches(p)
        setCompetitions(c)
      })
    }
  }

  async function handleSaveDate() {
    setDateSaving(true)
    setDateError(null)
    const result = await updateFixture({
      fixtureId: row.id,
      homeAway: row.homeAway as "Home" | "Away" | "TBD" | "Not Applicable",
      rawOppositionText: row.rawOppositionText,
      kickoffDate: date,
      kickoffTime: time || null,
      gameType: row.gameType,
      status: row.status,
      venueId: null,
      notes: "",
    })
    setDateSaving(false)
    if (result.ok) router.refresh()
    else setDateError(result.error)
  }

  async function handleSaveCompetition() {
    setDateSaving(true)
    setDateError(null)
    const result = await updateFixtureCompetition(row.id, competitionEditionId)
    setDateSaving(false)
    if (result.ok) router.refresh()
    else setDateError(result.error)
  }

  async function handleSaveResult() {
    if (homeScore.trim() === "" || awayScore.trim() === "") {
      setResultError("Both scores are required.")
      return
    }
    if (!resultReason.trim()) {
      setResultError("A short reason is required for a Site Admin result correction.")
      return
    }
    setResultSaving(true)
    setResultError(null)
    const result = await resolveFixtureResultDisputeAction(row.id, Number(homeScore), Number(awayScore), resultReason.trim())
    setResultSaving(false)
    if (result.ok) {
      setResultReason("")
      router.refresh()
    } else {
      setResultError(result.error)
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 bg-white p-4">
        <button type="button" onClick={handleOpen} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
          <p className="text-xs text-ink/45">
            {formatFixtureDate(row.kickoffDate)}
            {row.kickoffTime && ` · ${row.kickoffTime.slice(0, 5)}`} &middot; {RUGBY_CODE_LABEL[row.rugbyCode] ?? row.rugbyCode}
          </p>
          <p className="mt-0.5 font-medium text-ink">
            {row.homeTeamName} ({row.homeClubName}) vs {row.awayTeamName} ({row.awayClubName})
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${FIXTURE_STATUS_BADGE_CLASS[row.status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/8 text-ink/50"}`}>{row.status}</span>
            {row.gameType && <span className="text-xs text-ink/40">{row.gameType}</span>}
            {row.homeScore !== null && row.awayScore !== null && (
              <span className="text-xs font-medium text-ink/60">
                {row.homeScore}&ndash;{row.awayScore}
              </span>
            )}
            {row.pitchAllocation && <span className="text-xs text-ink/40">{row.pitchAllocation}</span>}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleOpen}
            aria-label={`Edit ${row.homeTeamName} vs ${row.awayTeamName}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-ink/15 text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Pencil className="size-4" />
          </button>
          <a
            href={`/admin/fixtures/${row.id}`}
            aria-label="Open full details"
            className="inline-flex size-9 items-center justify-center rounded-lg text-ink/30 outline-none hover:text-ink/60 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronRight className="size-4" />
          </a>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {row.homeTeamName} vs {row.awayTeamName}
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-3">
              <FixtureStatusControl fixtureId={row.id} status={row.status} />
              <PitchInline fixtureId={row.id} pitch={row.pitchAllocation} pitchId={null} isHomeFixture={isHomeFixtureForPitch} availablePitches={pitches} />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink/10 pt-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">{isHome ? "Home" : "Away"}</span>
                <span className="text-sm text-ink/70">{isHome ? row.homeTeamName : row.awayTeamName}</span>
                <OwningTeamEditor
                  fixtureId={row.id}
                  clubId={row.owningClubId}
                  currentTeamId={row.owningTeamId}
                  currentTeamName={isHome ? row.homeTeamName : row.awayTeamName}
                  sideLabel={isHome ? "Home" : "Away"}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">{isHome ? "Away" : "Home"}</span>
                <span className="text-sm text-ink/70">{(isHome ? row.awayTeamName : row.homeTeamName) || row.rawOppositionText || "Unresolved"}</span>
                <OpponentTeamEditor
                  fixtureId={row.id}
                  owningTeamId={row.owningTeamId}
                  currentTeam={opponentTeamForEditor}
                  currentDirectoryId={row.opponentDirectoryId}
                  currentRawText={row.rawOppositionText}
                  sideLabel={isHome ? "Away" : "Home"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-ink/10 pt-4">
              <div>
                <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                />
              </div>
              <div>
                <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Kickoff</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Competition</label>
                <select
                  value={competitionEditionId ?? ""}
                  onChange={(e) => setCompetitionEditionId(e.target.value || null)}
                  className="mt-1 h-10 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                >
                  <option value="">None</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.competitionName} &middot; {c.seasonName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" className="h-9" disabled={dateSaving || (!dateDirty && competitionEditionId === null)} onClick={handleSaveDate}>
                {dateSaving ? "Saving…" : "Save date/kickoff"}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={dateSaving} onClick={handleSaveCompetition}>
                Save competition
              </Button>
            </div>
            {dateError && <p className="text-xs text-destructive">{dateError}</p>}

            <div className="border-t border-ink/10 pt-4">
              <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Result correction</span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  placeholder="Home"
                  className="h-10 w-20 rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                />
                <span className="text-ink/40">&ndash;</span>
                <input
                  type="number"
                  min={0}
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  placeholder="Away"
                  className="h-10 w-20 rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                />
              </div>
              <input
                value={resultReason}
                onChange={(e) => setResultReason(e.target.value)}
                placeholder="Reason for this correction (required)"
                className="mt-2 h-10 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
              />
              <Button type="button" size="sm" className="mt-2 h-9" disabled={resultSaving} onClick={handleSaveResult}>
                {resultSaving ? "Saving…" : "Save result"}
              </Button>
              {resultError && <p className="mt-1 text-xs text-destructive">{resultError}</p>}
            </div>

            <p className="border-t border-ink/10 pt-4 text-xs text-ink/40">
              Source: {SOURCE_LABEL[row.source] ?? row.source}. Rugby code and Source aren&apos;t directly editable.{" "}
              <a href={`/admin/fixtures/${row.id}`} className="font-medium text-forest-800 underline">
                Open full details
              </a>{" "}
              for swap home/away, conversation, and audit history.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
