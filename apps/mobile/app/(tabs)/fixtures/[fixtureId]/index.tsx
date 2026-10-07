import { MatchCentre } from "../../../../src/fixtures/match-centre"

/**
 * ONE PHYSICAL FIXTURE, ONE ADDRESS, ONE SURFACE.
 *
 * `/fixtures/<id>` is the canonical address on both clients -- what the website routes to, what every
 * fixture notification carries, what a shared link and restored navigation hold. It now renders the one
 * Match Centre for everybody (owner brief, 2026-10-03): the former Fixture Detail console and Edit
 * Fixture are sections and sheets inside it, gated by what the server says THIS viewer may do for THIS
 * fixture. `?tab=` opens a section directly, which is how a notification lands on the exact thing it is
 * about.
 *
 * IT STILL FAILS TOWARDS THE PARTICIPANT. A read that errors, or a viewer with no authority, gets the
 * same surface with fewer powers -- every control is drawn from the server's answer, and every write is
 * re-checked by the database regardless.
 */
export default MatchCentre
