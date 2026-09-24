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
 * THE FIFTH CELL IS MORE. Everything that does not earn a permanent cell lives one tap inside it
 * rather than being lost.
 *
 * AND IT IS A PROJECTION, NOT AN AUTHORITY. Every route re-checks the server, exactly as the
 * website's navigation does. Showing a cell grants nothing and hiding one protects nothing.
 */

export type TabKey =
  | "index"
  | "fixtures"
  | "calendar"
  | "messages"
  | "hub"
  | "subscriptions"
  | "more"
  /** Header utilities. Routes in this group, never cells in the bar. */
  | "notifications"
  | "support"
  /** Reached from More in a club context (CA-M1). A route in this group, never a cell. */
  | "admin"
  /** Reached from Home and More in a team context (CA-M7): Availability, People, Requests, Team Settings. A route group, never a cell. */
  | "team"

export interface TabSpec {
  key: TabKey
  label: string
}

/**
 * The four everyday destinations, in the same place for every context.
 *
 * MESSAGES IS NO LONGER ONE OF THEM, and this supersedes the M3 decision that put it here. The
 * reasoning then was that messaging is a DAILY operational job while Rugby Hub is something you go
 * and read -- which was true, and is not the whole question. Communication is a UTILITY: it is needed
 * from wherever you already are, not navigated to, and the same is true of notifications and of
 * support. All three now live in the global header, persistently, on every screen -- which is more
 * available than a tab, not less.
 *
 * That frees the bar to hold five PRODUCT AREAS. Rugby Hub takes the fourth cell.
 *
 * MESSAGES' ROUTE IS UNTOUCHED. `/messages`, `/messages/[kind]/[id]`, every deep-link intent and every
 * recipient rule are exactly as they were: this moved a shortcut, not a product.
 */
const EVERYDAY: TabSpec[] = [
  { key: "index", label: "Home" },
  { key: "fixtures", label: "Fixtures" },
  { key: "calendar", label: "Calendar" },
  { key: "hub", label: "Rugby Hub" },
]

export function projectTabs(_options?: {
  kind: ActiveContextKind | null
  canSeeTeamSubscriptions?: boolean
}): TabSpec[] {
  // ONE ARRANGEMENT FOR EVERY CONTEXT, at this stage and deliberately. A bar whose shape changes when
  // you switch context costs more in confusion than a tailored cell saves in taps, and the owner's
  // rule for Parent and Player is the same five either way -- identical navigation, different
  // authority INSIDE each destination.
  //
  // Subscriptions is one tap away in More and keeps its capability-aware behaviour on its own screen.
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
export const ALL_TABS: TabKey[] = [
  "index",
  "fixtures",
  "calendar",
  "messages",
  "hub",
  "subscriptions",
  "more",
  "notifications",
  "support",
]

/**
 * THE GLOBAL HEADER'S THREE, in the order they appear.
 *
 * Declared here beside the bar so that "which destinations exist, and where each
 * one lives" is one list rather than two -- and so a test can assert that none of
 * them is also a bar cell.
 */
export const HEADER_UTILITIES: TabKey[] = ["messages", "notifications", "support"]
