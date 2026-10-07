import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { Image, type ImageProps } from "expo-image"
import * as Haptics from "expo-haptics"
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

import { PhotoBottomShade } from "../components/photo-gradient"
import { colour, radius, space, type } from "../design/tokens"

/** A light tick under the finger on the phone's own engine; silence on the web and on a simulator. */
export function tapFeedback(): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return
  void Haptics.selectionAsync().catch(() => undefined)
}

/**
 * A SURFACE THAT ANSWERS THE FINGER -- it settles a few per cent smaller while pressed and springs back on
 * release (100 ms in, 160 ms out), rather than snapping between two states. Reduce Motion keeps the
 * feedback as a dimming alone. Used by Arena Home's photographic destinations, its day cards and the
 * Arena Planning entry -- never by list rows, which highlight instead.
 */
export function PressableScale({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  reduceMotion,
  scaleTo = 0.97,
  children,
}: {
  onPress: () => void
  accessibilityLabel: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
  reduceMotion: boolean
  scaleTo?: number
  children: React.ReactNode
}) {
  const pressed = useSharedValue(0)
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - scaleTo) * pressed.value }],
    opacity: 1 - 0.08 * pressed.value,
  }))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 100 }) }}
      onPressOut={() => { pressed.value = withTiming(0, { duration: 160 }) }}
      onPress={() => { tapFeedback(); onPress() }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  )
}

/**
 * ONE OF ARENA'S SIX WAYS IN (the approved Arena Hub mock-up, Screen 1): a real Ovalball library photograph
 * of the thing itself, darkened at the foot so the white title always reads, a small icon beside the
 * title, and one quiet line saying what is behind it. Every card is the same size and the same shape, so
 * the grid reads as one set of places rather than six different buttons.
 */
export function ArenaDestinationCard({
  title,
  subtitle,
  image,
  icon,
  width,
  height,
  reduceMotion,
  onPress,
}: {
  title: string
  subtitle: string
  image: ImageProps["source"]
  icon: React.ReactNode
  width: number
  height: number
  reduceMotion: boolean
  onPress: () => void
}) {
  return (
    <PressableScale
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      reduceMotion={reduceMotion}
      style={{ width, height, borderRadius: radius.md, overflow: "hidden", backgroundColor: colour.forest800, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}
    >
      <Image source={image} accessible={false} contentFit="cover" transition={220} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade strength={0.9} />
      <View style={{ flex: 1, justifyContent: "flex-end", padding: space.sm + 2 }}>
        {/* One line each, always whole: on a narrower phone the words settle a little smaller rather than
            losing their ends ("Create and run tournaments" is the longest, and only just fits at 402 pt). */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon}
          <Text style={[type.smallMedium, { flexShrink: 1, color: colour.onForest, fontSize: 14, lineHeight: 18, fontFamily: type.heading.fontFamily }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {title}
          </Text>
        </View>
        <Text style={[type.caption, { color: "rgba(255,255,255,0.82)", fontSize: 11, lineHeight: 14, marginTop: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {subtitle}
        </Text>
      </View>
    </PressableScale>
  )
}
