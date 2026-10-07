import { useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { Image } from "expo-image"

import { supabase } from "../../../../../src/auth/supabase"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { useCreateVenueDraft } from "../../../../../src/venue/create-venue-context"
import { countClubVenues, createVenueWithPitches } from "../../../../../src/venue/create-venue-data"
import { changingRoomCountLabel, changingRoomTypeLabel, firstVenueMustBePrimary, pitchCountLabel, pitchSummaryLabel, wizardStepCount } from "../../../../../src/venue/create-venue-logic"
import { VenueLocationMap } from "../../../../../src/venue/venue-location-map"
import { AddVenueHeader, WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { Check } from "../../../../../src/components/icons"
import { friendly, logDetail } from "../../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../../src/design/tokens"
import { coverPhotoSource, fallbackAsset } from "../../../../../src/media/stock-assets"


/** ADD VENUE -- THE LAST STEP (3 of 3, or 4 of 4 with Changing Rooms). Every value shown here is read
 * straight from the wizard's own draft -- never a second, hand-built summary that could disagree with
 * what Create Venue actually submits. The Changing Rooms section only ever appears when the venue's
 * own facilities row says it has them -- never a section claiming rooms exist for a venue whose
 * Changing Rooms Available toggle is off. */
export default function ReviewCreateScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const { draft } = useCreateVenueDraft()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submitting = useRef(false)

  const venuePhoto = draft.photo.kind === "stock" ? coverPhotoSource("VENUE", { kind: "stock", key: draft.photo.key }) : draft.photo.kind === "upload" ? { uri: draft.photo.localUri } : fallbackAsset("VENUE")

  const addressLine = [draft.line1, draft.line2, draft.town, draft.county, draft.postcode].filter((s) => s.trim()).join(", ")

  async function create() {
    if (submitting.current || !clubId) return
    submitting.current = true
    setBusy(true)
    setProblem(null)
    try {
      const existingCount = await countClubVenues(supabase, clubId)
      const draftForSubmit = firstVenueMustBePrimary(existingCount) ? { ...draft, setPrimary: true } : draft
      const venueId = await createVenueWithPitches(supabase, clubId, draftForSubmit)
      const changingRoomCount = draft.changingRoomsAvailable ? draft.changingRooms.reduce((total, room) => total + Math.max(1, Math.round(room.quantity)), 0) : 0
      router.replace({ pathname: "/admin/venues/new/success", params: { venueId, venueName: draft.name, pitchCount: String(draft.pitches.length), changingRoomCount: String(changingRoomCount) } } as never)
    } catch (caught) {
      const failure = friendly(caught, "this venue")
      logDetail("venue:create", failure)
      setProblem(failure.message)
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AddVenueHeader step={wizardStepCount(draft.changingRoomsAvailable)} includeChangingRooms={draft.changingRoomsAvailable} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>VENUE SUMMARY</Text>
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", gap: space.md, padding: space.md, borderBottomWidth: 1, borderBottomColor: colour.line }}>
            <Image source={venuePhoto} accessible={false} contentFit="cover" style={{ width: 56, height: 56, borderRadius: radius.md }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{draft.name || "Untitled Venue"}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
                {addressLine || "No address recorded"}
              </Text>
            </View>
          </View>
          <FactRow label="Catering available" value={draft.cateringAvailable} />
          <FactRow label="Changing rooms available" value={draft.changingRoomsAvailable} />
          <FactRow label="Primary venue for the club" value={draft.setPrimary} last />
        </View>

        {draft.resolvedLatitude !== null && draft.resolvedLongitude !== null && <VenueLocationMap latitude={draft.resolvedLatitude} longitude={draft.resolvedLongitude} />}

        <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCHES ({draft.pitches.length})</Text>
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {draft.pitches.map((pitch, i) => {
            const cover = pitch.photo.kind === "stock" ? coverPhotoSource("PITCH", { kind: "stock", key: pitch.photo.key }) : pitch.photo.kind === "upload" ? { uri: pitch.photo.localUri } : fallbackAsset("PITCH")
            return (
              <View key={pitch.localId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                <Image source={cover} accessible={false} contentFit="cover" style={{ width: 48, height: 48, borderRadius: radius.md }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{pitch.name}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{pitchSummaryLabel(pitch)}</Text>
                </View>
              </View>
            )
          })}
        </View>
        <Text style={[type.caption, { color: colour.inkSubtle }]}>{pitchCountLabel(draft.pitches.length)} will be created with this venue.</Text>

        {draft.changingRoomsAvailable && (
          <>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>CHANGING ROOMS ({draft.changingRooms.length})</Text>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {draft.changingRooms.map((room, i) => {
                const cover = room.photo.kind === "stock" ? coverPhotoSource("CHANGING_ROOM", { kind: "stock", key: room.photo.key }) : room.photo.kind === "upload" ? { uri: room.photo.localUri } : fallbackAsset("CHANGING_ROOM")
                return (
                  <View key={room.localId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <Image source={cover} accessible={false} contentFit="cover" style={{ width: 48, height: 48, borderRadius: radius.md }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{room.name}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{changingRoomTypeLabel(room.roomType)}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>{changingRoomCountLabel(draft.changingRooms.length)} will be created with this venue.</Text>
          </>
        )}

        {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
      </ScrollView>
      <WizardFooter onBack={() => router.back()} primaryLabel="Create Venue" onPrimary={() => void create()} primaryBusy={busy} primaryDisabled={busy} />
    </View>
  )
}

function FactRow({ label, value, last }: { label: string; value: boolean; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colour.line, opacity: value ? 1 : 0.5 }}>
      <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: value ? colour.forest800 : colour.line, alignItems: "center", justifyContent: "center" }}>
        {value && <Check size={13} color={colour.onForest} strokeWidth={3} />}
      </View>
      <Text style={[type.small, { color: colour.ink }]}>{label}</Text>
    </View>
  )
}
