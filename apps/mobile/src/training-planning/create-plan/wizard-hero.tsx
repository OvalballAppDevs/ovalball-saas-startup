import { Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import { ChevronLeft, X } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"

/**
 * THE CREATE TRAINING PLAN HERO -- the same single-gradient photographic treatment the correction
 * pass fixed on Training Planning Home, reused across every wizard step so the whole flow reads as one
 * screen family rather than five separately-designed ones.
 *
 * TWO SIZES, matching the reference exactly rather than one size reused everywhere: Team & Type (the
 * wizard's entry point) gets the full two-line "CREATE / TRAINING PLAN" introduction; every step after
 * it (Page 3 correction pass) is a single-line page title in a visibly shorter band, giving the step's
 * own form more room -- "Do NOT create giant controls... this is a planning workflow." Pass `subcopy`
 * only for the two-line entry treatment.
 */
export function WizardHero({
  heroPhoto,
  heading,
  subcopy,
  onClose,
  closeIcon = "back",
}: {
  heroPhoto: number
  heading: string
  subcopy?: string
  onClose: () => void
  closeIcon?: "back" | "close"
}) {
  const insets = useSafeAreaInsets()
  const compact = !subcopy
  return (
    <View style={{ height: compact ? 148 : 232 }}>
      <Image source={heroPhoto} style={{ width: "100%", height: "100%" }} contentFit="cover" />
      <View style={{ position: "absolute", inset: 0 }}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="wizardHeroFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colour.forest950} stopOpacity={0.15} />
              <Stop offset="0.5" stopColor={colour.forest950} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colour.forest950} stopOpacity={0.92} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#wizardHeroFade)" />
        </Svg>
      </View>

      <View style={{ position: "absolute", top: insets.top + space.xs, left: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeIcon === "close" ? "Cancel" : "Back"}
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "rgba(7,28,20,0.55)" : "rgba(7,28,20,0.32)",
          })}
        >
          {closeIcon === "close" ? <X size={20} color={colour.chalk} strokeWidth={2.2} /> : <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />}
        </Pressable>
      </View>

      <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: compact ? space.sm : space.md }}>
        <Text style={compact ? [type.title, { color: colour.chalk }] : [type.display, { color: colour.chalk }]}>{heading}</Text>
        {subcopy && <Text style={[type.small, { color: "rgba(248,250,247,0.9)", marginTop: space.xs }]}>{subcopy}</Text>}
      </View>
    </View>
  )
}
