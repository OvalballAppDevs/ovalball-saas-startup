/**
 * Moved to `packages/contracts` so the mobile app builds its inbox from the SAME rows the website
 * does, and re-exported here so nothing on the web had to change.
 *
 * `export *` rather than a hand-written list: a list is a second declaration of what this module
 * offers, and the first thing to go stale.
 */

export * from "@ovalball/contracts/support-types"
