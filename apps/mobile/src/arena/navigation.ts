import type { useRouter } from "expo-router"

import type { ArenaActivity } from "@ovalball/contracts/arena"

import { routeForIntent } from "../links/destinations"
import { withinStack } from "../links/stack-routes"

/**
 * ARENA OPENS THE CANONICAL CENTRE, NEVER A COPY OF IT. A fixture opens its Match Centre, a session the
 * Training Centre, a tournament its organiser's screen, an event its Event Centre -- through the one
 * routing table, kept inside the admin stack where an alias exists so Back returns to Arena.
 */
export function openActivity(router: ReturnType<typeof useRouter>, a: ArenaActivity): void {
  const route =
    a.kind === "FIXTURE"
      ? routeForIntent({ kind: "FIXTURE", fixtureId: a.id })
      : a.kind === "TRAINING"
        ? routeForIntent({ kind: "TRAINING", sessionId: a.id })
        : a.kind === "TOURNAMENT"
          ? { pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: a.id } }
          : { pathname: "/admin/event/[eventId]", params: { eventId: a.id } }
  if (!route) return
  router.push(withinStack(route as never, "admin") as never)
}

/** The centre an activity opens in, in words, for a button. */
export function centreName(a: ArenaActivity): string {
  if (a.kind === "FIXTURE") return "Open Fixture"
  if (a.kind === "TRAINING") return "Open Training"
  if (a.kind === "TOURNAMENT") return "Open Tournament"
  return "Open Event Centre"
}
