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

/**
 * THE AGENDA IS ALWAYS UNDERNEATH.
 *
 * Home pushes straight to a session or a fixture inside this tab. Without this,
 * that screen is the ONLY thing on the stack, so Back has nothing to return to
 * -- the router dispatches GO_BACK regardless, nothing handles it, and the person
 * is stuck on the event with an error. Naming the initial route makes the router
 * mount Calendar beneath any deep-linked screen, so Back always returns to it.
 */
export const unstable_settings = { initialRouteName: "index" }
