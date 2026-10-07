import { useCallback, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { readClubVenues, setVenueChangingRoomActive, updateVenueChangingRoom, venueChangingRoomTypeLabel, venueErrorMessage, type VenueChangingRoom } from "@ovalball/contracts/club/venues"
import { resolveChangingRoomCover } from "@ovalball/contracts/changing-room-cover"
import { bookingsAheadSentence, readResourceBookingsAhead } from "@ovalball/contracts/arena"
import { setChangingRoomCover, uploadChangingRoomCoverPhoto } from "@ovalball/contracts/changing-room-media"

import { supabase } from "../../../../../../src/auth/supabase"
import { useAdminCentreAccess } from "../../../../../../src/admin/access"
import { AdminScreen } from "../../../../../../src/admin/screen"
import { coverWriteFor, draftPhotoFromCover, type DraftPhoto } from "../../../../../../src/venue/create-venue-logic"
import { Field, TextField } from "../../../../../../src/components/form"
import { Button, CardSkeleton, ErrorState } from "../../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../../../src/design/tokens"
import { PhotoPicker, applyCoverWrite } from "../../../../../../src/venue/photo-picker"


const ROOM_TYPE_OPTIONS: { value: VenueChangingRoom["roomType"]; label: string }[] = [
  { value: "full_size", label: venueChangingRoomTypeLabel("full_size") },
  { value: "smaller", label: venueChangingRoomTypeLabel("smaller") },
  { value: "match_officials", label: venueChangingRoomTypeLabel("match_officials") },
]

/**
 * EDIT CHANGING ROOM -- one existing, individually addressable changing room, matching the Venue
 * Detail mock-up's Phone 4. No Quantity control here, deliberately: quantity is a creation-time
 * convenience that already expanded into this one real row (`venue-detail-data.ts`'s
 * `addChangingRoomToVenue`) -- editing it again would misleadingly imply this record still represents
 * more than itself. The info panel says so instead of a control that would lie.
 */
export default function EditChangingRoomScreen() {
  const router = useRouter()
  const { roomId } = useLocalSearchParams<{ venueId: string; roomId: string }>()
  const { clubId } = useAdminCentreAccess()

  const [room, setRoom] = useState<VenueChangingRoom | null>(null)
  // What is booked in the room from today, in words, for the deactivation step.
  const [bookingsAhead, setBookingsAhead] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)

  const [name, setName] = useState("")
  const [roomType, setRoomType] = useState<VenueChangingRoom["roomType"]>("full_size")
  const [photo, setPhoto] = useState<DraftPhoto>({ kind: "none" })
  // Seeded ONCE from the stored cover, so a refocus never puts it back over a Reset to Default.
  const photoSeeded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadError(null)
    try {
      const all = await readClubVenues(supabase, clubId)
      const found = all.changingRooms.find((r) => r.id === roomId) ?? null
      setRoom(found)
      if (found) {
        setName((n) => (n ? n : found.displayName))
        setRoomType(found.roomType)
        if (!photoSeeded.current) {
          photoSeeded.current = true
          setPhoto(draftPhotoFromCover(resolveChangingRoomCover({ supabase, coverImagePath: found.coverImagePath, coverStockKey: found.coverStockKey })))
        }
      }
    } catch (cause) {
      const translated = friendly(cause, "this changing room")
      logDetail("admin:changing-room-edit", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, roomId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function save() {
    if (!room || !clubId) return
    setBusy(true)
    setProblem(null)
    try {
      await updateVenueChangingRoom(supabase, room.id, name.trim(), roomType)
      const photoProblem = await applyCoverWrite(coverWriteFor(photo, room), {
        set: (selection) => setChangingRoomCover(supabase, room.id, selection),
        upload: (bytes, mimeType) => uploadChangingRoomCoverPhoto(supabase, clubId, room.id, bytes, mimeType),
      })
      if (photoProblem) {
        setProblem(`The changing room was saved, but its photo was not changed. ${photoProblem}`)
        return
      }
      router.back()
    } catch (cause) {
      setProblem(venueErrorMessage(cause, friendly(cause, "this changing room").message))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (!room) return
    setBusy(true)
    setProblem(null)
    try {
      await setVenueChangingRoomActive(supabase, room.id, false)
      router.back()
    } catch (cause) {
      setProblem(venueErrorMessage(cause, friendly(cause, "this changing room").message))
    } finally {
      setBusy(false)
      setConfirmDeactivate(false)
    }
  }

  if (loading && !room) {
    return (
      <AdminScreen section="Edit Changing Room">
        <CardSkeleton lines={4} />
      </AdminScreen>
    )
  }
  if (loadError) {
    return (
      <AdminScreen section="Edit Changing Room">
        <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />
      </AdminScreen>
    )
  }
  if (!room) {
    return (
      <AdminScreen section="Edit Changing Room">
        <ErrorState message="This changing room is not available to you." />
      </AdminScreen>
    )
  }

  return (
    <AdminScreen
      section="Edit Changing Room"
      footer={
        <View style={{ padding: space.lg, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk, gap: space.sm }}>
          {!confirmDeactivate && <Button label="Deactivate Changing Room" variant="danger" onPress={() => { setConfirmDeactivate(true); void readResourceBookingsAhead(supabase, "ROOM", room.id).then((b) => setBookingsAhead(bookingsAheadSentence(b))).catch(() => setBookingsAhead(null)) }} disabled={busy} />}
          {confirmDeactivate && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>Deactivate {room.displayName}? It will no longer be shown as available at this venue. Everything already recorded in it is kept, and it can be reactivated later.</Text>
              {!!bookingsAhead && (
                <Text accessibilityRole="alert" style={[type.small, { color: colour.warning }]}>{`${bookingsAhead} They keep it until you change them, and Arena Planning shows each one as needing attention.`}</Text>
              )}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Keep Room" variant="secondary" onPress={() => setConfirmDeactivate(false)} disabled={busy} style={{ flex: 1 }} />
                <Button label="Deactivate" variant="danger" onPress={() => void deactivate()} busy={busy} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <Button label="Save Changes" onPress={() => void save()} busy={busy} disabled={!name.trim()} />
        </View>
      }
    >
      <PhotoPicker photo={photo} onChange={setPhoto} domain="CHANGING_ROOM" label="Changing Room Photos" overline="CHANGING ROOM PHOTO" seed={String(roomId ?? "")} />

      <Field label="Changing Room Name">
        <TextField label="Changing Room Name" value={name} onChange={setName} placeholder="Home Changing Room" />
      </Field>

      <View style={{ gap: space.xs }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>TYPE OF CHANGING ROOM</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {ROOM_TYPE_OPTIONS.map((o) => {
            const on = o.value === roomType
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={o.label}
                onPress={() => setRoomType(o.value)}
                style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.line, backgroundColor: on ? colour.forest800 : colour.surface }}
              >
                <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={{ borderRadius: radius.md, backgroundColor: colour.chalk, padding: space.sm }}>
        <Text style={[type.caption, { color: colour.inkMuted }]}>For existing changing rooms, quantity is managed individually. To add more changing rooms, use Add Changing Room on the previous screen.</Text>
      </View>

      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
    </AdminScreen>
  )
}
