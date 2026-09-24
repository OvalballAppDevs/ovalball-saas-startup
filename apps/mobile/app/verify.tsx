import { useEffect, useState } from "react"
import { Linking, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { pickChallengeFactor } from "@ovalball/contracts/auth"

import { supabase } from "../src/auth/supabase"
import { webUrl } from "../src/config/environment"
import { useSession } from "../src/auth/session"
import { friendly, logDetail } from "../src/errors/translate"
import { Button } from "../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../src/design/tokens"

/**
 * THE SECOND FACTOR, CONTINUED ON THE PHONE.
 *
 * The canonical flow, unchanged: list the account's enrolled factors, open a challenge against the
 * TOTP one, verify the six digits. Supabase issues the AAL2 session on success, and the gate in
 * `_layout.tsx` moves the app on because the STATUS changed -- this screen does not navigate anywhere
 * itself, so there is no path where it could decide the requirement had been met.
 *
 * NOTHING SENSITIVE IS SHOWN. Enrolment happens on the website, so this screen never sees a TOTP
 * secret or a QR code, and recovery codes are not displayed here: a screen that shows them "just in
 * case" is a screen that shows them to whoever is standing behind you.
 *
 * SIGN OUT IS THE WAY BACK. There is no cancel that leaves a half-authenticated session sitting in the
 * app -- the only exits are forward through the factor, or out.
 */
export default function Verify() {
  const { refreshAssurance, signOut, email } = useSession()
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
        logDetail("list factors", failure)
        setProblem(failure.message)
      }
      // ONE RULE FOR BOTH CHALLENGES: a challenge is only ever issued against a verified factor.
      const totp = pickChallengeFactor(data?.totp ?? [])
      setFactorId(totp?.id ?? null)
      setLoading(false)
    })()
  }, [])

  async function verify() {
    if (!factorId || code.trim().length < 6) return
    setBusy(true)
    setProblem(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError || !challenge) {
      const failure = friendly(challengeError, "your security check")
      logDetail("mfa challenge", failure)
      setProblem(failure.message)
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    })
    setBusy(false)
    if (error) {
      const failure = friendly(error, "your security check")
      logDetail("mfa verify", failure)
      setProblem(failure.message)
      setCode("")
      return
    }
    // The auth server now holds an AAL2 session. Re-asking it -- rather than assuming -- is what keeps
    // this screen incapable of letting anybody through on its own say-so.
    await refreshAssurance()
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.chalk }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.xl,
        justifyContent: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
        One more step
      </Text>
      <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
        {email ? `Enter the six-digit code from your authenticator app to finish signing in as ${email}.` : "Enter the six-digit code from your authenticator app."}
      </Text>

      {loading ? (
        <Text style={[type.small, { color: colour.inkMuted, marginTop: space.lg }]}>Checking your security settings…</Text>
      ) : !factorId ? (
        <Text accessibilityRole="alert" style={[type.body, { color: colour.danger, marginTop: space.lg }]}>
          This account needs a second factor, and none is set up yet. Set one up on the Ovalball website, then sign in here again.
        </Text>
      ) : (
        <>
          <Text style={[type.smallMedium, { color: colour.ink, marginTop: space.xl, marginBottom: 6 }]}>
            Authentication Code
          </Text>
          <TextInput
            accessibilityLabel="Authentication code"
            value={code}
            onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            style={[
              type.display,
              {
                minHeight: TOUCH_TARGET + 12,
                backgroundColor: colour.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colour.lineStrong,
                paddingHorizontal: space.lg,
                color: colour.ink,
                letterSpacing: 8,
              },
            ]}
          />
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger, marginTop: space.md }]}>
              {problem}
            </Text>
          )}
          <Button
            label="Verify"
            onPress={verify}
            busy={busy}
            disabled={code.length < 6}
            style={{ marginTop: space.lg }}
          />
        </>
      )}

      <View style={{ marginTop: space.lg, gap: space.xs }}>
        {/* LOST THE AUTHENTICATOR? A recovery code signs in on the website (`/security/recovery`): it
            removes every factor and leaves the session at AAL1, which is a desk decision, not a tap. */}
        <Button
          label="Use a Recovery Code on the Website"
          variant="quiet"
          onPress={() => { if (webUrl) void Linking.openURL(`${webUrl}/security/recovery`) }}
          accessibilityHint="Opens the Ovalball website, where a recovery code signs you in"
        />
        <Button label="Sign Out" variant="quiet" onPress={() => void signOut()} />
      </View>
    </ScrollView>
  )
}
