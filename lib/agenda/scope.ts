/**
 * Moved to `packages/contracts/src/agenda` so React Native can reach it, and re-exported here so
 * nothing on the web had to change. The implementation is unchanged and lives in exactly one place;
 * this file exists only so the existing `@/lib/agenda/...` imports keep resolving to it.
 *
 * NO `server-only` HERE, and that is the point. This module is pure and has always been imported by
 * CLIENT components -- the agenda controls, the season bar, the filter drawer. The first version of
 * this shim added the directive to all four agenda modules alike, which took the whole /agenda page
 * down with a 500 ("You're importing a module that depends on \"server-only\"") the moment a browser
 * bundle reached it. Only `load.ts` ever carried it, because only `load.ts` talks to the database.
 */

export * from "@ovalball/contracts/agenda/scope"
