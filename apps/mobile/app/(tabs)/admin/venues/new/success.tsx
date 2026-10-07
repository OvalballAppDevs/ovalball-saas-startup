import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Image } from "expo-image"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useCreateVenueDraft } from "../../../../../src/venue/create-venue-context"
import { changingRoomCountLabel, pitchCountLabel } from "../../../../../src/venue/create-venue-logic"
import { Button } from "../../../../../src/components/ui"
import { CircleCheck } from "../../../../../src/components/icons"
import { colour, space, type } from "../../../../../src/design/tokens"
import { coverPhotoSource, fallbackAsset } from "../../../../../src/media/stock-assets"


/** VENUE ADDED -- the selected venue's own photo as the hero, dynamic copy from the draft that was
 * actually just submitted (never a hardcoded name). "Add Another Venue" resets the draft and starts a
 * fresh wizard; "View All Venues" returns to Venues & Pitches Home, where the new venue must already
 * appear (`readClubVenues` re-reads the same canonical table, nothing cached client-side). */
export default function VenueAddedScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { venueId, venueName, pitchCount, changingRoomCount } = useLocalSearchParams<{ venueId: string; venueName: string; pitchCount: string; changingRoomCount: string }>()
  const { draft, reset } = useCreateVenueDraft()

  const photo = draft.photo.kind === "stock" ? coverPhotoSource("VENUE", { kind: "stock", key: draft.photo.key }) : draft.photo.kind === "upload" ? { uri: draft.photo.localUri } : fallbackAsset("VENUE")
  const count = Number(pitchCount ?? "0")
  const roomCount = Number(changingRoomCount ?? "0")

  return (
    <View style={{ flex: 1, backgroundColor: "#0b1f16" }}>
      <StatusBar style="light" />
      <Image source={photo} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(7,20,15,0.72)" }} />

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, paddingHorizontal: space.xl }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(90,203,131,0.18)", alignItems: "center", justifyContent: "center" }}>
          <CircleCheck size={44} color={colour.pitch400} strokeWidth={1.7} />
        </View>
        <Text accessibilityRole="header" style={[type.display, { color: colour.chalk, textAlign: "center" }]}>
          Venue Added
        </Text>
        <Text style={[type.body, { color: "rgba(248,250,247,0.85)", textAlign: "center" }]}>
          {venueName || "This venue"} has been created with {pitchCountLabel(count)}
          {roomCount > 0 ? ` and ${changingRoomCountLabel(roomCount)}` : ""}.
        </Text>
      </View>

      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, gap: space.sm }}>
        <Button
          label="Add Another Venue"
          onPress={() => {
            reset()
            router.replace("/admin/venues/new" as never)
          }}
        />
        {!!venueId && <Button label="Open Venue" variant="secondary" onPress={() => router.replace({ pathname: "/admin/venues/[venueId]", params: { venueId } } as never)} />}
        <Button label="View All Venues" variant="quiet" onPress={() => router.replace("/admin/venues" as never)} />
      </View>
    </View>
  )
}
