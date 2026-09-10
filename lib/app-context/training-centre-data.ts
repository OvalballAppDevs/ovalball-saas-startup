import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { KitConfig } from "@/components/club/rugby-kit"
import type { Database } from "@/types/database.types"

import { resolveClubLogoUrl } from "./club-logo"
import type { MatchCentrePitch, MatchCentreVenue } from "./match-centre-data"

/**
 * TRAINING CENTRE -- the server-derived view of ONE canonical training session.
 *
 * The same shape as the Match Centre's resolver, for the same reason: the page
 * is a presentation surface, and every authority question is answered HERE,
 * before a component exists. What comes back is already filtered to what this
 * viewer may see, so the page never has a decision to make and never has
 * anything to hide in React.
 *
 * ONE RECORD, NOT A NEW ONE. Everything below is read from the canonical
 * training domain that already existed:
 *
 *   public.get_training_session_card          the session, and this viewer's
 *                                             capabilities over it
 *   public.get_my_players_for_training_session the players this viewer may
 *                                             answer for
 *   public.venues / public.club_pitches       the same two tables Match Centre
 *                                             reads, not a training copy
 *
 * NO SCHEMA WAS INVENTED FOR THIS SURFACE. The audit that preceded it found
 * the attendance model, the safeguarding rule and the register already correct
 * and already shared with fixtures. The one thing it found missing was
 * VISIBILITY -- reading a session was ungated -- and that was fixed in the
 * database, where it belongs, rather than by a check in this file.
 *
 * WHY "not_found" COVERS "not allowed". get_training_session_card raises
 * 42501 for a session the caller may not see and a plain not-found for one
 * that does not exist. Both arrive here as `not_found` and the page renders a
 * 404, so probing ids tells an attacker nothing about which sessions exist.
 */

export type TrainingAttendanceStatus = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"

export interface TrainingSessionIdentity {
  /** THE canonical id. One scheduled session, one of these, everywhere. */
  trainingSessionId: string
  clubId: string
  teamId: string | null
  /** Mini-Rugby and other multi-team arrangements train as a group, not a team. */
  schedulingGroupId: string | null
  /** Canonical display name of the team or group. Never assembled here. */
  teamLabel: string
  sessionDate: string
  startTime: string | null
  endTime: string | null
  durationMinutes: number | null
  status: "PLANNED" | "CANCELLED"
  /** Whether this occurrence came from a recurring plan or was created by hand. */
  source: "MANUAL" | "AUTOMATIC_PLAN"
  /** The recurrence this occurrence belongs to, when it has one. Never used AS the session's identity. */
  trainingPlanId: string | null
  seasonId: string | null
  agenda: string
  furtherNotes: string | null
  cancellationReason: string | null
  cancelledByName: string | null
}

export interface TrainingClubIdentity {
  clubId: string | null
  displayName: string
  logoUrl: string | null
  kit: KitConfig | null
}

/** One player this viewer is entitled to answer for, and their current answer. */
export interface TrainingAttendanceEntry {
  playerId: string
  firstName: string
  displayName: string
  /** True when the player IS the signed-in person, which changes the wording only. */
  isSelf: boolean
  response: TrainingAttendanceStatus | null
  /**
   * MAY THIS VIEWER ACTUALLY ANSWER FOR THIS PLAYER?
   *
   * Resolved server-side from public.get_my_attendance_authority, which wraps
   * the SAME internal.resolve_attendance_response_source the write enforces --
   * so this is the write's own rule asked in advance, never a second copy of
   * the safeguarding policy.
   *
   * Without it this page offered three inviting buttons to people the database
   * would refuse, and a 15-year-old learned the safeguarding rule as a red
   * error AFTER tapping. Match Centre had resolved this correctly from the
   * start; training had not, which made the rule weaker on one surface than
   * the other for the same person and the same policy.
   */
  canRespond: boolean
  /** The reason, in the words the database gives, when they may not. */
  cannotRespondReason: string | null
}

