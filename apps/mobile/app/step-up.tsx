import { useEffect, useState } from "react"
import { ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../src/auth/supabase"
import { useSession } from "../src/auth/session"
import { friendly, logDetail } from "../src/errors/translate"
import { Button } from "../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../src/design/tokens"

/**
 * CONFIRM IT'S YOU -- the second factor, again, before a sensitive change (CA-M4).
 *
 * The server refuses a permission or membership decision unless a code was entered on THIS session
 * within the last ten minutes (`internal.require_recent_aal2`). This screen is how the person meets
 * that: the canonical flow, unchanged -- list the enrolled factors, challenge the TOTP one, verify the
 * six digits -- which writes the fresh verification the server reads. Then `refreshAssurance()` and
 * back to where they came from.
 *
 * IT DOES NOT PERFORM THE CHANGE. The screen that sent the person here kept the intent in memory and
 * re-asks its question on return; the person confirms again and the server decides again. Passing
 * the factor is evidence of identity, never authority.
 *
 * CANCEL IS A REAL EXIT. Unlike sign-in verification, the person is already signed in, so leaving
 * without a code simply means the change is not made.
 */
export default function StepUp() {
  const router = useRouter()
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>()
  const { refreshAssurance, email } = useSession()
  const insets = useSafeAreaInsets()
  const [code, setCode] = useState("")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) {
        const failure = friendly(error, "your security settings")
        logDetail("step-up: list factors", failure)
        setProblem(failure.message)
      }
      const totp = data?.totp?.find((f) => f.status === "verified") ?? null
      setFactorId(totp?.id ?? null)
      setLoading(false)
    })()
  }, [])

  // Return to the screen that asked, named by it, so the pending intent is found where it was left --
  // whatever the navigation stack did in between. Only an in-app path is honoured.
  const back = () => {
    const to = typeof returnTo === "string" && /^\/[a-z0-9/[\]_-]*$/i.test(returnTo) ? returnTo : null
    if (to) router.replace(to as never)
    else if (router.canGoBack()) router.back()
    else router.replace("/(tabs)")
  }

  async function verify() {
    if (!factorId || code.trim().length < 6) return
    setBusy(true)
    setProblem(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError || !challenge) {
      const failure = friendly(challengeError, "your security check")
      logDetail("step-up: challenge", failure)
      setProblem(failure.message)
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() })
    if (error) {
      const failure = friendly(error, "your security check")
      logDetail("step-up: verify", failure)
      setProblem(failure.message)
      setCode("")
      setBusy(false)
      return
    }
    // The auth server now holds a fresh verification on this session. Re-ask it rather than assume,
    // then return: the screen underneath re-asks its own question.
    await refreshAssurance()
    setBusy(false)
    back()
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.chalk }}
      contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl, justifyContent: "center" }}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
        Confirm it's you
      </Text>
      <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
        {email ? `This change needs a recent check. Enter the six-digit code from your authenticator app for ${email}.` : "This change needs a recent check. Enter the six-digit code from your authenticator app."}
      </Text>

      {loading ? (
        <Text style={[type.small, { color: colour.inkMuted, marginTop: space.lg }]}>Checking your security settings…</Text>
      ) : !factorId ? (
        <Text accessibilityRole="alert" style={[type.body, { color: colour.danger, marginTop: space.lg }]}>
          This change needs a second factor, and none is set up on this account yet. Set one up on the Ovalball website, then try again here.
        </Text>
      ) : (
        <>
          <Text style={[type.smallMedium, { color: colour.ink, marginTop: space.xl, marginBottom: 6 }]}>Authentication Code</Text>
          <TextInput
            accessibilityLabel="Authentication code"
            value={code}
            onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            style={[type.display, { minHeight: TOUCH_TARGET + 12, backgroundColor: colour.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, paddingHorizontal: space.lg, color: colour.ink, letterSpacing: 8 }]}
          />
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, marginTop: space.md }]}>
              {problem}
            </Text>
          )}
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={code.length < 6} style={{ marginTop: space.lg }} />
        </>
      )}

      <View style={{ marginTop: space.lg }}>
        <Button label="Cancel" variant="quiet" onPress={back} disabled={busy} />
      </View>
    </ScrollView>
  )
}
