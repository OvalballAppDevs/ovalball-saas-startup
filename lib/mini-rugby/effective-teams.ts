/**
 * THE canonical "which real operational teams does this fixture commitment
 * actually involve" resolver (Section 5/6/25 of the Mini-Rugby brief;
 * extended for group-vs-group in the Season Handover Main Project pass).
 * Every consumer -- fixture conflict validation, Calendar filtering,
 * Pitch Allocation eligibility, Season Handover safety checks, and (per
 * Section 34/72) Side Project 1's future Player/Guardian/attendance
 * integration -- must call this (or effectiveFixtureParticipants below)
 * rather than re-deriving "is this fixture a shared-group booking" inline.
 *
 * Resolves ONE SIDE of ONE fixture row: the OWNING side (owning_team_id /
 * owning_scheduling_group_id). A confirmed two-sided fixture is a SINGLE
 * fixtures row shared by both clubs (Master Fixture Registry, since
 * 20260904600000_master_fixture_consolidation.sql) -- accept_fixture_
 * request has not created a mirror pair since; mirror_fixture_id only
 * still exists on pre-consolidation legacy rows. The OTHER side of that
 * same row is the OPPONENT side (opponent_team_id / opponent_scheduling_
 * group_id, added by 20260926000000_group_vs_group_fixture_model.sql) --
 * resolve it with the exact same function, never by reaching into a
 * second row. Use effectiveFixtureParticipants below when you need BOTH
 * sides of one fixture at once, correctly split by home/away.
 *
 * Pure with respect to its inputs -- no query inside, no "server-only"
 * guard needed -- so it can be unit tested without a database (see
 * effective-teams.verify.ts) and reused from client-safe code paths, and
 * so read-heavy server callers (a Calendar month grid rendering 100+
 * fixtures) can batch-fetch scheduling_group_members ONCE (via
 * loadGroupMemberTeamIds in effective-teams.server.ts) and call this per
 * row, rather than one round trip per fixture.
 */
export function effectiveTeamIdsForFixtureSide(anchorTeamId: string, schedulingGroupId: string | null, groupMemberTeamIds: Map<string, string[]>): string[] {
  if (!schedulingGroupId) return [anchorTeamId]
  const members = groupMemberTeamIds.get(schedulingGroupId)
  // Section 27: a squad-specific group (e.g. "U6 B + U7 C") returns EXACTLY
  // those component team_ids -- never every team sharing that age. This
  // function only ever reads real scheduling_group_members rows, so a
  // squad-specific group is already correctly narrow by construction; the
  // fallback below only fires if the group row itself is missing/broken
  // (deleted mid-request, an active=false group failed the caller's own
  // pre-filter, etc.) -- never silently widen to "every team this age".
  return members && members.length > 0 ? members : [anchorTeamId]
}

/** One fixture row's participant identity on both sides -- the inputs effectiveFixtureParticipants needs, mirroring exactly the fixtures columns of the same name. */
export interface FixtureParticipantsInput {
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  owningTeamId: string
  owningSchedulingGroupId: string | null
  opponentTeamId: string | null
  opponentSchedulingGroupId: string | null
}

/**
 * THE canonical, side-preserving effective-team resolver for a WHOLE
 * fixture row (Section 6/14 of the group-vs-group brief) -- the
 * client-safe, DB-free twin of public.get_effective_fixture_participants.
 * Splits by the fixture's real home/away, not by which club is asking, so
 * both clubs reading the same shared row get the same answer. homeTeamIds/
 * awayTeamIds are empty for a TBD/Not Applicable fixture (never guessed);
 * allTeamIds is always populated from both sides regardless, for a caller
 * that only needs "who is committed today" (same-day conflict checks,
 * attendance). TEAM vs TEAM -> two singletons; GROUP vs TEAM / TEAM vs
 * GROUP -> one side expands; GROUP vs GROUP -> both expand, still
 * correctly split by side.
 */
export function effectiveFixtureParticipants(
  input: FixtureParticipantsInput,
  groupMemberTeamIds: Map<string, string[]>
): { homeTeamIds: string[]; awayTeamIds: string[]; allTeamIds: string[] } {
  const owningIds = effectiveTeamIdsForFixtureSide(input.owningTeamId, input.owningSchedulingGroupId, groupMemberTeamIds)
  const opponentIds = input.opponentTeamId ? effectiveTeamIdsForFixtureSide(input.opponentTeamId, input.opponentSchedulingGroupId, groupMemberTeamIds) : []

  const homeTeamIds = input.homeAway === "Home" ? owningIds : input.homeAway === "Away" ? opponentIds : []
  const awayTeamIds = input.homeAway === "Home" ? opponentIds : input.homeAway === "Away" ? owningIds : []
  const allTeamIds = Array.from(new Set([...owningIds, ...opponentIds]))

  return { homeTeamIds, awayTeamIds, allTeamIds }
}
