import { Stack } from "expo-router"

import { TrainingPlanDraftProvider } from "../../../../../src/training-planning/create-plan/draft-context"

export default function CreateTrainingPlanLayout() {
  return (
    <TrainingPlanDraftProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="select-team" options={{ presentation: "modal" }} />
        <Stack.Screen name="select-season" options={{ presentation: "modal" }} />
        <Stack.Screen name="select-venue" options={{ presentation: "modal" }} />
        <Stack.Screen name="select-pitch" options={{ presentation: "modal" }} />
      </Stack>
    </TrainingPlanDraftProvider>
  )
}
