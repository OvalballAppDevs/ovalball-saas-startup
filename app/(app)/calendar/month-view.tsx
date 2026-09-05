"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Dumbbell, MapPin, MessageSquare, Plus, Trophy } from "lucide-react"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { isIsoInRange } from "@/lib/calendar/season-window"
import { cn } from "@/lib/utils"

import { type CompetitionOption } from "./create-fixture-dialog"
import { CreateFixtureDialog } from "./create-fixture-dialog"
import { AddFixtureDialog } from "../admin/fixtures/add-fixture-dialog"
import { type TournamentPitchOption } from "./week-board"
import { FixtureEditPanel } from "./fixture-edit-panel"
import { TournamentQuickView, type Lane, type WeekEntry } from "./week-board"

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MAX_VISIBLE_PER_DAY = 3

/**
 * Month grid -- compact per-day summaries only (a real fixture card in
 * every square becomes unreadable the moment several teams play the same
 * Sunday), click a date to open a day drawer grouped by team. Same
 * bounded-query discipline as Week: the grid only ever covers the ~6
 * weeks it actually renders, never the whole season fetched and filtered
 * client-side. Creation from an empty day uses the day drawer's own "Add
 * fixture" action (with a team picker) rather than a per-cell hover
 * affordance -- Month's cells are too small for that to stay legible.
 */
