import { useCallback, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { canAddFactor, canRemoveFactor, describeDevice, factorLabel, MAX_TOTP_FACTORS } from "@ovalball/contracts/auth"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { leaveSession } from "../../../src/auth/leave"
import { readSecurityOverview, regenerateMyRecoveryCodes, removeMyFactor, signOutMyOtherDevices, type SecurityOverview } from "../../../src/security/data"
import { holdIntent, takeIntent } from "../../../src/admin/pending-intent"
import { SubScreenHeader } from "../../../src/components/sub-screen"
import { Button, Card, CardSkeleton, ErrorState, SectionHeading, StatusPill } from "../../../src/components/ui"
import { ChevronRight, KeyRound, LogOut, Shield, ShieldCheck, Smartphone, X } from "../../../src/components/icons"
import { friendly, logDetail } from "../../../src/errors/translate"
import { sessionStorageDescription } from "../../../src/auth/session-store"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * SECURITY -- the person's own account, on the phone, through the website's own operations.
 *
 *   password      change it (the shared composition rule; GoTrue re-applies its minimum)
 *   authenticator add one (native enrolment, secret shown once), remove one (never the last)
 *   recovery      how many codes are left; new ones (the server demands a recent code)
 *   devices       what else is signed in; sign the rest out (the server demands a recent code)
 *
 * WHAT NEEDS A RECENT SECOND FACTOR IS DECIDED BY THE SERVER. The two operations that do are refused
 * with the recent-auth sentence; the screen hands the person to the step-up challenge, holds what
 * they meant to do, and does it again after -- verification never performs the operation itself, and
 * a cancelled step-up discards it (CA-M4's rule).
 *
 * NOTHING SECRET IS SHOWN HERE. The enrolment secret lives on the enrolment screen for as long as it
 * is on screen; recovery codes are shown once, on the screen that created them.
 */
const INTENT_KEY = "security:resume"
type Resume = { op: "SIGN_OUT_OTHER_DEVICES" | "REGENERATE_RECOVERY_CODES" }

export default function Security() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { signOut, email } = useSession()
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setOverview(await readSecurityOverview(supabase))
    } catch (caught) {
      const failure = friendly(caught, "your security settings")
      logDetail("security overview", failure)
      setProblem(failure.message)
    }
  }, [])

  const stepUp = useCallback(
    (op: Resume["op"]) => {
      holdIntent<Resume>(INTENT_KEY, { op })
      router.push({ pathname: "/step-up", params: { returnTo: "/security" } } as never)
    },
    [router]
  )

  const signOutOthers = useCallback(async () => {
    setBusy("devices")
    setNotice(null)
    const result = await signOutMyOtherDevices(supabase)
    setBusy(null)
    if (!result.ok) {
      if (result.recentAuth) stepUp("SIGN_OUT_OTHER_DEVICES")
      else setNotice(result.message)
      return
    }
    setNotice(result.revoked === 0 ? "No other devices were signed in." : `Signed out ${result.revoked} other ${result.revoked === 1 ? "device" : "devices"}.`)
    await load()
  }, [load, stepUp])

  const regenerate = useCallback(async () => {
    setBusy("codes")
    setNotice(null)
    const result = await regenerateMyRecoveryCodes(supabase)
    setBusy(null)
    if (!result.ok) {
      if (result.recentAuth) stepUp("REGENERATE_RECOVERY_CODES")
      else setNotice(result.message)
      return
    }
    setNewCodes(result.codes)
    await load()
  }, [load, stepUp])

  // RESUMED AFTER A STEP-UP: the held intent is taken once and performed now, by this screen.
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = takeIntent<Resume>(INTENT_KEY)
      if (resume?.op === "SIGN_OUT_OTHER_DEVICES") void signOutOthers()
      if (resume?.op === "REGENERATE_RECOVERY_CODES") void regenerate()
    }, [load, signOutOthers, regenerate])
  )

  async function remove(factorId: string) {
    setBusy(factorId)
    setNotice(null)
    const result = await removeMyFactor(supabase, factorId)
    setBusy(null)
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setNotice("Authenticator removed.")
    await load()
  }

  const factors = overview?.factors ?? []

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <SubScreenHeader title="Security" />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} tintColor={colour.forest800} />}
      >
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!overview && !problem && <CardSkeleton lines={3} />}

        {notice && (
          <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>
            {notice}
          </Text>
        )}

        {newCodes && (
          <Card style={{ gap: space.sm, borderColor: colour.pitch600 }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Your new recovery codes</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>Each one works once. Keep them somewhere safe -- they are not shown again, and your old codes no longer work.</Text>
            <View style={{ gap: 4, marginTop: space.xs }}>
              {newCodes.map((code) => (
                <Text key={code} selectable style={[type.bodyMedium, { color: colour.ink, fontFamily: "Inter_500Medium", letterSpacing: 1.2 }]}>
                  {code}
                </Text>
              ))}
            </View>
            <Button label="I've Saved Them" variant="secondary" onPress={() => setNewCodes(null)} style={{ marginTop: space.sm }} />
          </Card>
        )}

        {overview && (
          <>
            <Card style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {overview.atAal2 ? <ShieldCheck size={20} color={colour.forest800} /> : <Shield size={20} color={colour.inkSubtle} />}
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>{email ?? "Your account"}</Text>
                <StatusPill label={factors.length > 0 ? "Two-step on" : "Password only"} tone={factors.length > 0 ? "positive" : "caution"} />
              </View>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {factors.length > 0
                  ? "A stolen password is not enough to get in: signing in also needs a code from your authenticator app."
                  : "An authenticator app means a stolen password is not enough to get in."}
              </Text>
            </Card>

            <SectionHeading>Password</SectionHeading>
            <Row icon={<KeyRound size={19} color={colour.forest800} />} label="Change Password" caption="Choose a new password for your account" onPress={() => router.push("/security/password" as never)} />

            <SectionHeading>Authenticator</SectionHeading>
            <Card style={{ gap: space.sm }}>
              {factors.length === 0 && (
                <Text style={[type.small, { color: colour.inkMuted }]}>You haven't set one up. It takes about a minute with any authenticator app.</Text>
              )}
              {factors.map((factor, index) => (
                <View key={factor.id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
                  <ShieldCheck size={18} color={colour.forest800} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{factorLabel(factor, index)}</Text>
                    {!!factor.created_at && (
                      <Text style={[type.caption, { color: colour.inkSubtle }]}>Added {new Date(factor.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
                    )}
                  </View>
                  {canRemoveFactor(factors.length) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${factorLabel(factor, index)}`}
                      onPress={() => void remove(factor.id)}
                      disabled={busy === factor.id}
                      hitSlop={8}
                      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed || busy === factor.id ? 0.5 : 1 })}
                    >
                      <X size={18} color={colour.inkMuted} />
                    </Pressable>
                  ) : (
                    <Text style={[type.caption, { color: colour.inkSubtle, maxWidth: 120, textAlign: "right" }]}>Add another before removing</Text>
                  )}
                </View>
              ))}
              {canAddFactor(factors.length) ? (
                <Button label={factors.length === 0 ? "Set Up Authenticator" : "Add Another Authenticator"} variant={factors.length === 0 ? "primary" : "secondary"} onPress={() => router.push("/security/enrol" as never)} style={{ marginTop: space.xs }} />
              ) : (
                <Text style={[type.caption, { color: colour.inkSubtle }]}>You have the maximum of {MAX_TOTP_FACTORS} authenticators.</Text>
              )}
            </Card>

            {factors.length > 0 && (
              <>
                <SectionHeading>Recovery codes</SectionHeading>
                <Card style={{ gap: space.sm }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    {overview.recoveryCodesLeft > 0
                      ? `${overview.recoveryCodesLeft} unused ${overview.recoveryCodesLeft === 1 ? "code" : "codes"} left. Each one works once.`
                      : "You have no unused recovery codes. Without one, losing your phone means asking Ovalball for help."}
                  </Text>
                  <Button label={overview.recoveryCodesLeft > 0 ? "Replace My Codes" : "Create Recovery Codes"} variant="secondary" onPress={() => void regenerate()} busy={busy === "codes"} accessibilityHint="Needs a code from your authenticator" />
                </Card>
              </>
            )}

            <SectionHeading>Signed-in devices</SectionHeading>
            <Card style={{ gap: space.sm }}>
              {overview.sessions.map((session) => (
                <View key={session.session_id} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET - 8 }}>
                  <Smartphone size={18} color={session.is_current ? colour.forest800 : colour.inkSubtle} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{describeDevice(session.user_agent)}{session.is_current ? " (this device)" : ""}</Text>
                    {!!session.refreshed_at && (
                      <Text style={[type.caption, { color: colour.inkSubtle }]}>Active {new Date(session.refreshed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Text>
                    )}
                  </View>
                </View>
              ))}
              {overview.otherDevices > 0 ? (
                <Button label="Sign Out Other Devices" variant="secondary" onPress={() => void signOutOthers()} busy={busy === "devices"} accessibilityHint="Needs a code from your authenticator" style={{ marginTop: space.xs }} />
              ) : (
                <Text style={[type.caption, { color: colour.inkSubtle }]}>Only this device is signed in.</Text>
              )}
            </Card>

            <SectionHeading>This device</SectionHeading>
            <Card style={{ gap: space.sm }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Your session is stored in {sessionStorageDescription}. Nothing about what you may do is stored on the phone.</Text>
              <Button label="Sign Out" variant="quiet" onPress={() => void leaveSession(signOut)} />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Row({ icon, label, caption, onPress }: { icon: React.ReactNode; label: string; caption: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}. ${caption}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
        </View>
        <ChevronRight size={16} color={colour.inkSubtle} />
        <LogOut size={0} color="transparent" />
      </View>
    </Card>
  )
}
