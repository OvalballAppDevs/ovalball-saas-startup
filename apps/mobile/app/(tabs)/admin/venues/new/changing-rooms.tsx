import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Image } from "expo-image"

import { useCreateVenueDraft } from "../../../../../src/venue/create-venue-context"
import { canProceedFromChangingRooms, changingRoomSummaryLabel, type ChangingRoomDraft } from "../../../../../src/venue/create-venue-logic"
import { ChangingRoomEditorSheet } from "../../../../../src/venue/changing-room-editor-sheet"
import { AddVenueHeader, WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { ChevronRight, Plus } from "../../../../../src/components/icons"
import { colour, radius, space, type } from "../../../../../src/design/tokens"
import { coverPhotoSource, fallbackAsset } from "../../../../../src/media/stock-assets"


/** ADD VENUE -- STEP 3 OF 4, only ever reached when Changing Rooms Available is on (`pitches.tsx`'s
 * Next skips straight to Review otherwise). Every draft changing room lives only in the wizard's own
 * context until Review & Create submits the whole thing in one transaction
 * (`create_venue_with_pitches`) -- never an orphan `venue_changing_rooms` row created mid-wizard. */
export default function AddChangingRoomsScreen() {
  const router = useRouter()
  const { draft, setDraft } = useCreateVenueDraft()
  const [editing, setEditing] = useState<ChangingRoomDraft | null>(null)
  const [adding, setAdding] = useState(false)

  function upsert(room: ChangingRoomDraft) {
    setDraft((d) => {
      const exists = d.changingRooms.some((r) => r.localId === room.localId)
      return { ...d, changingRooms: exists ? d.changingRooms.map((r) => (r.localId === room.localId ? room : r)) : [...d.changingRooms, room] }
    })
    setEditing(null)
    setAdding(false)
  }

  function remove(localId: string) {
    setDraft((d) => ({ ...d, changingRooms: d.changingRooms.filter((r) => r.localId !== localId) }))
    setEditing(null)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AddVenueHeader step={3} includeChangingRooms onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.overline, { color: colour.inkSubtle }]}>CHANGING ROOMS FOR THIS VENUE</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Add one or more changing rooms to this venue.</Text>
        </View>

        {draft.changingRooms.length > 0 && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {draft.changingRooms.map((room, i) => {
              const cover =
                room.photo.kind === "stock"
                  ? coverPhotoSource("CHANGING_ROOM", { kind: "stock", key: room.photo.key })
                  : room.photo.kind === "upload"
                    ? { uri: room.photo.localUri }
                    : fallbackAsset("CHANGING_ROOM")
              return (
                <Pressable
                  key={room.localId}
                  accessibilityRole="button"
                  accessibilityLabel={`${room.name}. ${changingRoomSummaryLabel(room)}`}
                  onPress={() => setEditing(room)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                >
                  <Image source={cover} accessible={false} contentFit="cover" style={{ width: 56, height: 56, borderRadius: radius.md }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>{room.name}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{changingRoomSummaryLabel(room)}</Text>
                  </View>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add Another Changing Room"
          onPress={() => setAdding(true)}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.lineStrong, borderStyle: "dashed", backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
        >
          <Plus size={17} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Another Changing Room</Text>
        </Pressable>
      </ScrollView>

      <WizardFooter onBack={() => router.back()} primaryLabel="Next" onPrimary={() => router.push("/admin/venues/new/review" as never)} primaryDisabled={!canProceedFromChangingRooms(draft.changingRooms)} />

      <ChangingRoomEditorSheet visible={adding} initial={null} onClose={() => setAdding(false)} onSave={upsert} />
      <ChangingRoomEditorSheet visible={editing !== null} initial={editing} onClose={() => setEditing(null)} onSave={upsert} onDelete={editing ? () => remove(editing.localId) : undefined} />
    </View>
  )
}
