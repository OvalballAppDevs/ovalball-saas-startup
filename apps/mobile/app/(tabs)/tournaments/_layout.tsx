import { Stack } from "expo-router"

/**
 * THE GROUP'S OWN STACK.
 *
 * Without this file expo-router flattens the folder and registers
 * `tournaments/[tournamentId]` directly as a tab-group route, which the bar then draws as a stray
 * cell with the library's "missing icon" glyph -- the exact defect the tab layout's own comment
 * records from CA-M11.1. A group with a layout is one declared route (`tournaments`), which the
 * layout hides with `href: null` while leaving it addressable by link and by the Calendar.
 */
export default function TournamentsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
