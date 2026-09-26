/**
 * THE TWO CLUBHOUSE DISCOVERY ENTRY INTENTS, resolved once and testably (physical-review correction --
 * a real bug where the Expo Go environment silently overrode this and made "Explore the Map" land in
 * List with no way back to Map, indistinguishable from "Find a Club").
 *
 * EXPLORE THE MAP is discovery-led: "I want to explore the rugby network," map first.
 * FIND A CLUB is intent-led: "I know which club I want," list/search first.
 *
 * ENVIRONMENT MUST NEVER DECIDE THIS. Expo Go's genuine inability to RENDER MapLibre (no native module)
 * is a rendering limitation handled entirely inside the map view itself (an honest "needs a development
 * build" message), never a reason to swap which PRODUCT MODE the screen opens in -- that decision
 * belongs only to which Home tile the person actually tapped.
 */
export type ClubhouseMapMode = "map" | "list"

export function resolveInitialMode(params: { mode?: string }): ClubhouseMapMode {
  return params.mode === "search" ? "list" : "map"
}
