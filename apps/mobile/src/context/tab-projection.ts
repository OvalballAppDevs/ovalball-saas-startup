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

export type TabKey = "index" | "fixtures" | "calendar" | "hub" | "subscriptions" | "more"

export interface TabSpec {
  key: TabKey
  label: string
}

/** The four everyday destinations, in the same place for every context. */
const EVERYDAY: TabSpec[] = [
  { key: "index", label: "Home" },
  { key: "fixtures", label: "Fixtures" },
  { key: "calendar", label: "Calendar" },
  { key: "hub", label: "Rugby Hub" },
]

export function projectTabs({
  kind,
  canSeeTeamSubscriptions,
}: {
  kind: ActiveContextKind | null
  /** Held at TEAM scope, answered by the server. Never inferred from the context kind. */
  canSeeTeamSubscriptions: boolean
}): TabSpec[] {
  // A team manager who may see this squad's subscription state does that most weeks; it earns the
  // fifth cell for them and for nobody else. The capability is the server's answer -- `kind === "team"`
  // alone would hand it to every coach who cannot open the page.
  if (kind === "team" && canSeeTeamSubscriptions) {
    return [...EVERYDAY, { key: "subscriptions", label: "Subscriptions" }]
  }
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
export const ALL_TABS: TabKey[] = ["index", "fixtures", "calendar", "hub", "subscriptions", "more"]
