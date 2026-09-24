import type { AgendaItem } from "../agenda/load"
import { needsAttendanceResponse } from "../parent/agenda-model"

/**
 * ONE EVENT, EVERY CHILD IN IT (CA-M9).
 *
 * The agenda reads one row per (event, child), because each child's answer is its own canonical
 * record. A family with two children on the same side therefore reads the same match twice -- which
 * is the truth of the records and a lie on a screen: there is one match, and both children are going
 * to it. This collapses rows onto the event's canonical identity (`kind:eventId`) and carries every
 * child's association beside it, so a list shows one match with two names and two answers rather than
 * two matches. Presentation only: nothing is merged in the domain, and a single child's row is the
 * same row it always was.
 */
export interface FamilyEventChild {
  playerId: string
  firstName: string | null
  attendance: AgendaItem["attendance"]
  /** The child's own row, so an answer is written against the right record. */
  item: AgendaItem
}

export interface FamilyEvent {
  /** `kind:eventId` -- the canonical event, not a child's copy of it. */
  key: string
  kind: AgendaItem["kind"]
  eventId: string
  date: string
  /** The first row read for the event; every event-level fact is the same on every child's row. */
  item: AgendaItem
  children: FamilyEventChild[]
}

export function collapseFamilyEvents(items: AgendaItem[]): FamilyEvent[] {
  const byEvent = new Map<string, FamilyEvent>()
  const order: string[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.eventId}`
    let event = byEvent.get(key)
    if (!event) {
      event = { key, kind: item.kind, eventId: item.eventId, date: item.date, item, children: [] }
      byEvent.set(key, event)
      order.push(key)
    }
    // A row with no child (a staff scope) is the event itself; a row with a child is one association.
    if (item.playerId && !event.children.some((c) => c.playerId === item.playerId)) {
      event.children.push({ playerId: item.playerId, firstName: item.childFirstName, attendance: item.attendance, item })
    }
  }
  return order.map((key) => byEvent.get(key)!)
}

/** Whether any child in the event still owes an answer, by the one canonical rule. */
export function eventNeedsAnswer(event: FamilyEvent, todayIso: string): boolean {
  return event.children.some((c) => needsAttendanceResponse(c.item, todayIso))
}

/** Group collapsed events by day, in the order given. */
export function groupFamilyEventsByDay(events: FamilyEvent[]): { date: string; events: FamilyEvent[] }[] {
  const days: { date: string; events: FamilyEvent[] }[] = []
  for (const event of events) {
    const last = days[days.length - 1]
    if (last && last.date === event.date) last.events.push(event)
    else days.push({ date: event.date, events: [event] })
  }
  return days
}
