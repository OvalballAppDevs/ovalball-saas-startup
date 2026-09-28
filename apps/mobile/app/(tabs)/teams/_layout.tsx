import { Stack } from "expo-router"

/**
 * TEAMS IS ONE TAB WITH SEVERAL SCREENS -- the same shape `fixtures/_layout.tsx` already establishes.
 *
 * Without this file, expo-router had nowhere to nest `[teamId]` and its own child screens (cover-library,
 * details, documents, gallery, photo) under the "teams" tab this group's own `href: null` already hides,
 * so it flattened each of them into its own undeclared, iconless tab bar cell instead -- the extra
 * downward-arrow cells the owner saw beside More. A Stack here consolidates all six back into the one
 * hidden "teams" entry point, reachable only by push (a team tile, a fixture's opponent, etc.), never by
 * tapping the bar itself.
 */
export default function TeamsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
