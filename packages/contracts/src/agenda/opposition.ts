import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * IS THE OPPOSITION ON OVALBALL?
 *
 * A fixture operator needs this before they need almost anything else, because it decides what is
 * possible. If the other side is on Ovalball there is somebody to message, a result they can confirm
 * and a conversation that reaches them; if they are not, the fixture is a note in a diary and the way
 * to reach them is a telephone.
 *
 * IT IS DERIVED FROM IDENTITY, NEVER FROM PRESENTATION. Not from the club's name, not from whether a
 * crest exists, not from an email address, and emphatically not from string matching -- a club called
 * "Preston Grasshoppers RFC" in free text is not the Preston Grasshoppers on Ovalball, and treating it
 * as one would offer a manager an inter-club conversation with nobody at the other end.
 *
 * THERE ARE THREE ANSWERS, NOT TWO, and the middle one matters:
 *
 *   TEAM      the fixture names an opposing TEAM (`opponent_team_id`). Both sides are on Ovalball and
 *             the fixture is two-sided -- the richest case, and the only one where the platform knows
 *             who to put a message in front of.
 *   CLUB      the fixture names a Club Directory entry that HAS been claimed -- a `clubs` row exists --
 *             so the club is on Ovalball but this particular side is not linked to the fixture. The
 *             club is reachable; this fixture is not yet two-sided.
 *   EXTERNAL  a Directory entry nobody has claimed, or free text. Not on Ovalball.
 *
 * WHAT THIS DOES NOT DECIDE. Whether the viewer may message anybody. That is
 * `fixture_opposition_contacts`, which applies `internal.may_direct_message` and returns nothing when
 * there is nobody. Being on Ovalball is a fact about the OPPOSITION; being allowed to talk to them is a
 * fact about the VIEWER, and conflating the two is how an interface ends up offering an action that
 * fails after it is tapped.
 */

export type OppositionPresence =
  | { kind: "team"; onOvalball: true; clubId: string | null; teamId: string; label: string }
  | { kind: "club"; onOvalball: true; clubId: string; teamId: null; label: string }
  | { kind: "external"; onOvalball: false; clubId: null; teamId: null; label: string }

export interface OppositionIdentityInput {
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  rawOppositionText: string | null
}

/**
 * The presence of one fixture's opposition.
 *
 * The Directory lookup is a read through RLS like any other; a directory row that comes back without a
 * claimed club is the honest "external" answer rather than an error.
 */
export async function resolveOppositionPresence(
  supabase: SupabaseClient<Database>,
  fixture: OppositionIdentityInput & { opponentTeamClubId?: string | null; label: string }
): Promise<OppositionPresence> {
  if (fixture.opponentTeamId) {
    return {
      kind: "team",
      onOvalball: true,
      clubId: fixture.opponentTeamClubId ?? null,
      teamId: fixture.opponentTeamId,
      label: fixture.label,
    }
  }

  if (fixture.opponentDirectoryId) {
    // CLAIMED MEANS A CLUB ROW EXISTS. A Club Directory entry is a name Ovalball knows about; a `clubs`
    // row is a club that has actually started using it. The distinction is the whole point: the
    // Directory contains every club in the country and almost none of them are here yet.
    const { data } = await supabase
      .from("clubs")
      .select("id, status")
      .eq("directory_id", fixture.opponentDirectoryId)
      .eq("status", "active")
      .maybeSingle()
    if (data?.id) {
      return { kind: "club", onOvalball: true, clubId: data.id, teamId: null, label: fixture.label }
    }
  }

  return { kind: "external", onOvalball: false, clubId: null, teamId: null, label: fixture.label }
}

/**
 * What to call it on screen.
 *
 * RESTRAINED ON PURPOSE. "On Ovalball" tells a manager that richer things are possible; it is not a
 * verification badge, because Ovalball has a separate verification concept for the Club Directory and
 * borrowing its vocabulary here would claim something this has not checked.
 */
export function oppositionPresenceLabel(presence: OppositionPresence): string {
  return presence.onOvalball ? "On Ovalball" : "Not on Ovalball"
}
