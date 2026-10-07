import { Stack } from "expo-router"

/** The wizard's own stack, so the tournaments group stays one declared route rather than several. */
export default function PlanLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
