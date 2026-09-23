import { isFamilyFacingContext, type ActiveContextKind } from "../active-context-rules"

/**
 * WHAT THIS VIEWER MAY DO ON THIS FIXTURE — AND WHICH HAT THEY ARE WEARING.
 *
 * `get_match_centre_capabilities` answers a question about the PERSON: may this
 * user manage this fixture, see its register, reach its club-to-club thread. That
 * is the right question for the database to answer and it is authoritative.
 *
 * IT IS NOT THE WHOLE QUESTION. Ovalball is built on the idea that one person
 * wears several hats -- a coach who is also a parent, a club admin whose daughter
 * plays Under 12 -- and the context switcher exists so they can say WHICH ONE THEY
 * ARE OPERATING AS. Standing in their Parent/Guardian context, a club admin was
 * still being offered "Announce to the Squad" and a fixture-management entry
 * point, because the capability is scoped to the user and the surface never asked
 * which hat they had chosen.
 *
 * SO THE CONTEXT NARROWS, AND ONLY NARROWS. A family-facing context holds no
 * fixture-management authority by construction -- `loadFixtureAuthority` has no
 * scope to ask at for one -- so removing those capabilities takes away a
 * possibility rather than granting one. Nothing here can turn a false into a true,
 * which is what makes it safe to apply on a client.
 *
 * AND IT IS NOT THE PROTECTION. The database still decides: a genuine parent is
 * refused every one of these writes whatever any client believes, which is proved
 * in `participant_route_authority.sql`. What this fixes is a person being offered
 * their coach's controls while they are reading as a parent -- a product defect,
 * not a hole. A club admin who switches back to their club context gets everything
 * back, because they really are a club admin.
 */

export interface MatchCentreCapabilities {
  /** The full squad register and its aggregate counts. Staff-level visibility. */
  canViewParticipants: boolean
  /** The club-to-club fixture conversation. Never a parent's. */
  canMessage: boolean
  /** Kick-off, venue, pitch, cancellation, announcements. */
  canManageFixture: boolean
}

export const NO_MATCH_CENTRE_CAPABILITIES: MatchCentreCapabilities = {
  canViewParticipants: false,
  canMessage: false,
  canManageFixture: false,
}

/**
 * The capabilities as they apply to the context somebody is actually operating in.
 *
 * A participant context gets none of them. Every other context gets exactly what
 * the server said, unchanged.
 */
export function narrowCapabilitiesToContext(
  capabilities: MatchCentreCapabilities,
  contextKind: ActiveContextKind | null
): MatchCentreCapabilities {
  if (contextKind && isFamilyFacingContext(contextKind)) return NO_MATCH_CENTRE_CAPABILITIES
  return capabilities
}
