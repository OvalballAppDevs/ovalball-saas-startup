import "server-only"

/**
 * Moved to `packages/contracts/src/agenda` so React Native can reach it, and re-exported here so
 * nothing on the web had to change. The implementation is unchanged and lives in exactly one place;
 * this file exists only so the existing `@/lib/agenda/...` imports keep resolving to it.
 *
 * `server-only` stays HERE rather than in the package. It was always a bundling directive -- this
 * module holds no secret, and the loader takes an already-authenticated client -- but keeping it on the
 * web side means a browser component that reaches for these still fails exactly as it did before, while
 * the mobile client, which has no such bundle boundary, imports the package directly.
 */

export * from "@ovalball/contracts/agenda/load"
