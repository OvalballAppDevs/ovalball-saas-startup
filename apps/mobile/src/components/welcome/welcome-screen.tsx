import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg"

import { BRAND_GREEN, OvalballMark, OvalballWordmark } from "../brand"
import { welcomeStill } from "./still"
import { webUrl } from "../../config/environment"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"

/**
 * THE PUBLIC ENTRANCE — the first thing somebody who is not signed in sees.
 *
 * ONE PICTURE, ON FOREST. The owner's direction is a single action frame: a player mid-pass on a
 * floodlit pitch, the ball coming at the camera, the Ovalball mark embroidered on the jersey. The
 * frame is an app-owned still (`welcomeStill`), shown full-bleed on the forest ground and darkened
 * toward the foot so the words read. Everything that says something -- the mark, the motto, the
 * copy, the two actions -- is native, laid over the picture, never baked into it.
 *
 * NOT THE SPLASH. The native splash and the launch canvas stay forest with the mark alone for as
 * long as the session is being resolved; this is what a SIGNED-OUT session resolves to, and a
 * signed-in one is sent past it by the gate.
 *
 * ALIVE, BARELY. The still pushes in by six per cent over twelve seconds, once. Nothing loops,
 * spins or bounces. With Reduce Motion on, it simply holds.
 *
 * NO AUTHORITY. Get Started opens the website's own signup; Log In goes to the app's one sign-in.
 */
export function WelcomeScreen({ onLogIn }: { onLogIn: () => void }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const short = height < 720
  const motto = Math.round(Math.min(width * 0.19, short ? 56 : height >= 900 ? 78 : 70))
  const push = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduceMotion) {
      push.setValue(0)
      return
    }
    const drift = Animated.timing(push, { toValue: 1, duration: 12000, easing: Easing.out(Easing.quad), useNativeDriver: true })
    drift.start()
    return () => drift.stop()
  }, [push, reduceMotion])

  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <StatusBar style="light" />

      {/* THE STILL. Decorative: the words over it carry the meaning. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}
      >
        {welcomeStill && (
          <Animated.View style={{ position: "absolute", top: 0, left: 0, width, height, transform: [{ scale: push.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
            <Image source={welcomeStill} style={{ width, height }} contentFit="cover" contentPosition="top" accessible={false} />
          </Animated.View>
        )}
        {/* Forest rising from the foot so the motto and the actions read on any frame. */}
        <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
          <Defs>
            <LinearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.05" />
              <Stop offset="0.42" stopColor={colour.forest950} stopOpacity="0.22" />
              <Stop offset="0.62" stopColor={colour.forest950} stopOpacity="0.72" />
              <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.96" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={height} fill="url(#foot)" />
        </Svg>
      </View>

      {/* THE COLUMN: the lower half of the screen, inside the safe area. */}
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom + space.md, paddingHorizontal: space.xl, justifyContent: "flex-end" }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <OvalballMark size={short ? 68 : 84} tint={colour.chalk} />
          <OvalballWordmark size={short ? 20 : 24} onDark />
        </View>

        <View style={{ marginTop: short ? space.md : space.lg, alignItems: "center" }}>
          {/* Line-height at 1.0× of the size: the display face's caps are clipped by anything less on iOS. */}
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: type.display.fontFamily,
              fontSize: motto,
              lineHeight: Math.round(motto * 1.0),
              letterSpacing: 1,
              color: colour.chalk,
              textAlign: "center",
            }}
          >
            RUGBY.{"\n"}
            <Text style={{ color: BRAND_GREEN }}>CONNECTED.</Text>
          </Text>
          <Text style={[type.body, { color: "rgba(248,250,247,0.78)", textAlign: "center", marginTop: space.sm }]}>
            Your rugby life, all in one place.
          </Text>
        </View>

        <View style={{ gap: space.md, marginTop: short ? space.lg : space.xl }}>
          <PrimaryAction label="Get Started" onPress={openSignup} hint="Opens the Ovalball website to create your account" reduceMotion={reduceMotion} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityHint="Signs in to an existing Ovalball account"
            onPress={onLogIn}
            style={({ pressed }) => ({
              minHeight: 52,
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: pressed ? "rgba(248,250,247,0.9)" : "rgba(248,250,247,0.55)",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "rgba(248,250,247,0.08)" : "transparent",
            })}
          >
            <Text style={[type.bodyMedium, { color: colour.chalk }]}>Log In</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

/**
 * THE CANONICAL WAY IN. Creating an account and joining a club live on the website, where the
 * invitation, claim and verification architecture already is. The app opens it in the system browser
 * -- never a webview pretending to be the app -- and creates no signup path of its own.
 */
function openSignup() {
  if (webUrl) {
    void Linking.openURL(`${webUrl}/signup`)
    return
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[ovalball] EXPO_PUBLIC_OVALBALL_WEB_URL is not set; Get Started has nowhere to go")
  }
}

/** The one loud control: a green pill with an arrow that settles under the thumb. */
function PrimaryAction({ label, onPress, hint, reduceMotion }: { label: string; onPress: () => void; hint: string; reduceMotion: boolean }) {
  const press = useRef(new Animated.Value(0)).current
  const to = (value: number) => Animated.spring(press, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
  const scaleTo = press.interpolate({ inputRange: [0, 1], outputRange: [1, reduceMotion ? 1 : 0.975] })
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} onPressIn={() => to(1)} onPressOut={() => to(0)}>
      {({ pressed }) => (
        <Animated.View
          style={{
            minHeight: Math.max(TOUCH_TARGET, 56),
            borderRadius: radius.pill,
            backgroundColor: pressed ? "#029457" : BRAND_GREEN,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            transform: [{ scale: scaleTo }],
          }}
        >
          <Text style={[type.bodyMedium, { color: colour.chalk, fontFamily: "Inter_600SemiBold", fontSize: 17 }]}>{label}</Text>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M5 12h14M13 6l6 6-6 6" stroke={colour.chalk} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      )}
    </Pressable>
  )
}

/** iOS Reduce Motion, live. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let live = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduce(value)
    })
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce)
    return () => {
      live = false
      subscription.remove()
    }
  }, [])
  return reduce
}
