import "server-only"

/**
 * Moved to `packages/contracts/src/agenda/team-identity` so React Native can reach it, and re-exported
 * here so nothing on the web had to change. `server-only` stays on this side, as it does for every other
 * module the mobile client now shares: a bundling boundary for the browser, not a secret.
 */

export * from "@ovalball/contracts/agenda/team-identity"
