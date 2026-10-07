/**
 * WHAT ONE VIEWER MAY DO WITH ONE FIXTURE'S RESULT -- decided once, for both clients.
 *
 * `submit_fixture_result` is the real state machine and authority boundary: a confirmation is the
 * other club submitting the SAME score, a dispute is it submitting a different one, and a club
 * re-submitting its own pending score revises it. This function only decides which of those
 * buttons to OFFER, from the fixture's own result columns, so the phone and the website draw the
 * same choices for the same state. Anything it offers is still refused by the server if the viewer
 * turns out not to hold `fixture.result.record`.
 *
 * A PAST FIXTURE IS A RESULT TO READ, NOT A FIXTURE TO EDIT. Nothing here ever routes to editing
 * kick-off, venue or teams; the only write is a score.
 */
export type FixtureResultStatus =
  | "none"
  | "awaiting_confirmation"
  | "disputed"
  | "unverified"
  | "amendment_pending"
  | "final"
  | "external_recorded"

export interface FixtureResultState {
  status: FixtureResultStatus
  homeScore: number | null
  awayScore: number | null
  submittedByClubId: string | null
  amendmentHomeScore: number | null
  amendmentAwayScore: number | null
  amendmentByClubId: string | null
  resolvedBySiteAdmin: boolean
  cancelled: boolean
  kickoffPassed: boolean
}

export type FixtureResultMode =
  /** Cancelled: there is no result to have. */
  | "cancelled"
  /** Before kick-off: nothing to enter yet. */
  | "not_started"
  /** Kicked off, no score yet: this viewer may enter one. */
  | "enter"
  /** The other club submitted; this viewer confirms or disputes. */
  | "confirm"
  /** This viewer's club submitted; waiting on the other side, and may revise. */
  | "awaiting_other_side"
  /** The two sides disagree; either may submit the score they believe, an organiser may settle it. */
  | "disputed"
  /** The other club proposed changing a final result; this viewer confirms or disputes the change. */
  | "confirm_amendment"
  /** This viewer's club proposed the change; waiting on the other side. */
  | "amendment_awaiting_other_side"
  /** Agreed and final (or recorded against a side not on Ovalball); a change can be requested. */
  | "final"
  /** Anything this viewer may read but not act on. */
  | "read_only"

export function fixtureResultMode(
  state: FixtureResultState,
  viewer: { myClubIds: ReadonlySet<string>; canRecord: boolean; isParticipant: boolean }
): FixtureResultMode {
  if (state.cancelled) return "cancelled"
  const mine = (clubId: string | null) => clubId !== null && viewer.myClubIds.has(clubId)
  const canAct = viewer.canRecord && viewer.isParticipant

  switch (state.status) {
    case "none":
      if (!state.kickoffPassed) return "not_started"
      return canAct ? "enter" : "read_only"
    case "awaiting_confirmation":
      if (mine(state.submittedByClubId)) return canAct ? "awaiting_other_side" : "read_only"
      return canAct ? "confirm" : "read_only"
    case "disputed":
    case "unverified":
      return canAct ? "disputed" : "read_only"
    case "amendment_pending":
      if (mine(state.amendmentByClubId)) return canAct ? "amendment_awaiting_other_side" : "read_only"
      return canAct ? "confirm_amendment" : "read_only"
    case "final":
    case "external_recorded":
      return canAct ? "final" : "read_only"
  }
}

/** The plain-English line under the score, for every state, for every viewer. */
export function fixtureResultStatusLine(state: FixtureResultState, mode: FixtureResultMode): string {
  if (state.cancelled) return "This fixture was cancelled, so there is no result."
  switch (state.status) {
    case "none":
      return state.kickoffPassed ? "No result has been entered yet." : "The result can be entered once the match has kicked off."
    case "awaiting_confirmation":
      return mode === "awaiting_other_side"
        ? "Your club submitted this score. Waiting for the other club to confirm or dispute it."
        : mode === "confirm"
          ? "The other club submitted this score. Confirm it if it's right, or dispute it."
          : "This score is waiting for confirmation."
    case "disputed":
      return "The two clubs submitted different scores. Either club can submit the score it believes, or an organiser can settle it."
    case "unverified":
      return "This result has not been verified by both clubs."
    case "amendment_pending":
      return mode === "amendment_awaiting_other_side"
        ? "Your club proposed a change to the final score. Waiting for the other club to agree."
        : "A change to the final score has been proposed. The original stands until it is agreed."
    case "final":
      return state.resolvedBySiteAdmin ? "Final. Settled by an organiser." : "Final. Both clubs agree this score."
    case "external_recorded":
      return "Recorded against a club that isn't on Ovalball, so there was no one to confirm it."
  }
}
