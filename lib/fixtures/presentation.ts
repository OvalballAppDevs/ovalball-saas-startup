/**
 * HOW A FIXTURE IS NAMED, IN ONE PLACE.
 *
 * A fixture stores an owning team and `home_away`; `home_team_id` and
 * `away_team_id` are generated from those two. Every screen that prints a
 * fixture has to turn that back into words, and until this module existed each
 * of them had its own idea of how.
 *
 * Six of them printed `our team v opposition` whatever the answer was, so an
 * away match at Fylde read "Under 12 Mixed v Fylde" -- which says our side is
 * at home. One of them (the family agenda) had the rule right, written inline,
 * unnamed, and reachable from nowhere else. That is the failure mode the
 * convergence programme keeps finding: the correct behaviour existed, once, and
 * could not propagate because it was not a thing anybody could call.
 *
 * So the rule lives here and is the only one:
 *
 *   **The home side is named first. Always. On every surface.**
 *
 * It is not a stylistic preference. "Fylde v Under 12 Mixed" is how a fixture
 * list, a league table, a programme and a scoreboard have named matches for a
 * century, and it is the only form that tells a parent whether to travel
 * without them having to find a separate badge. Home/away chips stay where they
 * are -- this decides the ORDER, not whether the relationship is also stated in
 * words.
 *
 * What this module deliberately does NOT do is decide the labels. What a side
 * is called comes from the canonical team identity resolvers
 * (`get_team_identity_for_season`, `fullTeamLabel` / `compactTeamLabel`) and
 * from the Club Directory. This only decides which of two already-resolved
 * labels is printed first, so that a naming change made once propagates
 * everywhere rather than being re-decided per screen.
 */

/** The stored value. `TBD` and `Not Applicable` are real, legitimate states -- a fixture whose side has not been settled is not an error. */
export type HomeAwayValue = "Home" | "Away" | "TBD" | "Not Applicable" | string | null | undefined

export interface FixtureSides {
  /** The side named first. */
  homeLabel: string
  /** The side named second. */
  awayLabel: string
  /** `home v away`. The one separator: a lower-case "v", spaced, never "vs", "V" or an en dash. */
  title: string
  /** True when the order was reversed because the owning team is away. Surfaces that need to say so can, without recomputing the rule. */
  ownTeamIsAway: boolean
}

/** The separator, as one constant, so no surface can drift to "vs". */
export const FIXTURE_SIDE_SEPARATOR = " v "

/**
 * Order two already-resolved labels for display.
 *
 * `ownLabel` is the fixture's owning side as this viewer knows it; `oppositionLabel`
 * is the other side. When `home_away` is anything other than `Away` the owning
 * side is named first, which covers `Home`, `TBD` and `Not Applicable`: a
 * fixture whose side is not yet settled is still the club's own fixture, and
 * guessing that an undecided match is away would be a worse answer than the
 * club's own team leading.
 */
export function fixtureSides(input: { homeAway: HomeAwayValue; ownLabel: string | null | undefined; oppositionLabel: string | null | undefined }): FixtureSides {
  const own = (input.ownLabel ?? "").trim() || "Our team"
  const opposition = (input.oppositionLabel ?? "").trim() || "Opposition to be confirmed"
  const ownTeamIsAway = input.homeAway === "Away"
  const homeLabel = ownTeamIsAway ? opposition : own
  const awayLabel = ownTeamIsAway ? own : opposition
  return { homeLabel, awayLabel, title: `${homeLabel}${FIXTURE_SIDE_SEPARATOR}${awayLabel}`, ownTeamIsAway }
}

/** The common case: just the words. */
export function fixtureTitle(input: { homeAway: HomeAwayValue; ownLabel: string | null | undefined; oppositionLabel: string | null | undefined }): string {
  return fixtureSides(input).title
}

/**
 * Where a side is already known to be home or away -- a competition match, a
 * public projection, an email whose context resolved both sides -- there is no
 * owning team to orient around and nothing to reverse. Kept as its own function
 * so that a caller with genuinely absolute sides is not made to invent a
 * `home_away` value in order to use the separator.
 */
export function fixtureTitleFromSides(homeLabel: string | null | undefined, awayLabel: string | null | undefined): string {
  const home = (homeLabel ?? "").trim() || "Home side to be confirmed"
  const away = (awayLabel ?? "").trim() || "Opposition to be confirmed"
  return `${home}${FIXTURE_SIDE_SEPARATOR}${away}`
}

/**
 * MATCH TYPE.
 *
 * Moved to `packages/contracts/src/fixtures/game-type` so both clients read one
 * rule, and re-exported here so nothing on the web had to change. The taxonomy is
 * `fixtures.game_type`, constrained by the database itself; a fixture with no match
 * type recorded is not "Friendly", it is a fixture with no match type recorded.
 */
export { matchTypeLabel } from "@ovalball/contracts/fixtures/game-type"

