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

/**
 * THE AGENDA IS ALWAYS UNDERNEATH.
 *
 * Home pushes straight to a session or a fixture inside this tab. Without this,
 * that screen is the ONLY thing on the stack, so Back has nothing to return to
 * -- the router dispatches GO_BACK regardless, nothing handles it, and the person
 * is stuck on the event with an error. Naming the initial route makes the router
 * mount Fixtures beneath any deep-linked screen, so Back always returns to it.
 */
export const unstable_settings = { initialRouteName: "index" }
