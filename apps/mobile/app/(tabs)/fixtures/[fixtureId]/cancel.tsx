import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { loadFixtureDetail, type FixtureDetail } from "../../../../src/agenda/fixture-detail"
import { cancelFixture } from "../../../../src/agenda/mutations"
import { exactDate } from "../../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ChevronRight } from "../../../../src/components/icons"
import { CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * CANCELLING A FIXTURE, WHICH IS NOT DELETING ONE.
 *
 * The row stays. It stays cancelled, with a reason, visible to both clubs and to every family who had
 * already put it in a diary -- because a match that disappears is a match somebody turns up for.
 * Deleting is a club-scoped capability this screen does not have and does not offer.
 *
 * THE REASON IS REQUIRED BY THE DATABASE, not by this form. `cancel_fixture` refuses an empty one, and
 * it is right to: the cancellation reaches the other side and the players, and "Cancelled" on its own
 * is the message nobody can act on. Asking here simply means the refusal happens before the round trip.
 *
 * IT IS A TWO-STEP, DELIBERATELY. Typing a sentence is the confirmation -- a dialogue box asking "are
 * you sure" after a one-tap button is a reflex people learn to dismiss, whereas writing "waterlogged,
 * pitch inspection failed" is a moment of thought that also produces something useful.
 *
 * AND IT CANCELS BOTH SIDES. `cancel_fixture` writes the mirror row too, so the opposing club is not
 * left holding a fixture that is not happening. Nothing here has to know that; it is worth knowing that
 * nothing here could have done it.
 */
export default function CancelFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!id || !sessionContext) return
    try {
      const teams = new Set(sessionContext.teamPermissions.map((t) => t.teamId))
      setFixture(await loadFixtureDetail(supabase, id, teams))
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("cancel fixture", failure)
      setProblem(failure.message)
    }
  }, [id, sessionContext])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (saving) return
    setSaving(true)
    setProblem(null)
    const result = await cancelFixture(supabase, id, reason)
    setSaving(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    // Back to the fixture, which now says it is cancelled and why -- rather than to a confirmation
    // screen that would have to say the same thing again.
    router.back()
  }

  const ready = reason.trim().length > 0 && !saving

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <Header title="Cancel Fixture" onBack={() => router.back()} insets={insets} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} onRetry={load} />}
        {!fixture && !problem && <CardSkeleton lines={2} />}

        {!!fixture && (
          <>
            <View style={{ padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>
                {fixture.us.teamName ?? fixture.us.clubName} {fixture.homeAway === "Away" ? "at" : "v"}{" "}
                {fixture.them.teamName ?? fixture.them.clubName}
              </Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {exactDate(fixture.date)}
                {fixture.kickoff ? ` · ${fixture.kickoff}` : ""}
              </Text>
            </View>

            <View style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Why Is It Cancelled?</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                The other club and everyone who was going to play will see this.
              </Text>
              <TextInput
                accessibilityLabel="Why the fixture is cancelled"
                value={reason}
                onChangeText={setReason}
                placeholder="Waterlogged pitch, failed inspection"
                placeholderTextColor={colour.inkSubtle}
                multiline
                selectionColor={colour.pitch600}
                style={[
                  type.body,
                  {
                    minHeight: 96,
                    padding: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colour.lineStrong,
                    backgroundColor: colour.surface,
                    color: colour.ink,
                    textAlignVertical: "top",
                  },
                ]}
              />
            </View>

            <Text style={[type.caption, { color: colour.inkMuted }]}>
              The fixture stays in the calendar, marked cancelled, so nobody turns up for a match that is
              not happening. It is not deleted.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel this fixture"
              accessibilityState={{ disabled: !ready, busy: saving }}
              disabled={!ready}
              onPress={() => void submit()}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: ready ? colour.danger : colour.lineStrong,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              {saving ? (
                <ActivityIndicator color={colour.onForest} />
              ) : (
                <Text style={[type.smallMedium, { color: colour.onForest }]}>Cancel Fixture</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Header({ title, onBack, insets }: { title: string; onBack: () => void; insets: { top: number } }) {
  return (
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
        accessibilityLabel="Back to the fixture"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
        {title}
      </Text>
    </View>
  )
}
