import { useEffect } from "react"
import { Slot, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import * as SplashScreen from "expo-splash-screen"
import { useFonts } from "expo-font"
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue"
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { View } from "react-native"

import { SessionProvider, useSession } from "../src/auth/session"
import { ContextProvider } from "../src/context/contexts"
import { colour } from "../src/design/tokens"
import { OvalballMark, OvalballWordmark } from "../src/components/brand"

void SplashScreen.preventAutoHideAsync()

/**
 * THE ONE GATE.
 *
 * Every route in the app sits behind this, and it answers one question: where does this session belong
 * right now. Three states, three places, no screen deciding for itself -- a screen that checked its own
 * access would be one `return` away from being the only screen that forgot.
 *
 *   restoring   → the brand screen, held. Not the sign-in screen: showing that to somebody who is
 *                 already signed in reads as having been logged out, and they will sign in again
 *                 needlessly.
 *   needs-mfa   → the verification screen. A password gets a session at AAL1; Ovalball's standard is
 *                 AAL2, and until the auth server says the session has reached it, the product is not
 *                 reachable. The requirement is not relaxed because native navigation makes it awkward.
 *   signed-out  → sign in.
 *   signed-in   → the app.
 *
 * The redirect runs in an effect rather than during render because expo-router's navigation state is
 * not ready on the first frame, and navigating during render is what produces the "attempted to
 * navigate before mounting" crash on a cold start.
 */
function Gate() {
  const { status } = useSession()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (status === "restoring") return
    // `segments[0]` is undefined at the root route, and that is a place to be MOVED FROM, not a place
    // that counts as already-signed-in-somewhere. Treating it as "already on sign-in" left a signed-out
    // launch sitting on the blank entry route with nothing to press.
    const group = segments[0]
    const inApp = group === "(tabs)"
    const onVerify = group === "verify"
    const onSignIn = group === "sign-in"

    if (status === "signed-in" && !inApp) router.replace("/(tabs)")
    else if (status === "needs-mfa" && !onVerify) router.replace("/verify")
    else if (status === "signed-out" && !onSignIn) router.replace("/sign-in")
  }, [status, segments, router])

  if (status === "restoring") return <BrandHold />
  return <Slot />
}

/** The launch state: the brand, on the brand's own ground, while the stored session is read back. */
function BrandHold() {
  return (
    <View
      accessible
      accessibilityLabel="Ovalball is starting"
      style={{ flex: 1, backgroundColor: colour.forest950, alignItems: "center", justifyContent: "center", gap: 24 }}
    >
      <OvalballMark size={140} />
      <OvalballWordmark size={38} />
    </View>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BebasNeue_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  })

  useEffect(() => {
    // The splash goes once the fonts have SETTLED -- loaded or failed. Waiting only on success is how
    // an app hangs on a blank brand screen forever, which is the web product's own development
    // webfont defect moved onto a phone, and it must not be reproduced here.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync()
    if (fontError && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[ovalball] brand fonts did not load; falling back to the system face", fontError)
    }
  }, [fontsLoaded, fontError])

  // RENDERING NEVER WAITS ON A TYPEFACE. The fonts are bundled with the app rather than fetched, so
  // this is normally a frame; but if loading fails on some platform, Ovalball must still be usable in
  // the system face. React Native ignores an unknown fontFamily and falls back, so the layout holds.
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <SessionProvider>
        <ContextProvider>
          <Gate />
        </ContextProvider>
      </SessionProvider>
    </SafeAreaProvider>
  )
}
