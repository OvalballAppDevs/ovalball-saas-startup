/**
 * Moved to `packages/contracts/src/availability/vocabulary` so React Native can
 * reach it, and re-exported here so nothing on the web had to change. The
 * implementation is unchanged and lives in exactly one place; this file exists
 * only so the existing `@/lib/attendance/vocabulary` imports keep resolving to
 * it.
 *
 * NO `server-only` HERE, deliberately and for the original reason this module
 * exists at all: it is imported by a `"use client"` control AND by
 * server-rendered registers. A server component importing a plain value from a
 * client module gets a client-reference proxy rather than the value, which is how
 * every register label once rendered as an empty string; a bundling directive
 * here would break the mirror image of that. The module holds no secret and
 * talks to nothing.
 *
 * The package now also holds the FIRST-PERSON answer words, the canonical group
 * order, the semantic tone of each state and the summary model -- see that
 * directory's own commentary for why the answer words had drifted into two sets.
 */

export { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability/vocabulary"
export type { AttendanceGroupKey as AttendanceStateKey } from "@ovalball/contracts/availability/states"
