import "server-only"

/**
 * Moved to `packages/contracts` so React Native can reach it, and re-exported here so nothing on the
 * web had to change. The implementation is unchanged and lives in exactly one place; this file exists
 * only so the existing `@/lib/...` imports keep resolving to it.
 *
 * `export *` rather than a hand-written list: a list is a second declaration of what this module
 * offers, and the first thing to go stale.
 *
 * `server-only` stays HERE rather than in the package, for the same reason `club-logo.ts` keeps it
 * here: this module holds no secret and every function takes an already-authenticated client, but
 * keeping the guard on the web side means a browser component that reaches for these still fails
 * exactly as it did before, while the mobile client, which has no such bundle boundary, imports the
 * package directly.
 */

export * from "@ovalball/contracts/team-cover"
