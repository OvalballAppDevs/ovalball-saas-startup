import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { DateWindow } from "./window"

type Client = SupabaseClient<Database>

/**
 * CLUB EVENTS, READ (CA-M10): the club's own calendar entries -- a presentation evening, a tournament
 * day, a work party -- beside fixtures and training. `club_events` is read under its own row rule
 * (`internal.club_event_visible_row`: `calendar.event.view` at the club, or a family on a side the event
 * is for), so this reader decides nothing: it asks for the club's events in a window and gets back the
 * ones this person may see.
 *
 * DELIBERATELY A SEPARATE SHAPE from `AgendaItem`. A fixture has sides, a session has a squad; an event
 * has an audience (the whole club, or named sides) and a place that may not be one of the club's
 * grounds. Folding it into the agenda item would give it a fake opposition or a fake squad.
 *
 * READING an event and DECIDING who is told about it are different problems; this is only the first.
 */
export interface ClubEventItem {
  kind: "event"
  key: string
  eventId: string
  clubId: string
  name: string
  description: string | null
  /** YYYY-MM-DD, inclusive. */
  startsOn: string
  endsOn: string
  startTime: string | null
  endTime: string | null
  isClubWide: boolean
  teamNames: string[]
  /** The club ground, or the external place, in one line. */
  where: string | null
  status: string | null
  cancelled: boolean
}

const EVENT_FIELDS =
  "id, club_id, name, description, starts_on, ends_on, start_time, end_time, is_club_wide, status, cancelled_at, external_location_name, external_town, venues(name), club_event_teams(teams(display_name))"

export async function loadClubEvents(supabase: Client, clubIds: string[], window: Pick<DateWindow, "startIso" | "endIso">): Promise<ClubEventItem[]> {
  if (clubIds.length === 0) return []
  const { data, error } = await supabase
    .from("club_events")
    .select(EVENT_FIELDS)
    .in("club_id", clubIds)
    .lte("starts_on", window.endIso)
    .gte("ends_on", window.startIso)
    .order("starts_on", { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      club_id: string
      name: string
      description: string | null
      starts_on: string
      ends_on: string
      start_time: string | null
      end_time: string | null
      is_club_wide: boolean
      status: string | null
      cancelled_at: string | null
      external_location_name: string | null
      external_town: string | null
      venues: { name: string | null } | null
      club_event_teams: { teams: { display_name: string | null } | null }[] | null
    }
    return {
      kind: "event" as const,
      key: `event:${r.id}`,
      eventId: r.id,
      clubId: r.club_id,
      name: r.name,
      description: r.description,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      startTime: r.start_time ? r.start_time.slice(0, 5) : null,
      endTime: r.end_time ? r.end_time.slice(0, 5) : null,
      isClubWide: r.is_club_wide,
      teamNames: (r.club_event_teams ?? []).map((t) => t.teams?.display_name).filter((n): n is string => !!n),
      where: r.venues?.name ?? [r.external_location_name, r.external_town].filter(Boolean).join(", ") ?? null,
      status: r.status,
      cancelled: !!r.cancelled_at || r.status === "CANCELLED",
    }
  })
}

/** "Whole club" or the sides it is for -- the audience in words, never an id. */
export function eventAudienceLabel(event: Pick<ClubEventItem, "isClubWide" | "teamNames">): string {
  if (event.isClubWide) return "Whole club"
  return event.teamNames.join(", ") || "Selected sides"
}

/** The days an event covers inside a window, so a multi-day event marks each of its days. */
export function eventDays(event: Pick<ClubEventItem, "startsOn" | "endsOn">, startIso: string, endIso: string): string[] {
  const days: string[] = []
  let cursor = event.startsOn < startIso ? startIso : event.startsOn
  const last = event.endsOn > endIso ? endIso : event.endsOn
  while (cursor <= last) {
    days.push(cursor)
    const d = new Date(`${cursor}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    cursor = d.toISOString().slice(0, 10)
  }
  return days
}
