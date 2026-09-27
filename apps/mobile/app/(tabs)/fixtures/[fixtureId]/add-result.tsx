import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { loadFixtureDetail, type FixtureDetail } from "../../../../src/agenda/fixture-detail"
import { submitFixtureResult } from "../../../../src/agenda/mutations"
import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { loadFixtureAuthority, type FixtureAuthority } from "../../../../src/agenda/authority"
import { exactDate } from "../../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ClubCrest } from "../../../../src/components/identity"
import { Button, CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { ChevronRight } from "../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ADD RESULT (owner correction pass, Section 21) -- the FIRST step of the canonical result lifecycle,
 * `submit_fixture_result`, the same RPC the website's fixture-thread result panel calls. That RPC is
 * itself the real authorisation/state-machine boundary and, against another Ovalball club, the start of
 * a two-sided dispute/amendment negotiation -- this screen deliberately covers only "submit a score" and
 * not that reconciliation loop, which is a materially bigger feature the web already owns. See the
 * overnight report's KNOWN DEBT section.
 */
export default function AddResult() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const { sessionContext, active } = useAppContexts()
  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [ourScore, setOurScore] = useState("")
  const [theirScore, setTheirScore] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const myTeamIds = useMemo(
    () =>
      new Set([
        ...(sessionContext?.teamPermissions ?? []).map((t) => t.teamId),
        ...(sessionContext?.guardianRelationships ?? []).map((g) => g.teamId),
        ...(sessionContext?.linkedPlayerTeams ?? []).map((p) => p.teamId),
      ]),
    [sessionContext]
  )

  const load = useCallback(async () => {
    if (!fixtureId) return
    setProblem(null)
    try {
      const loaded = await loadFixtureDetail(supabase, fixtureId, myTeamIds)
      if (!loaded) {
        setProblem("This fixture couldn't be found.")
        return
      }
      setFixture(loaded)
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("add result", failure)
      setProblem(failure.message)
    }
  }, [fixtureId, myTeamIds])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let live = true
    void loadFixtureAuthority(supabase, active).then((result) => {
      if (live) setAuthority(result)
    })
    return () => {
      live = false
    }
  }, [active])

  async function save() {
    if (!fixture || fixture.homeAway !== "Home" && fixture.homeAway !== "Away") return
    const our = Number(ourScore)
    const their = Number(theirScore)
    if (!Number.isInteger(our) || our < 0 || !Number.isInteger(their) || their < 0) {
      setSaveError("Enter both final scores as whole numbers.")
      return
    }
    setSaving(true)
    setSaveError(null)
    const result = await submitFixtureResult(supabase, fixture.id, fixture.homeAway, our, their)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.message)
      return
    }
    router.back()
  }

  const canRecord = authority?.recordResult ?? false
  const orientationKnown = fixture?.homeAway === "Home" || fixture?.homeAway === "Away"

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Add Result
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && !fixture && <ErrorState message={problem} onRetry={load} />}
        {!problem && fixture === null && <CardSkeleton lines={4} />}

        {fixture && (
          <>
            <View style={{ alignItems: "center", gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
                <ClubCrest clubName={fixture.us.clubName} url={fixture.us.crestUrl} size={56} />
                <Text style={[type.title, { color: colour.inkMuted }]}>v</Text>
                <ClubCrest clubName={fixture.them.clubName} url={fixture.them.crestUrl} size={56} />
              </View>
              <Text style={[type.small, { color: colour.inkMuted }]}>{exactDate(fixture.date)}</Text>
            </View>

            {!canRecord && (
              <ErrorState message="You don't have permission to record a result for this fixture." onRetry={load} />
            )}

            {canRecord && !orientationKnown && (
              <ErrorState message="This fixture has no confirmed home or away side yet, so a result can't be recorded until it does." onRetry={load} />
            )}

            {canRecord && orientationKnown && fixture.result && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.xs, alignItems: "center" }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>RESULT ALREADY RECORDED</Text>
                <Text style={[type.title, { color: colour.ink }]}>
                  {fixture.result.ourScore} – {fixture.result.theirScore}
                </Text>
              </View>
            )}

            {canRecord && orientationKnown && !fixture.result && (
              <View style={{ gap: space.lg }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>FINAL SCORE</Text>
                <ScoreField label={fixture.us.clubName} value={ourScore} onChange={setOurScore} />
                <ScoreField label={fixture.them.clubName} value={theirScore} onChange={setTheirScore} />
                {saveError && <Text style={[type.small, { color: colour.danger }]}>{saveError}</Text>}
                <Button label="Save Result" busy={saving} disabled={!ourScore || !theirScore} onPress={save} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function ScoreField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} final score`}
        value={value}
        onChangeText={(next) => onChange(next.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="0"
        placeholderTextColor={colour.inkSubtle}
        style={[
          type.title,
          {
            minHeight: TOUCH_TARGET + 12,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: colour.surface,
            color: colour.ink,
            textAlign: "center",
          },
        ]}
      />
    </View>
  )
}
