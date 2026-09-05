export interface MyFixtureSide {
  /** The real anchor team on whichever side is mine -- null if this fixture somehow involves none of my scoped teams (should not happen given the query that fetched it, but never assumed). */
  myTeamId: string | null
  /** The row's OWN stored group id for my side -- read directly, never inferred from a club's current live group membership. Null when my side is an ordinary single team. */
  myGroupId: string | null
  iAmOpponent: boolean
}

/**
 * Which side of a fixture row is "mine", and does that side carry a
 * stable, explicitly-stored Mini-Rugby Group participant. Read directly
 * from owning_scheduling_group_id/opponent_scheduling_group_id -- NEVER
 * inferred from a team's current live group membership (Section 5/9/13
 * of the Calendar component-filtering brief): a team's group membership
 * can change after a fixture is played, two structurally-overlapping
 * groups (e.g. U6+U7 and U7+U8) must never both silently claim the same
 * fixture, and only the row's own stored id says which group actually
 * played. This is the ONE place both Week/Month and Agenda determine
 * "which side is mine" -- previously duplicated inline in each page with
 * the opponent side's group hardcoded to null (the root cause of the
 * opponent-side group-vs-* fixtures collapsing to a plain team lane).
 *
 * Pure with respect to its inputs -- no query inside, no "server-only"
 * guard needed -- so it can be unit tested without a database (see
 * resolve-my-fixture-side.verify.ts) and reused from client-safe code.
 */
export function resolveMyFixtureSide(
  f: { owning_team_id: string; opponent_team_id: string | null; owning_scheduling_group_id: string | null; opponent_scheduling_group_id: string | null },
  teamIds: string[]
): MyFixtureSide {
  const iAmOpponent = f.opponent_team_id !== null && teamIds.includes(f.opponent_team_id) && !teamIds.includes(f.owning_team_id)
  const myTeamId = iAmOpponent ? f.opponent_team_id : teamIds.includes(f.owning_team_id) ? f.owning_team_id : null
  const myGroupId = iAmOpponent ? f.opponent_scheduling_group_id : f.owning_scheduling_group_id
  return { myTeamId, myGroupId, iAmOpponent }
}
