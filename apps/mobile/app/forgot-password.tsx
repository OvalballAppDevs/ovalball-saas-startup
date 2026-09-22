import { useState } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import * as Linking from "expo-linking"

import { supabase } from "../src/auth/supabase"
import { RECOVERY_PATH } from "../src/links/intents"
import { recoveryRedirectFor } from "../src/config/environment"
import { logDetail, friendly } from "../src/errors/translate"
import { EntranceLink, EntranceProblem, EntranceScreen, Field } from "../src/components/entrance"
import { Button, Card } from "../src/components/ui"
import { CircleAlert, Mail } from "../src/components/icons"
import { colour, space, type } from "../src/design/tokens"

/**
 * ASKING FOR A RESET.
 *
 * THE ANSWER IS THE SAME WHATEVER THE TRUTH. An address with an account, an address without one, and
 * a GoTrue refusal all produce the identical confirmation, because this endpoint is public and causes
 * an email to be sent to an address the caller chose -- so distinguishing them would let anybody test
 * whether a person is on Ovalball. The web's `requestPasswordReset` takes exactly this position and
 * the wording here is its wording.
 *
 * WHAT IS NOT THE SAME AS THE WEB: there is no Turnstile. Turnstile is a browser challenge and has no
 * native widget, so the abuse protection in front of this on a phone is GoTrue's own per-address rate
 * limit, which is real but is not a CAPTCHA. Recorded honestly rather than papered over, and listed
 * as an owner decision.
 *
 * THE LINK COMES BACK TO THIS APP. `redirectTo` is built from the app's own scheme, so tapping the
 * email on the phone opens Ovalball rather than stranding somebody in a browser page telling them to
 * go back.
 */
export default function ForgotPassword() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  async function submit() {
    const trimmed = email.trim().toLowerCase()
    setProblem(null)
    setFieldError(null)

    // "This is not an email address at all" reveals nothing about any account, so it is the one thing
    // worth saying rather than silently accepting.
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setFieldError("Enter a valid email address.")
      return
    }

    setBusy(true)
    // In a development or production build this IS the app; in Expo Go it becomes the website's
    // one-hop handoff, because Supabase will not redirect to an exp:// URL on a LAN host.
    const redirectTo = recoveryRedirectFor(Linking.createURL(RECOVERY_PATH))
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo })
    setBusy(false)

    if (error) {
      const failure = friendly(error, "that request")
      logDetail("reset request", failure)
      // A rate limit is the one failure worth surfacing: it is about the REQUEST, not the address, and
      // silently claiming to have sent an email that was refused would leave somebody waiting for it.
      if (failure.message.includes("Too many")) {
        setProblem(failure.message)
        return
      }
      // Everything else is operational and says nothing about the address, so it collapses into the
      // same neutral confirmation the success path gives.
    }
    setSent(true)
  }

  if (sent) {
    return (
      <EntranceScreen
        title="Check your email"
        subtitle="If an Ovalball account exists for that email, we've sent password reset instructions."
      >
        <Card style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <Mail size={20} color={colour.forest800} />
            <View style={{ flex: 1 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Open the link on this phone</Text>
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                Tapping it here brings you straight back into Ovalball to choose a new password. The
                link works once and expires after an hour.
              </Text>
            </View>
          </View>
        </Card>
        <View style={{ marginTop: space.lg }}>
          <Button label="Back to Sign In" variant="secondary" onPress={() => router.replace("/sign-in")} />
        </View>
        <EntranceLink label="Send it again" onPress={() => setSent(false)} />
      </EntranceScreen>
    )
  }

  return (
    <EntranceScreen
      title="Forgot your password?"
      subtitle="Enter the email you use for Ovalball and we'll send you a link to set a new one."
      footer={<EntranceLink label="Back to Sign In" onPress={() => router.replace("/sign-in")} />}
    >
      <View style={{ marginTop: space.xl }}>
        <Field
          label="Email Address"
          icon={<Mail size={18} color={colour.inkSubtle} />}
          value={email}
          onChangeValue={setEmail}
          error={fieldError}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          returnKeyType="send"
          onSubmitEditing={submit}
        />
      </View>

      <EntranceProblem message={problem} />

      <Button label="Send Reset Link" onPress={submit} busy={busy} disabled={email.trim().length === 0} />

      <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.lg, alignItems: "flex-start" }}>
        <CircleAlert size={14} color={colour.inkSubtle} />
        <Text style={[type.caption, { color: colour.inkSubtle, flex: 1 }]}>
          Resetting your password does not change your two-factor security. You&rsquo;ll still be asked
          for your authenticator code.
        </Text>
      </View>
    </EntranceScreen>
  )
}
