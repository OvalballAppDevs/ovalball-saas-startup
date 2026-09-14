/**
 * THE SEASON PLANNER'S SUGGESTIONS, AND WHEN THEY STEP ASIDE.
 *
 * The same rules the fixture editor uses (opposition-match.ts, venue-defaults.ts),
 * applied to a spreadsheet row:
 *
 *   Opposition Team -- when the opposition club is on Ovalball, the one
 *                      strong match for our team is filled in. Several good
 *                      matches, or none, leave it blank to choose.
 *   Venue / Pitch   -- Home fills our default ground (and its pitch when it
 *                      has exactly one); Away fills the opposition's recorded
 *                      home ground (and, for an Ovalball club, its only
 *                      pitch). No ground on record, nothing is filled.
 *
 * THE OVERRIDE RULE. A filled cell is a suggestion until somebody types in it.
 * A suggestion is refreshed when what it was based on changes; a person's own
 * value is never replaced, except where a material change has made it wrong:
 * a different opposition club (their team no longer applies), or Home and Away
 * swapping (the ground is now the other club's).
 *
 * Runs only when a person edits one cell. A paste or an import is somebody's
 * data, and is left exactly as it arrived.
 */

import type { MatchableTeam } from "./opposition-match"
import { suggestOppositionTeam } from "./opposition-match"
import { normaliseHomeAway, type PlannerDraftRow } from "./planner-model"

export type SuggestableField = "oppositionTeam" | "venue" | "pitch"

export interface PlannerOppositionContext {
  /** On Ovalball: their real teams can be suggested. */
  onOvalball: boolean
  /** Their recorded home ground, if any. */
  homeGround: string | null
  /** The only pitch at that ground, when they are on Ovalball and it has exactly one. */
  homePitch?: string | null
  /** Their teams, or null while they are still loading. */
  teams: MatchableTeam[] | null
}

export interface PlannerDefaultsContext {
  ourTeam: MatchableTeam | null
  opposition: PlannerOppositionContext | null
  /** Our default ground and, when it has exactly one, its pitch. */
  ourGround: { venue: string; pitch: string | null } | null
}

export interface PlannerDefaultsResult {
  row: PlannerDraftRow
  suggested: Set<SuggestableField>
  /** The opposition is on Ovalball but their teams have not arrived yet. */
  awaitingTeams: boolean
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Fills Opposition Team when it is blank or still a suggestion. */
export function suggestTeamForRow(
  row: PlannerDraftRow,
  suggested: ReadonlySet<SuggestableField>,
  ctx: PlannerDefaultsContext,
): PlannerDefaultsResult {
  const next = new Set(suggested)
  const opp = ctx.opposition
  if (!opp?.onOvalball || !ctx.ourTeam) return { row, suggested: next, awaitingTeams: false }
  if (!opp.teams) return { row, suggested: next, awaitingTeams: true }
  if (row.oppositionTeam.trim() && !next.has("oppositionTeam")) return { row, suggested: next, awaitingTeams: false }
  const { preselect } = suggestOppositionTeam(ctx.ourTeam, opp.teams)
  if (preselect) {
    next.add("oppositionTeam")
    return { row: { ...row, oppositionTeam: preselect.label }, suggested: next, awaitingTeams: false }
  }
  if (next.has("oppositionTeam")) {
    next.delete("oppositionTeam")
    return { row: { ...row, oppositionTeam: "" }, suggested: next, awaitingTeams: false }
  }
  return { row, suggested: next, awaitingTeams: false }
}

export function applyPlannerDefaults(
  before: PlannerDraftRow,
  after: PlannerDraftRow,
  suggested: ReadonlySet<SuggestableField>,
  ctx: PlannerDefaultsContext,
): PlannerDefaultsResult {
  let row = { ...after }
  const marks = new Set(suggested)

  // A cell somebody typed in is theirs now.
  for (const field of ["oppositionTeam", "venue", "pitch"] as const) {
    if (after[field] !== before[field]) marks.delete(field)
  }

  const clubChanged = !same(before.oppositionClub, after.oppositionClub)
  const ourTeamChanged = !same(before.ourTeam, after.ourTeam)
  const sideBefore = normaliseHomeAway(before.homeAway)
  const side = normaliseHomeAway(after.homeAway)
  const sideChanged = sideBefore !== side
  // Swapping between Home and Away is material; filling a blank is not.
  const sideSwapped = sideChanged && sideBefore !== null

  // ----- Opposition team
  let awaitingTeams = false
  if (clubChanged) {
    // A different club: a team of the previous one no longer applies, whoever
    // chose it. A club cell being cleared or retyped keeps it until a real club is named.
    if (before.oppositionClub.trim() && after.oppositionClub.trim() && row.oppositionTeam === before.oppositionTeam) row.oppositionTeam = ""
    marks.delete("oppositionTeam")
  }
  if (clubChanged || ourTeamChanged) {
    const t = suggestTeamForRow(row, marks, ctx)
    row = t.row
    awaitingTeams = t.awaitingTeams
    marks.clear()
    for (const m of t.suggested) marks.add(m)
  }

  // ----- Venue and pitch
  const venueBasisChanged = sideChanged || (clubChanged && side === "Away")
  if (venueBasisChanged) {
    const venueReplaceable = sideSwapped || !row.venue.trim() || marks.has("venue")
    const pitchReplaceable = sideSwapped || !row.pitch.trim() || marks.has("pitch")
    let venue: string | null = null
    let pitch: string | null = null
    if (side === "Home" && ctx.ourGround) {
      venue = ctx.ourGround.venue
      pitch = ctx.ourGround.pitch
    } else if (side === "Away" && ctx.opposition?.homeGround) {
      venue = ctx.opposition.homeGround
      pitch = ctx.opposition.homePitch ?? null
    }
    if (venueReplaceable) {
      if (venue) {
        row.venue = venue
        marks.add("venue")
      } else if (marks.has("venue") || sideSwapped) {
        row.venue = ""
        marks.delete("venue")
      }
      // The pitch belongs to the ground: a suggested pitch follows it, a chosen one stays unless the side swapped.
      if (pitchReplaceable) {
        if (pitch) {
          row.pitch = pitch
          marks.add("pitch")
        } else if (marks.has("pitch") || sideSwapped) {
          row.pitch = ""
          marks.delete("pitch")
        }
      }
    }
  }

  return { row, suggested: marks, awaitingTeams }
}
