"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"

import {
  applyClubhouseDistanceFilter,
  applyFindFixturePartnerFilter,
  buildFindFixtureAvailability,
  buildFindFixtureCandidates,
  countNoKnownClashDates,
  findDistanceOrigin,
  nextWeekdayDates,
  type ClubhouseDistanceFilter,
  type ClubMapMarker,
  type FindFixtureAvailabilityState,
  type FindFixtureCandidate,
  type FindFixtureCandidateAvailability,
  type FindFixturePartnerFilter,
  type FindFixtureSort,
  type FindFixtureVenuePreference,
} from "@ovalball/contracts/clubhouse"
import { fullTeamLabel } from "@ovalball/contracts/teams/compact-label"
import type { MyTeam } from "@/lib/app-context/my-teams"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import type { ClubMapHandle } from "../club-map"
import { ClubStatusPill } from "../club-status-pill"
import { InviteClubDialog } from "../invite-club-dialog"
import { getFindFixtureAvailability, getFindFixtureData } from "./actions"

const ClubMap = dynamic(() => import("../club-map").then((m) => m.ClubMap), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-ink/[0.03] text-sm text-ink-muted">Loading map…</div>,
})

const DISTANCE_OPTIONS: { value: ClubhouseDistanceFilter; label: string }[] = [
  { value: 10, label: "10 mi" },
  { value: 25, label: "25 mi" },
  { value: 50, label: "50 mi" },
  { value: 100, label: "100 mi" },
  { value: "any", label: "Any" },
]
const SORT_OPTIONS: { value: FindFixtureSort; label: string }[] = [
  { value: "nearest", label: "Nearest" },
  { value: "partners_first", label: "Partners First" },
  { value: "club_name", label: "Club Name" },
]
const MAX_DATES = 6

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

function dedupeDates(candidates: string[]): string[] {
  return [...new Set(candidates)].sort().slice(0, MAX_DATES)
}

function dateStateLabel(state: FindFixtureAvailabilityState): string {
  if (state === "no_known_clash") return "No known clash"
  if (state === "tentative") return "Tentative"
  if (state === "unknown") return "Unknown"
  return "Busy"
}

interface InitialOpponent {
  directoryId: string
  clubId: string | null
  name: string
}

/**
 * ONE FETCH PER TEAM, EVERYTHING ELSE LOCAL -- see actions.ts. Selecting a candidate team hands off
 * to the existing /fixtures/new composer with ids only (never a name/crest trusted back from this
 * client) -- that page re-resolves the opponent itself, exactly as it already does for the Compare
 * Calendars deep link.
 */
