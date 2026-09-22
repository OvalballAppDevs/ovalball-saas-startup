import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

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

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          backgroundColor: colour.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colour.line,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
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

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: "rgba(193,34,27,0.25)", backgroundColor: colour.dangerSurface }}>
      <Text accessibilityRole="alert" style={[type.body, { color: colour.danger }]}>
        {message}
      </Text>
      {onRetry && <Button label="Try Again" variant="secondary" onPress={onRetry} style={{ marginTop: space.md }} />}
    </Card>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card style={{ borderStyle: "dashed", backgroundColor: "transparent" }}>
      <Text style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
      <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>{body}</Text>
    </Card>
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
