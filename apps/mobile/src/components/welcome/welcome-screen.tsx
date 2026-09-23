import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { Image } from "expo-image"

import { BRAND_GREEN, OvalballMark, OvalballWordmark } from "../brand"
import { welcomeObjects, type WelcomeObject } from "./objects"
import { webUrl } from "../../config/environment"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"

/**
 * THE PUBLIC ENTRANCE — the first thing somebody who is not signed in sees.
 *
 * NOT THE SPLASH. The native splash and the launch canvas stay forest, with the mark alone, for as
 * long as the session is being resolved. This is what a SIGNED-OUT session resolves to: a light
 * canvas, the same mark, the motto, and a rugby collage around them. A signed-in session never
 * passes through it -- the gate sends that person straight into the product.
 *
 * ONE COMPOSITION, MANY SCREENS. Nothing is placed from a screenshot. The content column is ordinary
 * flex layout inside the safe area; the collage is a decorative layer positioned in fractions of the
 * window, cropped deliberately by the edges, and it never carries meaning -- it is hidden from the
 * accessibility tree and the words are native text over it. The call to action is the last thing in
 * the column, above the home indicator, with clear ground around it.
 *
 * ALIVE, NOT ANIMATED. The pieces arrive with one gentle staggered settle when the screen first
 * appears, and afterwards only two of them breathe: the ball turns a few degrees over nine seconds
 * and the scrum cap drifts a few points over seven. Everything else holds still. With Reduce Motion
 * on, every piece simply renders where it ends up.
 *
 * NO AUTHORITY. Get Started opens the website's own signup -- the one canonical way an account and a
 * club relationship come to exist -- and Log In goes to the app's one sign-in. Nothing here infers a
 * role, a club or a family from anything.
 */
export function WelcomeScreen({ onLogIn }: { onLogIn: () => void }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const short = height < 720
  const tall = height >= 900

  const scale = useMemo(() => layoutFor(width, height), [width, height])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="dark" />

      {/* THE COLLAGE. Decorative, cropped by the window, never read out. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}
      >
        {/* Painted back to front: the tall post and the turf sit behind everything; the ball is last
            and biggest; each piece is cropped by an edge so the collage reads as a world, not a grid. */}
        <Piece object={welcomeObjects.posts} order={6} reduceMotion={reduceMotion} style={{ left: -0.14 * width, top: 0.26 * height, width: 0.32 * width }} rotate="-4deg" />
        <Piece object={welcomeObjects.turf} order={7} reduceMotion={reduceMotion} style={{ left: -0.2 * width, bottom: -0.05 * height, width: 0.42 * width }} rotate="-8deg" />
        <Piece object={welcomeObjects.jersey} order={3} reduceMotion={reduceMotion} style={{ left: -0.19 * width, top: 0.43 * height, width: 0.44 * width }} rotate="11deg" />
        <Piece object={welcomeObjects.whistle} order={4} reduceMotion={reduceMotion} style={{ left: -0.03 * width, top: insets.top + 0.04 * height, width: 0.24 * width }} rotate="16deg" />
        <Piece object={welcomeObjects.scrumCap} order={2} reduceMotion={reduceMotion} style={{ right: -0.1 * width, top: insets.top + 0.01 * height, width: 0.31 * width }} rotate="-14deg" ambient="float" />
        <Piece object={welcomeObjects.tape} order={8} reduceMotion={reduceMotion} style={{ right: 0.04 * width, top: 0.33 * height, width: 0.13 * width }} rotate="-20deg" />
        <Piece object={welcomeObjects.cones} order={5} reduceMotion={reduceMotion} style={{ left: 0.02 * width, top: 0.66 * height, width: 0.17 * width }} rotate="6deg" />
        <Piece object={welcomeObjects.boots} order={9} reduceMotion={reduceMotion} style={{ right: -0.12 * width, top: 0.6 * height, width: 0.33 * width }} rotate="8deg" />
        <Piece object={welcomeObjects.ball} order={1} reduceMotion={reduceMotion} style={{ right: -0.15 * width, top: 0.43 * height, width: scale.ball * width }} rotate="-18deg" ambient="turn" />
      </View>

      {/* THE COLUMN. Ordinary layout, inside the safe area, over the collage. */}
      <View style={{ flex: 1, paddingTop: insets.top + (short ? space.lg : space.xxl), paddingBottom: insets.bottom + space.lg, paddingHorizontal: space.xl }}>
        <View style={{ alignItems: "center", gap: short ? space.sm : space.md }}>
          <OvalballMark size={short ? 84 : tall ? 112 : 100} tint={colour.forest950} />
          <OvalballWordmark size={short ? 22 : 26} onDark={false} />
        </View>

        <View style={{ marginTop: short ? space.xl : space.xxl + space.sm, alignItems: "center" }}>
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: type.display.fontFamily,
              fontSize: scale.motto,
              lineHeight: scale.motto * 0.92,
              letterSpacing: 1,
              color: colour.forest950,
              textAlign: "center",
            }}
          >
            RUGBY.{"\n"}
            <Text style={{ color: BRAND_GREEN }}>CONNECTED.</Text>
          </Text>
          <Text style={[type.body, { color: colour.inkMuted, textAlign: "center", marginTop: short ? space.sm : space.md }]}>
            Your rugby life, all in one place.
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ gap: space.xs }}>
          <PrimaryAction label="Get Started" onPress={openSignup} hint="Opens the Ovalball website to create your account" reduceMotion={reduceMotion} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityHint="Signs in to an existing Ovalball account"
            onPress={onLogIn}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.bodyMedium, { color: colour.forest800 }]}>Log In</Text>
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

