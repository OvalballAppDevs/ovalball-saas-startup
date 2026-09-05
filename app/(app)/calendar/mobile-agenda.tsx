"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Dumbbell, MapPin, MessageSquare, Plus, Trophy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { clampIsoToRange } from "@/lib/calendar/season-window"
import { cn } from "@/lib/utils"

import { AddFixtureDialog } from "../admin/fixtures/add-fixture-dialog"
import { CreateFixtureDialog, type CompetitionOption } from "./create-fixture-dialog"
import { FixtureEditPanel } from "./fixture-edit-panel"
import { TournamentQuickView, type Lane, type TournamentPitchOption, type WeekEntry } from "./week-board"

/**
 * Mobile agenda's own fixture/training detail Sheet -- deliberately a
 * parallel copy of WeekBoard's inline Sheet body (both view and Edit-mode
 * via the shared FixtureEditPanel), not a refactor of the already-correct
 * desktop board into a shared component. WeekBoard's Sheet logic is
 * tightly interleaved with its own lane-grid state; extracting a shared
 * component risked regressing the desktop board for the sake of avoiding
 * ~80 lines of duplication here. TournamentQuickView, by contrast, was
 * already a standalone exported component, so that one IS reused directly
 * (no duplication for tournaments).
 */
function MobileFixtureSheet({
  entry,
  laneLabel,
  competitions,
  pitches,
  editing,
  onEdit,
  onSaved,
  onCancelEdit,
}: {
  entry: WeekEntry
  laneLabel: string
  competitions: CompetitionOption[]
  pitches: TournamentPitchOption[]
  editing: boolean
  onEdit: () => void
  onSaved: () => void
  onCancelEdit: () => void
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{entry.kind === "training" ? `${laneLabel} training` : `${laneLabel} vs ${entry.opposition}`}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink/70">
          <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", entry.statusClass)}>{entry.status}</span>
          {entry.resultLabel && <span className="font-medium text-ink">{entry.resultLabel}</span>}
        </div>
        {!editing && (
          <>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink/50">Date</dt>
                <dd className="text-ink">
                  {new Date(`${entry.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                  {entry.time ? ` · ${entry.time.slice(0, 5)}` : ""}
                </dd>
              </div>
              {entry.kind === "fixture" && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink/50">Home / Away</dt>
                  <dd className="text-ink capitalize">{entry.homeAway}</dd>
                </div>
              )}
              {entry.venueAddress && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-ink/50">Venue</dt>
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
            <div className="mt-1 flex flex-wrap gap-2 border-t border-ink/10 pt-3">
              {entry.kind === "fixture" && entry.canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-forest-950 px-3.5 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Edit
                </button>
              )}
              {entry.kind === "fixture" && (
                <Link
                  href="/fixtures"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Open Fixture
                </Link>
              )}
              {entry.kind === "fixture" && (
                <Link
                  href={`/messages/fixture/${entry.id}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <MessageSquare className="size-3.5" />
                  Open Conversation
                </Link>
              )}
              {entry.venueAddress && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entry.venueAddress)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <MapPin className="size-3.5" />
                  Directions
                </a>
              )}
            </div>
          </>
        )}
        {editing && entry.kind === "fixture" && entry.owningTeamId && (
          <FixtureEditPanel
            fixture={{
              id: entry.id,
              owningTeamId: entry.owningTeamId,
              owningTeamName: laneLabel,
              opponentTeamId: entry.opponentTeamId,
              opponentDirectoryId: entry.opponentDirectoryId,
              oppositionText: entry.opposition,
              kickoffDate: entry.date,
              kickoffTime: entry.time,
              status: entry.status,
              competitionEditionId: entry.competitionEditionId,
              pitchId: entry.pitchId,
              notes: entry.notes,
            }}
            competitions={competitions}
            pitches={pitches}
            onSaved={onSaved}
            onCancel={onCancelEdit}
          />
        )}
      </div>
    </>
  )
}

/**
 * Mobile Calendar (<768px) -- a compact date-grouped agenda list, never a
 * squeezed lanes grid. Previously read-only (Calendar mega-spec's own
 * design-quality pass flagged this as a real gap: every desktop
 * interactivity feature -- fixture popup, edit mode, click-to-create,
 * Tournament UI -- had no mobile equivalent at all). Now wired to the
 * exact same Sheet/edit/create/tournament components the desktop board
 * uses, so a Club Admin working from a touchline phone gets full parity,
 * not a read-only fallback.
 */
