import { MatchCentre } from "../../../../src/fixtures/match-centre"

/**
 * THE SAME MATCH CENTRE, OPENED FROM THE CALENDAR -- a second address, not a second page (`src/links/stack.ts`).
 * A match tapped on a Calendar day opens here, inside the Calendar stack, so Back returns to that day rather
 * than to the Fixtures agenda the person never opened.
 */
export default MatchCentre
