import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * WHICH SURFACE DOES THIS PERSON GET FOR THIS FIXTURE?
 *
 * Two answers and no third:
 *
 *   "participant"  the Match Centre. My child's match, or my own.
 *   "operations"   the Fixture Console. Kick-off, venue, pitch, cancellation,
 *                  opposition contacts -- the work of running a fixture.
 *
 * THE ANSWER IS THE SERVER'S, PER FIXTURE. `get_match_centre_capabilities` runs
 * the canonical `internal.can` chain for this viewer and this fixture, and
 * `can_manage_fixture` is the same value every fixture mutation re-checks before
 * it writes. That is what makes this a projection of authority rather than a
 * second opinion about it.
 *
 * WHY NOT THE CONTEXT KIND. Because membership is not management. A coach's
 * switcher context says "team", and a team context is not by itself permission to
 * move a kick-off -- a Club Admin grants `fixture.fixture.edit` to a team, and a
 * team manager who has not been granted it is a participant in this sense. Asking
 * the capability resolver answers the real question; reading the context kind
 * answers a label.
 *
 * AND IT FAILS TOWARDS THE PARTICIPANT. Absent, errored or false all give
 * "participant": the surface with fewer powers is the safe answer when the
 * authority is unknown.
 */
export type FixtureSurface = "participant" | "operations"

export async function loadFixtureSurface(
  supabase: SupabaseClient<Database>,
  fixtureId: string
): Promise<FixtureSurface> {
  const { data, error } = await supabase
    .rpc("get_match_centre_capabilities", { p_fixture_id: fixtureId })
    .maybeSingle()
  if (error || !data) return "participant"
  return data.can_manage_fixture === true ? "operations" : "participant"
}
