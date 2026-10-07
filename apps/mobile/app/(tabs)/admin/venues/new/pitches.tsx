import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Image } from "expo-image"

import { useCreateVenueDraft } from "../../../../../src/venue/create-venue-context"
import { canProceedFromPitches, pitchSummaryLabel, type PitchDraft } from "../../../../../src/venue/create-venue-logic"
import { PitchEditorSheet } from "../../../../../src/venue/pitch-editor-sheet"
import { AddVenueHeader, WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { ChevronRight, Plus } from "../../../../../src/components/icons"
import { colour, radius, space, type } from "../../../../../src/design/tokens"
import { coverPhotoSource, fallbackAsset } from "../../../../../src/media/stock-assets"


/** ADD VENUE -- STEP 2: ADD PITCHES (of 3 or 4, depending on whether Changing Rooms Available is on).
 * Every draft pitch lives only in the wizard's own context until Review & Create submits the whole
 * thing in one transaction (`create_venue_with_pitches`) -- never an orphan `club_pitches` row created
 * mid-wizard. Next goes to Add Changing Rooms when the venue has them, straight to Review otherwise. */
export default function AddPitchesScreen() {
  const router = useRouter()
  const { draft, setDraft } = useCreateVenueDraft()
  const [editing, setEditing] = useState<PitchDraft | null>(null)
  const [adding, setAdding] = useState(false)

  function upsert(pitch: PitchDraft) {
    setDraft((d) => {
      const exists = d.pitches.some((p) => p.localId === pitch.localId)
      return { ...d, pitches: exists ? d.pitches.map((p) => (p.localId === pitch.localId ? pitch : p)) : [...d.pitches, pitch] }
    })
    setEditing(null)
    setAdding(false)
  }

  function remove(localId: string) {
    setDraft((d) => ({ ...d, pitches: d.pitches.filter((p) => p.localId !== localId) }))
    setEditing(null)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AddVenueHeader step={2} includeChangingRooms={draft.changingRoomsAvailable} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCHES FOR THIS VENUE</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Add one or more pitches to this venue.</Text>
        </View>

        {draft.pitches.length > 0 && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {draft.pitches.map((pitch, i) => {
              const cover =
                pitch.photo.kind === "stock"
                  ? coverPhotoSource("PITCH", { kind: "stock", key: pitch.photo.key })
                  : pitch.photo.kind === "upload"
                    ? { uri: pitch.photo.localUri }
                    : fallbackAsset("PITCH")
              return (
                <Pressable
                  key={pitch.localId}
                  accessibilityRole="button"
                  accessibilityLabel={`${pitch.name}. ${pitchSummaryLabel(pitch)}`}
                  onPress={() => setEditing(pitch)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                >
                  <Image source={cover} accessible={false} contentFit="cover" style={{ width: 56, height: 56, borderRadius: radius.md }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{pitch.name}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{pitchSummaryLabel(pitch)}</Text>
                  </View>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add Another Pitch"
          onPress={() => setAdding(true)}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.lineStrong, borderStyle: "dashed", backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
        >
          <Plus size={17} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Another Pitch</Text>
        </Pressable>
      </ScrollView>

      <WizardFooter
        onBack={() => router.back()}
        primaryLabel="Next"
        onPrimary={() => router.push((draft.changingRoomsAvailable ? "/admin/venues/new/changing-rooms" : "/admin/venues/new/review") as never)}
        primaryDisabled={!canProceedFromPitches(draft.pitches)}
      />

      <PitchEditorSheet visible={adding} initial={null} onClose={() => setAdding(false)} onSave={upsert} />
      <PitchEditorSheet visible={editing !== null} initial={editing} onClose={() => setEditing(null)} onSave={upsert} onDelete={editing ? () => remove(editing.localId) : undefined} />
    </View>
  )
}
