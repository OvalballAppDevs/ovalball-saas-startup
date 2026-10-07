/**
 * THE ARENA READS AND WRITES -- one call each, never one per resource or per card.
 *
 * Every write goes through the server, which decides authority (the club's pitch-allocation permission,
 * never a client role), checks every placement with the one occupancy engine, and refuses a clash, a
 * stale plan or a locked part in words. A refusal is thrown as the server's own error so the screen can
 * say exactly what it said.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Json } from "../database"
import type {
  AllocationOptions,
  AllocationPreview,
  AllocationPart,
  ArenaChange,
  ArenaDay,
  ArenaHub,
  ArenaPreferences,
  ArenaRange,
  PreferencePurpose,
} from "./types"

type Client = SupabaseClient<Database>

/** The Arena Hub: the club's estate, what is in use now, today at the club and the week ahead. */
export async function readArenaHub(supabase: Client, clubId: string): Promise<ArenaHub> {
  const { data, error } = await supabase.rpc("get_arena_hub", { p_club_id: clubId })
  if (error) throw error
  return data as unknown as ArenaHub
}

/** One day of the estate, whole: activities, occupancy, clashes, readiness and catering counts. */
export async function readArenaDay(supabase: Client, clubId: string, date: string): Promise<ArenaDay> {
  const { data, error } = await supabase.rpc("get_arena_day", { p_club_id: clubId, p_date: date })
  if (error) throw error
  return data as unknown as ArenaDay
}

/** A week or a month, a day at a time, for the Week and Month views. */
export async function readArenaRange(supabase: Client, clubId: string, from: string, until: string): Promise<ArenaRange> {
  const { data, error } = await supabase.rpc("get_arena_range", { p_club_id: clubId, p_from: from, p_until: until })
  if (error) throw error
  return data as unknown as ArenaRange
}

/** Every ground, pitch and room one activity could have, each with its state and the engine's reason. */
export async function readAllocationOptions(supabase: Client, kind: "FIXTURE" | "TRAINING", id: string): Promise<AllocationOptions> {
  const { data, error } = await supabase.rpc("get_arena_allocation_options", { p_kind: kind, p_id: id })
  if (error) throw error
  return data as unknown as AllocationOptions
}

/**
 * AUTO ALLOCATE, as a proposal: computed on the server, returned, never stored. `rerun` recalculates what
 * Arena placed itself before; a person's allocation and anything locked stay.
 */
export async function previewArenaAllocation(
  supabase: Client,
  clubId: string,
  date: string,
  options: { venueId?: string | null; rerun?: boolean } = {}
): Promise<AllocationPreview> {
  const { data, error } = await supabase.rpc("preview_arena_allocation", {
    p_club_id: clubId,
    p_date: date,
    ...(options.venueId ? { p_venue_id: options.venueId } : {}),
    p_rerun: options.rerun ?? false,
  })
  if (error) throw error
  return data as unknown as AllocationPreview
}

/**
 * APPLY: every change in one transaction through the canonical writers. `source` says whose decision it
 * is -- AUTO for an applied proposal (re-runs may recalculate it), MANUAL for a person's (they may not).
 */
export async function applyArenaAllocation(
  supabase: Client,
  clubId: string,
  date: string,
  changes: ArenaChange[],
  source: "AUTO" | "MANUAL"
): Promise<{ applied: number; notified: number; kickoffProposed: string[] }> {
  const { data, error } = await supabase.rpc("apply_arena_allocation", {
    p_club_id: clubId,
    p_date: date,
    p_changes: changes as unknown as Json,
    p_source: source,
  })
  if (error) throw error
  return data as unknown as { applied: number; notified: number; kickoffProposed: string[] }
}

/** Lock (or unlock) the parts of an allocation automatic allocation must leave alone. */
export async function setArenaLock(supabase: Client, kind: "FIXTURE" | "TRAINING", id: string, locks: AllocationPart[]): Promise<AllocationPart[]> {
  const { data, error } = await supabase.rpc("set_arena_lock", { p_kind: kind, p_id: id, p_locks: locks })
  if (error) throw error
  return ((data as unknown as { locks: AllocationPart[] }) ?? { locks: [] }).locks
}