/** Sizes that scale with the window rather than with a screenshot. */
function layoutFor(width: number, height: number) {
  const short = height < 720
  return {
    motto: Math.round(Math.min(width * 0.19, short ? 56 : height >= 900 ? 76 : 68)),
    ball: short ? 0.6 : 0.68,
  }
}

/**
 * ONE PIECE OF THE COLLAGE. Arrives once, on a stagger; may breathe afterwards; otherwise still.
 * Sized by width alone, so the asset's own proportions decide its height.
 */
function Piece({
  object,
  order,
  reduceMotion,
  style,
  rotate,
  ambient,
}: {
  object: WelcomeObject | null
  order: number
  reduceMotion: boolean
  style: { left?: number; right?: number; top?: number; bottom?: number; width: number }
  rotate: string
  ambient?: "turn" | "float"
}) {
  const arrival = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current
  const breath = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduceMotion) {
      arrival.setValue(1)
      breath.setValue(0)
      return
    }
    const settle = Animated.timing(arrival, {
      toValue: 1,
      duration: 640,
      delay: 120 + order * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    settle.start()
    let loop: Animated.CompositeAnimation | null = null
    if (ambient) {
      const period = ambient === "turn" ? 9000 : 7000
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
      loop.start()
    }
    return () => {
      settle.stop()
      loop?.stop()
    }
  }, [ambient, arrival, breath, order, reduceMotion])

  if (!object) return null
  const height = style.width * (object.height / object.width)
  const base = Number.parseFloat(rotate)
  const turn = breath.interpolate({ inputRange: [0, 1], outputRange: [`${base - 1.5}deg`, `${base + 1.5}deg`] })
  const float = breath.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] })
  const rise = arrival.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })

  return (
    <Animated.View
      style={{
        position: "absolute",
        ...style,
        height,
        opacity: arrival,
        transform: [
          { translateY: Animated.add(rise, ambient === "float" ? float : new Animated.Value(0)) },
          { rotate: ambient === "turn" ? turn : rotate },
        ],
      }}
    >
      <Image source={object.source} style={{ width: style.width, height }} contentFit="contain" accessible={false} />
    </Animated.View>
  )
}

/** The one loud control: a forest pill that answers a press by settling under the thumb. */
function PrimaryAction({ label, onPress, hint, reduceMotion }: { label: string; onPress: () => void; hint: string; reduceMotion: boolean }) {
  const press = useRef(new Animated.Value(0)).current
  const to = (value: number) =>
    Animated.spring(press, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
  const scaleTo = press.interpolate({ inputRange: [0, 1], outputRange: [1, reduceMotion ? 1 : 0.975] })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
    >
      {({ pressed }) => (
        <Animated.View
          style={{
            minHeight: 56,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colour.forest900 : colour.forest800,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale: scaleTo }],
          }}
        >
          <Text style={[type.bodyMedium, { color: colour.chalk, fontFamily: "Inter_600SemiBold", fontSize: 17 }]}>{label}</Text>
        </Animated.View>
      )}
    </Pressable>
  )
}

/** iOS Reduce Motion, live: the collage stops breathing the moment the setting changes. */
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
