import { Stack } from "expo-router"

/** News & Announcements is one route with its own screens: the list stays underneath, a story slides over it. */
export default function NewsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
