import type { RugbyHubTeamOption } from "@ovalball/contracts/rugby-hub/rugby-hub-data"

/**
 * WHOSE RUGBY HUB — the one rule, written down once.
 *
 * The website's rule (`resolveActiveRugbyHubTeamId`): the Hub's own remembered
 * choice if it is still one of the viewer's real options, else the first real
 * option. The app adds the one thing a phone has that a browser tab does not:
 * a SELECTED CONTEXT in the header. A parent standing in Ava's context has
 * already said whose rugby they mean, so that team is the default -- and a
 * choice made inside the Hub is remembered PER CONTEXT, never across one, so
 * switching from Ava to Ben in the header can never leave Ava's rules on
 * screen. That was the defect the owner saw.
 *
 *   1. the Hub's remembered choice for THIS context, if still a real option
 *   2. the team the selected context IS (parent / player / team), or the
 *      first of the club's teams for a club context
 *   3. the first real option (the website's fallback; "All Children" lands here)
 *
 * The options are the SERVER's list of the viewer's real relationships; this
 * only chooses among them. Nothing here is authority, and nothing here reads a
 * team's name.
 */
export interface HubTeamChoice {
  teamId: string | null
  /** How the team was chosen, for the screen to say so honestly. */
  source: "remembered" | "context" | "first" | "none"
}

export function resolveHubTeam(
  options: RugbyHubTeamOption[],
  active: { kind: string; id: string | null } | null,
  rememberedTeamId: string | null
): HubTeamChoice {
  if (options.length === 0) return { teamId: null, source: "none" }
  const remembered = rememberedTeamId ? options.find((t) => t.teamId === rememberedTeamId) : undefined
  if (remembered) return { teamId: remembered.teamId, source: "remembered" }
  if (active?.id) {
    const fromContext =
      active.kind === "club" ? options.find((t) => t.clubId === active.id) : active.kind === "parent" || active.kind === "player" || active.kind === "team" ? options.find((t) => t.teamId === active.id) : undefined
    if (fromContext) return { teamId: fromContext.teamId, source: "context" }
  }
  return { teamId: options[0].teamId, source: "first" }
}

/** The AsyncStorage key a Hub choice is remembered under: one per selected context, so a choice never crosses contexts. */
export function hubTeamPreferenceKey(activeKey: string | null): string {
  return `ovalball.rugby-hub.team:${activeKey ?? "none"}`
}

export const HUB_TEAM_PREFERENCE_PREFIX = "ovalball.rugby-hub.team:"
