import { Stack } from "expo-router"

/**
 * THE TEAM WORKSPACE'S OWN SCREENS (CA-M7). Availability, People, Fixture Requests and Team Settings
 * slide over the Home tab, so Back returns to the team rather than out of the group. Reached from the
 * Team Home's cards and from More in a team context; addressable by deep link, where the screen asked
 * for mounts directly and every read re-checks who is asking.
 */
export default function TeamLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
