import { Redirect, useLocalSearchParams } from "expo-router"

import { parseMatchCentreSection } from "@ovalball/contracts/match-centre/sections"

import { routeForIntent } from "../../../../src/links/destinations"

/**
 * A COMPATIBILITY ADDRESS, NOT A SECOND SURFACE.
 *
 * The Match Centre's former participant address. Links that already exist keep working: they arrive at
 * the one Match Centre, at the section they name.
 * It draws nothing of its own: it resolves through the one route table and redirects there.
 */
export default function Compatibility() {
  const { fixtureId, tab } = useLocalSearchParams<{ fixtureId: string; tab?: string }>()
  return <Redirect href={routeForIntent({ kind: "MATCH_CENTRE", fixtureId: String(fixtureId), ...(tab ? { section: parseMatchCentreSection(tab) } : {}) }) as never} />
}
