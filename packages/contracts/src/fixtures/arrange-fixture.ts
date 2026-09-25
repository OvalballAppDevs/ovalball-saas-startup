/**
 * ARRANGE A FIXTURE -- SHARED DISPLAY SEMANTICS (Clubhouse Programme Section 8).
 *
 * NOT a second request-creation domain. This module has no I/O and creates nothing -- both clients keep
 * their own existing insert paths (`fixture_request_groups`/`fixture_requests`), which the real
 * authority boundary (`fixture_request_groups_insert_scoped` / `fixture_requests_insert_scoped` RLS,
 * plus the age-eligibility and duplicate-refusal triggers) enforces server-side regardless of what this
 * module says. What genuinely needs to be shared is INTERPRETATION: the same home/away pairing must
 * read identically on both clients, and the pre-send summary must be built from the same rule, not
 * hand-written twice and left to drift.
 */

export type ArrangeFixtureVenuePreference = "home" | "away" | "either"

export interface ArrangeFixtureHost {
  /** Who ends up hosting, in the one vocabulary both clients render -- never "TBD", which reads as a
   * fixture in limbo rather than a genuine open question both sides still have to answer. */
  outcome: "we_host" | "they_host" | "not_yet_agreed"
  /** A complete sentence naming the actual host club, for the pre-send summary and the "Request Sent"
   * confirmation -- e.g. "Burnley RUFC will host." Null when the venue is not yet agreed, since there is
   * truthfully nothing to name. */
  statement: string | null
}

/**
 * THE ONE HOME/AWAY TRANSLATION. `venuePreference` is always relative to the REQUESTING side --
 * "home" means the requester hosts, "away" means the opponent hosts, "either" is a genuine open
 * question neither side has resolved yet (never faked as a side). `opponentClubName` is required for
 * "away" and "home" so the statement can name who actually hosts, not just whose preference it was.
 */
export function describeArrangeFixtureHost(
  venuePreference: ArrangeFixtureVenuePreference,
  ourClubName: string,
  opponentClubName: string | null
): ArrangeFixtureHost {
  if (venuePreference === "home") {
    return { outcome: "we_host", statement: `${ourClubName} will host.` }
  }
  if (venuePreference === "away") {
    return { outcome: "they_host", statement: opponentClubName ? `${opponentClubName} will host.` : null }
  }
  return { outcome: "not_yet_agreed", statement: null }
}

export type ArrangeFixtureAvailabilityContext = "no_known_clash" | "busy" | "tentative" | "unknown" | null

/**
 * THE LANGUAGE RULE THIS SECTION MUST NOT BREAK (Section 7's own semantics, carried through): never
 * "Available" unless a team has said so about itself, which this composer never claims on either side's
 * behalf. A composer arriving with Section 7's own coarse state shows exactly that state, softened
 * nowhere.
 */
export function arrangeFixtureAvailabilityLabel(context: ArrangeFixtureAvailabilityContext): string | null {
  if (context === "no_known_clash") return "No known clash"
  if (context === "busy") return "Busy"
  if (context === "tentative") return "Tentative"
  if (context === "unknown") return "Unknown"
  return null
}

export interface ArrangeFixtureSummary {
  ourTeamLabel: string
  opponentLabel: string
  dateLabel: string
  kickoffLabel: string | null
  host: ArrangeFixtureHost
  availabilityLabel: string | null
}

/**
 * THE ONE PRE-SEND SUMMARY PROJECTION. Pure and platform-neutral -- web renders it in a review card,
 * native in a summary sheet, both from this exact shape, so a rewording never has to happen twice.
 * `dateIso` is a plain `YYYY-MM-DD`; formatting to a long date name is left to the caller's own locale
 * utilities (already established and different per client) rather than duplicated here.
 */
export function buildArrangeFixtureSummary(input: {
  ourTeamLabel: string
  opponentLabel: string
  dateLabel: string
  kickoffTime: string | null
  venuePreference: ArrangeFixtureVenuePreference
  ourClubName: string
  opponentClubName: string | null
  availabilityContext?: ArrangeFixtureAvailabilityContext
}): ArrangeFixtureSummary {
  return {
    ourTeamLabel: input.ourTeamLabel,
    opponentLabel: input.opponentLabel,
    dateLabel: input.dateLabel,
    kickoffLabel: input.kickoffTime,
    host: describeArrangeFixtureHost(input.venuePreference, input.ourClubName, input.opponentClubName),
    availabilityLabel: arrangeFixtureAvailabilityLabel(input.availabilityContext ?? null),
  }
}
