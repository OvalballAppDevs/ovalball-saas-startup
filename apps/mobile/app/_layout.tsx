import { useCallback, useEffect, useRef, useState } from "react"
import { Slot, useNavigationContainerRef, useRouter, useSegments } from "expo-router"
import * as Linking from "expo-linking"
import { StatusBar } from "expo-status-bar"
import * as SplashScreen from "expo-splash-screen"
import { useFonts } from "expo-font"
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue"
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { View } from "react-native"

import { SessionProvider, useSession } from "../src/auth/session"
import { supabase } from "../src/auth/supabase"
import { setEntranceNotice } from "../src/auth/entrance-notice"
import { hasJoinSecret, holdJoinSecret } from "../src/onboarding/join-secret"
import { routeForIntent } from "../src/links/destinations"
import { resolveIntent, type LinkIntent } from "../src/links/intents"
import { ContextProvider, useAppContexts } from "../src/context/contexts"
import { FamilyProvider } from "../src/family/family"
import { colour } from "../src/design/tokens"
import { LaunchCanvas } from "../src/components/launch"
import { ForegroundBannerHost } from "../src/components/foreground-banner"
import { useNotificationRouting } from "../src/notifications/push"
import { PushPrePrompt } from "../src/notifications/push-pre-prompt"

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
 *   signed-out  → the public Welcome, from which Log In reaches sign in.
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
  const { beginRecovery, refreshAssurance, status } = useSession()
  /*
    A FIXTURE LINK IS CANONICAL -- `/fixtures/<id>` is what the website, an email and
    a push payload all carry -- and it opens the one Match Centre for everybody. The
    Match Centre asks the server what THIS viewer may see and do, so a link that
    arrives before the context has resolved is routed immediately rather than held.
  */
  const router = useRouter()
  const segments = useSegments()
  const handled = useRef(new Set<string>())
  const [linkProblem, setLinkProblem] = useState<string | null>(null)
  // AN INTENT THAT ARRIVES BEFORE THE SESSION IS READY IS HELD, NOT DROPPED. A message link tapped by
  // somebody who is signed out must survive signing in -- otherwise they authenticate and land on
  // Home wondering where the message went. Recovery is the exception and is handled immediately,
  // because the link IS the way in.
  const pending = useRef<LinkIntent | null>(null)

  const deliver = useCallback(
    (intent: LinkIntent) => {
      // ONE ROUTE TABLE, shared with every list in the app (src/links/destinations).
      // An id says WHERE to go and nothing about WHETHER it may be opened: each
      // screen reads its event through the canonical readers and RLS, and says it
      // is unavailable if it is not this person's -- which is also what a deleted
      // one does, deliberately, because the difference is not ours to reveal.
      //
      // A CALENDAR anchor is carried in the intent and ignored by the route: the
      // Calendar opens on today, which is the right default for a tap with no date.
      const route = routeForIntent(intent)
      if (route) router.push(route as never)
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
          // THE SENTENCE TRAVELS WITH THE PERSON. The sign-in screen is where they land, so the sign-in
          // screen is where the reason is read -- not a state here that nothing renders.
          setLinkProblem(failure.message)
          setEntranceNotice(failure.message)
          router.replace("/sign-in")
        }
        return
      }

      // CA-M11.3 -- COLD-START ONLY. The ordinary, warm round trip never reaches this: the provider
      // button's own `openAuthSessionAsync` call already resolved with this same URL and has already
      // exchanged the code by the time this listener would fire again (the `handled` de-duplication
      // above stops it being processed twice regardless). This branch exists for the one case that
      // matters and is easy to get wrong: the app was killed while the provider's own UI was in front
      // of the person, so nothing was there to resolve that promise, and the callback arrives instead
      // as an ordinary cold-start URL. Session establishment then goes through the exact same
      // `exchangeCodeForSession` → `refreshAssurance` path the button uses, so MFA, a held invitation
      // and a held team code all resolve identically to the warm case -- neither is a special path.
      if (intent.kind === "AUTH_OAUTH") {
        if (intent.error || !intent.code) {
          // A provider decline or an explicit cancellation: nothing to exchange, nothing signed in.
          // Silence is correct here specifically because the person is not looking at Ovalball right
          // now to read a message -- the app was not running -- so there is nobody to show it to.
          return
        }
        const { error } = await supabase.auth.exchangeCodeForSession(intent.code)
        if (error) {
          setEntranceNotice("That sign-in link is no longer valid. Please try again.")
          router.replace("/sign-in")
          return
        }
        await refreshAssurance()
        return
      }

      // AN INVITATION IS ITS OWN WAY IN. The secret is held in memory for one journey (never stored),
      // and the invitation screen is opened whether or not anybody is signed in: it previews first,
      // asks for a sign-in if one is needed, and only then offers to accept. The gate keeps that
      // screen reachable in both states, and re-opens it after a sign-in while a secret is held.
      if (intent.kind === "JOIN") {
        holdJoinSecret({ token: intent.token, code: intent.code })
        // Already on the invitation screen (the link itself opened it, as on the web): the screen
        // re-reads the held secret; pushing a second copy would only stack the same screen twice.
        if (segments[0] !== "join") router.push("/join")
        return
      }

      // EVERY ROUTABLE LINK IS DELIVERED, exactly as a push tap on the same href is (`routeForHref`, below
      // in the Gate). This was a hand-kept list, written before events and tournaments had links, and it
      // silently dropped them: an event invitation opened from an email, or a shared Event Centre link,
      // landed on Home. The route table is the one authority on what is routable; each screen still
      // decides, through the server, whether this person may see what it opens.
      if (routeForIntent(intent)) {
        if (status === "signed-in") deliver(intent)
        else pending.current = intent
      }
    },
    [beginRecovery, refreshAssurance, router, status, deliver, segments]
  )

  // The held intent is delivered once the session is real AND the person is inside the app -- and cleared
  // either way, so it cannot fire again later in a context where it no longer makes sense. Delivering on
  // "signed-in" alone pushed the screen from the sign-in route in the same moment the gate replaced that
  // route with the tabs, so the link was lost and the person landed on Home: the very thing holding it is for.
  const inApp = segments[0] === "(tabs)"
  useEffect(() => {
    if (status !== "signed-in" || !inApp || !pending.current) return
    const intent = pending.current
    pending.current = null
    deliver(intent)
  }, [status, inApp, deliver])

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
  const navigation = useNavigationContainerRef()
  useIncomingLinks()
  // A PUSH TAP RESOLVES THE SAME WAY AN IN-APP NOTIFICATION TAP DOES (`routeForHref`) -- the same one
  // route table `useIncomingLinks`'s own `deliver` applies to every other kind of incoming link.
  const { active } = useAppContexts()
  useNotificationRouting(active?.kind ?? null)
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
    // A step-up is a place a signed-in person deliberately goes (to confirm it is them before a
    // sensitive change); it is not a place to be moved on from.
    const onStepUp = group === "step-up"
    const onRecovery = group === "auth"
    // AN INVITATION SCREEN IS REACHABLE SIGNED OUT AND SIGNED IN. It previews for anybody holding the
    // link, asks for a sign-in when one is needed and accepts only for a signed-in person -- so it is
    // neither a place to be moved to Welcome from nor a place to be moved into the tabs from.
    const onJoin = group === "join" || group === "scan-invitation"
    // Welcome, Get Started, sign in and forgot password are all part of being signed out, not places to
    // be moved away from. Welcome is where a signed-out session LANDS; a signed-in one never sees it.
    const onEntrance = group === "welcome" || group === "get-started" || group === "sign-in" || group === "forgot-password" || onJoin

    // RECOVERY OUTRANKS EVERYTHING. A validated recovery link produces a real session at AAL1, and
    // without this rule the next two branches would read that as "signed in" and drop somebody into
    // the product with a password they do not know -- or, for an account holding a factor, send them
    // to a TOTP challenge before they have set the password they came to set.
    if (status === "recovering" && !onRecovery) router.replace("/auth/recovery")
    // A HELD INVITATION OUTRANKS HOME: somebody who signed in to accept it is taken back to it.
    else if (status === "signed-in" && hasJoinSecret() && !onJoin && !onStepUp) router.replace("/join")
    else if (status === "signed-in" && !inApp && !onStepUp && !onJoin) router.replace("/(tabs)")
    else if (status === "needs-mfa" && !onVerify) router.replace("/verify")
    // SIGNING OUT LEAVES NOTHING OF THE LAST PERSON BEHIND. Replacing one route kept every tab's stack, so
    // the next person to sign in on this phone could step Back into the screens the last one had open --
    // a coach's team events under a parent's account. The whole navigation tree is reset instead.
    else if (status === "signed-out" && !onEntrance) {
      if (navigation.isReady()) navigation.reset({ index: 0, routes: [{ name: "welcome" }] })
      else router.replace("/welcome")
    }
  }, [status, segments, router, navigation])

  // THE CANVAS STAYS UNTIL THE DESTINATION IS DECIDED AND PAINTED. Rendering the Slot underneath it
  // from the first frame means the real screen is already laid out when the canvas fades, so the fade
  // reveals a finished screen rather than starting one.
  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <Slot />
      {!settled && <LaunchCanvas fading={status !== "restoring"} />}
      <ForegroundBannerHost />
      <PushPrePrompt />
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
    // THE GESTURE ROOT (CA-M11.2): the pitch allocation board's press-and-hold drags are native gestures,
    // and react-native-gesture-handler needs one root view above every screen that uses them.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <SessionProvider>
        {/* THE FAMILY SITS INSIDE THE CONTEXT, never beside it. Which children a
            view covers is derived from the SELECTED context, so it has to be
            able to read it -- and the nesting is the architecture: switching
            context re-resolves the family, while choosing a child cannot touch
            the context. A parent choosing Pippa remains the parent. */}
        <ContextProvider>
          <FamilyProvider>
            <Gate />
          </FamilyProvider>
        </ContextProvider>
      </SessionProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
