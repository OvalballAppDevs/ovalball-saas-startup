import type { ActiveContextKind } from "@ovalball/contracts"

/**
 * WHICH FIVE DESTINATIONS THIS CONTEXT ACTUALLY WANTS.
 *
 * The bottom bar is five cells wide before the labels stop being readable, and Ovalball has more than
 * five jobs -- so which five is a product decision, and it is not the same decision for a coach and
 * for a parent. Deciding it HERE, as data, rather than inside the layout means it can be asserted in a
 * test and changed in one place.
 *
 * THE SHAPE STAYS THE SAME ON PURPOSE. Home, Fixtures, Calendar and Rugby Hub are in the same position
 * for everybody, so switching context does not feel like opening a different app -- the owner's
 * instruction, and the reason the fifth cell is the only one that varies. Muscle memory for the four
 * everyday destinations is worth more than a perfectly tailored bar.
 *
 * THE FIFTH CELL IS THE CONTEXT'S OWN. A team manager who holds the bounded finance capability gets
 * Subscriptions there, because chasing subscriptions is a weekly job for exactly that person. Everyone
 * else gets More, which holds the same destination one tap further away rather than losing it.
 *
 * AND IT IS A PROJECTION, NOT AN AUTHORITY. Every route re-checks the server, exactly as the
 * website's navigation does. Showing a cell grants nothing and hiding one protects nothing.
 */

export type TabKey = "index" | "fixtures" | "calendar" | "messages" | "hub" | "subscriptions" | "more"

export interface TabSpec {
  key: TabKey
  label: string
}

/**
 * The five destinations, in the same place for every context.
 *
 * MESSAGES EARNED THE FOURTH CELL at M3, and Rugby Hub moved to More. Both are owner decisions and
 * they are the same decision: messaging is a DAILY operational job -- a coach answering a parent on a
 * Friday night -- while Rugby Hub is something you go and read. A bar holds five before the labels
 * stop being readable, so the fifth is the one a person opens most.
 *
 * Rugby Hub's ROUTE is untouched; only its shortcut moved.
 */
const EVERYDAY: TabSpec[] = [
  { key: "index", label: "Home" },
  { key: "fixtures", label: "Fixtures" },
  { key: "calendar", label: "Calendar" },
  { key: "messages", label: "Messages" },
]

export function projectTabs(_options?: {
  kind: ActiveContextKind | null
  canSeeTeamSubscriptions?: boolean
}): TabSpec[] {
  // ONE ARRANGEMENT FOR EVERY CONTEXT, at this stage and deliberately. Subscriptions briefly took the
  // fifth cell for a team manager holding the finance capability; Messages is a daily job for every
  // persona, and a bar whose shape changes when you switch context costs more in confusion than a
  // tailored fifth cell saves in taps. Subscriptions and Rugby Hub are both one tap away in More, and
  // Subscriptions keeps its capability-aware behaviour on its own screen.
  //
  // The signature keeps its options so the projection stays the place this decision is made -- a
  // per-context bar is a change here, not a change in the layout.
  return [...EVERYDAY, { key: "more", label: "More" }]
}

/**
 * Every tab the router must declare, whatever the projection.
 *
 * expo-router needs a screen for each file that exists; a projection that simply omitted one would
 * leave the route reachable but unlisted, which is how a destination becomes unreachable on some
 * contexts and mysteriously reachable by URL on others. So all six are declared, and the ones this
 * context does not want are hidden from the bar -- and More is always reachable, because it is where
 * everything the bar cannot hold lives.
 */
export const ALL_TABS: TabKey[] = ["index", "fixtures", "calendar", "messages", "hub", "subscriptions", "more"]
