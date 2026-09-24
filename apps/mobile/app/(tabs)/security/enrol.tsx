import { useEffect, useState } from "react"
import { ScrollView, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"

import { isCompleteTotpCode, normaliseTotpCode } from "@ovalball/contracts/auth"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { confirmTotpEnrolment, startTotpEnrolment } from "../../../src/security/data"
import { SubScreenHeader } from "../../../src/components/sub-screen"
import { EntranceProblem } from "../../../src/components/entrance"
import { Button, Card, Loading } from "../../../src/components/ui"
import { CircleCheck } from "../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * SET UP AN AUTHENTICATOR -- natively, over GoTrue's own enrolment, exactly as the website does it.
 *
 *   1. enroll   -> the auth server mints the factor and hands back a QR and the secret, ONCE
 *   2. verify   -> the person proves their app has it, with the current six-digit code
 *   3. codes    -> the first recovery codes, shown once
 *
 * THE SECRET EXISTS ONLY ON THIS SCREEN WHILE IT IS ON SCREEN. It is in component state, never in
 * AsyncStorage or SecureStore, never logged, never passed to another screen. Leaving mid-way leaves a
 * half-finished factor on the server that the next attempt removes (as the website does). A screenshot
 * of this screen would contain the secret, so this is one screen the review list does not capture.
 */
type Step = { kind: "starting" } | { kind: "show"; factorId: string; qrCode: string; secret: string } | { kind: "codes"; codes: string[] } | { kind: "failed"; message: string }

export default function Enrol() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { refreshAssurance } = useSession()
  const [step, setStep] = useState<Step>({ kind: "starting" })
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const started = await startTotpEnrolment(supabase)
      if (!live) return
      setStep(started.ok ? { kind: "show", factorId: started.factorId, qrCode: started.qrCode, secret: started.secret } : { kind: "failed", message: started.message })
    })()
    return () => {
      live = false
    }
  }, [])

  async function verify() {
    if (step.kind !== "show" || !isCompleteTotpCode(code)) return
    setBusy(true)
    setProblem(null)
    const result = await confirmTotpEnrolment(supabase, step.factorId, code)
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      setCode("")
      return
    }
    // The session is now at AAL2; the provider re-reads the assurance so nothing downstream asks again.
    await refreshAssurance()
    setStep({ kind: "codes", codes: result.recoveryCodes })
  }

  const finish = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/security" as never))

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <SubScreenHeader title="Set Up Authenticator" fallback="/(tabs)/security" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {step.kind === "starting" && <Loading label="Preparing your authenticator" />}

        {step.kind === "failed" && (
          <Card style={{ gap: space.md }}>
            <Text style={[type.small, { color: colour.danger }]}>{step.message}</Text>
            <Button label="Back to Security" variant="secondary" onPress={finish} />
          </Card>
        )}

        {step.kind === "show" && (
          <>
            <Card style={{ gap: space.md }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>1. Add Ovalball to your app</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>Open your authenticator app (Google Authenticator, 1Password, Authy or similar) and scan this code.</Text>
              <View style={{ alignItems: "center" }}>
                <Image
                  source={{ uri: step.qrCode }}
                  style={{ width: 200, height: 200, borderRadius: radius.md, backgroundColor: colour.surface }}
                  contentFit="contain"
                  accessibilityLabel="QR code for your authenticator app"
                />
              </View>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Can't scan? Enter this key by hand instead.</Text>
              <Text selectable accessibilityLabel={`Setup key, ${step.secret.split("").join(" ")}`} style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_500Medium", letterSpacing: 1.5, textAlign: "center" }]}>
                {step.secret.replace(/(.{4})/g, "$1 ").trim()}
              </Text>
            </Card>

            <Card style={{ gap: space.md }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>2. Enter the code it shows</Text>
              <TextInput
                accessibilityLabel="Authentication code"
                value={code}
                onChangeText={(next) => setCode(normaliseTotpCode(next))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={() => void verify()}
                style={{ minHeight: TOUCH_TARGET + 8, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, fontFamily: "Inter_500Medium", fontSize: 24, letterSpacing: 8, textAlign: "center" }}
              />
              <EntranceProblem message={problem} />
              <Button label="Verify & Continue" onPress={() => void verify()} busy={busy} disabled={!isCompleteTotpCode(code)} />
              <Button label="Cancel" variant="quiet" onPress={finish} />
            </Card>
          </>
        )}

        {step.kind === "codes" && (
          <Card style={{ gap: space.md }}>
            <View style={{ alignItems: "center", gap: space.sm }}>
              <CircleCheck size={32} color={colour.forest800} />
              <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[type.heading, { color: colour.ink }]}>Authenticator set up</Text>
            </View>
            <Text style={[type.small, { color: colour.inkMuted }]}>These are your recovery codes. Each works once, and they are not shown again. Keep them somewhere that is not this phone.</Text>
            <View style={{ gap: 4 }}>
              {step.codes.map((recovery) => (
                <Text key={recovery} selectable style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_500Medium", letterSpacing: 1.2 }]}>
                  {recovery}
                </Text>
              ))}
            </View>
            <Button label="I've Saved Them" onPress={finish} />
          </Card>
        )}
      </ScrollView>
    </View>
  )
}
