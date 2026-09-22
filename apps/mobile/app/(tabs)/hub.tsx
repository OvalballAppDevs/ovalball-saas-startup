import { DestinationFoundation } from "../../src/components/destination"
import { BookOpen } from "../../src/components/icons"
import { colour } from "../../src/design/tokens"

export default function Hub() {
  return (
    <DestinationFoundation
      icon={<BookOpen size={30} color={colour.forest800} strokeWidth={1.9} />}
      title="Rugby Hub"
      intro="The laws, the age grades and the rest of the game — in your own code, written for the person asking."
      willHold={[
        "Age-grade rules and what changes at each one",
        "Laws and how they are actually applied on a Sunday morning",
        "Guidance for coaches, for parents and for players, each in their own words",
        "The story of the game, and of the two codes",
      ]}
      webPath="/rugby-hub"
      webLabel="Open Rugby Hub on the Web"
    />
  )
}
