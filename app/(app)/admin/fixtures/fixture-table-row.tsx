"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight, Copy, FileText, MoreHorizontal, Pencil, Trophy } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HomeAwayBadge } from "./home-away-badge"
import { PlannerCell, PlannerRowSelect } from "./planner-cell"
import { Button } from "@/components/ui/button"
import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"
import { FIXTURE_STATUS_BADGE_CLASS } from "@/lib/fixtures/status"

import { resolveFixtureResultDisputeAction } from "./[fixtureId]/result-admin-actions"
import { FixtureStatusControl } from "./[fixtureId]/fixture-status-control"
import { OpponentTeamEditor } from "./[fixtureId]/opponent-team-editor"
import { OwningTeamEditor } from "./[fixtureId]/owning-team-editor"
import { PitchInline } from "./[fixtureId]/pitch-inline"
import { getClubPitches, updateFixture, updateFixtureCompetition, type PitchOption, type TeamSearchResult } from "./actions"
import { duplicateFixture } from "./planner-actions"
import { RESULT_STATUS_LABEL, RUGBY_CODE_LABEL, SOURCE_LABEL } from "./format"
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
export function FixtureTableRow({
  row,
  clubScoped = false,
  grouped = false,
  columnCount,
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
  /** How wide the expanded editor must span; the column set is conditional. */
  columnCount: number
}) {
  const router = useRouter()
  // One fixture detail surface for both scopes: /admin/fixtures/[id] already
  // admits any club involved in the fixture, so a Fixture Secretary reaches
  // the same record a Site Admin does rather than a parallel club copy.
  const detailHref = `/admin/fixtures/${row.id}`
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
  const plannerLabel = `${row.owningTeamName} v ${opponentClubName || row.rawOppositionText}`
  const opponentClubLogoUrl = isHome ? row.awayClubLogoUrl : row.homeClubLogoUrl
  const owningClubLogoUrl = isHome ? row.homeClubLogoUrl : row.awayClubLogoUrl

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
                <DropdownMenuItem onClick={handleToggleOpen}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {open ? "Close Editor" : "Edit Fixture"}
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

      {open && (
        <tr className="border-b border-ink/6 bg-ink/[0.015]">
          <td colSpan={columnCount} className="px-4 py-4">
            {loading ? (
              <p className="text-sm text-ink-muted">Loading editable fields&hellip;</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Kickoff</label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm outline-none focus-visible:border-pitch-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Competition</label>
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
                    <span className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Status</span>
                    <FixtureStatusControl fixtureId={row.id} status={row.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Pitch</span>
                    <PitchInline fixtureId={row.id} pitch={row.pitchAllocation} pitchId={null} isHomeFixture={isHomeFixtureForPitch} availablePitches={pitches} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Result correction</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`home-score-${row.id}`}>
                        Home Score
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
                      <span className="text-ink-muted">&ndash;</span>
                      <label className="sr-only" htmlFor={`away-score-${row.id}`}>
                        Away Score
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
                        Reason for This Correction
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
                    <span className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{isHome ? "Home" : "Away"} team</span>
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
                    <span className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{isHome ? "Away" : "Home"} team</span>
                    {opponentClubResolved ? (
                      <span className="text-sm text-ink/70">
                        {opponentClubName}
                        {opponentTeamName ? <> &middot; {opponentTeamName}</> : <span className="text-ink-muted"> &middot; team not set</span>}
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
                  <p className="w-full text-xs text-ink-muted">
                    Rugby code and Source are set when the fixture is created and not directly editable.
                  </p>
                </div>

                {/* Row 4: unified Save/Discard, then Open Full Fixture Details */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" className="h-9" disabled={!isDirty || saving} onClick={handleSaveAll}>
                      {saving ? "Saving…" : "Save Changes"}
                    </Button>
                    {isDirty && (
                      <Button type="button" size="sm" variant="ghost" className="h-9 text-ink-muted" disabled={saving} onClick={handleDiscard}>
                        Discard
                      </Button>
                    )}
                    {isDirty && !saveError && <span className="text-xs text-ink-muted">You have unsaved changes.</span>}
                    {saveError && <span className="text-xs text-destructive-text">{saveError}</span>}
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
