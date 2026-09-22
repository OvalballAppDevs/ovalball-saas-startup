import { useCallback, useEffect, useRef, useState } from "react"
import { Slot, useRouter, useSegments } from "expo-router"
import * as Linking from "expo-linking"
import { StatusBar } from "expo-status-bar"
import * as SplashScreen from "expo-splash-screen"
import { useFonts } from "expo-font"
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue"
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { View } from "react-native"

import { SessionProvider, useSession } from "../src/auth/session"
import { resolveIntent, type LinkIntent } from "../src/links/intents"
import { ContextProvider } from "../src/context/contexts"
import { colour } from "../src/design/tokens"
import { LaunchCanvas } from "../src/components/launch"

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
/**
 * LINKS INTO OVALBALL, FROM BOTH DIRECTIONS.
 *
 * A link arrives one of two ways and they are genuinely different events. If the app was not running,
 * the URL is waiting in `getInitialURL()` at startup -- there was no listener to hear it. If the app
 * WAS running, which is the normal case for password recovery (you request it in Ovalball, switch to
 * Mail, tap, come back), it arrives on the `url` event and `getInitialURL` never mentions it. Handling
 * only the first is the classic version of this bug: it works from a cold start and silently does
 * nothing for the person who has the app open in front of them.
 *
 * Each URL is handled ONCE. `handled` is a ref rather than state so a re-render cannot replay a code,
 * and a replayed PKCE code would fail at the auth server anyway -- this just stops the app asking.
 */
function useIncomingLinks() {
  const { beginRecovery, status } = useSession()
  const router = useRouter()
  const handled = useRef(new Set<string>())
  const [linkProblem, setLinkProblem] = useState<string | null>(null)
  // AN INTENT THAT ARRIVES BEFORE THE SESSION IS READY IS HELD, NOT DROPPED. A message link tapped by
  // somebody who is signed out must survive signing in -- otherwise they authenticate and land on
  // Home wondering where the message went. Recovery is the exception and is handled immediately,
  // because the link IS the way in.
  const pending = useRef<LinkIntent | null>(null)

  const deliver = useCallback(
    (intent: LinkIntent) => {
      if (intent.kind === "MESSAGES") {
        router.push("/(tabs)/messages")
        return
      }
      if (intent.kind === "MESSAGE_THREAD") {
        // The id decides WHERE to go, never WHETHER: the screen reads it through RLS and says the
        // conversation is unavailable if it is not this person's.
        router.push({
          pathname: "/(tabs)/messages/[id]",
          params: { id: intent.conversationId, kind: intent.conversationKind },
        })
      }
    },
    [router]
  )

  const handle = useCallback(
    async (url: string | null) => {
      if (!url || handled.current.has(url)) return
      handled.current.add(url)
      const intent = resolveIntent(url)

      if (intent.kind === "AUTH_RECOVERY") {
        const failure = await beginRecovery(intent.code)
        if (failure) {
          setLinkProblem(failure.message)
          router.replace("/sign-in")
        }
        return
      }

      if (intent.kind === "MESSAGES" || intent.kind === "MESSAGE_THREAD") {
        if (status === "signed-in") deliver(intent)
        else pending.current = intent
      }
    },
    [beginRecovery, router, status, deliver]
  )

  // The held intent is delivered once the session is real -- and cleared either way, so it cannot
  // fire again later in a context where it no longer makes sense.
  useEffect(() => {
    if (status !== "signed-in" || !pending.current) return
    const intent = pending.current
    pending.current = null
    deliver(intent)
  }, [status, deliver])

  useEffect(() => {
    // Cold start: the URL that launched the app.
    void Linking.getInitialURL().then(handle)
    // Warm: the app was already running, which is what actually happens with a recovery email.
    const subscription = Linking.addEventListener("url", (event) => void handle(event.url))
    return () => subscription.remove()
  }, [handle])

  return linkProblem
}

function Gate() {
  const { status } = useSession()
  const segments = useSegments()
  const router = useRouter()
  useIncomingLinks()
  // `settled` trails `status` by the length of the fade, so the canvas is unmounted only after it has
  // finished fading -- not the moment the status changes, which would snap.
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (status === "restoring") return
    const timer = setTimeout(() => setSettled(true), 260)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (status === "restoring") return
    // `segments[0]` is undefined at the root route, and that is a place to be MOVED FROM, not a place
    // that counts as already-signed-in-somewhere. Treating it as "already on sign-in" left a signed-out
    // launch sitting on the blank entry route with nothing to press.
    const group = segments[0]
    const inApp = group === "(tabs)"
    const onVerify = group === "verify"
    const onRecovery = group === "auth"
    // Forgot Password is part of being signed out, not a place to be moved away from.
    const onEntrance = group === "sign-in" || group === "forgot-password"

    // RECOVERY OUTRANKS EVERYTHING. A validated recovery link produces a real session at AAL1, and
    // without this rule the next two branches would read that as "signed in" and drop somebody into
    // the product with a password they do not know -- or, for an account holding a factor, send them
    // to a TOTP challenge before they have set the password they came to set.
    if (status === "recovering" && !onRecovery) router.replace("/auth/recovery")
    else if (status === "signed-in" && !inApp) router.replace("/(tabs)")
    else if (status === "needs-mfa" && !onVerify) router.replace("/verify")
    else if (status === "signed-out" && !onEntrance) router.replace("/sign-in")
  }, [status, segments, router])

  // THE CANVAS STAYS UNTIL THE DESTINATION IS DECIDED AND PAINTED. Rendering the Slot underneath it
  // from the first frame means the real screen is already laid out when the canvas fades, so the fade
  // reveals a finished screen rather than starting one.
  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <Slot />
      {!settled && <LaunchCanvas fading={status !== "restoring"} />}
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
    // webfont defect moved onto a phone, and it must not be reproduced here. What the splash reveals
    // is LaunchCanvas, the same mark on the same ground, so hiding it is not a visible event.
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
