import { Stack } from "expo-router"

/**
 * CLUBHOUSE IS ONE TAB, ONE SCREEN, FOR V1.
 *
 * Section 10-11 of the owner's Clubhouse directive: the map is the hero, and the club sheet is a
 * bottom sheet over it, not a pushed screen -- so there is exactly one route in this stack today.
 * A Stack still exists (rather than the screen being registered directly on the tab) so a future
 * Activity/Partners destination reached FROM here has somewhere to push onto without restructuring
 * the tab group again.
 */
export default function ClubhouseLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
