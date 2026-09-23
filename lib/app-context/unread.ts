import "server-only"

/**
 * Moved to `packages/contracts/src/unread` so React Native can reach it, and
 * re-exported here so nothing on the web had to change.
 *
 * The app's header carries the same three controls -- Messages, Notifications
 * and Support -- and was summing its own inbox for one of them. Three badges
 * must come from the one round trip the database already offers, or they
 * disagree the moment a Support ticket arrives.
 */

export * from "@ovalball/contracts/unread"
