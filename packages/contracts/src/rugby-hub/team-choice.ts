import type { RugbyHubTeamOption } from "./rugby-hub-data"

/**
 * WHOSE RUGBY HUB -- the one rule, written down once, for both clients.
 *
 * The Hub is the same for everybody and personal in one narrow way: Rules, Safeguarding, Player
 * Welfare, the Position Explorer's age stage and the Skills Explorer's contact gate depend on WHICH
 * TEAM the viewer means by "mine". Both clients answer that from the same server list of the
 * viewer's real relationships (`getRugbyHubTeamOptions`) plus the app-wide SELECTED CONTEXT -- the
 * header switcher on the phone, the context switcher on the website -- and one remembered choice
 * made inside the Hub, kept PER CONTEXT so it can never outlive the context it was made in.
 * Switching from Ava to Ben in the header changes whose rugby is being asked about, and the Hub
 * follows on both clients.
 *
 *   1. the Hub's remembered choice for THIS context, if still a real option
 *   2. the team the selected context IS (parent / player / team), or the first of the club's
 *      teams for a club context
 *   3. the first real option (where the context names no team: "All Children", Site Admin)
 *
 * Nothing here is authority, and nothing here reads a team's name. The server still refuses a
 * team the viewer is not related to (`get_rugby_hub_identity_context`).
 */
export interface HubTeamChoice {
  teamId: string | null
  /** How the team was chosen, for the screen to say so honestly. */
  source: "remembered" | "context" | "first" | "none"
}

export interface HubActiveContext {
  kind: string
  /** The team for a team/parent/player context, the club for a club context. */
  id: string | null
  /** The owning club, when the context knows it. */
  clubId?: string | null
}

export function resolveHubTeam(options: RugbyHubTeamOption[], active: HubActiveContext | null, rememberedTeamId: string | null): HubTeamChoice {
  if (options.length === 0) return { teamId: null, source: "none" }
  const remembered = rememberedTeamId ? options.find((t) => t.teamId === rememberedTeamId) : undefined
  if (remembered) return { teamId: remembered.teamId, source: "remembered" }
  if (active) {
    const fromContext =
      active.kind === "club"
        ? options.find((t) => t.clubId === (active.clubId ?? active.id))
        : active.kind === "parent" || active.kind === "player" || active.kind === "team"
          ? options.find((t) => t.teamId === active.id)
          : undefined
    if (fromContext) return { teamId: fromContext.teamId, source: "context" }
  }
  return { teamId: options[0].teamId, source: "first" }
}

/** The AsyncStorage key (phone) a Hub choice is remembered under: one per selected context, so a choice never crosses contexts. */
export function hubTeamPreferenceKey(activeKey: string | null): string {
  return `${HUB_TEAM_PREFERENCE_PREFIX}${activeKey ?? "none"}`
}

export const HUB_TEAM_PREFERENCE_PREFIX = "ovalball.rugby-hub.team:"

/**
 * The website keeps the remembered choice in one cookie. Its value names the context the choice
 * was made in, so a choice made while viewing Ava is never applied while viewing Ben:
 * `<contextKey>|<teamId>`. Reading it for another context yields nothing.
 */
export function encodeHubTeamCookie(activeKey: string | null, teamId: string): string {
  return `${encodeURIComponent(activeKey ?? "none")}|${teamId}`
}

export function rememberedHubTeamFromCookie(value: string | undefined | null, activeKey: string | null): string | null {
  if (!value) return null
  const at = value.indexOf("|")
  if (at < 0) return null // the pre-RH-M0.2 shape (a bare team id) is not honoured across contexts
  const forContext = decodeURIComponent(value.slice(0, at))
  if (forContext !== (activeKey ?? "none")) return null
  const teamId = value.slice(at + 1)
  return teamId || null
}
