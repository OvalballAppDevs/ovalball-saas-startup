import "server-only"

/**
 * THE RULE THAT STOPS A SCALAR FROM BECOMING A GUESS.
 *
 * public.team_playing_group_recipient_context (and its club/platform
 * siblings) return one row per (recipient, player) relationship -- a
 * guardian of three children on the audience is three rows sharing one
 * user_id. That is exactly right for deciding what to show; it is exactly
 * wrong to hand straight to a template, because `{{player_first_name}}`
 * cannot mean three things at once, and picking "the first one" is a
 * silent, arbitrary product decision no one asked for.
 *
 * This resolves ONE recipient's rows into what a template may actually use:
 * the specific player when there is exactly one, and an explicit
 * "unavailable, ambiguous" state otherwise -- never a first-element guess.
 */

export interface RecipientPlayerRow {
  playerId: string
  relationship: "guardian" | "self"
}

export type RecipientRelativePlayerContext =
  | { kind: "single"; playerId: string; relationship: "guardian" | "self" }
  | { kind: "none" }
  | { kind: "ambiguous"; playerIds: string[] }

/**
 * Collapses one recipient's player relationships (all rows sharing their
 * user_id) into the single-player context a scalar variable may read from.
 *
 * `kind: "ambiguous"` is the case a template author must be told about
 * explicitly -- see resolveScalarPlayerVariable's own doc for how the Dynamic
 * Data panel and the send path are expected to react to it (never silently
 * substitute the first id, never render a blank as if nothing were relevant).
 */
export function resolveRecipientPlayerContext(rows: RecipientPlayerRow[]): RecipientRelativePlayerContext {
  if (rows.length === 0) return { kind: "none" }
  const uniquePlayerIds = [...new Set(rows.map((r) => r.playerId))]
  if (uniquePlayerIds.length === 1) {
    return { kind: "single", playerId: uniquePlayerIds[0], relationship: rows[0].relationship }
  }
  return { kind: "ambiguous", playerIds: uniquePlayerIds }
}

/**
 * A player-scoped scalar (e.g. `{{player_first_name}}`) is only ever
 * resolved for a "single" context. "none" and "ambiguous" both produce
 * `null` here -- the caller's job (lib/email/contracts.ts's own
 * unknownVariables rule, extended for audience sends) is to treat a null
 * player-scoped variable as UNAVAILABLE for this recipient, never as an
 * empty string silently substituted in. What "unavailable" means for an
 * audience send -- omit the recipient, omit the variable, fall back to a
 * structured collection -- is a product decision for the Broadcast Composer
 * this slice does not build; this function only guarantees the ambiguity is
 * never hidden.
 */
export function resolveScalarPlayerVariable<T>(
  context: RecipientRelativePlayerContext,
  resolve: (playerId: string) => T
): T | null {
  if (context.kind !== "single") return null
  return resolve(context.playerId)
}
