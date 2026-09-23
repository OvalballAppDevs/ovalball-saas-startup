/**
 * Client-safe heritage types and pure constants -- split from
 * heritage-data.ts (which carries "server-only") for the same reason as
 * position-explorer-types.ts / skills-explorer-types.ts: a client
 * component importing anything, even a runtime constant like
 * CERTAINTY_LABEL, from a "server-only" module pulls the whole module,
 * guard included, into the client bundle. Pure type-only imports don't
 * have this problem (they're erased at compile time), but CERTAINTY_LABEL
 * is a real runtime value, so it lives here instead.
 */

export type CodeScope = "union" | "league" | "both" | "pre_schism"
export type Certainty = "ESTABLISHED" | "WELL_DOCUMENTED" | "CONTESTED" | "LEGEND" | "MYTH"

/** The one certainty vocabulary -- reused by the detail page's CertaintyBadge and by Rugby Hub search, so a MYTH/LEGEND result never reads differently in two places. */
export const CERTAINTY_LABEL: Record<Certainty, string> = {
  ESTABLISHED: "Established",
  WELL_DOCUMENTED: "Well documented",
  CONTESTED: "Contested",
  LEGEND: "Legend",
  MYTH: "Myth",
}
