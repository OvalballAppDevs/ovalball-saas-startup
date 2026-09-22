import { Stack } from "expo-router"

/**
 * FIXTURES IS ONE TAB WITH SEVERAL SCREENS.
 *
 * The list stays put and a fixture slides over it, which is what a phone expects and what makes the
 * system back gesture return rather than dropping somebody out of the tab.
 */
export default function FixturesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
