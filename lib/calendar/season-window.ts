/**
 * Moved to `packages/contracts/src/agenda/season-window` so React Native can reach it, and re-exported
 * here so nothing on the web had to change. It is pure -- no database, no request, no clock it was not
 * handed -- which is exactly why the mobile Calendar can share it rather than deriving a second answer
 * to "which season is this".
 *
 * No `server-only`: it never had one, and several client components legitimately import it.
 */

export * from "@ovalball/contracts/agenda/season-window"
