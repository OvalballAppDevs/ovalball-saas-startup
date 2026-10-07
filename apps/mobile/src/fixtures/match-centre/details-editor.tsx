import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { Image } from "expo-image"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readFixtureFacilityOptions, type FixtureFacilityOptions } from "@ovalball/contracts/match-centre/facilities"

import { supabase } from "../../auth/supabase"
import { useAppContexts } from "../../context/contexts"
import { loadFixtureDetail, type FixtureDetail } from "../../agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../../agenda/authority"
import { saveMatchDetails } from "../../agenda/mutations"
import { friendly, logDetail } from "../../errors/translate"
import { ClubCrest } from "../../components/identity"
import { Field, DateField, TimeField, ChoiceField, TextField } from "../../components/form"
import { ChoiceSheet } from "../../components/field-sheet"
import { Button, CardSkeleton, ErrorState } from "../../components/ui"
import { Check, ChevronRight, MapPin } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { hasOwnPicture, pitchPhoto, venuePhoto } from "./facility-images"

type HomeAway = "Home" | "Away" | "TBD"
const NOTES_LIMIT = 500

/**
 * EDIT MATCH DETAILS, IN THE MATCH CENTRE -- the former Edit Fixture screen, merged.
 *
 * THE GROUND IS THE HOST'S. Home or away decides whose ground it is, so changing it re-reads the
 * host's grounds and pitches straight away (`get_fixture_facility_options` with the unsaved choice):
 * a club on Ovalball offers its own records, and its default ground is preselected; a host that is not
 * on Ovalball starts from its Club Directory home ground and has its pitch written down. Nothing from
 * the other club's ground survives the switch -- the server clears it too, on both rows of the match.
 *
 * PER-FIELD AUTHORITY IS STILL THE SERVER'S. `fixture.fixture.edit` gets you the sheet; the server's
 * own reason is shown on a field that does not respond, and every save is re-checked.
 */
