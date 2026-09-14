/**
 * WHERE IS THE MATCH? DEFAULTS THAT KNOW, AND STAY OUT OF THE WAY.
 *
 * Home: our club's default ground (venues.is_default_home), or its only ground.
 * Away: the opposition club's default ground when they are on Ovalball, or the
 * home ground recorded for them in the Club Directory when they are not.
 * Pitch: filled only when that venue has exactly one pitch; with several, the
 * person chooses. With no canonical ground, nothing is filled -- a venue is
 * never invented.
 *
 * THE OVERRIDE RULE. A default is a suggestion. Once somebody has chosen an
 * opposition team, venue or pitch themselves, a re-render never replaces it.
 * Their choice is only cleared when it has become incompatible with a material
 * change: a different opposition club (their team and ground no longer apply),
 * or Home/Away flipping (the ground is now the other club's).
 */

export interface VenueRecord {
  id: string
  name: string
  isDefaultHome: boolean
  active: boolean
}

export interface PitchRecord {
  id: string
  name: string
  venueId: string | null
  active: boolean
}

export interface ClubGrounds {
  venues: VenueRecord[]
  pitches: PitchRecord[]
  /** Club Directory home ground text, for a club not on Ovalball. */
  directoryHomeGround?: string | null
}

export interface VenueDefault {
  venueId: string | null
  /** A recorded ground name for an external club, where no venue record can exist. */
  venueText: string | null
  pitchId: string | null
  source: "our_default" | "our_only" | "their_default" | "their_only" | "directory" | "none"
}

const NONE: VenueDefault = { venueId: null, venueText: null, pitchId: null, source: "none" }

function primaryGround(grounds: ClubGrounds): { venue: VenueRecord; source: "default" | "only" } | null {
  const active = grounds.venues.filter((v) => v.active)
  const def = active.filter((v) => v.isDefaultHome)
  if (def.length === 1) return { venue: def[0], source: "default" }
  if (active.length === 1) return { venue: active[0], source: "only" }
  return null
}

function onlyPitch(grounds: ClubGrounds, venueId: string): string | null {
  const pitches = grounds.pitches.filter((p) => p.active && p.venueId === venueId)
  return pitches.length === 1 ? pitches[0].id : null
}

export function defaultVenue(homeAway: "Home" | "Away" | null, ours: ClubGrounds, theirs: ClubGrounds | null): VenueDefault {
  if (homeAway === "Home") {
    const g = primaryGround(ours)
    if (!g) return NONE
    return { venueId: g.venue.id, venueText: null, pitchId: onlyPitch(ours, g.venue.id), source: g.source === "default" ? "our_default" : "our_only" }
  }
  if (homeAway === "Away" && theirs) {
    const g = primaryGround(theirs)
    if (g) {
      return { venueId: g.venue.id, venueText: null, pitchId: onlyPitch(theirs, g.venue.id), source: g.source === "default" ? "their_default" : "their_only" }
    }
    const recorded = theirs.directoryHomeGround?.trim()
    if (recorded) return { venueId: null, venueText: recorded, pitchId: null, source: "directory" }
  }
  return NONE
}

// ---------------------------------------------------------------------------
// The override rule, as a reducer over an editor's state.
// ---------------------------------------------------------------------------

export interface DefaultableState {
  homeAway: "Home" | "Away" | null
  oppositionClubKey: string | null
  oppositionTeamId: string | null
  venueId: string | null
  venueText: string | null
  pitchId: string | null
  /** Fields the person has set themselves. */
  touched: { oppositionTeam: boolean; venue: boolean; pitch: boolean }
}

export type DefaultableChange =
  | { kind: "homeAway"; value: "Home" | "Away" | null }
  | { kind: "oppositionClub"; key: string | null }
  | { kind: "oppositionTeam"; id: string | null; byUser: boolean }
  | { kind: "venue"; id: string | null; text?: string | null; byUser: boolean }
  | { kind: "pitch"; id: string | null; byUser: boolean }

export function applyDefaultableChange(state: DefaultableState, change: DefaultableChange): DefaultableState {
  switch (change.kind) {
    case "homeAway": {
      if (change.value === state.homeAway) return state
      // The ground belongs to the other club now: a chosen venue and pitch no longer apply.
      return { ...state, homeAway: change.value, venueId: null, venueText: null, pitchId: null, touched: { ...state.touched, venue: false, pitch: false } }
    }
    case "oppositionClub": {
      if (change.key === state.oppositionClubKey) return state
      const awayGroundGone = state.homeAway === "Away"
      return {
        ...state,
        oppositionClubKey: change.key,
        oppositionTeamId: null,
        venueId: awayGroundGone ? null : state.venueId,
        venueText: awayGroundGone ? null : state.venueText,
        pitchId: awayGroundGone ? null : state.pitchId,
        touched: { oppositionTeam: false, venue: awayGroundGone ? false : state.touched.venue, pitch: awayGroundGone ? false : state.touched.pitch },
      }
    }
    case "oppositionTeam":
      if (!change.byUser && state.touched.oppositionTeam) return state
      return { ...state, oppositionTeamId: change.id, touched: { ...state.touched, oppositionTeam: state.touched.oppositionTeam || change.byUser } }
    case "venue": {
      if (!change.byUser && state.touched.venue) return state
      const venueChanged = change.id !== state.venueId
      return {
        ...state,
        venueId: change.id,
        venueText: change.text ?? null,
        // A pitch at the previous ground is not a pitch at this one.
        pitchId: venueChanged ? null : state.pitchId,
        touched: { ...state.touched, venue: state.touched.venue || change.byUser, pitch: venueChanged ? false : state.touched.pitch },
      }
    }
    case "pitch":
      if (!change.byUser && state.touched.pitch) return state
      return { ...state, pitchId: change.id, touched: { ...state.touched, pitch: state.touched.pitch || change.byUser } }
  }
}
