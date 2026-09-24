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
import { setEntranceNotice } from "../src/auth/entrance-notice"
import { hasJoinSecret, holdJoinSecret } from "../src/onboarding/join-secret"
import { narrowIntentForContext, routeForIntent } from "../src/links/destinations"
import { resolveIntent, type LinkIntent } from "../src/links/intents"
import { ContextProvider, useAppContexts } from "../src/context/contexts"
import { FamilyProvider } from "../src/family/family"
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
  const { beginRecovery, status } = useSession()
  /*
    THE VIEWER'S OWN CONTEXT, so an incoming link can be narrowed before it is
    routed. A fixture link is canonical -- `/fixtures/<id>` is what the website,
    an email and a future push payload all carry -- and it resolves to the address
    that decides by authority. For a parent or a player it is narrowed here to the
    participant address, which cannot draw administration at all.

    A link that arrives before the context has resolved is NOT held for it: the
    canonical address is authority-aware on its own, so routing it immediately is
    correct and narrowing is the second of two protections rather than the only one.
  */
  const { active } = useAppContexts()
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
      const route = routeForIntent(narrowIntentForContext(intent, active?.kind ?? null))
      if (route) router.push(route as never)
    },
    [router, active]
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

      if (
        intent.kind === "MESSAGES" ||
        intent.kind === "MESSAGE_THREAD" ||
        intent.kind === "FIXTURES" ||
        intent.kind === "FIXTURE" ||
        intent.kind === "MATCH_CENTRE" ||
        intent.kind === "TRAINING" ||
        intent.kind === "CALENDAR" ||
        intent.kind === "RUGBY_HUB" ||
        intent.kind === "NEWS" ||
        intent.kind === "CLUB_ARTICLE" ||
        intent.kind === "CLUB_ARTICLE_BY_SLUG" ||
        intent.kind === "CLUB_ANNOUNCEMENT" ||
        intent.kind === "TEAM"
      ) {
        if (status === "signed-in") deliver(intent)
        else pending.current = intent
      }
    },
    [beginRecovery, router, status, deliver, segments]
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
    else if (status === "signed-out" && !onEntrance) router.replace("/welcome")
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
  )
}