export function MatchDetailsEditor({ fixtureId, onClose, onSaved }: { fixtureId: string; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets()
  const { active } = useAppContexts()
  const id = fixtureId

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<FixtureFacilityOptions | null>(null)
  const [options, setOptions] = useState<FixtureFacilityOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [picker, setPicker] = useState<null | "venue" | "pitch">(null)

  // FORM STATE, initialised from the loaded fixture once -- edited locally, never written until Save Changes.
  const [date, setDate] = useState<string | null>(null)
  const [kickoff, setKickoff] = useState<string | null>(null)
  const [meetTime, setMeetTime] = useState<string | null>(null)
  const [homeAway, setHomeAway] = useState<HomeAway>("TBD")
  const [venueId, setVenueId] = useState<string | null>(null)
  const [venueText, setVenueText] = useState("")
  const [pitchId, setPitchId] = useState<string | null>(null)
  const [pitchText, setPitchText] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const request = useRef(0)

  const savedHomeAway = (f: FixtureDetail): HomeAway => (f.homeAway === "Home" || f.homeAway === "Away" ? f.homeAway : "TBD")
  /*
    WHAT THE MATCH CENTRE ALREADY SHOWS is where the form starts: a fixture with no ground chosen is read
    at the host's default ground (or, for a host not on Ovalball, its Club Directory ground), so the
    editor starts there too rather than at a blank that contradicts the page behind it.
  */
  const baseVenueId = (f: FixtureDetail, o: FixtureFacilityOptions | null) => f.venueId ?? (o?.mode === "CANONICAL" ? o.defaultVenueId : null)
  const baseVenueText = (f: FixtureDetail, o: FixtureFacilityOptions | null) =>
    f.venueId ? "" : (f.venueAddress ?? (o?.mode === "PROVISIONAL" ? groundLine(o.provisionalGround) : ""))

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadFixtureDetail(supabase, id, new Set())
      if (!loaded) {
        setProblem("This fixture couldn't be found.")
        return
      }
      const facilityOptions = await readFixtureFacilityOptions(supabase, id)
      setFixture(loaded)
      setSaved(facilityOptions)
      setOptions(facilityOptions)
      setDate(loaded.date)
      setKickoff(loaded.kickoff)
      setMeetTime(loaded.meetTime)
      setHomeAway(savedHomeAway(loaded))
      setVenueId(baseVenueId(loaded, facilityOptions))
      setVenueText(baseVenueText(loaded, facilityOptions))
      setPitchId(loaded.pitchId)
      setPitchText(loaded.pitchId ? "" : (loaded.pitch ?? ""))
      setNotes(loaded.notes ?? "")
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("edit match details", failure)
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

  /*
    HOME OR AWAY, RE-RESOLVED BEFORE SAVING. Back to the saved answer restores what was saved; anything
    else asks the server whose ground it would be and starts from that host's default.
  */
  async function chooseHomeAway(next: HomeAway) {
    if (!fixture || next === homeAway) return
    setHomeAway(next)
    const ticket = ++request.current
    if (next === savedHomeAway(fixture)) {
      setOptions(saved)
      setVenueId(baseVenueId(fixture, saved))
      setVenueText(baseVenueText(fixture, saved))
      setPitchId(fixture.pitchId)
      setPitchText(fixture.pitchId ? "" : (fixture.pitch ?? ""))
      return
    }
    setOptionsLoading(true)
    setVenueId(null)
    setVenueText("")
    setPitchId(null)
    setPitchText("")
    try {
      const resolved = await readFixtureFacilityOptions(supabase, id, next)
      if (ticket !== request.current) return
      setOptions(resolved)
      if (resolved.mode === "CANONICAL") setVenueId(resolved.defaultVenueId)
      if (resolved.mode === "PROVISIONAL") setVenueText(groundLine(resolved.provisionalGround))
    } catch (caught) {
      if (ticket === request.current) setSaveError(friendly(caught, "the host's grounds").message)
    } finally {
      if (ticket === request.current) setOptionsLoading(false)
    }
  }

  const cancelled = fixture?.status === "Cancelled"
  const reasonFor = (key: "schedule" | "meetTime" | "details" | "homeAway", fallback: string) => {
    const field = fixture?.editable[key]
    if (!authority?.edit) return fallback
    if (cancelled) return "This fixture is cancelled."
    return field?.editable === false ? field.reason : null
  }
  const scheduleReason = reasonFor("schedule", "You can't change this fixture's schedule.")
  const meetReason = reasonFor("meetTime", "You can't change the meet time.")
  const detailsReason = reasonFor("details", "You can't change the notes.")
  const orientationReason = reasonFor("homeAway", "You can't change home or away.")
  // The ground and pitch go through `set_fixture_facilities`, which asks the same schedule authority.
  const venueReason = scheduleReason

  const mode = options?.mode ?? "UNDECIDED"
  const venue = options?.venues.find((v) => v.id === venueId) ?? null
  const pitchesHere = (options?.pitches ?? []).filter((p) => !venueId || p.venueId === null || p.venueId === venueId)
  const pitch = options?.pitches.find((p) => p.id === pitchId) ?? null

  const savedVenueId = fixture ? baseVenueId(fixture, saved) : null
  const savedVenueText = fixture ? baseVenueText(fixture, saved) : ""
  const savedPitchText = fixture?.pitchId ? "" : (fixture?.pitch ?? "")
  const whereChanged =
    !!fixture &&
    (homeAway !== savedHomeAway(fixture) || venueId !== savedVenueId || pitchId !== fixture.pitchId || venueText !== savedVenueText || pitchText !== savedPitchText)

  const dirty = useMemo(() => {
    if (!fixture) return false
    return (
      date !== fixture.date ||
      kickoff !== fixture.kickoff ||
      meetTime !== fixture.meetTime ||
      notes !== (fixture.notes ?? "") ||
      whereChanged
    )
  }, [fixture, date, kickoff, meetTime, notes, whereChanged])

  async function save() {
    if (!fixture || saving || !dirty || optionsLoading) return
    setSaving(true)
    setSaveError(null)

    // ONE SAVE, ONE TRANSACTION, ONE NOTICE PER PERSON (`save_match_details`): the same governed writers in the
    // same order -- home or away and the notes first (a host change re-resolves the ground server-side), then
    // the schedule and the meet time, then the ground and pitch this form chose -- but all of it or none of
    // it, and each person the changes affect told once rather than once per writer.
    const detailsPatch: Record<string, string | null> = {}
    if (homeAway !== savedHomeAway(fixture)) detailsPatch.home_away = homeAway
    if (notes !== (fixture.notes ?? "")) detailsPatch.notes = notes.trim() || null
    const result = await saveMatchDetails(supabase, id, {
      details: detailsPatch,
      kickoff: date !== fixture.date || kickoff !== fixture.kickoff ? { date: date ?? fixture.date, time: kickoff } : undefined,
      meetTime: meetTime !== fixture.meetTime ? meetTime : undefined,
      facilities:
        whereChanged && mode !== "UNDECIDED"
          ? mode === "CANONICAL"
            ? { venue_id: venueId, pitch_id: pitchId }
            : { venue_text: venueText.trim() || null, pitch_text: pitchText.trim() || null }
          : undefined,
    })
    if (!result.ok) {
      setSaving(false)
      setSaveError(result.message)
      return
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Edit Match Details</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close without saving" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
                <ClubCrest clubName={fixture.us.clubName} url={fixture.us.crestUrl} size={30} />
                <ChevronRight size={15} color={colour.inkSubtle} />
                <ClubCrest clubName={fixture.them.clubName} url={fixture.them.crestUrl} size={30} />
                <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]} numberOfLines={1}>
                  {fixture.us.clubName} v {fixture.them.clubName}
                </Text>
              </View>

              {cancelled && <ErrorState message="This fixture is cancelled and cannot be edited." />}
                <Field label="Date" disabledReason={scheduleReason}>
                  <DateField label="Date" value={date ?? fixture.date} onChange={setDate} />
                </Field>
                <Field label="Meet Time" hint={meetTime ? "When the side is expected at the ground." : "Not set. Choose when the side is expected at the ground."} disabledReason={meetReason}>
                  <TimeField label="Meet Time" value={meetTime} onChange={setMeetTime} />
                </Field>
                <Field label="Kick-off Time" hint={kickoff ? undefined : "Not set."} disabledReason={scheduleReason}>
                  <TimeField label="Kick-off Time" value={kickoff} onChange={setKickoff} />
                </Field>

              <Field
                label="Home or Away"
                hint={
                  fixture.opposition.onOvalball
                    ? "The ground is the home club's. Changing this moves the match to their ground and tells the other club."
                    : "The ground is the home club's. Changing this moves the match to their ground."
                }
                disabledReason={orientationReason}
              >
                <ChoiceField
                  label="Home or Away"
                  value={homeAway}
                  onChange={(next) => void chooseHomeAway(next)}
                  options={[
                    { value: "Home", label: "Home" },
                    { value: "Away", label: "Away" },
                    { value: "TBD", label: "Not agreed" },
                  ]}
                />
              </Field>
                <Field label="Venue" hint={venueHint(options, homeAway)} disabledReason={venueReason}>
                  {optionsLoading ? (
                    <CardSkeleton lines={1} />
                  ) : mode === "CANONICAL" ? (
                    <VenueTrigger
                      name={venue?.name ?? "Choose a ground"}
                      address={venue ? [venue.address, venue.postcode].filter(Boolean).join(", ") : null}
                      photo={venue && hasOwnPicture(venue) ? venuePhoto(venue, venue.id) : null}
                      onPress={() => setPicker("venue")}
                    />
                  ) : mode === "PROVISIONAL" ? (
                    <View style={{ gap: space.sm }}>
                      <TextField label="Venue" value={venueText} onChange={setVenueText} placeholder="Ground name and address" />
                    </View>
                  ) : (
                    <Text style={[type.small, { color: colour.inkMuted }]}>Agree home or away first — the ground is the home club's.</Text>
                  )}
                </Field>

              {mode !== "UNDECIDED" && !optionsLoading && (
                  <Field
                    label="Pitch"
                    hint={mode === "PROVISIONAL" ? "Written for this match, as the host names it." : undefined}
                    disabledReason={venueReason}
                  >
                    {mode === "CANONICAL" ? (
                      <VenueTrigger
                        name={pitch?.name ?? "Not set"}
                        address={pitch?.description ?? null}
                        photo={pitch && hasOwnPicture(pitch) ? pitchPhoto(pitch, pitch.id) : null}
                        onPress={() => setPicker("pitch")}
                      />
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                        <Image source={pitchPhoto(null, id)} style={{ width: 56, height: TOUCH_TARGET, borderRadius: radius.sm }} contentFit="cover" accessible={false} />
                        <View style={{ flex: 1 }}>
                          <TextField label="Pitch" value={pitchText} onChange={setPitchText} placeholder="Pitch 1" />
                        </View>
                      </View>
                    )}
                  </Field>
                )}
                <Field label="Fixture Notes" disabledReason={detailsReason}>
                  <TextInput
                    accessibilityLabel="Fixture notes"
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Meet at the clubhouse. Bring boots, water bottle and a warm jacket."
                    placeholderTextColor={colour.inkSubtle}
                    multiline
                    maxLength={NOTES_LIMIT}
                    style={[type.body, { minHeight: 88, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlignVertical: "top" }]}
                  />
                  <Text style={[type.caption, { color: colour.inkSubtle, alignSelf: "flex-end" }]}>
                    {notes.length}/{NOTES_LIMIT}
                  </Text>
                </Field>

              {saveError && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{saveError}</Text>}
              <Button label="Save Changes" busy={saving} disabled={!dirty || optionsLoading} onPress={() => void save()} />

              <VenueSheet
                visible={picker === "venue"}
                options={options}
                value={venueId}
                onClose={() => setPicker(null)}
                onChoose={(next) => {
                  setVenueId(next)
                  // A pitch at another ground no longer fits.
                  const current = options?.pitches.find((p) => p.id === pitchId)
                  if (current && current.venueId && current.venueId !== next) setPitchId(null)
                  setPicker(null)
                }}
              />
              <ChoiceSheet
                visible={picker === "pitch"}
                title="Pitch"
                hint={venue ? `Playing areas at ${venue.name}.` : "Playing areas at this ground."}
                options={pitchesHere.map((p) => ({ id: p.id, name: p.name, detail: p.description }))}
                value={pitchId}
                emptyMessage={venueId ? "This ground has no pitches recorded. The host club adds them in Grounds & Pitches." : "Choose a ground first — a pitch belongs to one."}
                onClose={() => setPicker(null)}
                saving={false}
                problem={null}
                onSave={(next) => {
                  setPitchId(next || null)
                  setPicker(null)
                }}
              />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

function groundLine(ground: FixtureFacilityOptions["provisionalGround"]): string {
  if (!ground) return ""
  return [ground.name, ground.address, ground.postcode].filter(Boolean).join(", ")
}

function venueHint(options: FixtureFacilityOptions | null, homeAway: HomeAway): string | undefined {
  if (!options || options.mode === "UNDECIDED") return undefined
  const host = options.hostClubName ?? (homeAway === "Home" ? "your club" : "the home club")
  if (options.mode === "CANONICAL") return options.hostIsOwning ? "Your club's grounds." : `${host}'s grounds on Ovalball.`
  return `${host} isn't on Ovalball, so the ground is written for this match, starting from their Club Directory home ground.`
}


function VenueTrigger({ name, address, photo, onPress }: { name: string; address: string | null; photo: { uri: string } | number | null; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. Change`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.sm,
        paddingHorizontal: photo ? space.sm : space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.lineStrong,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {photo ? (
        <Image source={photo} style={{ width: 64, height: 44, borderRadius: radius.sm }} contentFit="cover" accessible={false} />
      ) : (
        <MapPin size={18} color={colour.inkSubtle} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: colour.ink }]} numberOfLines={1}>{name}</Text>
        {!!address && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>{address}</Text>}
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

/** The host's grounds, each with its own picture and address -- a ground is recognised by sight. */
function VenueSheet({
  visible,
  options,
  value,
  onClose,
  onChoose,
}: {
  visible: boolean
  options: FixtureFacilityOptions | null
  value: string | null
  onClose: () => void
  onChoose: (venueId: string) => void
}) {
  const insets = useSafeAreaInsets()
  const venues = options?.venues ?? []
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Venue</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.sm }}>
          {!!options?.hostClubName && <Text style={[type.small, { color: colour.inkMuted }]}>{options.hostClubName}'s grounds.</Text>}
          {venues.length === 0 && (
            <Text style={[type.small, { color: colour.inkMuted }]}>
              {options?.hostIsOwning ? "Your club has no grounds recorded yet. Add them in Grounds & Pitches." : "The home club has no grounds recorded on Ovalball yet."}
            </Text>
          )}
          {venues.map((v) => {
            const selected = v.id === value
            return (
              <Pressable
                key={v.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${v.name}${v.isDefault ? ", home ground" : ""}`}
                onPress={() => onChoose(v.id)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: selected ? colour.forest800 : colour.line,
                  backgroundColor: selected ? colour.mint100 : colour.surface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                {hasOwnPicture(v) ? (
                  <Image source={venuePhoto(v, v.id)} style={{ width: 72, height: 52, borderRadius: radius.sm }} contentFit="cover" accessible={false} />
                ) : (
                  // No picture of its own: a plain tile, not a stock photo that could pass for the ground.
                  <View style={{ width: 72, height: 52, borderRadius: radius.sm, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line, alignItems: "center", justifyContent: "center" }}>
                    <MapPin size={20} color={colour.forest800} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>{v.name}</Text>
                  {!!(v.address || v.postcode) && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>{[v.address, v.postcode].filter(Boolean).join(", ")}</Text>}
                  {v.isDefault && <Text style={[type.caption, { color: colour.forest800 }]}>Home ground</Text>}
                </View>
                {selected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  )
}
