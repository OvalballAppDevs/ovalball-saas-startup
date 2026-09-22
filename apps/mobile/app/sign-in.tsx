import { useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useSession } from "../src/auth/session"
import { configurationProblem } from "../src/config/environment"
import { Button, ErrorState } from "../src/components/ui"
import { OvalballMark } from "../src/components/brand"
import { TOUCH_TARGET, colour, radius, space, type } from "../src/design/tokens"

/**
 * WELCOME BACK.
 *
 * EMAIL AND PASSWORD, which is what the platform actually uses. Old tests in this repository still
 * mention a magic link; the identity programme retired it, and building a native flow around a dead
 * mechanism would have been archaeology mistaken for a requirement.
 *
 * THE REFUSAL IS UNDIFFERENTIATED, exactly as the website's is: "Email or password is incorrect"
 * whichever was wrong. Telling somebody the address exists tells an attacker the same thing.
 *
 * SOCIAL SIGN-IN IS NOT DRAWN HERE. Google, Apple and Facebook exist in the platform's configuration
 * and all three are switched OFF by default (`lib/auth/oauth-providers.ts`), because a button shown
 * before its provider is configured sends a real person into a provider error page. Drawing three
 * buttons that cannot work would be exactly the pretence the brief rules out, so the app will show
 * them when the platform says they are on.
 */
export default function SignIn() {
  const { signIn } = useSession()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const misconfigured = configurationProblem()
  const ready = email.trim().length > 0 && password.length > 0 && !misconfigured

  async function submit() {
    if (!ready) return
    setBusy(true)
    setProblem(null)
    const failure = await signIn(email, password)
    setBusy(false)
    if (failure) setProblem(failure.message)
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colour.chalk }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xl,
          paddingHorizontal: space.xl,
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: space.xl }}>
          <OvalballMark size={90} tint={colour.forest800} />
        </View>

        <Text accessibilityRole="header" style={[type.display, { color: colour.ink, textAlign: "center" }]}>
          Welcome back
        </Text>
        <Text style={[type.body, { color: colour.inkMuted, textAlign: "center", marginTop: space.xs }]}>
          Sign in to your Ovalball account
        </Text>

        {misconfigured && (
          <View style={{ marginTop: space.lg }}>
            <ErrorState message={misconfigured} />
          </View>
        )}

        <View style={{ marginTop: space.xl, gap: space.md }}>
          <Field
            label="Email Address"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            secure={!reveal}
            autoComplete="current-password"
            textContentType="password"
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={reveal ? "Hide password" : "Show password"}
                onPress={() => setReveal((v) => !v)}
                hitSlop={12}
                style={{ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={[type.small, { color: colour.forest800 }]}>{reveal ? "Hide" : "Show"}</Text>
              </Pressable>
            }
          />
        </View>

        {problem && (
          <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, marginTop: space.md }]}>
            {problem}
          </Text>
        )}

        <Button
          label="Sign In"
          onPress={submit}
          busy={busy}
          disabled={!ready}
          style={{ marginTop: space.lg }}
          accessibilityHint="Signs you in to Ovalball"
        />

        <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.lg }]}>
          Creating an account, resetting a password and joining a club are on the Ovalball website for now.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/**
 * A LABELLED field, never a placeholder standing in for one: a placeholder disappears the moment
 * somebody types, so the person who most needs to know what a box is for is the one who cannot see it.
 */
function Field({
  label,
  value,
  onChange,
  secure = false,
  trailing,
  ...input
}: {
  label: string
  value: string
  onChange: (value: string) => void
  secure?: boolean
  trailing?: React.ReactNode
} & Omit<React.ComponentProps<typeof TextInput>, "value" | "onChange" | "onChangeText" | "style">) {
  return (
    <View>
      <Text style={[type.smallMedium, { color: colour.ink, marginBottom: 6 }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colour.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colour.lineStrong,
          paddingLeft: space.md,
          paddingRight: trailing ? 4 : space.md,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          style={[type.body, { flex: 1, minHeight: TOUCH_TARGET + 4, color: colour.ink }]}
          placeholderTextColor={colour.inkSubtle}
          {...input}
        />
        {trailing}
      </View>
    </View>
  )
}
