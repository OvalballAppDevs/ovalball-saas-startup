import { Stack } from "expo-router"

/**
 * "create" presents as a full-screen modal, not a normal stack push -- Section 9's correction pass
 * found the global bottom tab bar (Home/Fixtures/Calendar/Clubhouse/More) was persisting underneath
 * the whole Create Training Plan flow, which is both visually wrong for a creation flow (the wizard's
 * own "Cancel" already reads as the exit, a second navigation surface below it is redundant) and the
 * literal cause of the Season selector overlapping tappable space with the tab bar. A modal
 * presentation covers the tab bar entirely, the same way select-team/select-season already do one
 * level deeper.
 */
export default function TrainingPlanningLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" options={{ presentation: "modal" }} />
    </Stack>
  )
}
