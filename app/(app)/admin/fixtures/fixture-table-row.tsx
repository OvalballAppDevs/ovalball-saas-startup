"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight, FileText, Pencil } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"
import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { resolveFixtureResultDisputeAction } from "./[fixtureId]/result-admin-actions"
import { FixtureStatusControl } from "./[fixtureId]/fixture-status-control"
import { OpponentTeamEditor } from "./[fixtureId]/opponent-team-editor"
import { OwningTeamEditor } from "./[fixtureId]/owning-team-editor"
import { PitchInline } from "./[fixtureId]/pitch-inline"
import { getClubPitches, updateFixture, updateFixtureCompetition, type PitchOption, type TeamSearchResult } from "./actions"
import { RESULT_STATUS_LABEL, RUGBY_CODE_LABEL, SOURCE_LABEL, formatFixtureDate } from "./format"
import type { AdminFixtureRow } from "./types"

/**
 * The full desktop grid row -- both the always-visible data row AND its
 * optional Grid Editing expansion (mega-spec section Q/R), owned by ONE
 * client component since the expansion renders a sibling <tr>, which
 * cannot come from inside a server-rendered <td>. Date/kickoff/competition
 * are dirty-tracked with an explicit Save/Cancel; Status/Pitch reuse the
 * SAME controlled, already-safe click-to-edit components the fixture
 * detail page uses (a menu selection or a single Save-gated field, never
 * raw typing written live); Result uses the Site Admin correction RPC
 * directly (a reason is always required). Opposition and Home/Away swap
 * are deliberately NOT duplicated here -- those are richer, identity-
 * changing operations with their own dedicated UI on the fixture detail
 * page (linked below).
 */
