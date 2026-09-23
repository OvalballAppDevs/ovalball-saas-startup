import "server-only"

/**
 * Moved to `packages/contracts/src/rugby-hub/position-explorer-data.ts` so React Native can reach it, and re-exported
 * here so nothing on the web had to change. The implementation is unchanged and lives in exactly
 * one place; this file exists only so every existing import path still resolves. One Rugby Hub, two
 * clients.
 */
export * from "@ovalball/contracts/rugby-hub/position-explorer-data"
