import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Switch, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { VALID_BUFFER_MINUTES, getPitchAllocationBoard, readPitchAllocationCapabilities, saveSchedulingPolicy, type PitchAllocationCapabilities } from "@ovalball/contracts/pitch-allocation"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { SubScreenHeader } from "../../../../src/components/sub-screen"
import { Button, Card, CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { todayIso } from "../../../../src/pitch-allocation/model"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PITCH ALLOCATION SETTINGS -- the club's own buffers and its auto-allocate switch, exactly the three
 * things the website's `/club/settings/pitch-allocation` form saves, through the shared write. Where
 * the buffers come from (the club's own or the platform's defaults) is said, because a club that has
 * never set one is inheriting a number it did not choose.
 */
export default function PitchAllocationSettings() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { clubId } = useAdminCentreAccess()
  const [caps, setCaps] = useState<PitchAllocationCapabilities>({ view: false, manage: false })
  const [loaded, setLoaded] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const [warmUp, setWarmUp] = useState(0)
  const [packUp, setPackUp] = useState(0)
  const [source, setSource] = useState<"club" | "platform">("platform")
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const [board, allowed] = await Promise.all([getPitchAllocationBoard(supabase, clubId, todayIso()), readPitchAllocationCapabilities(supabase, clubId)])
      setCaps(allowed)
      setAuto(board.policy.autoAllocateHomeFixtures)
      setWarmUp(board.policy.warmUpMinutes)
      setPackUp(board.policy.packUpMinutes)
      setSource(board.bufferSource)
    } catch (cause) {
      const failure = friendly(cause, "the pitch allocation settings")
      logDetail("pitch-allocation:settings", failure)
      setProblem(failure.message)
    } finally {
      setLoaded(true)
    }
  }, [clubId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!clubId || !session?.user) return
    setBusy(true)
    setSaved(null)
    setProblem(null)
    const result = await saveSchedulingPolicy(supabase, clubId, session.user.id, { autoAllocateHomeFixtures: auto, warmUpMinutes: warmUp, packUpMinutes: packUp })
    setBusy(false)
    if (!result.ok) {
      setProblem(friendly(new Error(result.error), "the settings").message)
      return
    }
    setSaved("Saved.")
    setSource("club")
  }

  const step = (value: number, delta: number) => {
    const list = VALID_BUFFER_MINUTES as readonly number[]
    const index = Math.max(0, Math.min(list.length - 1, list.indexOf(value) + delta))
    return list[index]
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <SubScreenHeader title="Allocation Settings" fallback="/(tabs)/admin/pitch-allocation" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!loaded && !problem && <CardSkeleton lines={3} />}
        {loaded && !caps.manage && (
          <Card>
            <Text style={[type.small, { color: colour.inkMuted }]}>Changing these settings is not part of your job here. The board shows them to you as they are.</Text>
          </Card>
        )}
        {loaded && (
          <>
            <Card style={{ gap: space.md }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Buffers around a match</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {source === "club" ? "These are the club's own numbers." : "The club has not set its own numbers, so these are Ovalball's defaults."} They decide when a pitch stops being free before kick-off and when it is free again after the final whistle.
              </Text>
              <Stepper label="Warm-up before kick-off" value={warmUp} onChange={(d) => setWarmUp(step(warmUp, d))} disabled={!caps.manage} />
              <Stepper label="Pack-up after the match" value={packUp} onChange={(d) => setPackUp(step(packUp, d))} disabled={!caps.manage} />
            </Card>
            <Card style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Propose pitches automatically</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>When the board opens on a day with unallocated home fixtures, a proposal is built for review. Nothing is applied without you.</Text>
                </View>
                <Switch value={auto} onValueChange={setAuto} disabled={!caps.manage} accessibilityLabel="Propose pitches automatically" trackColor={{ true: colour.pitch600 }} />
              </View>
            </Card>
            {caps.manage && <Button label="Save Settings" onPress={() => void save()} busy={busy} />}
            {!!saved && <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colour.forest800 }]}>{saved}</Text>}
            <Button label="Back to the Board" variant="quiet" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/admin/pitch-allocation" as never))} />
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Stepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (delta: number) => void; disabled: boolean }) {
  const control = (glyph: string, delta: number, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => onChange(delta)}
      disabled={disabled}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <Text style={[type.heading, { color: colour.ink }]}>{glyph}</Text>
    </Pressable>
  )
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{label}</Text>
      {control("−", -1, `${label}: five minutes less`)}
      <Text accessibilityLiveRegion="polite" style={[type.bodyMedium, { color: colour.ink, minWidth: 64, textAlign: "center" }]}>{value} min</Text>
      {control("+", 1, `${label}: five minutes more`)}
    </View>
  )
}
