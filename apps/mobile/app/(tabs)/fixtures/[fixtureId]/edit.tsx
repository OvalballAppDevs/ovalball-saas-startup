import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { loadFixtureDetail, type FixtureDetail } from "../../../../src/agenda/fixture-detail"
import { updateDetails, updateMeetTime, updateSchedule } from "../../../../src/agenda/mutations"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ChoiceField, DateField, Field, SubmitButton, TextField, TimeField } from "../../../../src/components/form"
import { ChevronRight } from "../../../../src/components/icons"
import { CardSkeleton, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * EDITING ONE FIXTURE.
 *
 * PREPOPULATED FROM THE FIXTURE AS IT IS, and every field asks the server whether it may be changed at
 * all. `fixture_editable_fields` answers per fixture and per person -- an away side does not own the
 * pitch, a cancelled fixture is not rescheduled by editing it, only the owning club changes the
 * opposition -- and it returns the SENTENCE for each refusal, which is shown rather than paraphrased.
 *
 * WHAT IS SENT IS WHAT CHANGED. A patch of everything would write fields nobody touched, and on a
 * two-sided fixture every written field is mirrored to the other club -- so an untouched kick-off sent
 * back unchanged is still a change event the opposition sees. Only genuinely different values go.
 *
 * THE SCHEDULE MOVES AS ONE. Date, kick-off and ground travel together through
 * `update_fixture_schedule`, because a fixture that shifts day usually shifts ground, and three
 * separate writes give the other club three separate notifications for one decision.
 *
 * A STALE EDIT IS THE SERVER'S TO REFUSE. The RPC takes the row `for update` and re-checks authority
 * and status; if the fixture was cancelled while this screen was open, the save is refused with the
 * reason and the screen reloads rather than overwriting somebody else's decision.
 */
export default function EditFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [date, setDate] = useState("")
  const [time, setTime] = useState<string | null>(null)
  const [meetTime, setMeetTime] = useState<string | null>(null)
  const [homeAway, setHomeAway] = useState<"Home" | "Away" | "TBD" | "Not Applicable">("Home")
  const [status, setStatus] = useState("Booked")
  const [notes, setNotes] = useState("")

  const load = useCallback(async () => {
    if (!id || !sessionContext) return
    setProblem(null)
    try {
      const teams = new Set(sessionContext.teamPermissions.map((t) => t.teamId))
      const loaded = await loadFixtureDetail(supabase, id, teams)
      if (!loaded) {
        setProblem("This fixture isn't available.")
        return
      }
      setFixture(loaded)
      setDate(loaded.date)
      setTime(loaded.kickoff)
      setMeetTime(loaded.meetTime)
      setHomeAway(loaded.homeAway ?? "Home")
      setStatus(loaded.status ?? "Booked")
      setNotes(loaded.notes ?? "")
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("edit fixture", failure)
      setProblem(failure.message)
    }
  }, [id, sessionContext])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!fixture || saving) return
    setSaving(true)
    setProblem(null)

    // ONLY WHAT CHANGED. Each write is mirrored to the opposing club's row, so sending an untouched
    // value is a change event for a decision nobody made.
    const scheduleChanged = date !== fixture.date || time !== fixture.kickoff
    const detailPatch: Record<string, string | null> = {}
    if (homeAway !== fixture.homeAway) detailPatch.home_away = homeAway
    if (status !== fixture.status) detailPatch.status = status
    if ((notes.trim() || null) !== fixture.notes) detailPatch.notes = notes.trim() || null

    if (scheduleChanged) {
      const result = await updateSchedule(supabase, id, { kickoffDate: date, kickoffTime: time, venueId: null })
      if (!result.ok) {
        setSaving(false)
        setProblem(result.message)
        return
      }
    }
    if (meetTime !== fixture.meetTime) {
      const result = await updateMeetTime(supabase, id, meetTime)
      if (!result.ok) {
        setSaving(false)
        setProblem(result.message)
        return
      }
    }
    if (Object.keys(detailPatch).length > 0) {
      const result = await updateDetails(supabase, id, detailPatch)
      if (!result.ok) {
        setSaving(false)
        setProblem(result.message)
        return
      }
    }

    setSaving(false)
    router.back()
  }

  const dirty =
    !!fixture &&
    (date !== fixture.date ||
      time !== fixture.kickoff ||
      meetTime !== fixture.meetTime ||
      homeAway !== fixture.homeAway ||
      status !== fixture.status ||
      (notes.trim() || null) !== fixture.notes)

  const schedule = fixture?.editable.schedule
  const meet = fixture?.editable.meetTime
  const orientation = fixture?.editable.homeAway
  const details = fixture?.editable.details

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <Header
        title="Edit Fixture"
        subtitle={fixture ? `${fixture.us.teamName ?? fixture.us.clubName} v ${fixture.them.teamName ?? fixture.them.clubName}` : null}
        onBack={() => router.back()}
        insets={insets}
      />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} onRetry={load} />}
        {!fixture && !problem && (
          <>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </>
        )}

        {!!fixture && (
          <>
            <Field label="Date" disabledReason={schedule?.editable === false ? schedule.reason : null}>
              <DateField label="Fixture date" value={date} onChange={setDate} />
            </Field>

            <Field label="Kick-Off" disabledReason={schedule?.editable === false ? schedule.reason : null}>
              <TimeField label="Kick-off time" value={time} onChange={setTime} />
            </Field>

            <Field
              label="Meet Time"
              hint="When the side is expected at the ground. Optional."
              disabledReason={meet?.editable === false ? meet.reason : null}
            >
              <TimeField label="Meet time" value={meetTime} onChange={setMeetTime} />
            </Field>

            <Field label="Home or Away" disabledReason={orientation?.editable === false ? orientation.reason : null}>
              <ChoiceField
                label="Home or away"
                value={homeAway}
                onChange={setHomeAway}
                options={[
                  { value: "Home", label: "Home" },
                  { value: "Away", label: "Away" },
                  { value: "TBD", label: "Not agreed" },
                ]}
              />
            </Field>

            <Field
              label="Status"
              hint="To call a fixture off, use Cancel Fixture — the other side and the players are told why."
              disabledReason={details?.editable === false ? details.reason : null}
            >
              <ChoiceField
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "Booked", label: "Booked" },
                  { value: "Planned", label: "Planned" },
                  { value: "Completed", label: "Completed" },
                ]}
              />
            </Field>

            <Field label="Notes" disabledReason={details?.editable === false ? details.reason : null}>
              <TextField label="Notes" value={notes} onChange={setNotes} multiline placeholder="Meet at the clubhouse" />
            </Field>

            <SubmitButton label="Save Changes" onPress={() => void submit()} busy={saving} disabled={!dirty} />
            {!dirty && (
              <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
                Nothing has changed yet.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Header({
  title,
  subtitle,
  onBack,
  insets,
}: {
  title: string
  subtitle?: string | null
  onBack: () => void
  insets: { top: number }
}) {
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  )
}
