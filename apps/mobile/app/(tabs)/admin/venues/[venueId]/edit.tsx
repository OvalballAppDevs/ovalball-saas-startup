import { useCallback, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { readClubVenues, saveClubVenue, venueErrorMessage, venueInputFrom, venueInputProblem, type ClubVenue, type VenueInput } from "@ovalball/contracts/club/venues"
import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { setVenueCover, uploadVenueCoverPhoto } from "@ovalball/contracts/venue-media"

import { supabase } from "../../../../../src/auth/supabase"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { AdminScreen } from "../../../../../src/admin/screen"
import { PhotoPicker, applyCoverWrite } from "../../../../../src/venue/photo-picker"
import { VenueLocationMap } from "../../../../../src/venue/venue-location-map"
import { coverWriteFor, draftPhotoFromCover, type DraftPhoto } from "../../../../../src/venue/create-venue-logic"
import { AddressLookupField } from "../../../../../src/address/address-lookup-field"
import { addressSummaryLine, addressToDraftFields } from "../../../../../src/address/address-search-logic"
import type { CanonicalAddress } from "@ovalball/contracts/address"
import { Field, TextField } from "../../../../../src/components/form"
import { Button, CardSkeleton, ErrorState } from "../../../../../src/components/ui"
import { BottomSheet } from "../../../../../src/components/bottom-sheet"
import { Check } from "../../../../../src/components/icons"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../../src/design/tokens"


/**
 * EDIT VENUE DETAILS -- the Add Venue wizard's own Venue Details step, re-shaped for an EXISTING
 * venue: the same photo picker, the sitewide canonical AddressLookup search, map and facility toggles,
 * saved through the same `save_club_venue` operation the venue's own creation already used. There is
 * no second venue model here: this screen edits `venues` in place and returns to Venue Detail, which
 * re-reads the same canonical row.
 *
 * THE MAP PIN AND THE SAVE PAYLOAD ARE DELIBERATELY SEPARATE STATE. `mapLat`/`mapLng` are what the map
 * shows RIGHT NOW -- the venue's own existing pin on load, or a freshly picked one. `draft.latitude` /
 * `draft.longitude` (via `venueInputFrom`) start null and stay null unless AddressLookup has actually
 * resolved a NEW address this session: `save_club_venue` only overwrites the stored pin (and re-stamps
 * its provenance to getaddress.io) when it receives a real value, so a save that never touched the
 * address must never resend the venue's own existing pin back at it as if it were a fresh selection --
 * see `venueInputFrom`'s own comment.
 */
export default function EditVenueDetailsScreen() {
  const router = useRouter()
  const { venueId } = useLocalSearchParams<{ venueId: string }>()
  const { clubId } = useAdminCentreAccess()

  const [venue, setVenue] = useState<ClubVenue | null>(null)
  const [activeRoomCount, setActiveRoomCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)

  const [draft, setDraft] = useState<VenueInput | null>(null)
  const [photo, setPhoto] = useState<DraftPhoto>({ kind: "none" })
  // The photo is seeded ONCE from the stored cover: after that "none" is a person's Reset to Default, and a
  // refocus must not put the old cover back over it.
  const photoSeeded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [mapLat, setMapLat] = useState<number | null>(null)
  const [mapLng, setMapLng] = useState<number | null>(null)
  const [confirmRoomsOff, setConfirmRoomsOff] = useState(false)

  const load = useCallback(async () => {
    if (!clubId || !venueId) return
    setLoadError(null)
    try {
      const all = await readClubVenues(supabase, clubId)
      const found = all.venues.find((v) => v.id === venueId) ?? null
      setVenue(found)
      setActiveRoomCount(all.changingRooms.filter((r) => r.venueId === venueId && r.active).length)
      if (found) {
        setDraft((d) => d ?? venueInputFrom(found))
        setMapLat((v) => v ?? found.latitude)
        setMapLng((v) => v ?? found.longitude)
        if (!photoSeeded.current) {
          photoSeeded.current = true
          setPhoto(draftPhotoFromCover(resolveVenueCover({ supabase, coverImagePath: found.coverImagePath, coverStockKey: found.coverStockKey })))
        }
      }
    } catch (cause) {
      const translated = friendly(cause, "this venue")
      logDetail("admin:venue-edit", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
    // draft/photo deliberately excluded: a refocus must not clobber an in-progress edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, venueId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  /** See the same handler in Add Venue: a resolved postcode writes the postcode, the coordinates and
   * the provider's own town/county, and deliberately does NOT touch `line1`/`line2`. For an existing
   * venue that matters twice over -- a person resolving a postcode keeps the building name and street
   * they already had, rather than watching them blank themselves. */
  /** See the same handler in Add Venue. A selected property fills the whole address; a field the
   * provider left empty keeps whatever the venue already had rather than being blanked. */
  function onResolveAddress(address: CanonicalAddress) {
    const fields = addressToDraftFields(address)
    setDraft((d) =>
      d
        ? {
            ...d,
            line1: fields.line1 || d.line1,
            line2: fields.line2,
            town: fields.town || d.town,
            county: fields.county || d.county,
            postcode: fields.postcode || d.postcode,
            latitude: fields.latitude,
            longitude: fields.longitude,
            addressProviderRef: fields.providerRef,
          }
        : d
    )
    setMapLat(fields.latitude)
    setMapLng(fields.longitude)
  }

  /** Hand-editing a structured field after a selection (fresh or the venue's own existing one)
   * invalidates whatever pin is currently showing -- text and coordinate must never disagree. The
   * async postcode geocoder resumes responsibility once this venue is saved with no pin supplied. */
  function editField<K extends "line1" | "line2" | "town" | "county" | "postcode">(key: K) {
    return (value: string) => {
      setDraft((d) => (d ? { ...d, [key]: value, latitude: null, longitude: null, addressProviderRef: null } : d))
      setMapLat(null)
      setMapLng(null)
    }
  }

  function toggleChangingRoomsAvailable() {
    if (!draft) return
    if (draft.changingRoomsAvailable && activeRoomCount > 0) {
      setConfirmRoomsOff(true)
      return
    }
    setDraft((d) => (d ? { ...d, changingRoomsAvailable: !d.changingRoomsAvailable } : d))
  }

  async function save() {
    if (!clubId || !venue || !draft) return
    setBusy(true)
    setProblem(null)
    try {
      const venueId2 = await saveClubVenue(supabase, clubId, venue.id, draft)
      const photoProblem = await applyCoverWrite(coverWriteFor(photo, venue), {
        set: (selection) => setVenueCover(supabase, venueId2, selection),
        upload: (bytes, mimeType) => uploadVenueCoverPhoto(supabase, clubId, venueId2, bytes, mimeType),
      })
      if (photoProblem) {
        setProblem(`The venue details were saved, but the photo was not changed. ${photoProblem}`)
        return
      }
      router.back()
    } catch (cause) {
      setProblem(venueErrorMessage(cause, friendly(cause, "this venue").message))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !venue) {
    return (
      <AdminScreen section="Edit Venue Details">
        <CardSkeleton lines={4} />
      </AdminScreen>
    )
  }
  if (loadError) {
    return (
      <AdminScreen section="Edit Venue Details">
        <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />
      </AdminScreen>
    )
  }
  if (!venue || !draft) {
    return (
      <AdminScreen section="Edit Venue Details">
        <ErrorState message="This venue is not available to you." />
      </AdminScreen>
    )
  }

  const problemText = venueInputProblem(draft)
  const currentAddressLine = addressSummaryLine(draft)

  return (
    <AdminScreen
      section="Edit Venue Details"
      footer={
        <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={busy} style={{ flex: 1 }} />
          <Button label="Save Changes" onPress={() => void save()} busy={busy} disabled={!!problemText} style={{ flex: 2 }} />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>VENUE PHOTO</Text>
        <PhotoPicker photo={photo} onChange={setPhoto} domain="VENUE" label="Venue Photos" seed={String(venueId ?? "")} />
      </View>

      <Field label="Venue Name">
        <TextField label="Venue Name" value={draft.name} onChange={(name) => setDraft((d) => (d ? { ...d, name } : d))} placeholder="Ovalball UAT Ground" />
      </Field>

      <AddressLookupField supabase={supabase} currentAddressLine={currentAddressLine || null} onResolve={onResolveAddress} />

      {mapLat !== null && mapLng !== null && <VenueLocationMap latitude={mapLat} longitude={mapLng} />}

      <View style={{ gap: space.sm }}>
        <Field label="Address Line 1">
          <TextField label="Address Line 1" value={draft.line1} onChange={editField("line1")} placeholder="The building or ground name" />
        </Field>
        <Field label="Address Line 2">
          <TextField label="Address Line 2" value={draft.line2} onChange={editField("line2")} placeholder="Street" />
        </Field>
        <Field label="Town">
          <TextField label="Town" value={draft.town} onChange={editField("town")} />
        </Field>
        <Field label="County">
          <TextField label="County" value={draft.county} onChange={editField("county")} />
        </Field>
        <Field label="Postcode">
          <TextField label="Postcode" value={draft.postcode} onChange={editField("postcode")} placeholder="BB10 4BX" autoCapitalize="none" />
        </Field>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>FACILITIES</Text>
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          <FacilityToggle label="Catering available" on={draft.cateringAvailable ?? true} onToggle={() => setDraft((d) => (d ? { ...d, cateringAvailable: !(d.cateringAvailable ?? true) } : d))} />
          <FacilityToggle label="Changing rooms available" on={draft.changingRoomsAvailable ?? true} onToggle={toggleChangingRoomsAvailable} />
          <FacilityToggle label="Primary venue for the club" on={draft.setDefault} disabled={venue.isDefaultHome} onToggle={() => setDraft((d) => (d ? { ...d, setDefault: !d.setDefault } : d))} last />
        </View>
        {venue.isDefaultHome && <Text style={[type.caption, { color: colour.inkSubtle }]}>This venue is already the club's primary venue. Making another venue primary will move this badge to it.</Text>}
      </View>

      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

      <BottomSheet visible={confirmRoomsOff} onClose={() => setConfirmRoomsOff(false)} title="Turn Off Changing Rooms?">
        <Text style={[type.small, { color: colour.inkMuted }]}>
          This venue currently has {activeRoomCount} changing room{activeRoomCount === 1 ? "" : "s"} configured. Turning Changing Rooms Available off will deactivate {activeRoomCount === 1 ? "it" : "them"} -- nothing is deleted, and they can be restored by turning this back
          on and adding them again.
        </Text>
        <Button
          label="Turn Off Anyway"
          variant="danger"
          onPress={() => {
            setDraft((d) => (d ? { ...d, changingRoomsAvailable: false } : d))
            setConfirmRoomsOff(false)
          }}
        />
      </BottomSheet>
    </AdminScreen>
  )
}

function FacilityToggle({ label, on, onToggle, disabled, last }: { label: string; on: boolean; onToggle: () => void; disabled?: boolean; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colour.line, backgroundColor: pressed && !disabled ? "rgba(16,21,18,0.03)" : "transparent", opacity: disabled ? 0.7 : 1 })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
        {on && <Check size={15} color={colour.onForest} strokeWidth={3} />}
      </View>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{label}</Text>
    </Pressable>
  )
}
