import { Stack } from "expo-router"

/** News & Announcements management: the list underneath, an editor over it. */
export default function AdminNewsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
