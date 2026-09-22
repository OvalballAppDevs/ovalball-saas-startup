/**
 * Moved to `packages/contracts/src/weather/types` so React Native can reach it,
 * and re-exported here so nothing on the web had to change.
 *
 * WHY IT WAS ALREADY READY TO MOVE. This module's own first line has always said
 * it is "deliberately dependency-free and provider-agnostic" -- it is the
 * normalised weather CONTRACT, with no adapter, no credential and no fetch. The
 * mobile Match Centre reads a forecast through an authorised route on the
 * website (which owns the provider, the key and the cache), and it has to
 * understand the same five states and the same two sentences, or the app would
 * invent a sixth.
 *
 * No `server-only` here: there never was one, and adding one now would break the
 * client components that already import these types.
 */

export * from "@ovalball/contracts/weather/types"
