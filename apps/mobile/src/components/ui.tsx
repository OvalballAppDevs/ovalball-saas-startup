import { useEffect, useRef } from "react"
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { CircleAlert, WifiOff } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * The small set of primitives every screen in this build actually uses.
 *
 * Accessibility is in the primitive, not added per screen: every Button is a button to a screen
 * reader, reports its own busy and disabled state, and is at least 44pt tall whatever is inside it.
 * A screen cannot forget what it never had to remember.
 */

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  style,
  accessibilityHint,
}: {
  label: string
  onPress: () => void
  variant?: "primary" | "secondary" | "quiet"
  busy?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityHint?: string
}) {
  const inactive = disabled || busy
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    primary: { bg: colour.forest800, fg: colour.onForest, border: colour.forest800 },
    secondary: { bg: colour.surface, fg: colour.ink, border: colour.lineStrong },
    quiet: { bg: "transparent", fg: colour.forest800, border: "transparent" },
  }
  const shade = palette[variant]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: TOUCH_TARGET,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          backgroundColor: shade.bg,
          borderWidth: 1,
          borderColor: shade.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={shade.fg} />}
      <Text style={[type.bodyMedium, { color: shade.fg }]}>{label}</Text>
    </Pressable>
  )
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  /** A card that does something is a button, and gets press feedback and a role. */
  onPress?: () => void
  accessibilityLabel?: string
}) {
  const shape: ViewStyle = {
    backgroundColor: colour.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colour.line,
    padding: space.lg,
    ...elevation.card,
  }
  if (!onPress) return <View style={[shape, style]}>{children}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [shape, { opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.995 : 1 }] }, style]}
    >
      {children}
    </Pressable>
  )
}

export function SectionHeading({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        {children}
      </Text>
      {action}
    </View>
  )
}

/** A status word with a tint behind it — never the tint alone, so colour is not the only signal. */
export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "positive" | "caution" | "neutral" }) {
  const tones = {
    positive: { bg: colour.successSurface, fg: colour.forest800 },
    caution: { bg: colour.warningSurface, fg: colour.warning },
    neutral: { bg: "rgba(16,21,18,0.05)", fg: colour.inkMuted },
  }
  const shade = tones[tone]
  return (
    <View style={{ backgroundColor: shade.bg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
      <Text style={[type.caption, { color: shade.fg }]}>{label}</Text>
    </View>
  )
}

/**
 * WHAT A SCREEN SAYS WHEN IT HAS NOTHING TO SHOW.
 *
 * Three cases, told apart on purpose. "Still loading" is not "nothing here", and neither is "this part
 * of the app is not built yet" -- a screen that shows an empty list for all three teaches a person
 * that the app is broken.
 */
export function Loading({ label }: { label: string }) {
  return (
    <View accessible accessibilityLabel={label} style={{ padding: space.xl, alignItems: "center", gap: space.md }}>
      <ActivityIndicator color={colour.forest800} />
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}

/**
 * A SKELETON, NOT A SPINNER.
 *
 * A spinner says "something is happening"; a skeleton says "a fixture card is about to be here", and
 * the page does not jump when it arrives because the space was already the right shape. Three spinners
 * in a row on one screen is the pattern this exists to replace.
 *
 * It announces itself once, as busy, rather than as several unlabelled boxes -- a screen reader should
 * hear "loading", not the geometry.
 */
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | string; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      style={[{ height, width: width as ViewStyle["width"], borderRadius: radius.sm, backgroundColor: "rgba(16,21,18,0.07)", opacity: pulse }, style]}
    />
  )
}

/** The shape a fixture card will be, so its arrival does not move the page. */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      <Card>
        <Skeleton height={14} width="45%" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} height={12} width={i === lines - 1 ? "60%" : "85%"} style={{ marginTop: space.sm }} />
        ))}
      </Card>
    </View>
  )
}

/**
 * A PRODUCT STATE, NOT A STACK TRACE.
 *
 * Ovalball's own voice, its own card, and a way forward. Offline gets its own icon and wording because
 * "check your signal" and "something went wrong" are different problems with different next steps, and
 * a touchline is where the first one actually happens.
 */
export function ErrorState({ message, onRetry, offline = false }: { message: string; onRetry?: () => void; offline?: boolean }) {
  return (
    <Card style={{ borderColor: offline ? colour.lineStrong : "rgba(193,34,27,0.25)", backgroundColor: offline ? colour.surface : colour.dangerSurface }}>
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        {offline ? <WifiOff size={20} color={colour.inkMuted} /> : <CircleAlert size={20} color={colour.danger} />}
        <Text accessibilityRole="alert" style={[type.body, { color: offline ? colour.ink : colour.danger, flex: 1 }]}>
          {message}
        </Text>
      </View>
      {onRetry && <Button label="Try Again" variant="secondary" onPress={onRetry} style={{ marginTop: space.md }} />}
    </Card>
  )
}

/**
 * EMPTY IS A REAL ANSWER, and it should read like one.
 *
 * "No fixtures this week" is information. It gets the same quiet card everywhere so a person learns
 * the shape once, and it never borrows the error treatment -- nothing has gone wrong.
 */
export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: colour.lineStrong,
        paddingVertical: space.xl,
        paddingHorizontal: space.lg,
        alignItems: "center",
        gap: space.xs,
      }}
    >
      {icon}
      <Text style={[type.bodyMedium, { color: colour.ink, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", maxWidth: 280 }]}>{body}</Text>
    </View>
  )
}

/**
 * NOT BUILT YET, SAID PLAINLY.
 *
 * The brief's instruction is not to pretend functionality exists. A destination that is coming says so
 * in its own words, names what it will hold, and points at the website where the job can be done
 * today -- which is more useful than a convincing empty list.
 */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ padding: space.xl, gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
        {title}
      </Text>
      <Text style={[type.body, { color: colour.inkMuted }]}>{body}</Text>
      <View style={{ marginTop: space.sm }}>
        <StatusPill label="Coming in this mobile build" tone="caution" />
      </View>
    </View>
  )
}
