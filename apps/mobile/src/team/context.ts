import type { SwitchableContext } from "@ovalball/contracts"

/**
 * A DEEP LINK NAMES A TEAM; THE SWITCHER DECIDES WHETHER IT IS YOURS.
 *
 * A notification about Under 12 Boys, tapped while standing in Under 14 Girls, should open in the team
 * it is about -- but only if that team is one of the contexts the person already holds. The switchable
 * contexts are the SAME list the website computes (`listSwitchableContexts`, shared), so a link cannot
 * grant a context: it can only select one that was already on offer. A team id that matches nothing is
 * left alone, and the screen it lands on refuses by RLS as it always would.
 *
 * Returns the key to select, or null when no switch is needed or possible.
 */
export function teamContextKeyFor(teamId: string, contexts: SwitchableContext[], active: SwitchableContext | null): string | null {
  if (active?.kind === "team" && active.id === teamId) return null
  const match = contexts.find((c) => c.kind === "team" && c.id === teamId)
  return match ? match.key : null
}
