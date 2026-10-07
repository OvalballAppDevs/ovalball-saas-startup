import { useSafeAreaInsets } from "react-native-safe-area-context"

import { tabBarHeight } from "./tab-bar-height"

/** How much room the bottom navigation takes on this device -- for a component inside the tab
 * navigator to reserve at the bottom of whatever it scrolls. */
export function useTabBarHeight(): number {
  return tabBarHeight(useSafeAreaInsets().bottom)
}