export function MonthView({
  gridDays,
  monthStartIso,
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
  gridDays: string[]
  monthStartIso: string
  todayIso: string
  /** Pre-Season/Main-Season date-boundary addendum: the active phase's effective range, or null (no restriction) -- days outside it render inactive, never selectable. Same shared resolver as Week/Agenda. */
  range: { start: string; end: string } | null
  lanes: Lane[]
  allLanes: Lane[]
  entries: WeekEntry[]
  clubId: string | null
  clubName?: string
  rugbyCode: string | null
  season: { id: string; label: string } | null
  competitions: CompetitionOption[]
  pitches: TournamentPitchOption[]
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<WeekEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [addingLaneId, setAddingLaneId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false)
  const currentMonth = monthStartIso.slice(0, 7)

  const entriesByDay = new Map<string, WeekEntry[]>()
  for (const e of entries) {
    entriesByDay.set(e.date, [...(entriesByDay.get(e.date) ?? []), e])
  }
  const laneLabel = (laneId: string) => lanes.find((l) => l.id === laneId)?.label ?? ""
  const creatableLanes = lanes.filter((l) => l.canCreate && l.primaryTeamId)

  const weeks: string[][] = []
  for (let i = 0; i < gridDays.length; i += 7) weeks.push(gridDays.slice(i, i + 7))

  const dayEntries = selectedDay ? (entriesByDay.get(selectedDay) ?? []) : []
  const addingLane = addingLaneId ? lanes.find((l) => l.id === addingLaneId) : null

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-ink/10 bg-white">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={cn("px-2 py-2 text-center text-[11px] font-medium tracking-wide text-ink/45 uppercase", i >= 5 && "bg-amber-50/40")}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day, i) => {
              const isToday = day === todayIso
              const isWeekend = i >= 5
              const inMonth = day.slice(0, 7) === currentMonth
              const inRange = !range || isIsoInRange(day, range)
              const dayItems = entriesByDay.get(day) ?? []
              const visible = dayItems.slice(0, MAX_VISIBLE_PER_DAY)
              const overflow = dayItems.length - visible.length
              const date = new Date(`${day}T00:00:00`)
              // Section 4: leading/trailing days from adjacent months may
              // still render for grid layout, but a day OUTSIDE the
              // selected Pre-Season/Season window is never clickable --
              // its entries (if any) still render as read-only summaries
              // below, informational only.
              const clickable = inRange && (dayItems.length > 0 || (clubId && creatableLanes.length > 0))
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => clickable && setSelectedDay(day)}
                  disabled={!clickable}
                  aria-disabled={!inRange}
                  title={inRange ? undefined : "Outside the selected Pre-Season/Season period"}
                  className={cn(
                    "flex min-h-[6rem] flex-col items-stretch gap-1 border-r border-b border-ink/10 p-1.5 text-left align-top outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset",
                    !inMonth && "bg-ink/[0.02]",
                    isWeekend && inMonth && !isToday && inRange && "bg-amber-50/20",
                    isToday && inRange && "bg-pitch-600/[0.05]",
                    !inRange && "bg-ink/[0.04] opacity-60",
                    clickable && "cursor-pointer hover:bg-ink/[0.03]"
                  )}
                >
                  <span className={cn("text-xs font-medium", !inRange ? "text-ink/25" : !inMonth ? "text-ink/25" : isToday ? "text-forest-950" : "text-ink/60")}>{date.getDate()}</span>
                  <div className="flex flex-1 flex-col gap-0.5">
                    {visible.map((e) => (
                      <span
                        key={e.id}
                        className={cn(
                          "truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                          e.kind === "training" ? "text-forest-800/70 italic" : e.kind === "tournament" ? "bg-amber-500/10 text-amber-900" : (e.statusClass ?? "bg-ink/5 text-ink/70")
                        )}
                      >
                        {e.kind === "training" ? "Training" : e.kind === "tournament" ? `Tournament · ${e.tournamentHostName}` : `${e.homeAway === "Home" ? "H" : "A"} ${e.opposition}`}
                      </span>
                    ))}
                    {overflow > 0 && <span className="text-[10px] font-medium text-ink/45">+{overflow} more</span>}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <Sheet open={selectedDay !== null} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <SheetContent>
          {selectedDay && (
            <>
              <SheetHeader>
                <SheetTitle>{new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <ul className="flex flex-col gap-2">
                  {dayEntries.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEntry(e)
                          setEditing(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-left outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        {e.kind === "training" ? (
                          <Dumbbell className="size-3.5 shrink-0 text-forest-800/60" />
                        ) : e.kind === "tournament" ? (
                          <Trophy className="size-3.5 shrink-0 text-amber-700" />
                        ) : (
                          e.needsAction && <AlertTriangle className="size-3.5 shrink-0 text-amber-700" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {e.kind === "tournament" ? `Tournament · ${e.tournamentHostName}` : laneLabel(e.laneId)}
                            {e.kind === "fixture" ? ` vs ${e.opposition}` : e.kind === "training" ? " training" : ""}
                          </span>
                          <span className="block text-xs text-ink/50">
                            {e.kind === "fixture" ? `${e.homeAway} · ` : ""}
                            {e.time ? e.time.slice(0, 5) : "Time TBC"}
                          </span>
                        </span>
                        {e.kind !== "tournament" && <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", e.statusClass)}>{e.status}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                {clubId && creatableLanes.length > 0 && (
                  <div className="border-t border-ink/10 pt-3">
                    {addingLaneId ? (
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => setCreateOpen(true)}
                          label={`Add fixture for ${addingLane?.label}`}
                        />
                        <button type="button" onClick={() => setAddingLaneId(null)} className="text-xs font-medium text-ink/50 underline hover:text-ink">
                          Change team
                        </button>
                      </div>
                    ) : creatableLanes.length === 1 ? (
                      <Button onClick={() => { setAddingLaneId(creatableLanes[0].id); setCreateOpen(true) }} label={`Add fixture for ${creatableLanes[0].label}`} />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="w-full text-xs text-ink/45">Add fixture for&hellip;</span>
                        {creatableLanes.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              setAddingLaneId(l.id)
                              setCreateOpen(true)
                            }}
                            className="rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:border-pitch-600 hover:text-ink"
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEntry(null)
            setEditing(false)
          }
        }}
      >
        <SheetContent>
          {selectedEntry && selectedEntry.kind === "tournament" && <TournamentQuickView entry={selectedEntry} onChanged={() => setSelectedEntry(null)} />}
          {selectedEntry && selectedEntry.kind !== "tournament" && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedEntry.kind === "training" ? `${laneLabel(selectedEntry.laneId)} training` : `${laneLabel(selectedEntry.laneId)} vs ${selectedEntry.opposition}`}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink/70">
                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", selectedEntry.statusClass)}>{selectedEntry.status}</span>
                  {selectedEntry.resultLabel && <span className="font-medium text-ink">{selectedEntry.resultLabel}</span>}
                </div>
                {!editing && (
                  <>
                    <dl className="flex flex-col gap-1.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink/50">Date</dt>
                        <dd className="text-ink">
                          {new Date(`${selectedEntry.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                          {selectedEntry.time ? ` · ${selectedEntry.time.slice(0, 5)}` : ""}
                        </dd>
                      </div>
                      {selectedEntry.kind === "fixture" && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink/50">Home / Away</dt>
                          <dd className="text-ink capitalize">{selectedEntry.homeAway}</dd>
                        </div>
                      )}
                      {selectedEntry.venueAddress && (
                        <div className="flex justify-between gap-3">
                          <dt className="shrink-0 text-ink/50">Venue</dt>
                          <dd className="text-right text-ink">{selectedEntry.venueAddress}</dd>
                        </div>
                      )}
                      {selectedEntry.pitchName && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink/50">Pitch</dt>
                          <dd className="text-ink">{selectedEntry.pitchName}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-1 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
                      {selectedEntry.kind === "fixture" && selectedEntry.canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Edit
                        </button>
                      )}
                      {selectedEntry.kind === "fixture" && (
                        <Link
                          href="/fixtures"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          Open Fixture
                        </Link>
                      )}
                      {selectedEntry.kind === "fixture" && (
                        <Link
                          href={`/messages/fixture/${selectedEntry.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          <MessageSquare className="size-3.5" />
                          Open Conversation
                        </Link>
                      )}
                      {selectedEntry.venueAddress && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEntry.venueAddress)}`}
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
                {editing && selectedEntry.kind === "fixture" && selectedEntry.owningTeamId && (
                  <FixtureEditPanel
                    fixture={{
                      id: selectedEntry.id,
                      owningTeamId: selectedEntry.owningTeamId,
                      owningTeamName: laneLabel(selectedEntry.laneId) || "Your team",
                      opponentTeamId: selectedEntry.opponentTeamId,
                      opponentDirectoryId: selectedEntry.opponentDirectoryId,
                      oppositionText: selectedEntry.opposition,
                      kickoffDate: selectedEntry.date,
                      kickoffTime: selectedEntry.time,
                      status: selectedEntry.status,
                      competitionEditionId: selectedEntry.competitionEditionId,
                      pitchId: selectedEntry.pitchId,
                      notes: selectedEntry.notes,
                    }}
                    competitions={competitions}
                    pitches={pitches}
                    onSaved={() => {
                      setEditing(false)
                      setSelectedEntry(null)
                    }}
                    onCancel={() => setEditing(false)}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {addingLane && addingLane.primaryTeamId && clubId && selectedDay && (
        <CreateFixtureDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) setAddingLaneId(null)
          }}
          clubId={clubId}
          teamOptions={allLanes.filter((l) => l.canCreate && l.primaryTeamId).map((l) => ({ id: l.primaryTeamId!, label: l.fullLabel }))}
          defaultTeamId={addingLane.primaryTeamId}
          date={selectedDay}
          rugbyCode={rugbyCode}
          season={season}
          range={range}
          competitions={competitions}
          pitches={pitches}
          onWantTournament={() => {
            setCreateOpen(false)
            setCreateTournamentOpen(true)
          }}
        />
      )}

      {addingLane && addingLane.primaryTeamId && clubId && selectedDay && (
        <AddFixtureDialog
          open={createTournamentOpen}
          onOpenChange={(open) => {
            setCreateTournamentOpen(open)
            if (!open) setAddingLaneId(null)
          }}
          hideTrigger
          lockedClubId={clubId}
          lockedClubName={clubName}
          initialTeamId={addingLane.primaryTeamId}
          initialTeamLabel={addingLane.label}
          initialDate={selectedDay}
          initialTournament
        />
      )}
    </>
  )
}

function Button({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-forest-950 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  )
}
