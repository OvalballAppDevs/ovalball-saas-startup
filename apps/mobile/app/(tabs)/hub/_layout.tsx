import { Stack } from "expo-router"

import { HubIdentityProvider } from "../../../src/hub/identity"

/**
 * RUGBY HUB IS ONE TAB WITH MANY SCREENS.
 *
 * The landing stays put and an article slides over it, so the system back
 * gesture returns to where the person was reading from rather than dropping
 * them out of the tab. Every screen beneath this layout shares one resolved
 * identity -- whose team the personal parts of the Hub are about -- so
 * Rules, Safeguarding, Player Welfare, Positions and Skills all answer for
 * the same rugby without each re-deriving it.
 */
export default function HubLayout() {
  return (
    <HubIdentityProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </HubIdentityProvider>
  )
}

/**
 * THE LANDING IS ALWAYS UNDERNEATH. A deep link straight to an article -- from
 * a notification, a shared link, a search result on Home -- mounts the landing
 * beneath it, so Back has somewhere to go. Same rule, same reason, as Calendar.
 */
export const unstable_settings = { initialRouteName: "index" }