export function MobileAgenda({
  entries,
  lanes,
  allLanes,
  canScheduleTraining,
  hasClubFixtureAuthority,
  clubId,
  clubName,
  rugbyCode,
  season,
  range,
  competitions,
  pitches,
}: {
  entries: WeekEntry[]
  lanes: Lane[]
  allLanes: Lane[]
  canScheduleTraining: boolean
  hasClubFixtureAuthority: boolean
  clubId: string | null
  clubName?: string
  rugbyCode: string | null
  season: { id: string; label: string } | null
  /** Pre-Season/Main-Season date-boundary addendum: bounds the "Add fixture" date picker. Existing entries always render (informational, read-only history) -- only new-date selection is bounded. */
  range: { start: string; end: string } | null
  competitions: CompetitionOption[]
  pitches: TournamentPitchOption[]
}) {
  const [selected, setSelected] = useState<WeekEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [addLaneId, setAddLaneId] = useState<string>("")
  const [addDate, setAddDate] = useState<string>(() => {
    const today = new Date().toISOString().slice(0, 10)
    return range ? clampIsoToRange(today, range) : today
  })
  const [createSlot, setCreateSlot] = useState<{ laneId: string; date: string } | null>(null)
  const [createTournamentSlot, setCreateTournamentSlot] = useState<{ laneId: string; date: string } | null>(null)

  const laneLabel = (laneId: string) => lanes.find((l) => l.id === laneId)?.label ?? ""
  const creatableLanes = lanes.filter((l) => l.canCreate && l.primaryTeamId)
  const canShowAdd = hasClubFixtureAuthority && clubId && creatableLanes.length > 0

  const createLane = createSlot ? lanes.find((l) => l.id === createSlot.laneId) : null
  const createTournamentLane = createTournamentSlot ? lanes.find((l) => l.id === createTournamentSlot.laneId) : null

  const grouped = new Map<string, WeekEntry[]>()
  for (const e of entries) grouped.set(e.date, [...(grouped.get(e.date) ?? []), e])

  return (
    <>
      {canShowAdd && (
        <div className="mb-4">
          <Button type="button" className="h-11 w-full justify-center gap-1.5" onClick={() => setAddPickerOpen(true)}>
            <Plus className="size-4" />
            Add fixture
          </Button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <p className="text-sm font-medium text-ink">No fixtures or training this period.</p>
          {canScheduleTraining && <p className="text-xs text-ink/45">Use &ldquo;Schedule training&rdquo; above to add a session.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {Array.from(grouped.entries()).map(([date, dayEntries]) => (
            <section key={date}>
              <h2 className="text-xs font-semibold tracking-wide text-ink/50 uppercase">
                {new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
              </h2>
              <ul className="mt-2 flex flex-col gap-2">
                {dayEntries.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(e)
                        setEditing(false)
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-left outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      {e.kind === "training" ? (
                        <Dumbbell className="size-3.5 shrink-0 text-forest-800/60" />
                      ) : e.kind === "tournament" ? (
                        <Trophy className="size-3.5 shrink-0 text-amber-700" />
                      ) : e.needsAction ? (
                        <AlertTriangle className="size-3.5 shrink-0 text-amber-700" />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {e.kind === "tournament" ? `Tournament · ${e.tournamentHostName}` : laneLabel(e.laneId)}
                          {e.kind === "fixture" ? ` vs ${e.opposition}` : e.kind === "training" ? " training" : ""}
                        </span>
                        <span className="block text-xs text-ink/50">
                          {e.kind === "fixture" ? `${e.homeAway} · ` : ""}
                          {e.kind === "tournament" ? `${e.tournamentParticipantCount ?? 0} team${e.tournamentParticipantCount === 1 ? "" : "s"} · ` : ""}
                          {e.time ? e.time.slice(0, 5) : "Time TBC"}
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", e.statusClass)}>{e.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

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
          {selected && selected.kind === "tournament" && <TournamentQuickView entry={selected} onChanged={() => setSelected(null)} />}
          {selected && selected.kind !== "tournament" && (
            <MobileFixtureSheet
              entry={selected}
              laneLabel={laneLabel(selected.laneId)}
              competitions={competitions}
              pitches={pitches}
              editing={editing}
              onEdit={() => setEditing(true)}
              onSaved={() => {
                setEditing(false)
                setSelected(null)
              }}
              onCancelEdit={() => setEditing(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={addPickerOpen} onOpenChange={setAddPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a fixture</DialogTitle>
            <DialogDescription>Pick the team and date, then choose the opponent and details.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-1">
            <div>
              <label className="text-sm font-medium text-ink/80">Team</label>
              <select
                value={addLaneId}
                onChange={(e) => setAddLaneId(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                <option value="">Select a team&hellip;</option>
                {creatableLanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.fullLabel}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-ink/80">Date</label>
              <input
                type="date"
                value={addDate}
                min={range?.start}
                max={range?.end}
                onChange={(e) => setAddDate(range ? clampIsoToRange(e.target.value, range) : e.target.value)}
                className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" className="h-11" />}>Cancel</DialogClose>
            <Button
              type="button"
              className="h-11"
              disabled={!addLaneId || !addDate}
              onClick={() => {
                setAddPickerOpen(false)
                setCreateSlot({ laneId: addLaneId, date: addDate })
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            // Same deliberate tick of grace as WeekBoard's own onWantTournament --
            // both dialogs unmount/mount off different slot state, and swapping
            // them within the same tick was found to occasionally race Base UI's
            // dialog portal teardown.
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
