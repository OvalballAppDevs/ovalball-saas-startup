import { Stack } from "expo-router"

/**
 * CALENDAR IS ONE TAB WITH SEVERAL SCREENS.
 *
 * The agenda stays put and an event slides over it, so the system back gesture returns rather than
 * dropping somebody out of the tab. Training gets its own screen here because a training session is a
 * domain object with a destination, not a calendar row that opens a copy of itself.
 */
export default function CalendarLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
