import { Stack } from "expo-router"

/**
 * NOTIFICATIONS (CA-M8): the feed and its preferences, as a stack over the header's bell. Back from
 * the preferences returns to the feed; back from the feed returns to wherever the bell was tapped.
 */
export default function NotificationsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
