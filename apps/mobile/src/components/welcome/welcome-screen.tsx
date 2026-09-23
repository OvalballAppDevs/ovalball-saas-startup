import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { Image } from "expo-image"
import Svg, { Path } from "react-native-svg"

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

  const scale = useMemo(() => layoutFor(width, height), [width, height])
  /*
    THE FIELD. The collage lives between the brand block and the call to action, and it is laid out
    against THAT span rather than against the window: the ball takes a fixed share of it, and the
    boots and cones hang from the CTA, so a tall phone gets a deeper composition instead of a gap
    above the button, and a short one gets the boots tucked under the pill's edge.
  */
  const ctaTop = height - (insets.bottom + space.md + TOUCH_TARGET + 2 + 56)
  const field = { top: (short ? 0.36 : height >= 900 ? 0.29 : 0.31) * height }
  const span = ctaTop - field.top
  const tall = (o: WelcomeObject | null, w: number) => (o ? w * (o.height / o.width) : 0)
  const bootsW = 0.54 * width, conesW = 0.15 * width

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="dark" />

      {/* THE COLLAGE. Decorative, cropped by the window, never read out. Painted back to front:
          a faint touchline, the jersey, the cap and boots, then the ball in front of everything;
          the whistle and cones are small accents. Each large piece leaves the window on purpose. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}
      >
        <Touchline width={width} height={height} />
        <Piece object={welcomeObjects.jersey} order={2} reduceMotion={reduceMotion} style={{ left: -0.15 * width, top: field.top + 0.05 * span, width: 0.54 * width }} rotate="9deg" />
        <Piece object={welcomeObjects.scrumCap} order={3} reduceMotion={reduceMotion} style={{ right: -0.14 * width, top: field.top - 0.02 * height, width: 0.38 * width }} rotate="-16deg" ambient="float" />
        <Piece object={welcomeObjects.boots} order={4} reduceMotion={reduceMotion} style={{ left: -0.18 * width, top: ctaTop - 0.8 * tall(welcomeObjects.boots, bootsW), width: bootsW }} rotate="6deg" />
        <Piece object={welcomeObjects.whistle} order={6} reduceMotion={reduceMotion} style={{ left: -0.05 * width, top: insets.top + 0.015 * height, width: 0.21 * width }} rotate="18deg" />
        <Piece object={welcomeObjects.cones} order={5} reduceMotion={reduceMotion} style={{ right: 0.03 * width, top: ctaTop - tall(welcomeObjects.cones, conesW) - space.sm, width: conesW }} rotate="-6deg" />
        <Piece object={welcomeObjects.ball} order={1} reduceMotion={reduceMotion} style={{ right: -0.22 * width, top: field.top + 0.22 * span, width: scale.ball * width }} rotate="-18deg" ambient="turn" />
      </View>

      {/* THE COLUMN. Ordinary layout, inside the safe area, over the collage. The brand block is
          tight -- mark, wordmark, motto, one line -- so the collage has the middle of the screen. */}
      <View style={{ flex: 1, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md, paddingHorizontal: space.xl }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <OvalballMark size={short ? 64 : 76} tint={colour.forest950} />
          <OvalballWordmark size={short ? 18 : 21} onDark={false} />
        </View>

        <View style={{ marginTop: short ? space.md : space.lg, alignItems: "center" }}>
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: type.display.fontFamily,
              fontSize: scale.motto,
              lineHeight: scale.motto * 0.9,
              letterSpacing: 0.8,
              color: colour.forest950,
              textAlign: "center",
            }}
          >
            RUGBY.{"\n"}
            <Text style={{ color: BRAND_GREEN }}>CONNECTED.</Text>
          </Text>
          <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", marginTop: space.sm, fontSize: 15 }]}>
            Your rugby life, all in one place.
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ gap: 2, marginHorizontal: space.sm }}>
          <PrimaryAction label="Get Started" onPress={openSignup} hint="Opens the Ovalball website to create your account" reduceMotion={reduceMotion} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityHint="Signs in to an existing Ovalball account"
            onPress={onLogIn}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.bodyMedium, { color: colour.forest800 }]}>Log In</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

/**
 * ONE RESTRAINED TACTICAL MARK: a faint chalk touchline sweeping behind the collage from the left
 * edge up toward the ball, and a short arrow where a coach would draw the run. Native vector, brand
 * forest at low opacity -- a mark, not a background.
 */
function Touchline({ width, height }: { width: number; height: number }) {
  const y0 = height * 0.78, y1 = height * 0.46
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <Path
        d={`M ${-0.05 * width} ${y0} C ${0.25 * width} ${y0 - 0.02 * height}, ${0.45 * width} ${y1 + 0.06 * height}, ${0.72 * width} ${y1}`}
        stroke={colour.forest800}
        strokeOpacity={0.1}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={`M ${0.66 * width} ${y1 + 0.028 * height} L ${0.72 * width} ${y1} L ${0.655 * width} ${y1 - 0.012 * height}`}
        stroke={colour.forest800}
        strokeOpacity={0.16}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
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
    motto: Math.round(Math.min(width * 0.15, short ? 46 : height >= 900 ? 58 : 52)),
    ball: short ? 0.76 : height >= 900 ? 0.9 : 0.84,
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
  // VISIBLE FIRST. Nothing about a piece's presence depends on an animation running: the settle
  // moves it a few points, and if no frame ever ran it would simply be a few points low.
  const arrival = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current
  const breath = useRef(new Animated.Value(0)).current
  const still = useRef(new Animated.Value(0)).current

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
  const rise = arrival.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })

  return (
    <Animated.View
      style={{
        position: "absolute",
        ...style,
        height,
        transform: [
          { translateY: Animated.add(rise, ambient === "float" ? float : still) },
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
