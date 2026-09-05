"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Check, Clock, Crown, Dumbbell, ExternalLink, MapPin, MessageSquare, Plus, Trophy, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { isIsoInRange } from "@/lib/calendar/season-window"
import { cn } from "@/lib/utils"

import { getClubVenuesAndPitches, getRequestingTeamIdentity, type RequestingTeamIdentity, type VenueOption } from "../admin/fixtures/actions"
import { AddFixtureDialog } from "../admin/fixtures/add-fixture-dialog"
import { TournamentOppositionEntry, type OppositionValue } from "../admin/fixtures/tournament-opposition-entry"
import { CreateFixtureDialog, type CompetitionOption } from "./create-fixture-dialog"
import { FixtureEditPanel } from "./fixture-edit-panel"
import {
  inviteTournamentParticipantAction,
  removeTournamentParticipantAction,
  respondTournamentInvitationAction,
  updateTournamentVenueAction,
} from "./tournament-actions"

const EMPTY_OPPOSITION: OppositionValue = { clubDirectoryId: null, clubName: null, clubActivated: false, clubId: null, canonicalTeamTypeId: null }

/** Shape Calendar's pitch data is fetched in; the tournament/fixture creation dialog resolves its own pitch options live once a club is known, so this is only used for display elsewhere on this page. */
export interface TournamentPitchOption {
  id: string
  displayName: string
}

export interface Lane {
  id: string
  label: string
  /** Full, readable team name (e.g. "Under 12", "Men's 1st Team") for the normal team selector/filter experience -- `label` stays the compact form ("U12", "Men's 1st") for the tight swimlane row. A shared scheduling-group lane has no single canonical team identity, so it falls back to `label`. */
  fullLabel: string
  kind: "team" | "group"
  memberTeamIds: string[]
  /** The one real team_id this lane creates fixtures/tournaments for -- the lane's own team, or the first member of a shared scheduling group. Null when nothing in this lane is creatable (view-only). */
  primaryTeamId: string | null
  canCreate: boolean
  /** Canonical team metadata (Section: Calendar Filter Rework) -- null for a "kind: group" lane, which has no single team identity and is grouped by convention instead (see lib/teams/filter-groups.ts). Used ONLY for filter grouping/sorting, never re-derived from `label`/`fullLabel` text. */
  category: string | null
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
}

export interface TournamentParticipantView {
  clubName: string
  teamTypeLabel: string
  status: "pending" | "accepted" | "declined" | "external_recorded" | "host"
  participantId: string | null
}

