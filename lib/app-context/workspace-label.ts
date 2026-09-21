import type { ActiveContextKind } from "./active-context-rules"

/**
 * WHAT KIND OF WORKSPACE AM I IN?
 *
 * UX-0 found that three of five personas were given the same page heading -- the club's name -- so a
 * Club Admin, a player and a team volunteer all arrived at a page that said "Ovalball UAT RUFC" and
 * nothing else. Site Admin was the exception: it already said SITE ADMIN above "Platform", and that is
 * the pattern this restores everywhere.
 *
 * This maps the ALREADY-RESOLVED active context to a word for it. It reads nothing, decides nothing and
 * grants nothing: `resolveActiveContext` has already settled which context is active, and every route
 * re-checks its own authority server-side regardless. A label is a description of a decision that has
 * been made, never the making of one.
 *
 * WHY THESE WORDS. Each is either already on screen ("Site Admin" above the platform dashboard, "Club"
 * above People) or is the noun the product's own routes already use (`/teams`, `/player`). "Club Desk"
 * was deliberately NOT introduced: it appears nowhere in the product today, and inventing user-facing
 * vocabulary is a product decision rather than a presentation one -- it belongs with the wider naming
 * question UX-0 raised, not to this slice.
 *
 * A parent context is one child inside a family, so it shares the family's word; the heading beside it
 * is the child's name, which is what actually distinguishes them.
 */
const WORKSPACE: Record<ActiveContextKind, string> = {
  site_admin: "Site Admin",
  club: "Club",
  team: "Team",
  parent: "Family",
  player: "Player",
  family: "Family",
  // A county union, an armed-forces or schools union, a referees' society. "Governing Body" is the
  // product's own word for it -- `constituent_bodies` is the table's name and not a thing anybody says.
  governing: "Governing Body",
}

export function workspaceLabel(kind: ActiveContextKind): string {
  return WORKSPACE[kind]
}
