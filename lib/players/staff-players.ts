import "server-only"

/**
 * Moved to `packages/contracts/src/team/players.ts` so React Native can reach it (CA-M7), and re-exported
 * here so nothing on the web changed its import. `server-only` stays: it is a bundling directive, not a
 * secret -- the reader takes an already-authenticated client and holds nothing privileged.
 */
export { loadStaffPlayers, staffPlayerAgeState, type StaffPlayer } from "@ovalball/contracts/team/players"