export function FindFixtureClient({
  clubId,
  contextTeamId,
  teams,
  initialOpponent,
}: {
  clubId: string
  contextTeamId: string | null
  teams: MyTeam[]
  initialOpponent: InitialOpponent | null
}) {
  const router = useRouter()
  const mapRef = useRef<ClubMapHandle>(null)

  const [teamId, setTeamId] = useState<string | null>(contextTeamId ?? (teams.length === 1 ? teams[0]!.id : null))
  const team = teams.find((t) => t.id === teamId) ?? null

  const [dates, setDates] = useState<string[]>([])
  const [pendingDate, setPendingDate] = useState("")
  const [venuePreference, setVenuePreference] = useState<FindFixtureVenuePreference>("either")
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")
  const [sort, setSort] = useState<FindFixtureSort>("nearest")
  const [partnerFilter, setPartnerFilter] = useState<FindFixturePartnerFilter>("all")
  const [mode, setMode] = useState<"map" | "list">("list")
  const [preselectedClubId, setPreselectedClubId] = useState<string | null>(initialOpponent?.clubId ?? null)
  const [inviteTarget, setInviteTarget] = useState<{ directoryId: string; name: string } | null>(null)

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [candidateRows, setCandidateRows] = useState<{ team_id: string; club_id: string; display_name: string; age_group: string | null; gender: string | null }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [availabilityRows, setAvailabilityRows] = useState<{ opponent_team_id: string; the_date: string; status: string }[] | null>(null)

  useEffect(() => {
    if (!teamId) return
    setError(null)
    setMarkers(null)
    setCandidateRows(null)
    void getFindFixtureData(teamId, clubId, contextTeamId)
      .then((d) => {
        setMarkers(d.markers)
        setCandidateRows(d.candidateRows)
      })
      .catch(() => setError("Couldn't search for opposition. Try again."))
  }, [teamId, clubId, contextTeamId])

  // AVAILABILITY (Section 7) -- fires only once real dates are chosen; separate from the fetch above
  // so changing dates never re-fetches the marker/compatibility population.
  useEffect(() => {
    setAvailabilityRows(null)
    if (!teamId || dates.length === 0) return
    let live = true
    void getFindFixtureAvailability(teamId, dates)
      .then((rows) => {
        if (live) setAvailabilityRows(rows)
      })
      .catch(() => {
        if (live) setAvailabilityRows([])
      })
    return () => {
      live = false
    }
  }, [teamId, dates])

  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  const { actionable, directoryOnly } = useMemo(() => {
    if (!markers || !candidateRows) return { actionable: [] as FindFixtureCandidate[], directoryOnly: [] as ClubMapMarker[] }
    return buildFindFixtureCandidates(markers, candidateRows, team?.rugbyCode ?? null)
  }, [markers, candidateRows, team])

  const filteredActionable = useMemo(() => {
    const byDistance = applyClubhouseDistanceFilter(actionable, distance, origin) as FindFixtureCandidate[]
    const byPartner = applyFindFixturePartnerFilter(byDistance, partnerFilter)
    return [...byPartner].sort((a, b) => {
      if (sort === "club_name") return a.name.localeCompare(b.name)
      if (sort === "partners_first") {
        const rank = (c: FindFixtureCandidate) => (c.partnershipStatus === "active" ? 0 : 1)
        const diff = rank(a) - rank(b)
        return diff !== 0 ? diff : a.name.localeCompare(b.name)
      }
      return a.name.localeCompare(b.name)
    })
  }, [actionable, distance, origin, partnerFilter, sort])

  // Section 3 found ~1,390 directory-only clubs, all one rugby code -- with no distance narrowed
  // (the "Any" default), showing every one of them would bury the actionable results under a wall
  // of Invite cards. Capped, with an honest count, rather than silently truncated.
  const allDirectoryOnly = useMemo(() => applyClubhouseDistanceFilter(directoryOnly, distance, origin), [directoryOnly, distance, origin])
  const DIRECTORY_ONLY_CAP = 20
  const filteredDirectoryOnly = allDirectoryOnly.slice(0, DIRECTORY_ONLY_CAP)

  // Availability per compatible TEAM (Section 7) -- a non-partner candidate reads "unknown" on every
  // date without ever being looked up server-side (see buildFindFixtureAvailability's own doc comment).
  const availabilityByTeamId = useMemo(() => {
    if (dates.length === 0 || availabilityRows === null) return null
    const built = buildFindFixtureAvailability(filteredActionable, dates, availabilityRows)
    return new Map(built.map((a) => [a.teamId, a]))
  }, [filteredActionable, dates, availabilityRows])

  const sortedByClearDates = useMemo(() => {
    if (sort !== "most_clear_dates" || !availabilityByTeamId) return filteredActionable
    return [...filteredActionable].sort((a, b) => {
      const clearA = Math.max(...a.compatibleTeams.map((t) => (availabilityByTeamId.get(t.teamId) ? countNoKnownClashDates(availabilityByTeamId.get(t.teamId)!) : 0)), 0)
      const clearB = Math.max(...b.compatibleTeams.map((t) => (availabilityByTeamId.get(t.teamId) ? countNoKnownClashDates(availabilityByTeamId.get(t.teamId)!) : 0)), 0)
      return clearB - clearA || a.name.localeCompare(b.name)
    })
  }, [filteredActionable, sort, availabilityByTeamId])

  const displayedActionable = preselectedClubId ? sortedByClearDates.filter((c) => c.clubId === preselectedClubId) : sortedByClearDates

  function selectCandidate(candidate: FindFixtureCandidate, targetTeamId: string, chosenDate?: string) {
    const params = new URLSearchParams({
      teamId: teamId ?? "",
      opponentDirectoryId: candidate.directoryId,
      opponentClubId: candidate.clubId ?? "",
      targetTeamId,
      venuePreference,
    })
    if (chosenDate) params.set("date", chosenDate)
    router.push(`/fixtures/new?${params.toString()}`)
  }

  return (
    <div>
      {!teamId && (
        <div className="max-w-md">
          <Label className="text-ink/80">Which team needs a fixture?</Label>
          <div className="mt-2 flex flex-col gap-2">
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTeamId(t.id)}
                className="flex items-center justify-between rounded-lg border border-ink/15 bg-white px-4 py-3 text-left text-sm font-medium text-ink hover:bg-ink/[0.03]"
              >
                {fullTeamLabel(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      {teamId && (
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-5">
            <div>
              <Label className="text-ink/80">When (Up to 6 Dates, Optional)</Label>
              {dates.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDates(dates.filter((x) => x !== d))}
                      className="rounded-full border border-forest-800 bg-forest-800 px-3 py-1.5 text-xs font-medium text-chalk outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      {shortDate(d)} &times;
                    </button>
                  ))}
                </div>
              )}
              {dates.length < MAX_DATES && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDates(dedupeDates([...dates, ...nextWeekdayDates(new Date().toISOString().slice(0, 10), 6, 1)]))}
                    className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    Next Saturday
                  </button>
                  <button
                    type="button"
                    onClick={() => setDates(dedupeDates(nextWeekdayDates(new Date().toISOString().slice(0, 10), 6, 3)))}
                    className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    Next 3 Saturdays
                  </button>
                  <button
                    type="button"
                    onClick={() => setDates(dedupeDates(nextWeekdayDates(new Date().toISOString().slice(0, 10), 7, 4)))}
                    className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/60 outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    Next 4 Sundays
                  </button>
                </div>
              )}
              {dates.length < MAX_DATES && (
                <Input
                  id="ff-date"
                  type="date"
                  value={pendingDate}
                  onChange={(e) => {
                    setPendingDate(e.target.value)
                    if (e.target.value) setDates((prev) => dedupeDates([...prev, e.target.value]))
                  }}
                  className="mt-1.5 h-10 border-ink/15 bg-white"
                  aria-label="Add a specific date"
                />
              )}
            </div>

            <div>
              <Label className="text-ink/80">Where</Label>
              <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="Home, away or either">
                {(["home", "away", "either"] as FindFixtureVenuePreference[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={venuePreference === v}
                    onClick={() => setVenuePreference(v)}
                    className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      venuePreference === v ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-ink/80">Distance</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Distance">
                {DISTANCE_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    role="radio"
                    aria-checked={distance === d.value}
                    onClick={() => setDistance(d.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      distance === d.value ? "border-pitch-600 bg-mint-100 text-forest-800" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-ink/80">Sort</Label>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {[...SORT_OPTIONS, ...(dates.length > 0 ? [{ value: "most_clear_dates" as const, label: "Most Clear Dates" }] : [])].map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={sort === s.value}
                    onClick={() => setSort(s.value)}
                    className={`rounded-lg border px-3 py-1.5 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      sort === s.value ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={partnerFilter === "partners"}
                  onClick={() => setPartnerFilter(partnerFilter === "partners" ? "all" : "partners")}
                  className={`rounded-lg border px-3 py-1.5 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                    partnerFilter === "partners" ? "border-pitch-600 bg-mint-100 text-forest-800" : "border-ink/15 bg-white text-ink/60 hover:bg-ink/[0.03]"
                  }`}
                >
                  Partners only
                </button>
              </div>
            </div>

            {preselectedClubId && (
              <Button type="button" variant="ghost" size="sm" className="h-9 w-fit" onClick={() => setPreselectedClubId(null)}>
                Clear club selection
              </Button>
            )}
          </div>

          <div>
            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">{error}</p>}

            {!error && markers === null && <p className="text-sm text-ink-muted">Searching for compatible opposition…</p>}

            {!error && markers !== null && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {displayedActionable.length} compatible {displayedActionable.length === 1 ? "club" : "clubs"}
                  </p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Map or list">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === "map"}
                      onClick={() => setMode("map")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${mode === "map" ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60"}`}
                    >
                      Map
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === "list"}
                      onClick={() => setMode("list")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${mode === "list" ? "border-forest-800 bg-forest-800 text-chalk" : "border-ink/15 bg-white text-ink/60"}`}
                    >
                      List
                    </button>
                  </div>
                </div>

                {displayedActionable.length === 0 && (
                  <div className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
                    <p className="text-sm font-medium text-ink">{distance === "any" ? "No compatible clubs found" : `No compatible clubs found within ${distance} miles`}</p>
                    <p className="mt-1 text-sm text-ink-muted">{distance === "any" ? "Try a different team, or check back once more clubs join Ovalball." : "Try a wider distance, or Any distance."}</p>
                  </div>
                )}

                {mode === "map" && displayedActionable.length > 0 && (
                  <div className="mt-4 h-[420px] overflow-hidden rounded-lg border border-ink/10">
                    <ClubMap
                      ref={mapRef}
                      clubs={displayedActionable}
                      canManagePartnerships={false}
                      renderPopup={(club) => (
                        <CandidatePopup
                          candidate={club as FindFixtureCandidate}
                          dates={dates}
                          availabilityByTeamId={availabilityByTeamId}
                          onSelect={(t, chosenDate) => selectCandidate(club as FindFixtureCandidate, t, chosenDate)}
                        />
                      )}
                    />
                  </div>
                )}

                {mode === "list" && displayedActionable.length > 0 && dates.length === 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    {displayedActionable.map((candidate) => (
                      <CandidateCard key={candidate.directoryId} candidate={candidate} onSelectTeam={(t) => selectCandidate(candidate, t)} />
                    ))}
                  </div>
                )}

                {mode === "list" && displayedActionable.length > 0 && dates.length > 0 && (
                  <div className="mt-4">
                    <AvailabilityMatrix candidates={displayedActionable} dates={dates} availabilityByTeamId={availabilityByTeamId} onSelect={selectCandidate} />
                  </div>
                )}

                {filteredDirectoryOnly.length > 0 && !preselectedClubId && (
                  <div className="mt-8">
                    <p className="text-sm font-medium text-ink">Other Rugby Clubs</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Not yet on Ovalball &mdash; can&apos;t receive a fixture request yet, but you can invite them.
                      {allDirectoryOnly.length > DIRECTORY_ONLY_CAP &&
                        ` Showing ${DIRECTORY_ONLY_CAP} of ${allDirectoryOnly.length} -- set a distance to narrow this down.`}
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      {filteredDirectoryOnly.map((club) => (
                        <div key={club.directoryId} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ClubAvatar logoUrl={club.logoUrl} name={club.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink">{club.name}</p>
                              <p className="truncate text-xs text-ink-muted">{[club.town, club.county].filter(Boolean).join(", ") || "Location unknown"}</p>
                            </div>
                          </div>
                          <Button type="button" size="sm" className="h-9 shrink-0 bg-pitch-600 text-white hover:bg-pitch-600/90" onClick={() => setInviteTarget({ directoryId: club.directoryId, name: club.name })}>
                            Invite
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {inviteTarget && (
        <InviteClubDialog open={true} onOpenChange={(open) => !open && setInviteTarget(null)} clubDirectoryId={inviteTarget.directoryId} clubName={inviteTarget.name} />
      )}
    </div>
  )
}

function CandidateCard({ candidate, onSelectTeam }: { candidate: FindFixtureCandidate; onSelectTeam: (teamId: string) => void }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-center gap-3">
        <ClubAvatar logoUrl={candidate.logoUrl} name={candidate.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{candidate.name}</p>
          <p className="truncate text-xs text-ink-muted">{[candidate.town, candidate.county].filter(Boolean).join(", ") || (candidate.hasLocation ? "" : "Location unavailable")}</p>
        </div>
        <ClubStatusPill club={candidate} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {candidate.compatibleTeams.map((t) => (
          <button
            key={t.teamId}
            type="button"
            onClick={() => onSelectTeam(t.teamId)}
            className="rounded-md border border-pitch-600 bg-mint-100 px-3 py-1.5 text-xs font-medium text-forest-800 hover:bg-pitch-600 hover:text-white"
          >
            {t.displayName}
          </button>
        ))}
      </div>
    </div>
  )
}

function CandidatePopup({
  candidate,
  dates,
  availabilityByTeamId,
  onSelect,
}: {
  candidate: FindFixtureCandidate
  dates: string[]
  availabilityByTeamId: Map<string, FindFixtureCandidateAvailability> | null
  onSelect: (teamId: string, date?: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ClubAvatar logoUrl={candidate.logoUrl} name={candidate.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{candidate.name}</p>
          <ClubStatusPill club={candidate} />
        </div>
      </div>
      {candidate.compatibleTeams.map((t) => {
        const availability = availabilityByTeamId?.get(t.teamId) ?? null
        return (
          <div key={t.teamId} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-ink">{t.displayName}</p>
            {dates.length === 0 ? (
              <button type="button" onClick={() => onSelect(t.teamId)} className="w-fit rounded-md border border-pitch-600 bg-mint-100 px-2.5 py-1 text-xs font-medium text-forest-800 hover:bg-pitch-600 hover:text-white">
                Select
              </button>
            ) : (
              <div className="flex flex-wrap gap-1">
                {dates.map((d) => {
                  const state = availability?.dates.find((x) => x.date === d)?.state ?? "unknown"
                  const selectable = state !== "busy"
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!selectable}
                      onClick={() => onSelect(t.teamId, d)}
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-70 ${
                        state === "no_known_clash" ? "border-pitch-600 bg-mint-100 text-forest-800" : "border-ink/15 bg-white text-ink/60"
                      }`}
                    >
                      {shortDate(d)}: {dateStateLabel(state)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * THE COMPARISON MATRIX (Section 7) -- rows are compatible TEAMS (never clubs; a club with two
 * compatible sides gets two rows), columns are the selected dates. Colour is always paired with the
 * exact word (never colour alone), and each cell is one `AvailabilityMatrixCell`.
 */
function AvailabilityMatrix({
  candidates,
  dates,
  availabilityByTeamId,
  onSelect,
}: {
  candidates: FindFixtureCandidate[]
  dates: string[]
  availabilityByTeamId: Map<string, FindFixtureCandidateAvailability> | null
  onSelect: (candidate: FindFixtureCandidate, teamId: string, date: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink/10">
            <th scope="col" className="sticky left-0 bg-white px-4 py-2.5 text-left text-xs font-medium text-ink-muted">
              Club / team
            </th>
            {dates.map((d) => (
              <th key={d} scope="col" className="px-3 py-2.5 text-center text-xs font-medium text-ink-muted">
                {shortDate(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.flatMap((candidate) =>
            candidate.compatibleTeams.map((t) => {
              const availability = availabilityByTeamId?.get(t.teamId) ?? null
              return (
                <tr key={t.teamId} className="border-b border-ink/5 last:border-b-0">
                  <th scope="row" className="sticky left-0 bg-white px-4 py-2.5 text-left font-normal">
                    <div className="flex items-center gap-2">
                      <ClubAvatar logoUrl={candidate.logoUrl} name={candidate.name} size="xs" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{candidate.name}</p>
                        <p className="truncate text-[11px] text-ink-muted">{t.displayName}</p>
                      </div>
                    </div>
                  </th>
                  {dates.map((d) => {
                    const state = availability?.dates.find((x) => x.date === d)?.state ?? "unknown"
                    return <AvailabilityMatrixCell key={d} state={state} onSelect={() => onSelect(candidate, t.teamId, d)} />
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

function AvailabilityMatrixCell({ state, onSelect }: { state: FindFixtureAvailabilityState; onSelect: () => void }) {
  const selectable = state !== "busy"
  const styles: Record<FindFixtureAvailabilityState, string> = {
    no_known_clash: "bg-pitch-600/10 text-forest-800",
    busy: "bg-destructive/5 text-destructive-text",
    tentative: "bg-amber-50 text-amber-800",
    unknown: "bg-ink/[0.03] text-ink-muted",
  }
  return (
    <td className="px-3 py-2 text-center">
      <button
        type="button"
        disabled={!selectable}
        onClick={onSelect}
        aria-label={`${dateStateLabel(state)}${selectable ? " -- select" : ", not selectable"}`}
        className={`inline-flex min-h-9 w-full items-center justify-center rounded-md px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:cursor-not-allowed ${styles[state]}`}
      >
        {dateStateLabel(state)}
      </button>
    </td>
  )
}
