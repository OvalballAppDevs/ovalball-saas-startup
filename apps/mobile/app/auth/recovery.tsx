import { useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { checkPasswordComposition, PASSWORD_REQUIREMENTS } from "@ovalball/contracts"

import { supabase } from "../../src/auth/supabase"
import { useSession } from "../../src/auth/session"
import { friendly, logDetail } from "../../src/errors/translate"
import { EntranceLink, EntranceProblem, EntranceScreen, Field } from "../../src/components/entrance"
import { Button, Card } from "../../src/components/ui"
import { Check, Lock } from "../../src/components/icons"
import { colour, space, type } from "../../src/design/tokens"

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
            <Check size={20} color={colour.forest800} />
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

      <Requirements password={password} />

      <EntranceProblem message={problem} />

      <Button label="Save New Password" onPress={submit} busy={busy} disabled={!ready} />
    </EntranceScreen>
  )
}

/**
 * The rules, shown while typing rather than after a rejection.
 *
 * Derived from `PASSWORD_REQUIREMENTS` in the shared package, so the list cannot describe a rule the
 * validator has stopped applying. Each row carries a TICK or a ring as well as a colour, and is
 * announced with its own state, so it is readable without separating the greens.
 */
function Requirements({ password }: { password: string }) {
  return (
    <View style={{ marginTop: space.lg, gap: 6 }}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>Your password needs</Text>
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = password.length > 0 && requirement.met(password)
        return (
          <View
            key={requirement.key}
            accessible
            accessibilityLabel={`${requirement.label}: ${met ? "met" : "not yet met"}`}
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: met ? colour.forest800 : "transparent",
                borderWidth: met ? 0 : 1.5,
                borderColor: colour.lineStrong,
              }}
            >
              {met && <Check size={10} color={colour.onForest} strokeWidth={3.5} />}
            </View>
            <Text style={[type.caption, { color: met ? colour.ink : colour.inkMuted, flex: 1 }]}>
              {requirement.label}
            </Text>
          </View>
        )
      })}
      {/*
        THE BREACH CHECK IS NOT CLAIMED HERE, and that is deliberate.

        Ovalball's Have I Been Pwned check lives in `lib/auth/password-policy.ts`, which is
        `server-only` and runs inside the website's reset action. This client sets the password through
        GoTrue directly, so that check does not run on this path -- and telling somebody it did would
        be a security claim this build cannot keep. The right fix is project-level leaked-password
        protection, which would cover both clients at the auth server; it is an owner decision and is
        reported as one rather than papered over with a reassuring sentence.
      */}
    </View>
  )
}
