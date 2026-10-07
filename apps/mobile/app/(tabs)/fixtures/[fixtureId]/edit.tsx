import { Redirect, useLocalSearchParams } from "expo-router"

import { routeForIntent } from "../../../../src/links/destinations"

/**
 * A COMPATIBILITY ADDRESS, NOT A SECOND SURFACE.
 *
 * The former Edit Fixture screen's address. Editing is contextual in the Match Centre now; this opens
 * it with the match details editor showing, which appears only where the server says this viewer may
 * edit.
 * It draws nothing of its own: it resolves through the one route table and redirects there.
 */
export default function Compatibility() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  return <Redirect href={routeForIntent({ kind: "EDIT_FIXTURE", fixtureId: String(fixtureId) }) as never} />
}
