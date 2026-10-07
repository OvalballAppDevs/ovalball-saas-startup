import { Redirect, useLocalSearchParams } from "expo-router"

import { routeForIntent } from "../../../../src/links/destinations"

/**
 * A COMPATIBILITY ADDRESS, NOT A SECOND SURFACE.
 *
 * The former Match Result screen's address, which every result notification and result job still
 * carries (the website has a page here). In the app it opens the Match Centre's Result section, where
 * the same Match Result lives.
 * It draws nothing of its own: it resolves through the one route table and redirects there.
 */
export default function Compatibility() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  return <Redirect href={routeForIntent({ kind: "FIXTURE_RESULT", fixtureId: String(fixtureId) }) as never} />
}
