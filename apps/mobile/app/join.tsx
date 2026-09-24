import { useCallback, useEffect, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"

import {
  entranceOutcome,
  hasInvitationSecret,
  invitationPurpose,
  normaliseInvitationCode,
  previewInvitation,
  redeemInvitation,
  unusableInvitationWording,
  type EntranceOutcome,
  type InvitationPreview,
  type InvitationSecret,
} from "@ovalball/contracts/invitations"
import { AUTH_WORDING } from "@ovalball/contracts/auth"

import { supabase } from "../src/auth/supabase"
import { useSession } from "../src/auth/session"
import { leaveSession } from "../src/auth/leave"
import { useAppContexts } from "../src/context/contexts"
import { webUrl } from "../src/config/environment"
import { discardJoinSecret, holdJoinSecret, peekJoinSecret } from "../src/onboarding/join-secret"
import { EntranceLink, EntranceProblem, EntranceScreen, Field } from "../src/components/entrance"
import { Button, Card, Loading } from "../src/components/ui"
import { CircleCheck, KeyRound, Mail, UserRound } from "../src/components/icons"
import { colour, radius, space, type } from "../src/design/tokens"

/**
 * THE INVITATION SCREEN -- one journey, on the phone, over the canonical invitation architecture.
 *
 *   preview  -> what this opens and who sent it, for anybody holding the link (never who was invited)
 *   sign in  -> if nobody is, with the secret held in memory across the sign-in
 *   accept   -> a deliberate tap; the shared redemption contract asks the server, which refuses by returning
 *   landing  -> what happened, in one sentence; the contexts are re-read; the person goes in
 *
 * THE SECRET IS NEVER STORED. It arrives from a link (held in memory by the deep-link router) or is
 * typed here as a code, goes to two RPCs that hash it on arrival, and is discarded when this journey
 * ends. It is not logged, not put in a screenshot and not written to any store.
 *
 * WRONG ACCOUNT. The server refuses generically when the signed-in address is not the invited one --
 * it will not say which address was invited. The screen says what that refusal usually means and
 * offers the way out: sign out (keeping the invitation) and sign in as the right person.
 */
export default function Join() {
  const router = useRouter()
  const params = useLocalSearchParams<{ t?: string; c?: string; mode?: string }>()
  const { status, email, signOut } = useSession()
  const { reload, select } = useAppContexts()

  const [secret, setSecret] = useState<InvitationSecret | null>(() => {
    const held = peekJoinSecret()
    if (hasInvitationSecret(held)) return held
    const fromParams: InvitationSecret = { token: typeof params.t === "string" ? params.t : null, code: typeof params.c === "string" ? params.c : null }
    if (hasInvitationSecret(fromParams)) {
      holdJoinSecret(fromParams)
      return fromParams
    }
    return null
  })
  // THE SECRET MAY ARRIVE AFTER THE FIRST RENDER: the deep-link router holds it once the app has
  // read the launching URL, which can be a moment after this screen mounted from the route itself.
  useEffect(() => {
    if (secret) return
    const held = peekJoinSecret()
    if (hasInvitationSecret(held)) {
      setSecret(held)
      return
    }
    const fromParams: InvitationSecret = { token: typeof params.t === "string" ? params.t : null, code: typeof params.c === "string" ? params.c : null }
    if (hasInvitationSecret(fromParams)) {
      holdJoinSecret(fromParams)
      setSecret(fromParams)
    }
  }, [params.t, params.c, secret])
  const [typed, setTyped] = useState("")
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<InvitationPreview | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refusedGenerically, setRefusedGenerically] = useState(false)
  const [outcome, setOutcome] = useState<EntranceOutcome | null>(null)

  const load = useCallback(async () => {
    if (!secret) return
    setLoading(true)
    setProblem(null)
    try {
      setPreview(await previewInvitation(supabase, secret))
    } catch {
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [secret])

  useEffect(() => {
    void load()
  }, [load])

  function useCode() {
    const code = normaliseInvitationCode(typed)
    if (code.length < 6) {
      setProblem("Enter the code exactly as it was given to you.")
      return
    }
    const next = { token: null, code }
    holdJoinSecret(next)
    setSecret(next)
  }

  async function accept() {
    if (!secret) return
    setBusy(true)
    setProblem(null)
    setRefusedGenerically(false)
    const result = await redeemInvitation(supabase, secret)
    if (!result.ok) {
      setBusy(false)
      setProblem(result.message)
      setRefusedGenerically(result.reason === null)
      return
    }
    const landing = entranceOutcome(result.outcome, result.detail)
    // THE CONTEXTS ARE RE-READ FROM THE SERVER, never patched locally from what the invitation said.
    await reload()
    if (landing.contextKey) await select(landing.contextKey)
    setBusy(false)
    setOutcome(landing)
  }

  function finish() {
    discardJoinSecret()
    if (outcome?.landing === "ACCOUNT") router.replace("/(tabs)/profile" as never)
    else router.replace("/(tabs)")
  }

  function notNow() {
    discardJoinSecret()
    if (status === "signed-in") router.replace("/(tabs)")
    else router.replace("/welcome")
  }

  async function useDifferentAccount() {
    setBusy(true)
    await leaveSession(signOut, { keepInvitation: true })
    // The gate takes over: signed out -> Welcome; the held secret brings them back here after sign-in.
    router.replace("/sign-in")
  }

  // ------------------------------------------------------------------ accepted
  if (outcome) {
    return (
      <EntranceScreen title="You're in" subtitle={outcome.note ?? "Your invitation has been accepted."}>
        <View style={{ alignItems: "center", marginTop: space.xl, gap: space.md }}>
          <CircleCheck size={40} color={colour.forest800} />
          <Text style={[type.body, { color: colour.inkMuted, textAlign: "center" }]}>
            {outcome.landing === "PENDING"
              ? "Nothing more to do for now. You will hear from the club when it has been confirmed."
              : outcome.landing === "SITE_ADMIN"
                ? "Platform administration stays on the website; the app will show you your own rugby."
                : "Everything you now hold is ready in the app."}
          </Text>
        </View>
        <Button label="Continue" onPress={finish} style={{ marginTop: space.xl }} />
      </EntranceScreen>
    )
  }

  // ------------------------------------------------------------------ no secret yet: type a code
  if (!secret) {
    return (
      <EntranceScreen
        title={params.mode === "code" ? "Enter your team code" : "Enter your invitation code"}
        subtitle="Type the code you were given. A link from an email opens here on its own."
        footer={<EntranceLink label="Not now" onPress={notNow} />}
      >
        <View style={{ marginTop: space.lg }}>
          <Field
            label="Code"
            icon={<KeyRound size={18} color={colour.inkSubtle} />}
            value={typed}
            onChangeValue={(v) => {
              setTyped(v.toUpperCase())
              setProblem(null)
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            error={problem}
            returnKeyType="go"
            onSubmitEditing={useCode}
          />
        </View>
        <EntranceProblem message={null} />
        <Button label="Check Code" onPress={useCode} disabled={normaliseInvitationCode(typed).length < 6} />
      </EntranceScreen>
    )
  }

  // ------------------------------------------------------------------ previewing
  if (loading || preview === undefined) {
    return (
      <EntranceScreen title="Checking your invitation" subtitle="One moment.">
        <View style={{ marginTop: space.xl }}>
          <Loading label="Checking" />
        </View>
      </EntranceScreen>
    )
  }

  // ------------------------------------------------------------------ cannot be used
  const unusable = unusableInvitationWording(preview, secret)
  if (unusable) {
    return (
      <EntranceScreen title={unusable.title} subtitle={unusable.body} footer={<EntranceLink label={status === "signed-in" ? "Back to Ovalball" : "Back"} onPress={notNow} />}>
        {!secret.token && (
          <Button
            label="Try Another Code"
            variant="secondary"
            style={{ marginTop: space.xl }}
            onPress={() => {
              discardJoinSecret()
              setSecret(null)
              setPreview(undefined)
              setTyped("")
            }}
          />
        )}
      </EntranceScreen>
    )
  }

  // ------------------------------------------------------------------ usable
  const invited = preview!
  const sentence = invited.inviterLabel ? `${invited.inviterLabel} has invited you to ${invitationPurpose(invited.kind)}.` : `You have been invited to ${invitationPurpose(invited.kind)}.`
  const expires = invited.expiresAt ? new Date(invited.expiresAt) : null

  return (
    <EntranceScreen title={invited.scopeLabel} subtitle={sentence} footer={<EntranceLink label="Not now" onPress={notNow} />}>
      <Card style={{ marginTop: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Mail size={18} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{secret.token ? "Invitation link" : "Invitation code"}</Text>
        </View>
        {expires && !Number.isNaN(expires.getTime()) && (
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            Open until {expires.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.
          </Text>
        )}
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          Ovalball checks that the invitation was sent to the address you sign in with, so nobody else can use it.
        </Text>
      </Card>

      {status === "signed-in" ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.lg }}>
            <UserRound size={16} color={colour.inkSubtle} />
            <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]} numberOfLines={1}>
              Signed in as {email ?? "you"}
            </Text>
          </View>
          <EntranceProblem message={problem} />
          {refusedGenerically && (
            <View style={{ backgroundColor: colour.warningSurface, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
              <Text style={[type.small, { color: colour.ink }]}>{AUTH_WORDING.invitationWrongAccount}</Text>
              <Button label="Use a Different Account" variant="secondary" onPress={() => void useDifferentAccount()} busy={busy} />
            </View>
          )}
          <Button label="Accept Invitation" onPress={() => void accept()} busy={busy} disabled={refusedGenerically} style={{ marginTop: space.md }} accessibilityHint="Accepts this invitation for the account you are signed in with" />
        </>
      ) : (
        <>
          <EntranceProblem message={problem} />
          <Button label="Sign In to Accept" onPress={() => router.push("/sign-in")} accessibilityHint="Signs you in, then brings you back to this invitation" />
          <Button
            label="I Don't Have an Account"
            variant="secondary"
            style={{ marginTop: space.sm }}
            accessibilityHint="Opens this invitation on the Ovalball website, where an account is created"
            onPress={() => {
              if (!webUrl) return
              const query = secret.token ? `t=${encodeURIComponent(secret.token)}` : `c=${encodeURIComponent(secret.code ?? "")}`
              void Linking.openURL(`${webUrl}/join?${query}`)
            }}
          />
        </>
      )}
    </EntranceScreen>
  )
}