export interface WeekEntry {
  id: string
  laneId: string
  kind: "fixture" | "training" | "tournament"
  date: string
  time: string | null
  title: string
  teamDisplayName: string
  opposition: string
  homeAway: string
  venueAddress: string | null
  pitchName: string | null
  status: string
  statusClass: string
  needsAction: boolean
  resultLabel: string | null
  canEdit: boolean
  owningTeamId: string | null
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  competitionEditionId: string | null
  pitchId: string | null
  notes: string | null
  tournamentHostName: string | null
  tournamentParticipantCount: number | null
  tournamentParticipants: TournamentParticipantView[] | null
  tournamentMyParticipantId: string | null
  tournamentMyStatus: TournamentParticipantView["status"] | null
  /** True only when the viewer's own scoped team is this tournament's host_team_id -- gates the host-only "+ Add opposition"/"Remove" controls in TournamentQuickView, distinct from tournamentMyStatus (which is null for the host, since the host is not a tournament_participants row). For a tournament entry, `id` above is already the tournament's own id. */
  tournamentIAmHost: boolean
  /** The host's own real team_id -- needed to resolve its age/gender identity for the host-only "+ Add opposition" picker (a tournament is never frozen after creation). Null for non-tournament entries. */
  tournamentHostTeamId: string | null
  /** The tournament's currently-selected venue (tournaments.venue_id), for the host-only "Change venue" control -- null for non-tournament entries and for a tournament with no venue chosen yet. */
  tournamentVenueId: string | null
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * The team-lanes operations board -- teams as rows, days as columns,
 * matching "rugby operations board" rather than a generic date-grid
 * calendar. Restrained visual craft pass: open layout (no heavy grid
 * box), weekends distinguished by a warm tint rather than a loud block
 * (rugby fixture density peaks Sat/Sun, so those columns need to scan
 * well, not shout), fixtures rendered as solid tactile cards and training
 * as a quieter tonal outline so a Saturday full of matches doesn't fight
 * a training slot for attention. Chip differentiation never relies on
 * color alone: training carries the Dumbbell icon + "Training" text,
 * action-needed fixtures carry an explicit AlertTriangle, tournaments
 * carry the Trophy icon. Empty slots in a creatable lane carry a subtle
 * hover affordance (a ghost "+") -- inviting to click, never dead space.
 */
export function WeekBoard({
  days,
  todayIso,
  range,
  lanes,
  allLanes,
  entries,
  clubId,
  clubName,
  rugbyCode,
  season,
  competitions,
  pitches,
}: {
  days: string[]
  todayIso: string
  /** Pre-Season/Main-Season date-boundary addendum: the active phase's effective range, or null (no restriction) -- days outside it render inactive, never selectable for creation. Same shared resolver as Month/Agenda. */
  range: { start: string; end: string } | null
  lanes: Lane[]
  /** Every creatable lane, unfiltered by the current team-filter -- the "Your team" picker's full roster (Reconciliation complaint 4), distinct from `lanes` which may be narrowed to one team by the view's own filter. */
  allLanes: Lane[]
  entries: WeekEntry[]
  clubId: string | null
  /** Display name for the active club context -- passed to AddFixtureDialog's lockedClubName when creating a Tournament from Calendar. */
  clubName?: string
  rugbyCode: string | null
  season: { id: string; label: string } | null
  competitions: CompetitionOption[]
  pitches: TournamentPitchOption[]
}) {
  const [selected, setSelected] = useState<WeekEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [createSlot, setCreateSlot] = useState<{ laneId: string; date: string } | null>(null)
  const [createTournamentSlot, setCreateTournamentSlot] = useState<{ laneId: string; date: string } | null>(null)

  const entriesByLaneAndDay = new Map<string, WeekEntry[]>()
  for (const e of entries) {
    const key = `${e.laneId}|${e.date}`
    entriesByLaneAndDay.set(key, [...(entriesByLaneAndDay.get(key) ?? []), e])
  }

  const createLane = createSlot ? lanes.find((l) => l.id === createSlot.laneId) : null
  const createTournamentLane = createTournamentSlot ? lanes.find((l) => l.id === createTournamentSlot.laneId) : null

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-sm">
        <div className="grid min-w-[920px] grid-cols-[8.5rem_repeat(7,1fr)]">
          <div className="sticky left-0 z-10 border-b border-ink/10 bg-white" />
          {days.map((day, i) => {
            const isToday = day === todayIso
            const isWeekend = i >= 5
            const inRange = !range || isIsoInRange(day, range)
            const date = new Date(`${day}T00:00:00`)
            return (
              <div
                key={day}
                aria-disabled={!inRange}
                title={inRange ? undefined : "Outside the selected Pre-Season/Season period"}
                className={cn(
                  "border-b border-ink/10 px-2 py-3 text-center",
                  isWeekend && !isToday && inRange && "bg-amber-50/40",
                  !inRange && "bg-ink/[0.03]",
                  i < 6 && "border-r border-ink/10"
                )}
              >
                <p className={cn("text-[11px] font-medium tracking-wide uppercase", !inRange ? "text-ink/25" : isToday ? "text-pitch-700" : "text-ink/45")}>{DAY_LABELS[i]}</p>
                <p className={cn("mt-0.5 text-base font-medium", !inRange ? "text-ink/25" : isToday ? "text-forest-950" : "text-ink/80")}>{date.getDate()}</p>
                {isToday && inRange && <div className="mx-auto mt-1 h-0.5 w-5 rounded-full bg-pitch-600" />}
              </div>
            )
          })}

          {lanes.map((lane) => (
            <div key={lane.id} className="contents">
              <div className="sticky left-0 z-10 flex items-center border-r border-b border-ink/10 bg-white px-3 py-3">
                <span className="truncate text-sm font-semibold text-forest-950" title={lane.label}>
                  {lane.label}
                </span>
              </div>
              {days.map((day, i) => {
                const isWeekend = i >= 5
                const isToday = day === todayIso
                const inRange = !range || isIsoInRange(day, range)
                const dayEntries = entriesByLaneAndDay.get(`${lane.id}|${day}`) ?? []
                const canCreateHere = lane.canCreate && lane.primaryTeamId && clubId && dayEntries.length === 0 && inRange
                return (
                  <div
                    key={day}
                    aria-disabled={!inRange}
                    className={cn(
                      "group/cell relative min-h-[4rem] border-b border-ink/10 p-1.5",
                      !inRange ? "bg-ink/[0.03]" : isToday ? "bg-pitch-600/[0.04]" : isWeekend && "bg-amber-50/20",
                      i < 6 && "border-r border-ink/10"
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      {dayEntries.map((e) =>
                        e.kind === "training" ? (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              setSelected(e)
                              setEditing(false)
                            }}
                            className="flex min-h-[24px] items-center gap-1 rounded-md border border-dashed border-forest-800/25 bg-transparent px-1.5 py-1 text-left text-[11px] leading-tight text-forest-800/80 outline-none transition-all hover:border-forest-800/40 hover:bg-forest-800/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                          >
                            <Dumbbell className="size-3 shrink-0" />
                            <span className="truncate">
                              Training
                              {e.time ? ` · ${e.time.slice(0, 5)}` : ""}
                            </span>
                          </button>
                        ) : e.kind === "tournament" ? (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              setSelected(e)
                              setEditing(false)
                            }}
                            className="flex min-h-[28px] flex-col gap-0.5 rounded-md border border-amber-600/30 bg-amber-500/10 px-1.5 py-1 text-left text-[11px] leading-tight text-amber-900 shadow-sm outline-none transition-all hover:-translate-y-px hover:shadow focus-visible:ring-2 focus-visible:ring-pitch-400"
                          >
                            <span className="flex items-center gap-1 font-medium">
                              <Trophy className="size-3 shrink-0" />
                              <span className="truncate">{e.tournamentHostName}</span>
                            </span>
                            <span className="truncate opacity-75">
                              {e.time ? `${e.time.slice(0, 5)} · ` : ""}
                              {e.tournamentParticipantCount ?? 0} team{e.tournamentParticipantCount === 1 ? "" : "s"}
                            </span>
                          </button>
                        ) : (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                              setSelected(e)
                              setEditing(false)
                            }}
                            className={cn(
                              "flex min-h-[28px] flex-col gap-0.5 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm outline-none transition-all hover:-translate-y-px hover:shadow focus-visible:ring-2 focus-visible:ring-pitch-400",
                              e.statusClass
                            )}
                          >
                            <span className="flex items-center gap-1 font-medium">
                              {e.needsAction && <AlertTriangle className="size-3 shrink-0" />}
                              <span className="truncate">{e.opposition}</span>
                            </span>
                            <span className="truncate opacity-75">
                              {e.homeAway === "Home" ? "H" : e.homeAway === "Away" ? "A" : "?"}
                              {e.time ? ` · ${e.time.slice(0, 5)}` : ""}
                            </span>
                          </button>
                        )
                      )}
                    </div>
                    {canCreateHere && (
                      <button
                        type="button"
                        onClick={() => setCreateSlot({ laneId: lane.id, date: day })}
                        aria-label={`Create fixture for ${lane.label} on ${day}`}
                        className="absolute inset-1.5 flex items-center justify-center rounded-md text-ink/0 opacity-0 transition-all hover:bg-pitch-600/[0.06] hover:text-pitch-700 hover:opacity-100 focus-visible:opacity-100 focus-visible:text-pitch-700 focus-visible:ring-2 focus-visible:ring-pitch-400 group-hover/cell:opacity-100"
                      >
                        <Plus className="size-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            setEditing(false)
          }
        }}
      >
        <SheetContent>
          {selected && selected.kind === "tournament" && (
            <TournamentQuickView entry={selected} onChanged={() => setSelected(null)} />
          )}
          {selected && selected.kind !== "tournament" && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.kind === "training" ? `${lanes.find((l) => l.id === selected.laneId)?.label ?? ""} training` : `${lanes.find((l) => l.id === selected.laneId)?.label ?? ""} vs ${selected.opposition}`}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink/70">
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", selected.statusClass)}>{selected.status}</span>
                  {selected.resultLabel && <span className="font-medium text-ink">{selected.resultLabel}</span>}
                </div>
                {!editing && (
                  <>
                    <dl className="flex flex-col gap-1.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink/50">Date</dt>
                        <dd className="text-ink">
                          {new Date(`${selected.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                          {selected.time ? ` · ${selected.time.slice(0, 5)}` : ""}
                        </dd>
                      </div>
                      {selected.kind === "fixture" && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink/50">Home / Away</dt>
                          <dd className="text-ink capitalize">{selected.homeAway}</dd>
                        </div>
                      )}
                      {selected.venueAddress && (
                        <div className="flex justify-between gap-3">
                          <dt className="shrink-0 text-ink/50">Venue</dt>
                          <dd className="text-right text-ink">{selected.venueAddress}</dd>
                        </div>
                      )}
                      {selected.pitchName && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink/50">Pitch</dt>
                          <dd className="text-ink">{selected.pitchName}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-1 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
                      {selected.kind === "fixture" && selected.canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Edit
                        </button>
                      )}
                      {selected.kind === "fixture" && (
                        <Link
                          href="/fixtures"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Open Fixture
                        </Link>
                      )}
                      {selected.kind === "fixture" && (
                        <Link
                          href={`/messages/fixture/${selected.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          <MessageSquare className="size-3.5" />
                          Open Conversation
                        </Link>
                      )}
                      {selected.venueAddress && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.venueAddress)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          <MapPin className="size-3.5" />
                          Directions
                        </a>
                      )}
                    </div>
                  </>
                )}
                {editing && selected.kind === "fixture" && selected.owningTeamId && (
                  <FixtureEditPanel
                    fixture={{
                      id: selected.id,
                      owningTeamId: selected.owningTeamId,
                      owningTeamName: lanes.find((l) => l.id === selected.laneId)?.label ?? "Your team",
                      opponentTeamId: selected.opponentTeamId,
                      opponentDirectoryId: selected.opponentDirectoryId,
                      oppositionText: selected.opposition,
                      kickoffDate: selected.date,
                      kickoffTime: selected.time,
                      status: selected.status,
                      competitionEditionId: selected.competitionEditionId,
                      pitchId: selected.pitchId,
                      notes: selected.notes,
                    }}
                    competitions={competitions}
                    pitches={pitches}
                    onSaved={() => {
                      setEditing(false)
                      setSelected(null)
                    }}
                    onCancel={() => setEditing(false)}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {createLane && createLane.primaryTeamId && clubId && (
        <CreateFixtureDialog
          open={createSlot !== null}
          onOpenChange={(open) => !open && setCreateSlot(null)}
          clubId={clubId}
          teamOptions={allLanes.filter((l) => l.canCreate && l.primaryTeamId).map((l) => ({ id: l.primaryTeamId!, label: l.fullLabel }))}
          defaultTeamId={createLane.primaryTeamId}
          date={createSlot!.date}
          rugbyCode={rugbyCode}
          season={season}
          range={range}
          competitions={competitions}
          pitches={pitches}
          onWantTournament={() => {
            // Both dialogs are conditionally UNMOUNTED (not just closed) by
            // their own createLane/createTournamentLane guards, since each
            // derives from a different slot -- unmounting one and mounting
            // the other in the same tick was found to occasionally race
            // Base UI's dialog portal teardown in manual testing; a tick's
            // grace avoids it.
            const slot = createSlot
            setCreateSlot(null)
            setTimeout(() => setCreateTournamentSlot(slot), 0)
          }}
        />
      )}

      {createTournamentLane && createTournamentLane.primaryTeamId && clubId && (
        <AddFixtureDialog
          open={createTournamentSlot !== null}
          onOpenChange={(open) => !open && setCreateTournamentSlot(null)}
          hideTrigger
          lockedClubId={clubId}
          lockedClubName={clubName}
          initialTeamId={createTournamentLane.primaryTeamId}
          initialTeamLabel={createTournamentLane.label}
          initialDate={createTournamentSlot!.date}
          initialTournament
        />
      )}
    </>
  )
}

const TOURNAMENT_STATUS_STYLE: Record<TournamentParticipantView["status"], string> = {
  host: "bg-pitch-600/10 text-forest-900 border-pitch-600/30",
  accepted: "bg-mint-100 text-forest-900 border-mint-300",
  pending: "bg-amber-50 text-amber-900 border-amber-300",
  declined: "bg-destructive/10 text-destructive border-destructive/30",
  external_recorded: "bg-ink/5 text-ink/60 border-ink/15",
}
const TOURNAMENT_STATUS_ICON: Record<TournamentParticipantView["status"], typeof Check> = {
  host: Crown,
  accepted: Check,
  pending: Clock,
  declined: X,
  external_recorded: ExternalLink,
}
const TOURNAMENT_STATUS_LABEL: Record<TournamentParticipantView["status"], string> = {
  host: "Host",
  accepted: "Accepted",
  pending: "Awaiting response",
  declined: "Declined",
  external_recorded: "Recorded externally",
}

/**
 * A tournament is never frozen after creation (follow-up correction,
 * section 9-10): the host can add more opposition here, later, through the
 * SAME resolver/component the creation form uses (TournamentOppositionEntry
 * -- never a second implementation), and remove a still-pending invite.
 * An ACCEPTED participant is never editable from here -- only Remove is
 * offered, and only while still pending, so Calendar/request history for an
 * already-accepted participant is never silently rewritten.
 */
export function TournamentQuickView({ entry, onChanged }: { entry: WeekEntry; onChanged: () => void }) {
  const [responding, setResponding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [hostIdentity, setHostIdentity] = useState<RequestingTeamIdentity | null>(null)
  const [newOppositions, setNewOppositions] = useState<OppositionValue[]>([{ ...EMPTY_OPPOSITION }])
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [hostVenues, setHostVenues] = useState<VenueOption[]>([])
  const [venueSaving, setVenueSaving] = useState(false)

  useEffect(() => {
    if (!entry.tournamentIAmHost || !entry.tournamentHostTeamId) return
    getRequestingTeamIdentity(entry.tournamentHostTeamId).then((identity) => {
      setHostIdentity(identity)
      if (identity?.clubId) getClubVenuesAndPitches(identity.clubId).then(({ venues }) => setHostVenues(venues))
    })
  }, [entry.tournamentIAmHost, entry.tournamentHostTeamId])

  async function handleVenueChange(venueId: string) {
    setVenueSaving(true)
    await updateTournamentVenueAction(entry.id, venueId || null)
    setVenueSaving(false)
    onChanged()
  }

  async function respond(accept: boolean) {
    if (!entry.tournamentMyParticipantId) return
    setResponding(true)
    await respondTournamentInvitationAction(entry.tournamentMyParticipantId, accept)
    setResponding(false)
    onChanged()
  }

  async function handleRemove(participantId: string) {
    setRemovingId(participantId)
    await removeTournamentParticipantAction(participantId)
    setRemovingId(null)
    onChanged()
  }

  async function handleSendInvites() {
    const ready = newOppositions.filter((o) => o.clubDirectoryId && o.canonicalTeamTypeId)
    if (ready.length === 0) {
      setInviteError("Choose at least one opposition club and team before sending.")
      return
    }
    setInviting(true)
    setInviteError(null)
    for (const o of ready) {
      const result = await inviteTournamentParticipantAction({ tournamentId: entry.id, clubDirectoryId: o.clubDirectoryId!, canonicalTeamTypeId: o.canonicalTeamTypeId! })
      if (!result.ok) {
        setInviteError(result.error)
        setInviting(false)
        return
      }
    }
    setInviting(false)
    setAdding(false)
    setNewOppositions([{ ...EMPTY_OPPOSITION }])
    onChanged()
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Trophy className="size-4 text-pitch-700" />
          Tournament &middot; {entry.tournamentHostName}
        </SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink/50">Date</dt>
            <dd className="text-ink">
              {new Date(`${entry.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              {entry.time ? ` · ${entry.time.slice(0, 5)}` : ""}
            </dd>
          </div>
          {!entry.tournamentIAmHost && entry.venueAddress && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/50">Venue</dt>
              <dd className="text-right text-ink">{entry.venueAddress}</dd>
            </div>
          )}
          {entry.pitchName && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/50">Pitch</dt>
              <dd className="text-ink">{entry.pitchName}</dd>
            </div>
          )}
        </dl>
        {entry.tournamentIAmHost && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <Label htmlFor="tournament-venue" className="text-ink/50">
              Venue
            </Label>
            <select
              id="tournament-venue"
              defaultValue={entry.tournamentVenueId ?? ""}
              disabled={venueSaving || hostVenues.length === 0}
              onChange={(e) => handleVenueChange(e.target.value)}
              className="h-8 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-50"
            >
              <option value="">Not set</option>
              {hostVenues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.isDefaultHome ? " (Default)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {entry.tournamentParticipants && entry.tournamentParticipants.length > 0 && (
          <div className="border-t border-ink/10 pt-3">
            <p className="text-xs font-medium tracking-wide text-ink/45 uppercase">Participants</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {entry.tournamentParticipants.map((p, i) => {
                const StatusIcon = TOURNAMENT_STATUS_ICON[p.status]
                return (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-ink">
                      {p.clubName} <span className="text-ink/45">{p.teamTypeLabel}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", TOURNAMENT_STATUS_STYLE[p.status])}>
                        <StatusIcon className="size-3" />
                        {TOURNAMENT_STATUS_LABEL[p.status]}
                      </span>
                      {entry.tournamentIAmHost && p.status === "pending" && p.participantId && (
                        <button
                          type="button"
                          disabled={removingId === p.participantId}
                          onClick={() => handleRemove(p.participantId!)}
                          className="text-xs font-medium text-destructive underline hover:text-destructive/80"
                        >
                          {removingId === p.participantId ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {entry.tournamentIAmHost && (
          <div className="border-t border-ink/10 pt-3">
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 underline hover:text-forest-950"
              >
                <Plus className="size-3.5" />
                Add opposition
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium tracking-wide text-ink/45 uppercase">Add opposition</p>
                {!hostIdentity ? (
                  <p className="text-sm text-ink/45">Resolving host team…</p>
                ) : (
                  newOppositions.map((o, i) => (
                    <TournamentOppositionEntry
                      key={i}
                      index={i}
                      value={o}
                      onChange={(next) => setNewOppositions((prev) => prev.map((p, pi) => (pi === i ? next : p)))}
                      onRemove={() => setNewOppositions((prev) => prev.filter((_, pi) => pi !== i))}
                      removable={newOppositions.length > 1}
                      hostAgeGroup={hostIdentity.ageGroup}
                      hostGender={hostIdentity.gender ?? null}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setNewOppositions((prev) => [...prev, { ...EMPTY_OPPOSITION }])}
                  className="self-start text-xs font-medium text-forest-800 underline hover:text-forest-950"
                >
                  + Add another
                </button>
                {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
                <div className="flex items-center gap-2">
                  <Button type="button" className="h-9" disabled={inviting || !hostIdentity} onClick={handleSendInvites}>
                    {inviting ? "Sending…" : "Send invite(s)"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false)
                      setNewOppositions([{ ...EMPTY_OPPOSITION }])
                      setInviteError(null)
                    }}
                    className="text-sm font-medium text-ink/50 underline hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {entry.tournamentMyStatus === "pending" && entry.tournamentMyParticipantId && (
          <div className="flex items-center gap-2 border-t border-ink/10 pt-3">
            <button
              type="button"
              disabled={responding}
              onClick={() => respond(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={responding}
              onClick={() => respond(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Decline
            </button>
          </div>
        )}
      </div>
    </>
  )
}
