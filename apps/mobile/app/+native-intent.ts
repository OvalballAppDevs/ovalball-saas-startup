import { routeForIntent } from "../src/links/destinations"
import { resolveIntent } from "../src/links/intents"

/**
 * EVERY LINK INTO OVALBALL IS FOLLOWED ONCE, BY ONE HANDLER.
 *
 * A link used to be followed twice. The router opened any URL whose path happened to be a real file
 * route -- `/fixtures/<id>` -- and the app's own link handler (`useIncomingLinks` in the root layout)
 * then pushed the canonical route for the same link on top of it, so Back from a Match Centre opened
 * from an email returned to the same Match Centre. A URL whose path is NOT a file route -- the canonical
 * `/events/<id>` every event notification, email and share carries -- went the other way: the router
 * found nothing and the app was left on Home.
 *
 * So the router is told to stand aside for every link the route table understands (`routeForIntent`),
 * and `useIncomingLinks` follows it: through the one route table, and held until sign-in when the
 * person is signed out, which the router's own navigation could never do. Recovery, sign-in callbacks
 * and invitations keep their existing path, and a link nothing understands still reaches +not-found.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    const intent = resolveIntent(path)
    if (intent.kind === "AUTH_RECOVERY" || intent.kind === "AUTH_OAUTH" || intent.kind === "JOIN") return path
    return routeForIntent(intent) ? null : path
  } catch {
    return path
  }
}
