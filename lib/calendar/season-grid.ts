/**
 * Moved to `packages/contracts/src/agenda/season-grid` so React Native can reach it, and re-exported
 * here so nothing on the web had to change. It is pure -- it takes events the server already
 * authorised and returns an arrangement of them -- which is exactly why both clients can share it: the
 * shape of a season is the same shape on a phone, and deriving it twice is how the two would come to
 * disagree about which week a Saturday belongs to.
 */

export * from "@ovalball/contracts/agenda/season-grid"
