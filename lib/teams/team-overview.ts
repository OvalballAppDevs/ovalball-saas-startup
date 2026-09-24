import "server-only"

/**
 * Moved to `packages/contracts/src/team/overview.ts` (CA-M7) so the app's Team Home and the website's
 * dashboard panel render the SAME read, and re-exported here so nothing on the web changed its import.
 *
 * The read grew with the move -- kick-off proposals, pending place requests, call-ups, subscription
 * attention and incomplete fixtures joined the two items it held -- and every one of them is derived
 * from a canonical record under the caller's own authority. See `projectTeamAttention`.
 */
export { loadTeamOverview, teamAgendaWindows, type TeamOverview } from "@ovalball/contracts/team/overview"
export type { TeamAttentionItem } from "@ovalball/contracts/team/attention"
