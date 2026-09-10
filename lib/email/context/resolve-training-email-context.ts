import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { formatDateLong, formatTimeRange } from "@/lib/email/dynamic-data/format"
import type { Database } from "@/types/database.types"

/**
 * THE CANONICAL TRAINING EMAIL CONTEXT.
 *
 * Same shape of reasoning as resolve-fixture-email-context.ts: this answers
 * "what is this training session" for whichever recipient is reading it,
 * built from `public.training_sessions` and the same venue/pitch/team tables
 * the rest of the product already treats as canonical. It does NOT invent a
 * home/away or opposition concept -- training has neither, and fabricating
 * one to look consistent with the fixture context would be describing
 * something that did not happen.
 *
 * There is currently no email event that sends this. It exists so the
 * Dynamic Data catalogue and a future training-notification event have a
 * single, already-reviewed resolver to build on, exactly as
 * resolve-fixture-email-context.ts did before match_cancelled existed.
 */

export type TrainingEmailStatus = "PLANNED" | "CANCELLED" | "COMPLETED"

export interface TrainingEmailVenue {
  name: string | null
  addressLines: string[]
  postcode: string | null
}

export interface TrainingEmailContext {
  trainingSessionId: string
  status: TrainingEmailStatus
  teamName: string | null
  clubName: string
  /** UK long form, e.g. "Wednesday 9 September 2026". */
  sessionDateDisplay: string
  sessionDateIso: string
  /** "18:00-19:30", or a single time when there is no end, or null when neither is set. */
  timeRangeDisplay: string | null
  venue: TrainingEmailVenue | null
  pitchName: string | null
  cancellationReason: string | null
}

export type TrainingEmailContextResolution =
  | { status: "available"; context: TrainingEmailContext }
  | { status: "not_found" }

export async function resolveTrainingEmailContext(
  supabase: SupabaseClient<Database>,
  trainingSessionId: string
): Promise<TrainingEmailContextResolution> {
  const { data: s } = await supabase
    .from("training_sessions")
    .select(
      "id, club_id, team_id, session_date, start_time, end_time, pitch_id, venue_id, status, cancelled_at, cancellation_reason, clubs(club_directory(name)), teams(display_name)"
    )
    .eq("id", trainingSessionId)
    .maybeSingle()

  if (!s) return { status: "not_found" }

  const [venueRow, pitchRow] = await Promise.all([
    s.venue_id
      ? supabase.from("venues").select("name, address_line_1, address_line_2, town, county, postcode").eq("id", s.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    s.pitch_id ? supabase.from("club_pitches").select("display_name").eq("id", s.pitch_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const venue = venueRow.data
  const club = s.clubs as unknown as { club_directory: { name: string } | null } | null
  const team = s.teams as unknown as { display_name: string } | null

  const status: TrainingEmailStatus = s.cancelled_at ? "CANCELLED" : s.status === "COMPLETED" ? "COMPLETED" : "PLANNED"

  return {
    status: "available",
    context: {
      trainingSessionId: s.id,
      status,
      teamName: team?.display_name ?? null,
      clubName: club?.club_directory?.name ?? "Ovalball",
      sessionDateDisplay: formatDateLong(s.session_date),
      sessionDateIso: s.session_date,
      timeRangeDisplay: formatTimeRange(s.start_time, s.end_time),
      venue: venue
        ? {
            name: venue.name,
            addressLines: [venue.address_line_1, venue.address_line_2, venue.town, venue.county].filter(
              (l): l is string => Boolean(l && l.trim())
            ),
            postcode: venue.postcode,
          }
        : null,
      pitchName: pitchRow.data?.display_name ?? null,
      cancellationReason: s.cancellation_reason,
    },
  }
}
