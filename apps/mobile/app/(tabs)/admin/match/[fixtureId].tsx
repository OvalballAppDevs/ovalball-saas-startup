import { MatchCentre } from "../../../../src/fixtures/match-centre"

/**
 * THE SAME MATCH CENTRE, OPENED FROM ADMIN -- a second address, not a second page (`src/links/stack.ts`).
 * Arena Planning opens a fixture here, inside the Admin stack, so Back returns to the day being planned
 * rather than to a Fixtures agenda the person never opened.
 */
export default MatchCentre
