import { useRef, useState } from "react"
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

import { useRouter } from "expo-router"

import { useSession } from "../src/auth/session"
import { configurationProblem } from "../src/config/environment"
import { Button } from "../src/components/ui"
import { EntranceLink } from "../src/components/entrance"
import { OvalballMark, OvalballWordmark } from "../src/components/brand"
import { ChevronLeft, CircleAlert, Eye, EyeOff, Lock, Mail } from "../src/components/icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../src/design/tokens"

/**
 * THE ENTRANCE — and it is the same room you just walked into.
 *
 * CONTINUITY IS THE WHOLE DESIGN. The app opens on a forest canvas with the mark in the middle; if the
 * next thing is a white form, the person has visibly left the product they just launched. So the mark
 * STAYS on forest at the top, and the form arrives as a chalk sheet rising over it. The launch is not
 * a screen that gets replaced -- it is the top of this one.
 *
 * THE SHEET RISES, IT DOES NOT FILL. Keeping forest visible above it is what makes the screen feel
 * like Ovalball rather than like a login. On a short handset the sheet takes more of the height and
 * the mark shrinks with it, because a form you cannot see is a worse trade than a smaller logo.
 *
 * SOCIAL SIGN-IN IS STILL NOT DRAWN. Google, Apple and Facebook are configured in the platform and all
 * three are switched OFF (`lib/auth/oauth-providers.ts`). A button shown before its provider is
 * configured sends a real person into a provider error page.
 */
export default function SignIn() {
  const { signIn } = useSession()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const passwordRef = useRef<TextInput>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // DEVELOPER DIAGNOSTICS, ONLY WHEN THERE IS A PROBLEM AND ONLY IN DEVELOPMENT. The localhost warning
  // earned its place during setup and would be noise now that the phone is talking to the Mac. It is
  // null when configuration is right, and it can never reach a production build.
  const misconfigured = __DEV__ ? configurationProblem() : null
  const ready = email.trim().length > 0 && password.length > 0

  // A short phone gives the form the room instead of the mark. 700pt is roughly an iPhone SE.
  const short = Dimensions.get("window").height < 700
  const markSize = short ? 64 : 84

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    const failure = await signIn(email, password)
    setBusy(false)
    if (failure) setProblem(failure.message)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <StatusBar style="light" />

      {/* The brand, still on its own ground -- the top of the launch canvas, not a new screen. */}
      <View
        style={{
          paddingTop: insets.top + (short ? space.lg : space.xxl),
          paddingBottom: short ? space.lg : space.xl,
          alignItems: "center",
          gap: space.md,
        }}
      >
        <OvalballMark size={markSize} />
        <OvalballWordmark size={short ? 26 : 30} />
      </View>
      {/* Back to Welcome. The root is a Slot, not a stack, so there is no swipe to return with. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.replace("/welcome")}
        hitSlop={8}
        style={({ pressed }) => ({
          position: "absolute",
          top: insets.top + space.xs,
          left: space.sm,
          width: TOUCH_TARGET,
          height: TOUCH_TARGET,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ChevronLeft size={24} color={colour.chalk} strokeWidth={2.2} />
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        // The sheet already clears the notch; without this offset iOS adds it twice and the form
        // detaches from the bottom of the screen when the keyboard opens.
        keyboardVerticalOffset={0}
      >
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
            contentContainerStyle={{
              padding: space.xl,
              paddingBottom: insets.bottom + space.xl,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              Welcome back
            </Text>
            <Text style={[type.body, { color: colour.inkMuted, marginTop: 2 }]}>
              Sign in to your Ovalball account
            </Text>

            {misconfigured && <DeveloperNotice message={misconfigured} />}

            <View style={{ marginTop: space.xl, gap: space.md }}>
              <Field
                label="Email Address"
                icon={<Mail size={18} color={colour.inkSubtle} />}
                value={email}
                onChangeValue={setEmail}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
              />
              <Field
                ref={passwordRef}
                label="Password"
                icon={<Lock size={18} color={colour.inkSubtle} />}
                value={password}
                onChangeValue={setPassword}
                secureTextEntry={!reveal}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={submit}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={reveal ? "Hide password" : "Show password"}
                    onPress={() => setReveal((v) => !v)}
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
                }
              />
            </View>

            {/* Placed under the password field, where somebody looks the moment they cannot remember
                it -- and a full-height target rather than a web-sized text link. */}
            <View style={{ alignItems: "flex-end", marginTop: space.xs, marginBottom: -space.sm }}>
              <EntranceLink label="Forgot your password?" onPress={() => router.push("/forgot-password")} align="right" />
            </View>

            {/* Reserved height, so the button does not jump down the screen the instant a sign-in fails. */}
            <View style={{ minHeight: 26, justifyContent: "center", marginTop: space.md }}>
              {problem && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <CircleAlert size={15} color={colour.danger} />
                  <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, flex: 1 }]}>
                    {problem}
                  </Text>
                </View>
              )}
            </View>

            <Button
              label="Sign In"
              onPress={submit}
              busy={busy}
              disabled={!ready}
              accessibilityHint="Signs you in to Ovalball"
            />

            <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.lg }]}>
              Creating an account, resetting a password and joining a club are on the Ovalball website
              for now.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

/** Visibly a developer's note, so nobody mistakes a setup problem for something the product did. */
function DeveloperNotice({ message }: { message: string }) {
  return (
    <View
      style={{
        marginTop: space.lg,
        flexDirection: "row",
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colour.warningSurface,
        borderWidth: 1,
        borderColor: "rgba(138,90,0,0.25)",
      }}
    >
      <CircleAlert size={16} color={colour.warning} />
      <View style={{ flex: 1 }}>
        <Text style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily }]}>
          Development build
        </Text>
        <Text style={[type.caption, { color: colour.warning, marginTop: 2 }]}>{message}</Text>
      </View>
    </View>
  )
}

/**
 * A LABELLED FIELD, never a placeholder standing in for one -- a placeholder disappears the moment
 * somebody types, so the person who most needs to know what a box is for is the one who cannot see it.
 *
 * `textContentType` and `autoComplete` are both set, which is what makes iOS offer the Passwords
 * keychain entry and Android its autofill: guessing from the label does not work, and a password
 * manager that does not appear is indistinguishable from one that is not installed.
 */
const Field = function Field({
  ref,
  label,
  icon,
  value,
  onChangeValue,
  trailing,
  ...input
}: {
  ref?: React.Ref<TextInput>
  label: string
  icon?: React.ReactNode
  value: string
  onChangeValue: (value: string) => void
  trailing?: React.ReactNode
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
          borderWidth: focused ? 2 : 1,
          // A two-pixel brand border on focus, and one pixel less padding to absorb it, so the field
          // does not grow by a pixel and nudge everything below it when it takes focus.
          borderColor: focused ? colour.pitch600 : colour.lineStrong,
          paddingLeft: focused ? space.md - 1 : space.md,
          paddingRight: trailing ? 2 : space.md,
        }}
      >
        {icon}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={colour.pitch600}
          placeholderTextColor={colour.inkSubtle}
          style={[type.body, { flex: 1, minHeight: TOUCH_TARGET + 6, color: colour.ink }]}
          {...input}
        />
        {trailing}
      </View>
    </View>
  )
}
