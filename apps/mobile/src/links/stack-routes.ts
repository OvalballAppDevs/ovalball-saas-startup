import type { Route } from "./destinations"

/**
 * WHICH ADDRESS A CANONICAL ROUTE HAS INSIDE EACH TAB'S STACK -- the pure half of `stack.ts`, kept free of the
 * router so it can be tested without one.
 *
 * Each entry maps a canonical route to an alias route that lives in that stack and re-exports the one
 * implementation (never a copy). A stack without an entry keeps the canonical route.
 */
const ALIASES: Record<string, Record<string, string>> = {
  calendar: {
    "/fixtures/[fixtureId]": "/calendar/match/[fixtureId]",
    "/fixtures/team/[teamId]": "/calendar/team/[teamId]",
    "/fixtures/club/[directoryId]": "/calendar/club/[directoryId]",
    "/tournaments/[tournamentId]": "/calendar/tournament/[tournamentId]",
    "/tournaments/result/[gameId]": "/calendar/tournament/result/[gameId]",
    // The Tournament Centre hands a tournament's organiser to the organiser's screen; from the Calendar it
    // must stay in the Calendar, or Back lands on whatever the Admin stack last showed.
    "/admin/tournaments/[tournamentId]": "/calendar/tournament/manage/[tournamentId]",
  },
  // The same hand-off when the Tournament Centre was opened from a link, a notification or Home.
  tournaments: {
    "/admin/tournaments/[tournamentId]": "/tournaments/manage/[tournamentId]",
  },
  // A club admin opens another club's tournament -- one it is attending -- from Admin › Tournaments, and the
  // organiser's game links open from the Results tab: both stay in the Admin stack, so Back returns there.
  admin: {
    "/tournaments/[tournamentId]": "/admin/tournament/[tournamentId]",
    "/tournaments/result/[gameId]": "/admin/tournament/result/[gameId]",
    // Arena Planning opens a fixture's Match Centre and a session's Training Centre: Back returns to Arena.
    "/fixtures/[fixtureId]": "/admin/match/[fixtureId]",
    "/calendar/training/[sessionId]": "/admin/training/[sessionId]",
  },
}

export function withinStack(route: Route, stack: string | null): Route {
  const alias = stack ? ALIASES[stack]?.[route.pathname] : undefined
  return alias ? { ...route, pathname: alias } : route
}

/** Every alias, for the structural test that each one is a re-export of the one implementation. */
export const STACK_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = ALIASES
