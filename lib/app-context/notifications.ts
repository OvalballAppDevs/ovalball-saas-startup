import "server-only"

/**
 * Moved to `packages/contracts/src/notifications/bell` so React Native can reach
 * it, and re-exported here so nothing on the web had to change. The app's header
 * carries the same bell and must show the same items.
 */

export * from "@ovalball/contracts/notifications/bell"
