"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarHeart, MapPin, Plus, Users } from "lucide-react"

import { formatEventDateRange } from "@/lib/app-context/event-centre-data"
import { cn } from "@/lib/utils"

import { CancelEventDialog } from "./cancel-event-dialog"
import { EventForm, type EventPitchOption, type EventTeamOption, type EventVenueOption } from "./event-form"

export interface ManagedEvent {
  id: string
  name: string
  description: string | null
  startsOn: string
  startTime: string | null
  endsOn: string
  endTime: string | null
  isClubWide: boolean
  status: string
  venueId: string | null
  locationName: string | null
  teamIds: string[]
  pitchIds: string[]
}

/**
 * The club's events, and the one control that creates them.
 *
 * A LIST AND AN EDITOR, not a second Event Centre. Each row states what an
 * administrator needs in order to find the right event -- what, when, who for,
 * how many pitches -- and offers the two things they came to do: edit it here,
 * or open the participant's view of it. Everything a participant sees lives at
 * /events/[eventId] and is not duplicated into this page.
 */
export function EventsManager({
  clubId,
  teams,
  venues,
  pitches,
  events,
  canCreateClubWide,
  focusEventId,
  focusAction,
}: {
  clubId: string
  teams: EventTeamOption[]
  venues: EventVenueOption[]
  pitches: EventPitchOption[]
  events: ManagedEvent[]
  canCreateClubWide: boolean
  /** Arriving from Event Centre's own Edit/Cancel action, so it opens on that event. */
  focusEventId: string | null
  focusAction: "edit" | "cancel" | null
}) {
  // ARRIVING FROM EVENT CENTRE. Its Edit and Cancel actions link here with the
  // event id, so the administrator lands on the thing they pressed rather than
  // on a list they then have to search. Derived as initial state, not an
  // effect: the URL is already known at first render, and an effect would
  // paint the list first and then jump.
  const focused = focusEventId ? (events.find((e) => e.id === focusEventId) ?? null) : null
  const [formOpen, setFormOpen] = useState(Boolean(focused) && focusAction !== "cancel")
  const [editing, setEditing] = useState<ManagedEvent | null>(focusAction === "cancel" ? null : focused)
  const [cancelling, setCancelling] = useState<ManagedEvent | null>(focusAction === "cancel" ? focused : null)

  const teamLabel = (ids: string[]) => {
    const names = ids.map((id) => teams.find((t) => t.id === id)?.label).filter(Boolean) as string[]
    if (names.length === 0) return "No teams"
    if (names.length <= 2) return names.join(" · ")
    return `${names.slice(0, 2).join(" · ")} +${names.length - 2} more`
  }

  return (
    <>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-forest-950 px-4 text-sm font-medium text-white transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-10"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add Event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-ink/10 bg-white px-5 py-12 text-center">
          <p className="font-display text-lg text-ink">No events yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">
            When your club puts on a social, a fundraiser or an open day, add it here and it will appear on everyone&rsquo;s calendar.
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {events.map((e) => {
            const cancelled = e.status === "CANCELLED"
            return (
              <li key={e.id} className={cn("overflow-hidden rounded-2xl border border-ink/10 bg-white", cancelled && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <CalendarHeart className="size-4 shrink-0 text-[#6d3b5d]" aria-hidden="true" />
                      <span className={cn("font-display text-base text-ink", cancelled && "line-through")}>{e.name}</span>
                      {cancelled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">Cancelled</span>}
                    </p>
                    <p className="mt-1.5 text-sm text-ink-muted">
                      {formatEventDateRange(e.startsOn, e.endsOn)}
                      {e.startTime ? ` · ${e.startTime.slice(0, 5)}` : " · All day"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3 shrink-0" aria-hidden="true" />
                        {e.isClubWide ? "All Teams" : teamLabel(e.teamIds)}
                      </span>
                      {e.pitchIds.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          {e.pitchIds.length} {e.pitchIds.length === 1 ? "pitch" : "pitches"} reserved
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(e)
                        setFormOpen(true)
                      }}
                      className="inline-flex min-h-11 items-center rounded-lg border border-ink/12 bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
                    >
                      Edit
                    </button>
                    {/* Cancel is offered only while there is something to
                        cancel -- an already-cancelled event has no second
                        cancellation state to enter. */}
                    {!cancelled && (
                      <button
                        type="button"
                        onClick={() => setCancelling(e)}
                        className="inline-flex min-h-11 items-center rounded-lg border border-destructive/30 bg-white px-3 text-sm font-medium text-destructive-text transition-colors hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
                      >
                        Cancel Event
                      </button>
                    )}
                    <Link
                      href={`/events/${e.id}`}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
                    >
                      View Event Centre
                    </Link>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Keyed so switching between "add" and editing a specific event
          remounts the form with that event's own values, rather than leaving
          the previous one's state behind in the fields. */}
      {cancelling && (
        <CancelEventDialog
          eventId={cancelling.id}
          eventName={cancelling.name}
          dateLabel={formatEventDateRange(cancelling.startsOn, cancelling.endsOn)}
          onClose={() => setCancelling(null)}
        />
      )}

      <EventForm
        key={editing?.id ?? "new"}
        clubId={clubId}
        teams={teams}
        venues={venues}
        pitches={pitches}
        canCreateClubWide={canCreateClubWide}
        existing={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </>
  )
}
