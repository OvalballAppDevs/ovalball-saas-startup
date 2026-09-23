import { MatchCentre } from "../../../../src/fixtures/match-centre"

/**
 * THE PARTICIPANT SURFACE, BY NAME.
 *
 * `/fixtures/<id>` is the canonical address and decides which surface to draw
 * from the viewer's authority. This one is the explicit participant address, and
 * it exists for two reasons.
 *
 * IT IS THE ADDRESS THE APP ITSELF USES for a parent or a player: Home, Fixtures,
 * the Calendar and the notification list all send a participant here rather than
 * to the deciding route. That is DEFENCE IN DEPTH, not duplication -- this route
 * cannot render administration under any circumstances, because it does not import
 * it. If the authority gate on the canonical address were ever wrong, every
 * in-app entry point for a participant would still be safe.
 *
 * AND IT IS A REAL ADDRESS PEOPLE HOLD. The website has linked a fixture's Match
 * Centre by this path since M4, and `resolveIntent` has parsed it for as long.
 * Removing it would break links that already exist.
 *
 * IT IS SAFE FOR EVERYBODY, including staff: the Match Centre is one shared
 * role-aware surface whose data is filtered on the server, so a coach who lands
 * here sees the register they are entitled to and a guardian sees their own child.
 */
export default MatchCentre
