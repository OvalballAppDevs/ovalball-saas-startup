import { Stack } from "expo-router"

/** SUBSCRIPTIONS & PAYMENTS (CA-M11.1): the overview underneath; programme, members, a membership and the Ovalball Plan over it. */
export default function AdminSubscriptionsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