/** The club's changing-room times. A value left null inherits the platform default. */
export async function saveArenaSettings(
  supabase: Client,
  clubId: string,
  patch: { roomAccessMinutes?: number | null; roomReleaseMinutes?: number | null; roomTurnaroundMinutes?: number | null }
): Promise<{ roomAccess: number; roomRelease: number; roomTurnaround: number; roomSource: "club" | "platform" }> {
  const { data, error } = await supabase.rpc("save_arena_settings", { p_club_id: clubId, p_patch: patch as unknown as Json })
  if (error) throw error
  return data as unknown as { roomAccess: number; roomRelease: number; roomTurnaround: number; roomSource: "club" | "platform" }
}

/** What is booked on a ground, a pitch or a changing room from today, by kind -- said before it is switched off. */
export interface ResourceBookingsAhead {
  from: string
  bookings: { kind: "FIXTURE" | "TRAINING" | "TOURNAMENT" | "EVENT"; count: number; first: string }[]
}

export async function readResourceBookingsAhead(supabase: Client, resourceType: "VENUE" | "PITCH" | "ROOM", resourceId: string): Promise<ResourceBookingsAhead> {
  const { data, error } = await supabase.rpc("get_resource_bookings_ahead", { p_resource_type: resourceType, p_resource_id: resourceId })
  if (error) throw error
  return data as unknown as ResourceBookingsAhead
}

/**
 * THE BOOKINGS AHEAD, IN WORDS, for the deactivation step: "2 fixtures, 2 training sessions and 1 tournament from
 * Sunday 25 October" -- or null when nothing is booked.
 */
export function bookingsAheadSentence(b: ResourceBookingsAhead | null): string | null {
  if (!b || b.bookings.length === 0) return null
  const words: Record<ResourceBookingsAhead["bookings"][number]["kind"], [string, string]> = {
    FIXTURE: ["fixture", "fixtures"], TRAINING: ["training session", "training sessions"],
    TOURNAMENT: ["tournament", "tournaments"], EVENT: ["event", "events"],
  }
  const parts = (["FIXTURE", "TRAINING", "TOURNAMENT", "EVENT"] as const)
    .map((k) => b.bookings.find((x) => x.kind === k))
    .filter((x): x is NonNullable<typeof x> => !!x && x.count > 0)
    .map((x) => `${x.count} ${words[x.kind][x.count === 1 ? 0 : 1]}`)
  if (parts.length === 0) return null
  const first = b.bookings.reduce((m, x) => (x.first < m ? x.first : m), b.bookings[0].first)
  const [y, mo, d] = first.split("-").map(Number)
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, d)))
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
  return `${list} ${parts.length === 1 && b.bookings[0].count === 1 ? "is" : "are"} booked on it from ${day}.`
}

/** The club's default preferences, every team's own, and the club's grounds, pitches and rooms. */
export async function readArenaPreferences(supabase: Client, clubId: string): Promise<ArenaPreferences> {
  const { data, error } = await supabase.rpc("get_arena_preferences", { p_club_id: clubId })
  if (error) throw error
  return data as unknown as ArenaPreferences
}

/**
 * Save one ranked list -- the club's default (`teamId` null) or a team's -- for one purpose. An empty
 * list removes it, so the team uses the club's default again.
 */
export async function saveFacilityPreferences(
  supabase: Client,
  clubId: string,
  teamId: string | null,
  purpose: PreferencePurpose,
  resourceIds: string[]
): Promise<{ purpose: PreferencePurpose; teamId: string | null; resourceIds: string[]; source: "TEAM" | "CLUB" | null }> {
  const { data, error } = await supabase.rpc("save_facility_preferences", {
    p_club_id: clubId,
    p_team_id: teamId as string,
    p_purpose: purpose,
    p_resource_ids: resourceIds,
  })
  if (error) throw error
  return data as unknown as { purpose: PreferencePurpose; teamId: string | null; resourceIds: string[]; source: "TEAM" | "CLUB" | null }
}
