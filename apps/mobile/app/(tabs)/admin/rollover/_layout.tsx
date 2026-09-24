import { Stack } from "expo-router"

/**
 * SEASON HANDOVER (CA-M11.1): the overview underneath, one screen per section over it -- Teams,
 * Players, Needs Attention, Apply & Audit -- the website's five sections as native screens.
 */
export default function AdminRolloverLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
