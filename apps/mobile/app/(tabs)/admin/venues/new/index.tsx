import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"

import { supabase } from "../../../../../src/auth/supabase"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { useCreateVenueDraft } from "../../../../../src/venue/create-venue-context"
import { venueDetailsValid, firstVenueMustBePrimary } from "../../../../../src/venue/create-venue-logic"
import { countClubVenues } from "../../../../../src/venue/create-venue-data"
import { PhotoPicker } from "../../../../../src/venue/photo-picker"
import { VenueLocationMap } from "../../../../../src/venue/venue-location-map"
import { AddVenueHeader, WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { AddressLookupField } from "../../../../../src/address/address-lookup-field"
import { addressSummaryLine, addressToDraftFields } from "../../../../../src/address/address-search-logic"
import type { CanonicalAddress } from "@ovalball/contracts/address"
import { Field, TextField } from "../../../../../src/components/form"
import { Check } from "../../../../../src/components/icons"
import { colour, radius, space, type } from "../../../../../src/design/tokens"


/**
 * ADD VENUE -- STEP 1 OF 3: VENUE DETAILS. Photo, name, address (the sitewide canonical AddressLookup
 * search -- see `src/address/address-lookup-field.tsx`'s own header comment), Catering/Changing Rooms
 * (default ON), Primary Venue.
 *
 * The structured Address Line 1/2/Town/County/Postcode fields below the search stay visible and
 * editable as CONFIRMATION fields, exactly as the approved mock-up shows them post-selection -- never
 * the normal way to enter an address, but the same honest manual fallback the web equivalent offers
 * when the provider is not configured, and the place a person can correct a genuinely wrong detail
 * without re-running the search. Hand-editing any of them after a search selection clears the
 * resolved pin, because a coordinate that no longer matches its own text is exactly the "map disagrees
 * with the saved address" failure the sitewide rule exists to rule out -- the async postcode geocoder
 * then takes over the same way it already does for a venue nobody has ever run through AddressLookup.
 */
export default function VenueDetailsScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const { draft, setDraft } = useCreateVenueDraft()
  const [firstVenue, setFirstVenue] = useState(false)

  const checkFirstVenue = useCallback(async () => {
    if (!clubId) return
    const count = await countClubVenues(supabase, clubId)
    setFirstVenue(firstVenueMustBePrimary(count))
  }, [clubId])
  useEffect(() => {
    void checkFirstVenue()
  }, [checkFirstVenue])

  /** A resolved postcode sets ONLY what postcodes.io actually established -- the canonical postcode,
   * its coordinates, and the administrative town/county where the provider returned them. `line1`
   * and `line2` are deliberately left alone: the provider said nothing about a building or a street,
   * so clearing them (or inventing them) would be a lie either way. The person confirms those below.
   * `addressProviderRef` is cleared because this pin came from a postcode, not a property record. */
  /** A selected PROPERTY fills the whole address, because Google genuinely supplies it: the building
   * and street, a real `postal_town` (not a council), the county, the postcode and the building's own
   * coordinate. Where the provider returned nothing for a field it writes an empty string rather than
   * inventing one, and the confirmation fields below remain editable. */
  function onResolveAddress(address: CanonicalAddress) {
    const fields = addressToDraftFields(address)
    setDraft((d) => ({
      ...d,
      line1: fields.line1 || d.line1,
      line2: fields.line2,
      town: fields.town || d.town,
      county: fields.county || d.county,
      postcode: fields.postcode || d.postcode,
      resolvedLatitude: fields.latitude,
      resolvedLongitude: fields.longitude,
      addressProviderRef: fields.providerRef,
    }))
  }

  /** Any hand-edit to a structured field after a search selection invalidates that selection's pin --
   * the text and the coordinate must never be allowed to disagree. */
  function editField<K extends "line1" | "line2" | "town" | "county" | "postcode">(key: K) {
    return (value: string) =>
      setDraft((d) => ({ ...d, [key]: value, resolvedLatitude: null, resolvedLongitude: null, addressProviderRef: null }))
  }

  const primaryForced = firstVenue
  const valid = venueDetailsValid(draft)
  const currentAddressLine = addressSummaryLine(draft)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AddVenueHeader step={1} includeChangingRooms={draft.changingRoomsAvailable} onBack={() => router.back()} />
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>VENUE PHOTO</Text>
            <PhotoPicker photo={draft.photo} onChange={(photo) => setDraft((d) => ({ ...d, photo }))} domain="VENUE" label="Venue Photos" />
          </View>

          <Field label="Venue Name">
            <TextField label="Venue Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} placeholder="Ovalball UAT Ground" />
          </Field>

          <AddressLookupField supabase={supabase} currentAddressLine={currentAddressLine || null} onResolve={onResolveAddress} />

          {draft.resolvedLatitude !== null && draft.resolvedLongitude !== null && <VenueLocationMap latitude={draft.resolvedLatitude} longitude={draft.resolvedLongitude} />}

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
              <FacilityRow label="Catering available" on={draft.cateringAvailable} onToggle={() => setDraft((d) => ({ ...d, cateringAvailable: !d.cateringAvailable }))} />
              <FacilityRow
                label="Changing rooms available"
                on={draft.changingRoomsAvailable}
                onToggle={() =>
                  setDraft((d) => {
                    const changingRoomsAvailable = !d.changingRoomsAvailable
                    // Turning this off must never leave inaccessible drafted changing rooms behind --
                    // the venue this wizard creates has to truthfully reflect that it has none.
                    return { ...d, changingRoomsAvailable, changingRooms: changingRoomsAvailable ? d.changingRooms : [] }
                  })
                }
              />
              <FacilityRow
                label="Primary venue for the club"
                on={primaryForced || draft.setPrimary}
                disabled={primaryForced}
                onToggle={() => setDraft((d) => ({ ...d, setPrimary: !d.setPrimary }))}
                last
              />
            </View>
            {primaryForced && <Text style={[type.caption, { color: colour.inkSubtle }]}>This is the club's first venue, so it automatically becomes the primary ground.</Text>}
          </View>
        </ScrollView>
      </View>
      <WizardFooter backLabel="Cancel" onBack={() => router.replace("/admin/venues" as never)} primaryLabel="Next" onPrimary={() => router.push("/admin/venues/new/pitches" as never)} primaryDisabled={!valid} />
    </View>
  )
}

function FacilityRow({ label, on, onToggle, disabled, last }: { label: string; on: boolean; onToggle: () => void; disabled?: boolean; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colour.line,
        backgroundColor: pressed && !disabled ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: disabled ? 0.7 : 1,
      })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : "transparent", alignItems: "center", justifyContent: "center" }}>
        {on && <Check size={15} color={colour.onForest} strokeWidth={3} />}
      </View>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{label}</Text>
    </Pressable>
  )
}
