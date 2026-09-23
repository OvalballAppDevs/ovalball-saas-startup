/**
 * Moved to `packages/contracts/src/club/theme` so React Native can reach it, and
 * re-exported here so nothing on the web had to change.
 *
 * These four modules were always pure -- a colour engine, a markup summariser
 * and two vocabularies, with no imports between them and nothing server-side.
 * The app needs all four for the same reason the website does: the club's home
 * kit decides the colour of its home screen, and a notice has to be summarised
 * and named the same way on both.
 */

export * from "@ovalball/contracts/club/theme"
