import { Stack } from "expo-router"

import { SeasonPlannerProvider } from "../../../../src/season-planner/state"

/** The Season Planner's screens share one club day in progress. */
export default function SeasonPlannerLayout() {
  return (
    <SeasonPlannerProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SeasonPlannerProvider>
  )
}
