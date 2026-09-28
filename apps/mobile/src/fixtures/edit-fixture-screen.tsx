import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import {
  loadFixtureDetail,
  loadPitchOptions,
  loadVenueOptions,
  type FixtureDetail,
  type PitchOption,
  type VenueOption,
} from "../agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../agenda/authority"
import { updateDetails, updateKickoff, updateMeetTime, updateVenue, type MutationResult } from "../agenda/mutations"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { ClubCrest } from "../components/identity"
import { Field, DateField, TimeField, ChoiceField, TextField } from "../components/form"
import { ChoiceSheet } from "../components/field-sheet"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { ChevronRight } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * EDIT FIXTURE (owner decision: Fixture Detail / Edit Fixture / Match Centre are now separate
 * destinations) -- a deliberate mutation form, ending in ONE "Save Changes". Reuses the exact same
 * canonical reads and mutations `FixtureConsole` used (`loadFixtureDetail`, `update_fixture_*` via
 * `agenda/mutations`) -- no new fixture model, no broadened authority, no silent mutation on Back.
 *
 * PER-FIELD AUTHORITY IS STILL THE SERVER'S. `fixture.fixture.edit` gets you onto this screen at all;
 * `fixture.editable.*` decides which fields actually respond here, with the server's own reason shown
 * where one does not. Pitch allocation and result recording remain their own, untouched authorities.
 */
