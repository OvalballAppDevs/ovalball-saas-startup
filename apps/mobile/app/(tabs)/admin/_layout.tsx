import { Stack } from "expo-router"

/**
 * THE ADMIN CENTRE IS ONE ROUTE WITH ITS OWN SCREENS. The landing stays underneath and a section
 * slides over it, so Back returns to the list rather than out of the group. Reached from More in a
 * club context; addressable by deep link, where the landing mounts beneath the section.
 */
export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
