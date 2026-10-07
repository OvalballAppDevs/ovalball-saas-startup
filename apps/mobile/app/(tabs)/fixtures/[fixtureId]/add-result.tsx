import { Redirect, useLocalSearchParams } from "expo-router"

import { routeForIntent } from "../../../../src/links/destinations"

/**
 * A COMPATIBILITY ADDRESS, NOT A SECOND SURFACE.
 *
 * The former Add Result screen's address. Entering a score is the Result section's own action in the
 * one Match Centre.
 * It draws nothing of its own: it resolves through the one route table and redirects there.
 */
export default function Compatibility() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  return <Redirect href={routeForIntent({ kind: "ADD_RESULT", fixtureId: String(fixtureId) }) as never} />
}