export function EditFixtureScreen() {
  const router = useRouter()
  const { active } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [pitches, setPitches] = useState<PitchOption[]>([])
  const [picker, setPicker] = useState<null | "venue" | "pitch">(null)

  // FORM STATE, initialised from the loaded fixture once and only once -- edited locally from there,
  // never mutated until Save Changes is pressed.
  const [date, setDate] = useState<string | null>(null)
  const [kickoff, setKickoff] = useState<string | null>(null)
  const [meetTime, setMeetTime] = useState<string | null>(null)
  const [homeAway, setHomeAway] = useState<"Home" | "Away" | "TBD">("TBD")
  const [venueId, setVenueId] = useState<string | null>(null)
  const [pitchId, setPitchId] = useState<string | null>(null)
  const [pitchText, setPitchText] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadFixtureDetail(supabase, id, new Set())
      if (!loaded) {
        setProblem("This fixture couldn't be found.")
        return
      }
      setFixture(loaded)
      setDate(loaded.date)
      setKickoff(loaded.kickoff)
      setMeetTime(loaded.meetTime)
      setHomeAway(loaded.homeAway === "Home" || loaded.homeAway === "Away" ? loaded.homeAway : "TBD")
      setVenueId(loaded.venueId)
      setPitchId(loaded.pitchId)
      setPitchText(loaded.pitchId ? "" : (loaded.pitch ?? ""))
      setNotes(loaded.notes ?? "")
      const [venueOptions, pitchOptions] = await Promise.all([
        loadVenueOptions(supabase, loaded.homeClubId ?? loaded.clubId),
        loadPitchOptions(supabase, loaded.clubId, loaded.venueId),
      ])
      setVenues(venueOptions)
      setPitches(pitchOptions)
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("edit fixture", failure)
      setProblem(failure.message)
    }
  }, [id])

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

  const cancelled = fixture?.status === "Cancelled"
  const canEditSchedule = Boolean(authority?.edit) && !cancelled && (fixture?.editable.schedule?.editable ?? false)
  const canEditMeet = Boolean(authority?.edit) && !cancelled && (fixture?.editable.meetTime?.editable ?? false)
  const canEditVenue = Boolean(authority?.edit) && !cancelled && (fixture?.editable.venue?.editable ?? false)
  const canEditDetails = Boolean(authority?.edit) && !cancelled && (fixture?.editable.details?.editable ?? false)
  const canEditOrientation = Boolean(authority?.edit) && !cancelled && (fixture?.editable.homeAway?.editable ?? false)
  const namedPitch = homeAway === "Home"

  const dirty = useMemo(() => {
    if (!fixture) return false
    return (
      date !== fixture.date ||
      kickoff !== fixture.kickoff ||
      meetTime !== fixture.meetTime ||
      homeAway !== (fixture.homeAway === "Home" || fixture.homeAway === "Away" ? fixture.homeAway : "TBD") ||
      venueId !== fixture.venueId ||
      pitchId !== fixture.pitchId ||
      pitchText !== (fixture.pitchId ? "" : (fixture.pitch ?? "")) ||
      notes !== (fixture.notes ?? "")
    )
  }, [fixture, date, kickoff, meetTime, homeAway, venueId, pitchId, pitchText, notes])

  async function save() {
    if (!fixture || saving || !dirty) return
    setSaving(true)
    setSaveError(null)

    // ONE COMMITTED CHANGE AT A TIME, in the order that keeps them consistent with each other: home/away
    // and notes first (a home/away change clears the ground and pitch server-side), then the ground
    // and pitch this form's own choice should stand regardless, then the schedule, then the meet time.
    const steps: (() => Promise<MutationResult>)[] = []

    const detailsPatch: Record<string, string | null> = {}
    if (homeAway !== (fixture.homeAway === "Home" || fixture.homeAway === "Away" ? fixture.homeAway : "TBD")) detailsPatch.home_away = homeAway
    if (notes !== (fixture.notes ?? "")) detailsPatch.notes = notes.trim() || null
    if (Object.keys(detailsPatch).length > 0) steps.push(() => updateDetails(supabase, id, detailsPatch))

    // VENUE AND PITCH GO THROUGH THE ONE CALL, whichever of the two actually changed: `updateVenue`
    // (`update_fixture_schedule`) already carries the pitch as part of the same write, so a pitch-only
    // change (the venue staying the same) still goes through here rather than a separate `updatePitch`
    // call -- one RPC, one consistent result, never two writes racing each other.
    if (venueId !== fixture.venueId || pitchId !== fixture.pitchId || pitchText !== (fixture.pitchId ? "" : (fixture.pitch ?? ""))) {
      steps.push(() =>
        updateVenue(supabase, id, venueId, {
          kickoffDate: date ?? fixture.date,
          kickoffTime: kickoff,
          pitchId: namedPitch ? pitchId : null,
          pitchText: namedPitch ? null : pitchText,
        })
      )
    }

    if (date !== fixture.date || kickoff !== fixture.kickoff) steps.push(() => updateKickoff(supabase, id, { date: date ?? fixture.date, time: kickoff }))
    if (meetTime !== fixture.meetTime) steps.push(() => updateMeetTime(supabase, id, meetTime))

    for (const step of steps) {
      const result = await step()
      if (!result.ok) {
        setSaving(false)
        setSaveError(result.message)
        return
      }
    }
    setSaving(false)
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Edit Fixture" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg }} showsVerticalScrollIndicator={false}>
        {problem && <ErrorState message={problem} onRetry={load} />}
        {!problem && !fixture && (
          <>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={2} />
          </>
        )}

        {!!fixture && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ClubCrest clubName={fixture.us.clubName} url={fixture.us.crestUrl} size={32} />
              <ChevronRight size={16} color={colour.inkSubtle} />
              <ClubCrest clubName={fixture.them.clubName} url={fixture.them.crestUrl} size={32} />
              <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]} numberOfLines={1}>
                {fixture.us.clubName} v {fixture.them.clubName}
              </Text>
            </View>

            {cancelled && <ErrorState message="This fixture is cancelled and cannot be edited. Use Fixture Detail to see why." />}

            <Field label="Date" disabledReason={!canEditSchedule ? (fixture.editable.schedule?.editable === false ? fixture.editable.schedule.reason : "You can't change this fixture's schedule.") : undefined}>
              <DateField label="Date" value={date ?? fixture.date} onChange={setDate} />
            </Field>
            <Field label="Kick-off" disabledReason={!canEditSchedule ? (fixture.editable.schedule?.editable === false ? fixture.editable.schedule.reason : "You can't change this fixture's schedule.") : undefined}>
              <TimeField label="Kick-off" value={kickoff} onChange={setKickoff} />
            </Field>
            <Field label="Meet Time" hint="When the side is expected at the ground." disabledReason={!canEditMeet ? (fixture.editable.meetTime?.editable === false ? fixture.editable.meetTime.reason : "You can't change the meet time.") : undefined}>
              <TimeField label="Meet time" value={meetTime} onChange={setMeetTime} />
            </Field>
            <Field
              label="Home or Away"
              hint={fixture.opposition.onOvalball ? "Changing this clears the ground and the pitch, and tells the other club." : "Changing this clears the ground and the pitch."}
              disabledReason={!canEditOrientation ? (fixture.editable.homeAway?.editable === false ? fixture.editable.homeAway.reason : "You can't change home or away.") : undefined}
            >
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
            <Field label="Venue" disabledReason={!canEditVenue ? (fixture.editable.venue?.editable === false ? fixture.editable.venue.reason : "You can't change the ground.") : undefined}>
              <PickerTrigger label={venues.find((v) => v.id === venueId)?.name ?? "Not set"} onPress={() => setPicker("venue")} />
            </Field>
            <Field
              label="Pitch"
              hint={namedPitch ? undefined : "Away — the ground belongs to the other club, so the pitch is recorded as text."}
              disabledReason={!canEditVenue ? (fixture.editable.venue?.editable === false ? fixture.editable.venue.reason : "You can't change the pitch.") : undefined}
            >
              {namedPitch ? (
                <PickerTrigger label={pitches.find((p) => p.id === pitchId)?.name ?? "Not set"} onPress={() => setPicker("pitch")} />
              ) : (
                <TextField label="Pitch" value={pitchText} onChange={setPitchText} placeholder="Pitch 2" />
              )}
            </Field>
            <Field label="Notes" hint="Anything the side needs to know." disabledReason={!canEditDetails ? (fixture.editable.details?.editable === false ? fixture.editable.details.reason : "You can't change the notes.") : undefined}>
              <TextField label="Notes" value={notes} onChange={setNotes} placeholder="Meet at the clubhouse" multiline />
            </Field>

            {saveError && <Text style={[type.small, { color: colour.danger }]}>{saveError}</Text>}
            <Button label="Save Changes" busy={saving} disabled={!dirty} onPress={() => void save()} />

            <ChoiceSheet
              visible={picker === "venue"}
              title="Venue"
              hint={homeAway === "Away" ? "The home club's grounds." : "Your club's grounds."}
              options={venues.map((v) => ({ id: v.id, name: v.name, detail: v.town }))}
              value={venueId}
              emptyMessage={
                homeAway === "Away"
                  ? "The other club has no grounds on Ovalball, so this fixture's ground is written down as an address instead."
                  : "Your club has no grounds recorded in Ovalball yet. They are added in Club Admin on the web."
              }
              onClose={() => setPicker(null)}
              saving={false}
              problem={null}
              onSave={(next) => {
                setVenueId(next)
                setPicker(null)
              }}
            />
            <ChoiceSheet
              visible={picker === "pitch"}
              title="Pitch"
              hint="Playing areas at this ground."
              options={pitches.map((p) => ({ id: p.id, name: p.name }))}
              value={pitchId}
              emptyMessage={venueId ? "This ground has no playing areas recorded. They are added with the ground in Club Admin on the web." : "Choose a ground first — a pitch belongs to one."}
              onClose={() => setPicker(null)}
              saving={false}
              problem={null}
              onSave={(next) => {
                setPitchId(next)
                setPicker(null)
              }}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}

function PickerTrigger({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.lineStrong,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[type.body, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
