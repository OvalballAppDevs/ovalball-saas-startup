import { useEffect, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { checkPasswordComposition } from "@ovalball/contracts"
import { isCompleteTotpCode, normaliseTotpCode, pickChallengeFactor } from "@ovalball/contracts/auth"

import { supabase } from "../../src/auth/supabase"
import { useSession } from "../../src/auth/session"
import { friendly, logDetail } from "../../src/errors/translate"
import { EntranceLink, EntranceProblem, EntranceScreen, Field } from "../../src/components/entrance"
import { Button, Card } from "../../src/components/ui"
import { CircleCheck, Lock } from "../../src/components/icons"
import { PasswordRequirements } from "../../src/components/password-requirements"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * SET A NEW PASSWORD.
 *
 * REACHED ONLY BY A VALIDATED RECOVERY. The gate routes here when the session provider is in
 * `recovering`, which happens only after `exchangeCodeForSession` has succeeded -- so the authority
 * to be on this screen is the auth server's judgement of the link, not a route anybody can type.
 *
 * THE RULES ARE THE PLATFORM'S, NOT MOBILE'S. `checkPasswordComposition` and `PASSWORD_REQUIREMENTS`
 * come from `packages/contracts`, which is the same code the website's validator runs -- so the app
 * cannot drift into a friendlier rule, and the wording a person is told is the wording they would be
 * told in a browser. They are SHOWN while typing rather than sprung as a rejection.
 *
 * SERVER AUTHORITY IS STILL FINAL. What is checked here is UX; GoTrue independently enforces the
 * twelve-character minimum on `updateUser`, and refuses whatever this screen might have let through.
 * The one rule that is NOT enforced for this client is the breach check, which lives in the website's
 * `server-only` validator -- stated in the report rather than quietly skipped.
 *
 * A RESET IS NOT AN MFA RESET. Nothing here touches a factor. If the account holds one, finishing
 * leaves the session at AAL1 and the gate sends it straight to the TOTP challenge, exactly as the web
 * does.
 */
export default function Recovery() {
  const router = useRouter()
  const { endRecovery, signOut } = useSession()

  /*
    A FACTOR HOLDER PROVES THE FACTOR BEFORE SETTING A PASSWORD. GoTrue refuses `updateUser({password})`
    from an AAL1 session when the account holds a verified factor ("AAL2 session is required to update
    email or password when MFA is enabled"), and a recovery session is AAL1 by definition. So the
    recovery screen asks for the six-digit code FIRST for such an account -- the same challenge the
    sign-in makes -- and only then shows the password form. Somebody who has lost both their password
    and their authenticator uses a recovery code on the website, which removes the factors.
  */
  const [assurance, setAssurance] = useState<"checking" | "challenge" | "ready">("checking")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [codeProblem, setCodeProblem] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      const needs = Boolean(data && data.nextLevel === "aal2" && data.nextLevel !== data.currentLevel)
      if (!live) return
      if (!needs) {
        setAssurance("ready")
        return
      }
      const { data: factors } = await supabase.auth.mfa.listFactors()
      if (!live) return
      setFactorId(pickChallengeFactor(factors?.totp ?? [])?.id ?? null)
      setAssurance("challenge")
    })()
    return () => {
      live = false
    }
  }, [])

  async function proveFactor() {
    if (!factorId || !isCompleteTotpCode(code)) return
    setVerifying(true)
    setCodeProblem(null)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError || !challenge) {
      setVerifying(false)
      setCodeProblem(friendly(challengeError, "your security check").message)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code })
    setVerifying(false)
    if (verifyError) {
      setCodeProblem(friendly(verifyError, "your code").message)
      setCode("")
      return
    }
    setAssurance("ready")
  }
  const confirmRef = useRef<TextInput>(null)
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
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      const failure = friendly(error, "your new password")
      logDetail("set password", failure)
      // GoTrue's own refusals are about the PASSWORD and are worth showing as they are -- "password is
      // too short" is useful, unlike a database error.
      setProblem(/password/i.test(failure.detail ?? "") ? (failure.detail as string) : failure.message)
      return
    }

    // The mark the web makes too, so a reset from a phone appears in the same history as one from a
    // browser. It is the person's own session doing it; no privileged path is involved.
    await supabase.rpc("record_my_security_change", { p_change: "PASSWORD_RESET" })

    // EVERY OTHER SESSION GOES. That is the point of resetting: anybody holding the account while the
    // password was unknown loses it now. Authorised by holding this session rather than by AAL, which
    // is what makes it usable here -- a person completing a recovery is at AAL1 by definition.
    const { error: revokeError } = await supabase.auth.signOut({ scope: "others" })
    setBusy(false)

    if (revokeError) {
      // FAIL CLOSED. The password is already live, so this cannot be reported as a failed reset -- but
      // old sessions surviving is the one outcome a reset exists to prevent. Everything goes, this one
      // included, and they sign in with the password they just chose.
      logDetail("revoke others", friendly(revokeError, "your other devices"))
      await signOut()
      setDone(true)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <EntranceScreen
        title="Password updated"
        subtitle="You're signed out everywhere else. Sign in with your new password to carry on."
      >
        <Card style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <CircleCheck size={20} color={colour.forest800} />
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
              If your account uses an authenticator app, you&rsquo;ll still be asked for a code. A
              password reset never changes your two-factor security.
            </Text>
          </View>
        </Card>
        <View style={{ marginTop: space.lg }}>
          <Button
            label="Continue to Sign In"
            onPress={async () => {
              // Ends the recovery AND the session, so the new password is actually used rather than a
              // half-authenticated recovery session carrying on into the product.
              await signOut()
              await endRecovery()
              router.replace("/sign-in")
            }}
          />
        </View>
      </EntranceScreen>
    )
  }

  if (assurance !== "ready") {
    return (
      <EntranceScreen
        title="Confirm it's you"
        subtitle={assurance === "checking" ? "One moment." : "This account has an authenticator. Enter the six-digit code from your app, then choose a new password."}
        footer={
          <EntranceLink
            label="Cancel and Sign In"
            onPress={async () => {
              await signOut()
              await endRecovery()
              router.replace("/sign-in")
            }}
          />
        }
      >
        {assurance === "challenge" && (
          <View style={{ marginTop: space.xl, gap: space.md }}>
            {factorId ? (
              <>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Authentication Code</Text>
                <TextInput
                  accessibilityLabel="Authentication code"
                  value={code}
                  onChangeText={(next) => setCode(normaliseTotpCode(next))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={() => void proveFactor()}
                  style={{ minHeight: TOUCH_TARGET + 8, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, fontFamily: "Inter_500Medium", fontSize: 24, letterSpacing: 8, textAlign: "center", backgroundColor: colour.surface }}
                />
                <EntranceProblem message={codeProblem} />
                <Button label="Verify" onPress={() => void proveFactor()} busy={verifying} disabled={!isCompleteTotpCode(code)} />
              </>
            ) : (
              <Text style={[type.small, { color: colour.inkMuted }]}>
                This account needs a second factor and none is usable. Use a recovery code on the Ovalball website, then try again.
              </Text>
            )}
          </View>
        )}
      </EntranceScreen>
    )
  }

  return (
    <EntranceScreen
      title="Set a new password"
      subtitle="Choose something you haven't used on Ovalball before."
      footer={
        <EntranceLink
          label="Cancel and Sign In"
          onPress={async () => {
            await signOut()
            await endRecovery()
            router.replace("/sign-in")
          }}
        />
      }
    >
      <View style={{ marginTop: space.xl, gap: space.md }}>
        <Field
          label="New Password"
          icon={<Lock size={18} color={colour.inkSubtle} />}
          value={password}
          onChangeValue={setPassword}
          reveal={reveal}
          onToggleReveal={() => setReveal((v) => !v)}
          // `newPassword` is what prompts iOS to offer a strong password and then to SAVE the chosen
          // one. Without it somebody resets their password and their manager never learns the new one.
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
        />
        <Field
          ref={confirmRef}
          label="Confirm New Password"
          icon={<Lock size={18} color={colour.inkSubtle} />}
          value={confirm}
          onChangeValue={(next) => {
            setConfirm(next)
            setConfirmError(null)
          }}
          error={confirmError}
          reveal={reveal}
          onToggleReveal={() => setReveal((v) => !v)}
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </View>

      <PasswordRequirements password={password} />

      <EntranceProblem message={problem} />

      <Button label="Save New Password" onPress={submit} busy={busy} disabled={!ready} />
    </EntranceScreen>
  )
}
