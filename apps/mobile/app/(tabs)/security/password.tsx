import { useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { checkPasswordComposition } from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { setMyPassword } from "../../../src/security/data"
import { SubScreenHeader } from "../../../src/components/sub-screen"
import { PasswordRequirements } from "../../../src/components/password-requirements"
import { EntranceProblem, Field } from "../../../src/components/entrance"
import { Button, Card } from "../../../src/components/ui"
import { CircleCheck, Lock } from "../../../src/components/icons"
import { colour, space, type } from "../../../src/design/tokens"

/**
 * CHANGE PASSWORD. The same rule the recovery screen and the website apply (`checkPasswordComposition`),
 * the same GoTrue call, the same recorded change. This does not sign out other devices: that is a
 * separate, deliberate action on the Security screen, because changing a password and evicting every
 * other session are two decisions.
 */
export default function ChangePassword() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const composition = checkPasswordComposition(password)
  const matches = password.length > 0 && password === confirm
  const ready = composition.ok && matches

  async function submit() {
    setProblem(null)
    setConfirmError(null)
    if (!composition.ok) {
      setProblem(composition.message)
      return
    }
    if (!matches) {
      setConfirmError("Those passwords do not match.")
      return
    }
    setBusy(true)
    const result = await setMyPassword(supabase, password)
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    setPassword("")
    setConfirm("")
    setDone(true)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <SubScreenHeader title="Change Password" fallback="/(tabs)/security" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {done ? (
          <Card style={{ alignItems: "center", gap: space.md }}>
            <CircleCheck size={32} color={colour.forest800} />
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[type.heading, { color: colour.ink }]}>Password changed</Text>
            <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>Use it the next time you sign in. Other devices stay signed in unless you sign them out from Security.</Text>
            <Button label="Back to Security" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/security" as never))} />
          </Card>
        ) : (
          <Card style={{ gap: space.md }}>
            <Field
              label="New Password"
              icon={<Lock size={18} color={colour.inkSubtle} />}
              value={password}
              onChangeValue={setPassword}
              secureTextEntry={!reveal}
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect={false}
              reveal={reveal}
              onToggleReveal={() => setReveal((v) => !v)}
            />
            <Field
              label="Confirm New Password"
              icon={<Lock size={18} color={colour.inkSubtle} />}
              value={confirm}
              onChangeValue={setConfirm}
              secureTextEntry={!reveal}
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect={false}
              error={confirmError}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            <PasswordRequirements password={password} />
            <EntranceProblem message={problem} />
            <Button label="Save New Password" onPress={() => void submit()} busy={busy} disabled={!ready} />
          </Card>
        )}
      </ScrollView>
    </View>
  )
}