export interface TrainingCentreActions {
  /** May edit the occurrence -- in the Scheduler, which owns it. Never here. */
  canManage: boolean
  /** May see who is training. Staff capability, never a guardian relationship. */
  canViewRegister: boolean
}

export interface TrainingCentreContext {
  session: TrainingSessionIdentity
  club: TrainingClubIdentity
  venue: MatchCentreVenue
  pitch: MatchCentrePitch
  /** Empty for a viewer with nobody to answer for -- a coach, for instance. */
  mine: TrainingAttendanceEntry[]
  actions: TrainingCentreActions
}

export type TrainingCentreResolution =
  | { status: "available"; context: TrainingCentreContext }
  | { status: "not_found" }

const EMPTY_VENUE: MatchCentreVenue = {
  venueId: null,
  name: null,
  address: null,
  addressLines: [],
  postcode: null,
  latitude: null,
  longitude: null,
  geocodeStatus: null,
}

export async function getTrainingCentreContext(
  supabase: SupabaseClient<Database>,
  trainingSessionId: string
): Promise<TrainingCentreResolution> {
  // THE AUTHORISED READ. Gated in the database on
  // internal.training_session_visible_row -- the same rule the table's own RLS
  // policy uses, so there is no way to be admitted by one and refused by the
  // other.
  const { data: cardRows, error } = await supabase.rpc("get_training_session_card", {
    p_training_session_id: trainingSessionId,
  })
  if (error) return { status: "not_found" }
  const card = (cardRows as Record<string, unknown>[] | null)?.[0]
  if (!card) return { status: "not_found" }

  const clubId = card.club_id as string
  const teamId = (card.team_id as string | null) ?? null
  const venueId = (card.venue_id as string | null) ?? null
  const pitchId = (card.pitch_id as string | null) ?? null

  const [{ data: clubRow }, { data: venueRow }, { data: pitchRow }, { data: mineRows }] = await Promise.all([
    supabase
      .from("clubs")
      .select("id, logo_storage_path, club_directory(id, name, logo_storage_path)")
      .eq("id", clubId)
      .maybeSingle(),
    venueId
      ? supabase
          .from("venues")
          .select("id, name, address, address_line_1, address_line_2, town, county, postcode, latitude, longitude, geocode_status")
          .eq("id", venueId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    pitchId ? supabase.from("club_pitches").select("id, display_name").eq("id", pitchId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("get_my_players_for_training_session", { p_training_session_id: trainingSessionId }),
  ])

  // The club's kit, for the same reason Match Centre shows it: a child
  // recognises the shirt before the badge. Read from the canonical club_kits
  // row, never chosen here.
  const { data: kitRow } = await supabase
    .from("club_kits")
    .select("pattern, primary_colour, secondary_colour, accent_colour")
    .eq("club_id", clubId)
    .eq("variant", "primary")
    .maybeSingle()

  const directory = clubRow?.club_directory ?? null

  const mineBase = ((mineRows as Record<string, unknown>[] | null) ?? []).map((r) => {
    const firstName = (r.first_name as string) ?? ""
    const surname = (r.surname as string) ?? ""
    return {
      playerId: r.player_id as string,
      firstName,
      displayName: `${firstName} ${surname}`.trim() || "Player",
      // "self" comes from the RPC, which resolves it from players.user_id --
      // never inferred here from a name or a role label.
      isSelf: (r.relationship as string) === "self",
      response: (r.current_status as TrainingAttendanceStatus | null) ?? null,
    }
  })

  /*
    ASK THE WRITE'S OWN RULE, BEFORE OFFERING THE CONTROL.

    One call per player the viewer already holds -- a guardian has one to three
    children, so this is bounded by the family, not by the squad, and the calls
    are issued together rather than in a waterfall. Match Centre resolves the
    identical authority the identical way.
  */
  const authorities = await Promise.all(
    mineBase.map((p) => supabase.rpc("get_my_attendance_authority", { p_player_id: p.playerId }).maybeSingle())
  )
  const cancelled = (card.status as string) === "CANCELLED"
  const mine: TrainingAttendanceEntry[] = mineBase.map((p, i) => {
    const a = authorities[i]?.data as { can_respond: boolean; denial_reason: string | null } | null
    return {
      ...p,
      // A cancelled session is answered by nobody, whatever their authority --
      // stated here once so the panel does not have to re-derive it.
      canRespond: Boolean(a?.can_respond) && !cancelled,
      cannotRespondReason: cancelled ? "This session has been cancelled, so no answer is needed." : (a?.denial_reason ?? null),
    }
  })

  const addressLines = venueRow
    ? [venueRow.address_line_1, venueRow.address_line_2, venueRow.town, venueRow.county].filter((l): l is string => Boolean(l && l.trim()))
    : []

  return {
    status: "available",
    context: {
      session: {
        trainingSessionId: card.id as string,
        clubId,
        teamId,
        schedulingGroupId: (card.scheduling_group_id as string | null) ?? null,
        teamLabel: (card.team_label as string) ?? "Team",
        sessionDate: card.session_date as string,
        startTime: (card.start_time as string | null) ?? null,
        endTime: (card.end_time as string | null) ?? null,
        durationMinutes: (card.duration_minutes as number | null) ?? null,
        status: (card.status as "PLANNED" | "CANCELLED") ?? "PLANNED",
        source: (card.source as "MANUAL" | "AUTOMATIC_PLAN") ?? "MANUAL",
        trainingPlanId: (card.training_plan_id as string | null) ?? null,
        seasonId: (card.season_id as string | null) ?? null,
        agenda: (card.agenda as string) ?? "",
        furtherNotes: (card.further_notes as string | null) ?? null,
        cancellationReason: (card.cancellation_reason as string | null) ?? null,
        cancelledByName: (card.cancelled_by_name as string | null) ?? null,
      },
      club: {
        clubId: clubRow?.id ?? null,
        displayName: directory?.name ?? "Club",
        logoUrl: clubRow
          ? resolveClubLogoUrl(supabase, {
              logo_storage_path: clubRow.logo_storage_path,
              club_directory: directory ? { logo_storage_path: directory.logo_storage_path } : null,
            })
          : null,
        kit: kitRow
          ? {
              pattern: kitRow.pattern as KitConfig["pattern"],
              primaryColour: kitRow.primary_colour,
              secondaryColour: kitRow.secondary_colour,
              accentColour: kitRow.accent_colour,
            }
          : null,
      },
      venue: venueRow
        ? {
            venueId: venueRow.id,
            name: venueRow.name,
            address: venueRow.address,
            addressLines,
            postcode: venueRow.postcode,
            latitude: venueRow.latitude === null ? null : Number(venueRow.latitude),
            longitude: venueRow.longitude === null ? null : Number(venueRow.longitude),
            geocodeStatus: venueRow.geocode_status,
          }
        : EMPTY_VENUE,
      pitch: { pitchId: pitchRow?.id ?? null, label: pitchRow?.display_name ?? null },
      mine,
      actions: {
        canManage: Boolean(card.can_manage),
        canViewRegister: Boolean(card.can_view_register),
      },
    },
  }
}

/**
 * The moment the session starts, as a plain time string for the forecast.
 *
 * Training has a start time rather than a kick-off, and that is the only
 * difference: the SAME weather entry point takes it, so there is one Met
 * Office integration, one cache and one honest unavailable state.
 */
export function trainingForecastInput(session: TrainingSessionIdentity, venue: MatchCentreVenue) {
  return {
    kickoffDate: session.sessionDate,
    kickoffTime: session.startTime,
    latitude: venue.latitude,
    longitude: venue.longitude,
  }
}
