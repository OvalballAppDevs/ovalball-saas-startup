import { useState } from "react"
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"

import { OvalballMark, OvalballWordmark } from "./brand"
import { CircleAlert, Eye, EyeOff } from "./icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * THE ENTRANCE'S SHARED SHAPE.
 *
 * Sign in, forgot password and set a new password are three steps of one journey, and they must feel
 * like it: the same forest ground the app launches on, the same mark, the same chalk sheet rising over
 * it. Written once here because three copies of a layout diverge -- one gains a shadow, one loses the
 * keyboard handling -- and a person walking through all three would feel the seams.
 *
 * The mark shrinks on a short handset so the form gets the room; a logo somebody cannot scroll past is
 * a worse trade than a smaller logo.
 */
export function EntranceScreen({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const short = Dimensions.get("window").height < 700

  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <StatusBar style="light" />

      <View
        style={{
          paddingTop: insets.top + (short ? space.lg : space.xxl),
          paddingBottom: short ? space.lg : space.xl,
          alignItems: "center",
          gap: space.md,
        }}
      >
        <OvalballMark size={short ? 64 : 84} />
        <OvalballWordmark size={short ? 26 : 30} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colour.chalk,
            borderTopLeftRadius: radius.xl + 8,
            borderTopRightRadius: radius.xl + 8,
            ...elevation.sheet,
          }}
        >
          <ScrollView
            contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {title}
            </Text>
            <Text style={[type.body, { color: colour.inkMuted, marginTop: 2 }]}>{subtitle}</Text>
            {children}
            {footer}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

/**
 * A LABELLED FIELD, never a placeholder standing in for one -- a placeholder disappears the moment
 * somebody types, so the person who most needs to know what a box is for is the one who cannot see it.
 *
 * `textContentType` and `autoComplete` are both set by callers, which is what makes iOS offer the
 * Passwords keychain entry and Android its autofill. `newPassword` in particular is what prompts iOS
 * to offer a strong password and then to SAVE the one that is chosen -- without it, somebody resets
 * their password and their password manager never learns the new one.
 */
export function Field({
  ref,
  label,
  hint,
  icon,
  value,
  onChangeValue,
  error,
  reveal,
  onToggleReveal,
  ...input
}: {
  ref?: React.Ref<TextInput>
  label: string
  hint?: string
  icon?: React.ReactNode
  value: string
  onChangeValue: (value: string) => void
  error?: string | null
  /** Present on a password field: renders the show/hide control. */
  reveal?: boolean
  onToggleReveal?: () => void
} & Omit<React.ComponentProps<typeof TextInput>, "value" | "onChange" | "onChangeText" | "style" | "ref">) {
  const [focused, setFocused] = useState(false)
  return (
    <View>
      <Text style={[type.smallMedium, { color: colour.ink, marginBottom: 6 }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: colour.surface,
          borderRadius: radius.md,
          borderWidth: focused || error ? 2 : 1,
          // The extra border width is absorbed by one less pixel of padding, so taking focus does not
          // grow the field and nudge everything below it.
          borderColor: error ? colour.danger : focused ? colour.pitch600 : colour.lineStrong,
          paddingLeft: focused || error ? space.md - 1 : space.md,
          paddingRight: onToggleReveal ? 2 : space.md,
        }}
      >
        {icon}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={value}
          onChangeText={onChangeValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={onToggleReveal ? !reveal : undefined}
          selectionColor={colour.pitch600}
          placeholderTextColor={colour.inkSubtle}
          style={[type.body, { flex: 1, minHeight: TOUCH_TARGET + 6, color: colour.ink }]}
          {...input}
        />
        {onToggleReveal && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onPress={onToggleReveal}
            hitSlop={10}
            style={({ pressed }) => ({
              width: TOUCH_TARGET,
              height: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {reveal ? <EyeOff size={20} color={colour.inkMuted} /> : <Eye size={20} color={colour.inkMuted} />}
          </Pressable>
        )}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, marginTop: 4 }]}>
          {error}
        </Text>
      )}
    </View>
  )
}

/** The one place a failure is shown on an entrance screen, with reserved height so nothing jumps. */
export function EntranceProblem({ message }: { message: string | null }) {
  return (
    <View style={{ minHeight: 26, justifyContent: "center", marginTop: space.md }}>
      {message && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <CircleAlert size={15} color={colour.danger} />
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, flex: 1 }]}>
            {message}
          </Text>
        </View>
      )}
    </View>
  )
}

/** A quiet text action — "Back to sign in", "Forgot your password?" — at a full touch target. */
export function EntranceLink({ label, onPress, align = "center" }: { label: string; onPress: () => void; align?: "center" | "right" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        justifyContent: "center",
        alignItems: align === "center" ? "center" : "flex-end",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={[type.smallMedium, { color: colour.forest800, textDecorationLine: "underline" }]}>{label}</Text>
    </Pressable>
  )
}
