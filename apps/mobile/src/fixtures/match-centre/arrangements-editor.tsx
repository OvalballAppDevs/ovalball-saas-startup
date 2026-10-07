import { useEffect, useState } from "react"
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  PROVISIONAL_ROOM_NUMBERS,
  readFixtureFacilityOptions,
  setFixtureFacilities,
  type FixtureFacilitiesPatch,
  type FixtureFacilityOptions,
} from "@ovalball/contracts/match-centre/facilities"
import { venueChangingRoomTypeLabel, type VenueChangingRoom } from "@ovalball/contracts/club/venues"

import { supabase } from "../../auth/supabase"
import { ChoiceSheet } from "../../components/field-sheet"
import { Button, CardSkeleton } from "../../components/ui"
import { ChevronRight } from "../../components/icons"
import { friendly } from "../../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import type { MatchCentreView } from "../../match-centre/load"

/**
 * CHANGING ROOMS AND CATERING -- which room each side uses, anything they need on arrival, and whether
 * the host is catering. One save through `set_fixture_facilities`.
 *
 * A HOST ON OVALBALL offers its own rooms at the chosen ground, and the match references them; nobody
 * types a room into another club's records. A HOST THAT IS NOT offers nothing to pick, so the rooms are
 * numbered 1-20 for this match -- or the ground has none at all, which is said plainly rather than left
 * looking unfinished.
 */
