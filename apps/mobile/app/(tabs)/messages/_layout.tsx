import { Stack } from "expo-router"

/**
 * MESSAGES IS ONE TAB WITH TWO SCREENS.
 *
 * Without a layout here the folder's two routes both tried to be part of the tab navigator, and a
 * conversation opened as a sibling of the inbox rather than on top of it. A Stack gives the tab the
 * behaviour a phone expects: the inbox stays put, a conversation slides over it, and the system back
 * gesture returns.
 */
export default function MessagesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
