/**
 * Moved to `packages/contracts/src/notifications/destinations` so React Native
 * can reach it, and re-exported here so nothing on the web had to change.
 *
 * The map was always pure and always existed to be checked as a table -- the
 * structural guard and the destinations test both read it. The app needs the
 * same table: a notification that lands on the wrong screen in one client and
 * the right one in the other is two products.
 */

export * from "@ovalball/contracts/notifications/destinations"
