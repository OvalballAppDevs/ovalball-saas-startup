/**
 * Moved to `packages/contracts` so React Native can reach it, and re-exported here so nothing on the
 * web had to change. The implementation is unchanged and lives in exactly one place; this file exists
 * only so the existing `@/lib/...` imports keep resolving to it.
 *
 * `export *` rather than a hand-written list: a list is a second declaration of what this module
 * offers, and the first thing to go stale.
 */

export * from "@ovalball/contracts/role-labels"
