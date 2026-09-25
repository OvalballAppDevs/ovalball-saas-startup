import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * SHARED SCHEDULING AVAILABILITY (CA-M11.4) -- "when can these two teams realistically play?"
 *
 * The one read model both clients use to answer that question while composing a fixture request. Backed
 * entirely by `public.team_scheduling_availability` (a SECURITY DEFINER RPC, not a client query over
 * fixtures/training_sessions -- see that function's own migration comment for why a direct client query
 * cannot work cross-club). The server returns a COARSE status per day, never event detail: exactly one
 * of the five values below, for any team the caller could legitimately raise a fixture request from --
 * never event names, never an opponent, never training content, never attendance.
 */

export type DayAvailability = "available" | "fixture" | "training" | "club_event" | "request_pending"

export interface TeamAvailabilityDay {
  date: string
  status: DayAvailability
}

/** Human words, never a raw status value. "Busy" language throughout -- the caller does not need to
 * know whether a commitment is a fixture, training or a club event to know a date is under pressure;
 * `availabilityDetailLabel` below is for OUR OWN side, where showing which kind is legitimate and useful. */
export function availabilityLabel(status: DayAvailability): string {
  if (status === "available") return "Available"
  if (status === "request_pending") return "Request pending"
  return "Busy"
}

/** The more specific word, for OUR OWN team's own calendar only -- never used to describe a partner's
 * day, where only the coarse "Busy" is legitimate to show (Section 15's own instruction). */
export function availabilityDetailLabel(status: DayAvailability): string {
  if (status === "available") return "Available"
  if (status === "fixture") return "Fixture"
  if (status === "training") return "Training"
  if (status === "club_event") return "Club event"
  return "Request pending"
}

const MAX_RANGE_DAYS = 90

function isoDaysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000)
}

/**
 * Reads one team's coarse availability over a bounded range. The SAME function is used for "our own"
 * team (viewerTeamId === targetTeamId, always permitted -- the caller may always see their own
 * scheduling picture) and for a prospective opponent's team (viewerTeamId is the caller's own team,
 * proving the legitimate scheduling intent the server's authority check requires).
 */
export async function readTeamAvailability(supabase: Client, viewerTeamId: string, targetTeamId: string, fromIso: string, toIso: string): Promise<TeamAvailabilityDay[]> {
  if (isoDaysBetween(fromIso, toIso) > MAX_RANGE_DAYS) {
    throw new Error(`Date range must be ${MAX_RANGE_DAYS} days or fewer.`)
  }
  const { data, error } = await supabase.rpc("team_scheduling_availability", {
    p_viewer_team_id: viewerTeamId,
    p_target_team_id: targetTeamId,
    p_from: fromIso,
    p_to: toIso,
  })
  if (error) throw error
  return (data ?? []).map((r) => ({ date: r.the_date, status: r.status as DayAvailability }))
}

/** One day's compare result -- our own status, the partner's (coarse, or "unknown" when there is no
 * specific Ovalball opponent team to ask yet), and whether it is a genuinely good option for both sides. */
export interface CompareDay {
  date: string
  ours: DayAvailability
  /** null when the partner side has not been read yet (e.g. no compatible opponent team chosen) --
   * "Partner availability unknown" (Section 20's own required wording), never claimed as available. */
  partner: DayAvailability | null
  isGoodOption: boolean
}

/** Pure -- no I/O. Combines two already-read availability lists into one per-day compare view. */
export function compareAvailability(ownDays: TeamAvailabilityDay[], partnerDays: TeamAvailabilityDay[] | null): CompareDay[] {
  const partnerByDate = partnerDays ? new Map(partnerDays.map((d) => [d.date, d.status])) : null
  return ownDays.map((o) => {
    const partner = partnerByDate ? (partnerByDate.get(o.date) ?? null) : null
    return { date: o.date, ours: o.status, partner, isGoodOption: o.status === "available" && partner === "available" }
  })
}

/** The dates a "Find a Date" search should surface -- available to both sides, in date order. Never a
 * score, never a ranking beyond chronological (Section 19's own instruction: "Do not assign an opaque
 * AI score. Simply surface factual scheduling compatibility."). */
export function findGoodDates(compareDays: CompareDay[]): string[] {
  return compareDays.filter((d) => d.isGoodOption).map((d) => d.date)
}
