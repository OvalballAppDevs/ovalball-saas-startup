import "server-only"

/**
 * Moved to `packages/contracts` so the mobile app builds its inbox from the SAME rows the website
 * does, and re-exported here so nothing on the web had to change.
 *
 * `export *` rather than a hand-written list: a list is a second declaration of what this module
 * offers, and the first thing to go stale.
 *
 * `server-only` stays HERE rather than in the package. It was always a bundling directive -- these
 * functions hold no secret and take an already-authenticated client -- but keeping it on the web side
 * means a browser component reaching for them still fails exactly as it did before.
 */

export * from "@ovalball/contracts/support-conversations"
