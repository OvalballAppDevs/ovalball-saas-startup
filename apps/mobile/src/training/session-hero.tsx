import { Image } from "expo-image"
import { Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { HeaderUtilities } from "../components/header-utilities"
import { ChevronLeft, ChevronRight } from "../components/icons"
import { useAppContexts } from "../context/contexts"
import { TOUCH_TARGET, onForest, radius, space, statusOnForest, type } from "../design/tokens"
import { libraryAsset } from "../media/stock-assets"

const heroPhoto = libraryAsset("training-player-ball-01")

/**
 * TRAINING CENTRE'S OWN HERO -- `EventHero` (`components/participant/event-hero.tsx`) is shared
 * with Fixture Detail and stays forest-only there by its own documented, deliberate choice
 * ("a borrowed photograph of somebody else's rugby on a page about your child is worse than no
 * photograph"). This is a SEPARATE, Training Centre-only component with the identical prop
 * contract, so the swap at the call site is a straight import change with no logic moved: same
 * back button, same status pill, same facts, same header utilities -- just a photographic ground
 * behind them, to bring Training Session Detail into the same visual family as Training Planning
 * Home, Create Training Plan and Plan Detail. This is a deliberate, requested exception to
 * EventHero's own rule, scoped to Training Centre alone; Fixture Detail is untouched.
 *
 * Reuses `training-player-ball-01` from the existing stock library (Training category) rather
 * than generating a new image -- a young player holding the ball, already accepted through full
 * QA for the Create Plan wizard, and the same "training is about to happen" framing suits a
 * single session's own page.
 */
export function TrainingSessionHero({
  surfaceName,
  title,
  eyebrow,
  status,
  mark,
  facts,
  onBack,
}: {
  surfaceName: string
  title: string
  eyebrow: string
  status?: { label: string; tone: "calm" | "warning" | "danger" } | null
  mark: React.ReactNode
  facts: { icon: React.ReactNode; label: string; detail?: string | null; onPress?: () => void }[]
  onBack: () => void
}) {
  const insets = useSafeAreaInsets()
  const { unread } = useAppContexts()
  const statusPaint = statusOnForest[status?.tone ?? "calm"]

  return (
    <View style={{ backgroundColor: "#0b1f16" }}>
      <Image source={heroPhoto} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(7,28,20,0.58)" }} />

      <View style={{ paddingTop: insets.top + space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => ({
              width: TOUCH_TARGET,
              height: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.pill,
              backgroundColor: pressed ? "rgba(255,255,255,0.10)" : "transparent",
            })}
          >
            <ChevronLeft size={22} color={onForest.primary} strokeWidth={2.2} />
          </Pressable>
          <Text style={[type.smallMedium, { color: onForest.primary, flex: 1, fontSize: 15 }]} numberOfLines={1}>
            {surfaceName}
          </Text>
          <HeaderUtilities unread={unread} tone="forest" />
        </View>

        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
            <View
              accessible={false}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: "rgba(90,203,131,0.20)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {mark}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[type.small, { color: onForest.secondary }]} numberOfLines={1}>
                {eyebrow}
              </Text>
              <Text accessibilityRole="header" style={[type.title, { color: onForest.primary, fontSize: 25 }]}>
                {title}
              </Text>
            </View>
            {!!status && (
              <View
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  backgroundColor: statusPaint.ground,
                }}
              >
                <Text style={[type.caption, { color: statusPaint.ink }]}>{status.label}</Text>
              </View>
            )}
          </View>

          <View style={{ gap: space.sm }}>
            {facts.map((fact) => (
              <Fact key={fact.label} {...fact} />
            ))}
          </View>
        </View>
      </View>
    </View>
  )
}

function Fact({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  detail?: string | null
  onPress?: () => void
}) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: onForest.primary, fontSize: 14 }]} numberOfLines={2}>
          {label}
        </Text>
        {!!detail && (
          <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {!!onPress && <ChevronRight size={16} color={onForest.secondary} />}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET - 8, justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  )
}
