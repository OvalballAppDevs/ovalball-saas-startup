import { useSegments } from "expo-router"

/**
 * A LINK STAYS IN THE STACK IT WAS OPENED FROM, SO BACK RETURNS THE WAY THE PERSON CAME.
 *
 * Each tab is its own stack. A match lives at `/fixtures/<id>`, so a match opened from the Calendar used
 * to switch the person into the Fixtures tab, and Back then landed on the Fixtures agenda -- a list they
 * had never opened -- instead of the Calendar day they had come from. The Match Centre already solved this
 * for a team or club named in its hero with "a second address, not a second page": a thin alias route
 * inside the Fixtures stack that renders the one shared page. This is that rule, written once:
 *
 *   - `useCurrentStack()` -- which tab stack this screen is in, from the router's own segments;
 *   - `withinStack(route, stack)` -- the canonical route, or the alias of it that lives in that stack.
 *
 * An alias is only ever a re-export of the one implementation (the Match Centre, the Tournament Centre,
 * the public team and club pages), never a copy. A stack without an alias keeps the canonical route.
 */
export function useCurrentStack(): string | null {
  const segments = useSegments() as string[]
  const tabs = segments.indexOf("(tabs)")
  return tabs >= 0 ? (segments[tabs + 1] ?? null) : null
}

export { STACK_ALIASES, withinStack } from "./stack-routes"
