import "server-only"

/**
 * Moved to `packages/contracts` so the mobile conversation screen reads the SAME thread the website
 * reads, and re-exported here so nothing on the web had to change.
 *
 * `server-only` stays HERE: it was always a bundling directive, and keeping it on the web side means a
 * browser component reaching for these still fails exactly as it did before.
 */

export * from "@ovalball/contracts/messenger-direct"
