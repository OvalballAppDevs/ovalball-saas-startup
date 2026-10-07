import { Stack } from "expo-router"

import { TournamentDraftProvider } from "../../../../../src/tournaments/create-context"

/**
 * THE CREATE TOURNAMENT WIZARD.
 *
 * The draft provider wraps the whole stack so the organiser's work survives every step change --
 * selecting age groups, configuring each one's teams, going back to correct a date. Each screen
 * carries its own header, so the stack's own is off.
 */
export default function CreateTournamentLayout() {
  return (
    <TournamentDraftProvider>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </TournamentDraftProvider>
  )
}
