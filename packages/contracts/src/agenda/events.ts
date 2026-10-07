import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadScheduleGrounds, type ScheduleGround } from "./grounds"
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
  /** The sides it is for, by canonical id -- what a screen filters on. `teamNames` is only for reading. */
  teamIds: string[]
  /** The club ground, or the external place, in one line. */
  where: string | null
  status: string | null
  cancelled: boolean
  /** 20270729: what kind of event, who hosts it, and the club's crest for the card. */
  eventType: string
  hostTeamName: string | null
  hostTeamId: string | null
  clubName: string | null
  clubLogoPath: string | null
  postponed: boolean
}

const EVENT_FIELDS =
  "id, club_id, name, description, starts_on, ends_on, start_time, end_time, is_club_wide, status, cancelled_at, external_location_name, external_town, location_kind, event_type, venue_id, host_team_id, venues(name), host:teams!club_events_host_team_id_fkey(display_name), clubs(logo_storage_path, club_directory(name, logo_storage_path)), club_event_teams(team_id, teams(display_name))"

/**
 * `clubIds` null reads every event this person may see in the window, at any club -- the row rule already
 * decides that (organisers, the invited, and a club's members for an event shown to the whole club).
 */
export async function loadClubEvents(supabase: Client, clubIds: string[] | null, window: Pick<DateWindow, "startIso" | "endIso">): Promise<ClubEventItem[]> {
  if (clubIds && clubIds.length === 0) return []
  let query = supabase.from("club_events").select(EVENT_FIELDS)
  if (clubIds) query = query.in("club_id", clubIds)
  const { data, error } = await query
    // A draft is its organisers' alone and is not on anybody's calendar yet -- the organiser included.
    .neq("status", "DRAFT")
    .lte("starts_on", window.endIso)
    .gte("ends_on", window.startIso)
    .order("starts_on", { ascending: true })
    .limit(200)
  if (error) throw error
  /*
    AN INVITED GUEST FROM OUTSIDE THE CLUB cannot read the club's venue rows, so the embed above is empty
    for them. Those events -- and only those -- ask the one ground rule, which answers for any event the
    caller can see. A member's calendar costs no extra request.
  */
  const unnamed = (data ?? [])
    .map((row) => row as unknown as { id: string; venue_id: string | null; venues: { name: string | null } | null })
    .filter((r) => r.venue_id && !r.venues?.name)
    .map((r) => r.id)
  const grounds = unnamed.length ? await loadScheduleGrounds(supabase, { eventIds: unnamed }) : new Map<string, ScheduleGround>()
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
      location_kind: string | null
      event_type: string | null
      host: { display_name: string | null } | null
      host_team_id: string | null
      clubs: { logo_storage_path: string | null; club_directory: { name: string | null; logo_storage_path: string | null } | null } | null
      club_event_teams: { team_id: string; teams: { display_name: string | null } | null }[] | null
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
      teamIds: (r.club_event_teams ?? []).map((t) => t.team_id),
      where:
        r.location_kind === "ONLINE"
          ? "Online"
          : (r.venues?.name ?? grounds.get(r.id)?.name ?? ([r.external_location_name, r.external_town].filter(Boolean).join(", ") || null)),
      status: r.status,
      cancelled: !!r.cancelled_at || r.status === "CANCELLED",
      eventType: r.event_type ?? "SOCIAL",
      hostTeamName: r.host?.display_name ?? null,
      hostTeamId: r.host_team_id,
      clubName: r.clubs?.club_directory?.name ?? null,
      clubLogoPath: r.clubs?.logo_storage_path ?? r.clubs?.club_directory?.logo_storage_path ?? null,
      postponed: r.status === "POSTPONED",
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
