/**
 * Moved to `packages/contracts/src/parent/agenda-model` so React Native can
 * reach it, and re-exported here so nothing on the web had to change.
 *
 * It was already dependency-free -- no `server-only`, no Supabase, no
 * `next/headers` -- precisely so the rules a parent acts on could be tested on
 * their own. The app needs the same rules: "this child has not answered yet, the
 * match is inside a fortnight, and it has not been cancelled" is one product
 * decision, and a phone that decided it a second way would eventually tell a
 * parent a different number from the website.
 */

export * from "@ovalball/contracts/parent/agenda-model"
