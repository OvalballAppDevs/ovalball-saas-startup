import { Stack } from "expo-router"

/** GUARDIANS & PLAYERS (CA-M11.1): the overview underneath, each queue and directory over it. */
export default function AdminGuardiansLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export const unstable_settings = { initialRouteName: "index" }