export function ArrangementsEditor({ view, onClose, onSaved }: { view: MatchCentreView; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets()
  const [options, setOptions] = useState<FixtureFacilityOptions | null>(null)
  const [homeRoom, setHomeRoom] = useState<string | null>(view.homeRoom?.id ?? null)
  const [awayRoom, setAwayRoom] = useState<string | null>(view.awayRoom?.id ?? null)
  const [officialsRoom, setOfficialsRoom] = useState<string | null>(view.officialsRoom?.id ?? null)
  const [homeNumber, setHomeNumber] = useState<number | null>(view.homeRoomNumber)
  const [awayNumber, setAwayNumber] = useState<number | null>(view.awayRoomNumber)
  const [none, setNone] = useState(view.noChangingRooms)
  const [notes, setNotes] = useState(view.changingRoomNotes ?? "")
  const [catering, setCatering] = useState(view.cateringRequired)
  const [picker, setPicker] = useState<null | "home" | "away" | "officials">(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void readFixtureFacilityOptions(supabase, view.fixtureId)
      .then((o) => live && setOptions(o))
      .catch((caught) => live && setProblem(friendly(caught, "the changing rooms").message))
    return () => {
      live = false
    }
  }, [view.fixtureId])

  const mode = options?.mode ?? view.facilityMode
  const rooms = (options?.rooms ?? []).filter((r) => r.venueId === view.venue.id)
  const canonicalBlocked = mode === "CANONICAL" && (!view.venue.id || rooms.length === 0)

  async function save() {
    setSaving(true)
    setProblem(null)
    const patch: FixtureFacilitiesPatch = { no_changing_rooms: none, changing_room_notes: notes.trim(), catering_required: catering }
    if (!none && mode === "CANONICAL") Object.assign(patch, { home_room_id: homeRoom, away_room_id: awayRoom, officials_room_id: officialsRoom })
    if (!none && mode === "PROVISIONAL") Object.assign(patch, { home_room_number: homeNumber, away_room_number: awayNumber })
    try {
      await setFixtureFacilities(supabase, view.fixtureId, patch)
    } catch (caught) {
      setSaving(false)
      setProblem(friendly(caught, "these arrangements").message)
      return
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? "Not set"
  const numberName = (n: number | null) => (n ? `Room ${n}` : "Not set")

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Changing Rooms & Catering</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close without saving" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {!options && !problem && <CardSkeleton lines={3} />}

          {mode === "UNDECIDED" && <Text style={[type.small, { color: colour.inkMuted }]}>Agree home or away first — the changing rooms are the home club's.</Text>}

          {mode !== "UNDECIDED" && !!options && (
            <>
              <ToggleRow
                title="No Changing Rooms Available"
                detail="The ground has no changing rooms for this match. Both sides are told to arrive changed."
                value={none}
                onChange={setNone}
              />

              {!none && mode === "CANONICAL" && (
                <>
                  {!view.venue.id && <Text style={[type.small, { color: colour.inkMuted }]}>Choose the venue in Match Details before allocating changing rooms.</Text>}
                  {!!view.venue.id && rooms.length === 0 && (
                    <Text style={[type.small, { color: colour.inkMuted }]}>
                      {options.hostIsOwning
                        ? "This ground has no changing rooms recorded. Add them with the ground in Grounds & Pitches."
                        : `${options.hostClubName ?? "The home club"} has no changing rooms recorded at this ground.`}
                    </Text>
                  )}
                  <Field label={`Home Changing Room · ${view.home.clubName}`}>
                    <Trigger label={roomName(homeRoom)} disabled={canonicalBlocked} onPress={() => setPicker("home")} />
                  </Field>
                  <Field label={`Away Changing Room · ${view.away.clubName}`}>
                    <Trigger label={roomName(awayRoom)} disabled={canonicalBlocked} onPress={() => setPicker("away")} />
                  </Field>
                  <Field label="Officials Room">
                    <Trigger label={roomName(officialsRoom)} disabled={canonicalBlocked} onPress={() => setPicker("officials")} />
                  </Field>
                </>
              )}

              {!none && mode === "PROVISIONAL" && (
                <>
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    {(options.hostClubName ?? "The home club")} isn't on Ovalball, so its rooms are numbered for this match.
                  </Text>
                  <Field label={`Home Changing Room · ${view.home.clubName}`}>
                    <Trigger label={numberName(homeNumber)} onPress={() => setPicker("home")} />
                  </Field>
                  <Field label={`Away Changing Room · ${view.away.clubName}`}>
                    <Trigger label={numberName(awayNumber)} onPress={() => setPicker("away")} />
                  </Field>
                </>
              )}

              <Field label="Arrival Notes">
                <TextInput
                  accessibilityLabel="Arrival notes"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Use the side door by the car park."
                  placeholderTextColor={colour.inkSubtle}
                  multiline
                  maxLength={500}
                  style={[type.body, { minHeight: 80, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlignVertical: "top" }]}
                />
              </Field>
            </>
          )}

          <ToggleRow
            title="Catering Required"
            detail="The headcount comes from the players marked Attending on each Ovalball side."
            value={catering}
            onChange={setCatering}
          />
          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button label="Save Changes" busy={saving} disabled={!options} onPress={() => void save()} />
        </ScrollView>

        {mode === "CANONICAL" && (
          <ChoiceSheet
            visible={picker !== null}
            title={picker === "home" ? "Home Changing Room" : picker === "officials" ? "Officials Room" : "Away Changing Room"}
            hint="Rooms at this ground."
            // The sheet offers its own "Not set" first, which is how a room is un-allocated.
            options={rooms.map((r) => ({ id: r.id, name: r.name, detail: r.roomType ? venueChangingRoomTypeLabel(r.roomType as VenueChangingRoom["roomType"]) : null }))}
            value={(picker === "home" ? homeRoom : picker === "officials" ? officialsRoom : awayRoom) ?? ""}
            emptyMessage="No rooms recorded."
            onClose={() => setPicker(null)}
            saving={false}
            problem={null}
            onSave={(next) => {
              const value = next ? next : null
              if (picker === "home") setHomeRoom(value)
              else if (picker === "officials") setOfficialsRoom(value)
              else setAwayRoom(value)
              setPicker(null)
            }}
          />
        )}
        {mode === "PROVISIONAL" && (
          <NumberSheet
            visible={picker !== null}
            title={picker === "home" ? "Home Changing Room" : "Away Changing Room"}
            value={picker === "home" ? homeNumber : awayNumber}
            taken={picker === "home" ? awayNumber : homeNumber}
            onClose={() => setPicker(null)}
            onChoose={(n) => {
              if (picker === "home") setHomeNumber(n)
              else setAwayNumber(n)
              setPicker(null)
            }}
          />
        )}
      </View>
    </Modal>
  )
}

/** Rooms 1-20 in a compact grid; the other side's room is marked, not forbidden -- some grounds share. */
function NumberSheet({
  visible,
  title,
  value,
  taken,
  onClose,
  onChoose,
}: {
  visible: boolean
  title: string
  value: number | null
  taken: number | null
  onClose: () => void
  onChoose: (n: number | null) => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk, paddingBottom: insets.bottom + space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <View style={{ padding: space.lg, gap: space.md }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {PROVISIONAL_ROOM_NUMBERS.map((n) => {
              const selected = n === value
              const other = n === taken
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Room ${n}${other ? ", the other side's room" : ""}`}
                  onPress={() => onChoose(n)}
                  style={({ pressed }) => ({
                    width: "18%",
                    minHeight: TOUCH_TARGET,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colour.forest800 : colour.lineStrong,
                    backgroundColor: selected ? colour.mint100 : colour.surface,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={[type.bodyMedium, { color: selected ? colour.forest800 : colour.ink }]}>{n}</Text>
                  {other && <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, lineHeight: 12 }]}>Other side</Text>}
                </Pressable>
              )
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChoose(null)}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={[type.smallMedium, { color: colour.ink }]}>Not Set</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function ToggleRow({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{detail}</Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} />
    </View>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      {children}
    </View>
  )
}

function Trigger({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}
    >
      <Text style={[type.body, { color: colour.ink, flex: 1 }]} numberOfLines={1}>{label}</Text>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