export function FixtureTableRow({ row }: { row: AdminFixtureRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pitches, setPitches] = useState<PitchOption[]>([])
  const [competitions, setCompetitions] = useState<CompetitionEditionOption[]>([])
  const [loading, setLoading] = useState(false)

  const [date, setDate] = useState(row.kickoffDate)
  const [time, setTime] = useState(row.kickoffTime ?? "")
  const [competitionEditionId, setCompetitionEditionId] = useState<string | null>(null)
  const dateDirty = date !== row.kickoffDate || time !== (row.kickoffTime ?? "")

  const initialHomeScore = row.homeScore !== null ? String(row.homeScore) : ""
  const initialAwayScore = row.awayScore !== null ? String(row.awayScore) : ""
  const [homeScore, setHomeScore] = useState(initialHomeScore)
  const [awayScore, setAwayScore] = useState(initialAwayScore)
  const [resultReason, setResultReason] = useState("")
  const resultDirty = homeScore !== initialHomeScore || awayScore !== initialAwayScore || resultReason.trim() !== ""

  // Unified Save (Reconciliation-follow-up: "one big save button that
  // tracks changes... alerts if you try to leave without saving", instead
  // of a separate Save per field group). Status, Pitch, and the two team-
  // change dialogs stay their own immediate, self-contained actions --
  // each already commits (or cancels) the moment you interact with it, so
  // there's no "unsaved" state to lose there; this unifies only the three
  // fields that previously had their own lingering, easy-to-miss Save
  // buttons (Date/Kickoff, Competition, Result Correction).
  const isDirty = dateDirty || competitionEditionId !== null || resultDirty
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  function guardNavigate(e: React.MouseEvent) {
    if (isDirty && !window.confirm("You have unsaved changes on this fixture. Leave without saving?")) {
      e.preventDefault()
    }
  }

  function handleDiscard() {
    setDate(row.kickoffDate)
    setTime(row.kickoffTime ?? "")
    setCompetitionEditionId(null)
    setHomeScore(initialHomeScore)
    setAwayScore(initialAwayScore)
    setResultReason("")
    setSaveError(null)
  }

  async function handleSaveAll() {
    setSaving(true)
    setSaveError(null)
    const errors: string[] = []

    if (dateDirty) {
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
      if (!result.ok) errors.push(`Date/kickoff: ${result.error}`)
    }

    if (competitionEditionId !== null) {
      const result = await updateFixtureCompetition(row.id, competitionEditionId)
      if (!result.ok) errors.push(`Competition: ${result.error}`)
    }

    if (resultDirty) {
      if (homeScore.trim() === "" || awayScore.trim() === "") {
        errors.push("Result: both scores are required.")
      } else if (!resultReason.trim()) {
        errors.push("Result: a reason is required for a Site Admin correction.")
      } else {
        const result = await resolveFixtureResultDisputeAction(row.id, Number(homeScore), Number(awayScore), resultReason.trim())
        if (!result.ok) errors.push(`Result: ${result.error}`)
        else setResultReason("")
      }
    }

    setSaving(false)
    if (errors.length > 0) {
      setSaveError(errors.join(" "))
    } else {
      router.refresh()
    }
  }

  const homeClubIdForPitch = row.homeAway === "Away" ? null : row.owningClubId
  const isHomeFixtureForPitch = row.homeAway === "Home"
  const [fetched, setFetched] = useState(false)

  const isHome = row.homeAway !== "Away"
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

  // Owning side is always this club's own resolved team; opponent side
  // must read the same resolved/unresolved distinction the main table row
  // uses, never fall straight to raw free text (see Row 3 below).
  const owningClubName = isHome ? row.homeClubName : row.awayClubName
  const opponentClubResolved = isHome ? row.awayClubResolved : row.homeClubResolved
  const opponentClubName = isHome ? row.awayClubName : row.homeClubName
  const opponentTeamName = isHome ? row.awayTeamName : row.homeTeamName

  function handleToggleOpen() {
    const next = !open
    setOpen(next)
    if (next && !fetched) {
      setLoading(true)
      setFetched(true)
      Promise.all([homeClubIdForPitch ? getClubPitches(homeClubIdForPitch) : Promise.resolve([]), listCompetitionEditionsForRugbyCode(row.rugbyCode)]).then(
        ([p, c]) => {
          setPitches(p)
          setCompetitions(c)
          setLoading(false)
        }
      )
    }
  }

  return (
    <>
      <tr className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
        <td className="px-4 py-3 text-ink/70">{formatFixtureDate(row.kickoffDate)}</td>
        <td className="px-4 py-3 text-ink/70">{row.kickoffTime ? row.kickoffTime.slice(0, 5) : <span className="text-ink/30">&mdash;</span>}</td>
        <td className="px-4 py-3 text-ink/60">{RUGBY_CODE_LABEL[row.rugbyCode] ?? row.rugbyCode}</td>
        <td className="px-4 py-3">
          {row.homeClubResolved ? (
            <div className="flex items-center gap-2.5">
              <ClubAvatar logoUrl={row.homeClubLogoUrl} name={row.homeClubName} size="xs" />
              <div>
                <p className="font-medium text-ink">{row.homeClubName}</p>
                <p className="text-xs text-ink/45">{row.homeTeamName}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-700">
              <span className="font-medium">Unresolved opponent:</span> {row.homeClubName}
            </p>
          )}
        </td>
        <td className="px-4 py-3">
          {row.awayClubResolved ? (
            <div className="flex items-center gap-2.5">
              <ClubAvatar logoUrl={row.awayClubLogoUrl} name={row.awayClubName} size="xs" />
              <div>
                <p className="font-medium text-ink">{row.awayClubName}</p>
                <p className="text-xs text-ink/45">{row.awayTeamName}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-700">
              <span className="font-medium">Unresolved opponent:</span> {row.awayClubName}
            </p>
          )}
        </td>
        <td className="px-4 py-3 text-ink/60">
          {row.pitchName || row.pitchAllocation ? (
            <>
              <p className="text-ink">{row.pitchName ?? row.pitchAllocation}</p>
              {row.venueName && <p className="text-xs text-ink/45">{row.venueName}</p>}
            </>
          ) : row.venueName ? (
            <p className="text-ink">{row.venueName}</p>
          ) : (
            <span className="text-ink/30">&mdash;</span>
          )}
        </td>
        <td className="px-4 py-3 text-ink/60">
          {row.homeScore !== null && row.awayScore !== null ? (
            <>
              <span className="font-medium text-ink">
                {row.homeScore}&ndash;{row.awayScore}
              </span>
              {row.resultStatus !== "final" && row.resultStatus !== "external_recorded" && (
                <span className="ml-1.5 text-xs text-ink/40">({RESULT_STATUS_LABEL[row.resultStatus] ?? row.resultStatus})</span>
              )}
            </>
          ) : (
            <span className="text-ink/30">&mdash;</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${FIXTURE_STATUS_BADGE_CLASS[row.status as keyof typeof FIXTURE_STATUS_BADGE_CLASS] ?? "bg-ink/8 text-ink/50"}`}>{row.status}</span>
        </td>
        <td className="px-4 py-3 text-ink/50">{SOURCE_LABEL[row.source] ?? row.source}</td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleToggleOpen}
              aria-expanded={open}
              aria-label={`Quick edit ${row.homeTeamName} vs ${row.awayTeamName}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
            <Link
              href={`/admin/fixtures/${row.id}`}
              onClick={guardNavigate}
              className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              View
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-ink/6 bg-ink/[0.015]">
          <td colSpan={10} className="px-4 py-4">
            {loading ? (
              <p className="text-sm text-ink/45">Loading editable fields&hellip;</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Kickoff</label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Competition</label>
                    <select
                      value={competitionEditionId ?? ""}
                      onChange={(e) => setCompetitionEditionId(e.target.value || null)}
                      className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
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

                {/* Row 2: Status | Pitch | compact Result Correction -- all one
                    operational row on wide viewports, wrapping sensibly on
                    narrow ones (Reconciliation-follow-up section 33/34). */}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-ink/10 pt-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Status</span>
                    <FixtureStatusControl fixtureId={row.id} status={row.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Pitch</span>
                    <PitchInline fixtureId={row.id} pitch={row.pitchAllocation} pitchId={null} isHomeFixture={isHomeFixtureForPitch} availablePitches={pitches} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Result correction</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`home-score-${row.id}`}>
                        Home score
                      </label>
                      <input
                        id={`home-score-${row.id}`}
                        type="number"
                        min={0}
                        value={homeScore}
                        onChange={(e) => setHomeScore(e.target.value)}
                        placeholder="H"
                        className="h-8 w-12 rounded-md border border-ink/15 bg-white px-2 text-center text-sm outline-none focus-visible:border-pitch-600"
                      />
                      <span className="text-ink/40">&ndash;</span>
                      <label className="sr-only" htmlFor={`away-score-${row.id}`}>
                        Away score
                      </label>
                      <input
                        id={`away-score-${row.id}`}
                        type="number"
                        min={0}
                        value={awayScore}
                        onChange={(e) => setAwayScore(e.target.value)}
                        placeholder="A"
                        className="h-8 w-12 rounded-md border border-ink/15 bg-white px-2 text-center text-sm outline-none focus-visible:border-pitch-600"
                      />
                      <label className="sr-only" htmlFor={`result-reason-${row.id}`}>
                        Reason for this correction
                      </label>
                      <input
                        id={`result-reason-${row.id}`}
                        value={resultReason}
                        onChange={(e) => setResultReason(e.target.value)}
                        placeholder="Reason (required)"
                        className="h-8 min-w-[140px] flex-1 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Row 3: Home Side | Away Side. The owning side is always
                    this club's own resolved team; the opponent side must
                    read the SAME resolved/unresolved distinction the main
                    table row above uses (row.*ClubResolved) -- falling
                    straight to row.rawOppositionText here would show stale
                    or unrelated free text as if it were the current
                    opponent, even when a real club (or team) is already
                    resolved. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ink/10 pt-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">{isHome ? "Home" : "Away"} team</span>
                    <span className="text-sm text-ink/70">
                      {owningClubName} &middot; {isHome ? row.homeTeamName : row.awayTeamName}
                    </span>
                    <OwningTeamEditor
                      fixtureId={row.id}
                      clubId={row.owningClubId}
                      currentTeamId={row.owningTeamId}
                      currentTeamName={isHome ? row.homeTeamName : row.awayTeamName}
                      sideLabel={isHome ? "Home" : "Away"}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">{isHome ? "Away" : "Home"} team</span>
                    {opponentClubResolved ? (
                      <span className="text-sm text-ink/70">
                        {opponentClubName}
                        {opponentTeamName ? <> &middot; {opponentTeamName}</> : <span className="text-ink/40"> &middot; team not set</span>}
                      </span>
                    ) : (
                      <span className="text-sm text-amber-700">
                        <span className="font-medium">Unresolved:</span> {opponentClubName}
                      </span>
                    )}
                    <OpponentTeamEditor
                      fixtureId={row.id}
                      owningTeamId={row.owningTeamId}
                      currentTeam={opponentTeamForEditor}
                      currentDirectoryId={row.opponentDirectoryId}
                      currentRawText={row.rawOppositionText}
                      sideLabel={isHome ? "Away" : "Home"}
                    />
                  </div>
                  <p className="w-full text-xs text-ink/35">
                    Rugby code and Source are set when the fixture is created and not directly editable.
                  </p>
                </div>

                {/* Row 4: unified Save/Discard, then Open Full Fixture Details */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" className="h-9" disabled={!isDirty || saving} onClick={handleSaveAll}>
                      {saving ? "Saving…" : "Save changes"}
                    </Button>
                    {isDirty && (
                      <Button type="button" size="sm" variant="ghost" className="h-9 text-ink/50" disabled={saving} onClick={handleDiscard}>
                        Discard
                      </Button>
                    )}
                    {isDirty && !saveError && <span className="text-xs text-ink/40">You have unsaved changes.</span>}
                    {saveError && <span className="text-xs text-destructive">{saveError}</span>}
                  </div>
                  <Button type="button" size="sm" className="h-9" nativeButton={false} render={<Link href={`/admin/fixtures/${row.id}`} onClick={guardNavigate} />}>
                    <FileText className="size-3.5" />
                    Open Full Fixture Details
                  </Button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
