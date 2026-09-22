/**
 * Moved to `packages/contracts/src/agenda/mirror-pair` so React Native can reach it, and re-exported
 * here so nothing on the web had to change. The rules -- and the long explanation of why a mirror pair
 * has no single global primary -- live there now, in one place.
 *
 * No `server-only`: this module is pure and several client components legitimately import it.
 */

export * from "@ovalball/contracts/agenda/mirror-pair"
