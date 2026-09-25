import { useCallback, useEffect, useState } from "react"
import { Linking, Platform, Pressable, Switch, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  createClubPitch,
  EMPTY_VENUE_INPUT,
  pitchConfigurationInputFrom,
  pitchConfigurationInputProblem,
  readClubVenues,
  readVenueCapabilities,
  renameClubPitch,
  saveClubVenue,
  setClubPitchActive,
  setClubPitchConfiguration,
  setDefaultVenue,
  setVenueActive,
  venueErrorMessage,
  venueInputFrom,
  venueInputProblem,
  venueMapsQuery,
  type ClubPitch,
  type ClubVenue,
  type PitchConfigurationInput,
  type VenueCapabilities,
  type VenueInput,
} from "@ovalball/contracts/club/venues"
import { layoutAreaCount, layoutLabel, physicalSizeCategoryLabel, pitchConfigurationImpact, pitchConfigurationSummary, pitchPhysicalSizeUnits, type PitchConfigurationImpact } from "@ovalball/contracts/pitch-allocation"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { supabase } from "../../../../src/auth/supabase"
import { CircleAlert, Plus } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ONE VENUE -- create ("new") or edit, natively (CA-M2).
 *
 * The four things the website does, on the same operations: name and address in one save
 * (`save_club_venue`: create_venue or update_venue, then set_venue_address -- the one writer of the
 * address), Make Home Ground (`set_default_venue`), Deactivate / Reactivate (`set_venue_active`;
 * there is no delete anywhere in the product), and the pitches at this ground (`create_club_pitch`,
 * `rename_club_pitch`, `set_club_pitch_active`). Every control appears only when the server says the
 * capability; every write is judged again by the server; the record is re-read after each.
 *
 * THE PIN IS NOT TYPED HERE. Coordinates come from the postcode through the platform's geocoding;
 * Open in Maps uses them only once the platform has confirmed them, and the postcode otherwise.
 */
export default function VenueScreen() {
  const router = useRouter()
  const { venueId: param } = useLocalSearchParams<{ venueId: string }>()
  const isNew = param === "new"
  const venueId = isNew ? null : param
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()

  const [venue, setVenue] = useState<ClubVenue | null>(null)
  const [pitches, setPitches] = useState<ClubPitch[]>([])
  const [draft, setDraft] = useState<VenueInput>(EMPTY_VENUE_INPUT)
  const [dirty, setDirty] = useState(false)
  const [caps, setCaps] = useState<VenueCapabilities>({ view: false, manageVenues: false, managePitches: false, allocate: false, viewAllocation: false })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) {
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const [all, allowed] = await Promise.all([readClubVenues(supabase, clubId), readVenueCapabilities(supabase, clubId)])
      setCaps(allowed)
      if (venueId) {
        const found = all.venues.find((v) => v.id === venueId) ?? null
        setVenue(found)
        setPitches(all.pitches.filter((p) => p.venueId === venueId))
        if (found) setDraft((d) => (dirty ? d : venueInputFrom(found)))
      }
    } catch (cause) {
      const translated = friendly(cause, "this venue")
      logDetail("admin:venue", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
    // dirty is read deliberately without being a dependency: a refocus must not restart the read mid-edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, venueId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function edit(patch: Partial<VenueInput>) {
    setMessage(null)
    setDirty(true)
    setDraft((d) => ({ ...d, ...patch }))
  }

  function refused(cause: unknown) {
    if ((cause as { code?: string }).code === "42501") {
      setCaps((c) => ({ ...c, manageVenues: false, managePitches: false }))
      void refreshAccess()
    }
  }

  async function save() {
    if (!clubId) return
    setBusy(true)
    setMessage(null)
    try {
      const id = await saveClubVenue(supabase, clubId, venueId, draft)
      setDirty(false)
      if (isNew) {
        router.replace(`/admin/venues/${id}` as never)
        return
      }
      await load()
      setMessage({ tone: "ok", text: "Saved. The pin is worked out from the postcode by Ovalball." })
    } catch (cause) {
      setMessage({ tone: "error", text: venueErrorMessage(cause, friendly(cause, "this venue").message) })
      refused(cause)
    } finally {
      setBusy(false)
    }
  }

  async function run(op: () => Promise<void>, subject: string, done?: string) {
    setBusy(true)
    setMessage(null)
    try {
      await op()
      await load()
      if (done) setMessage({ tone: "ok", text: done })
    } catch (cause) {
      setMessage({ tone: "error", text: venueErrorMessage(cause, friendly(cause, subject).message) })
      refused(cause)
    } finally {
      setBusy(false)
    }
  }

  const problem = venueInputProblem(draft)
  const maps = venue ? venueMapsQuery(venue) : null

  function openMaps() {
    if (!maps) return
    const url =
      maps.kind === "coordinates"
        ? Platform.OS === "ios"
          ? `https://maps.apple.com/?ll=${maps.latitude},${maps.longitude}&q=${encodeURIComponent(venue?.name ?? "Venue")}`
          : `geo:${maps.latitude},${maps.longitude}?q=${maps.latitude},${maps.longitude}(${encodeURIComponent(venue?.name ?? "Venue")})`
        : Platform.OS === "ios"
          ? `https://maps.apple.com/?q=${encodeURIComponent(maps.query)}`
          : `geo:0,0?q=${encodeURIComponent(maps.query)}`
    void Linking.openURL(url)
  }

  return (
    <AdminScreen section={isNew ? "New Venue" : (venue?.name ?? "Venue")} onRefresh={() => void load()} refreshing={false}>
      {loading && !venue && !isNew && <CardSkeleton lines={4} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {!loading && !loadError && !isNew && !venue && <ErrorState message="This venue is not available to you." />}

      {(isNew || venue) && (
        <>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {isNew ? "New Venue" : venue!.name}
            </Text>
            {venue && (
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                {venue.isDefaultHome && <StatusPill label="Home Ground" tone="positive" />}
                {!venue.active && <StatusPill label="Deactivated" tone="caution" />}
                <StatusPill label={venue.geocodeStatus === "success" ? "Pinned on the map" : venue.geocodeStatus === "pending" ? "Pin pending" : "No pin yet"} tone="neutral" />
              </View>
            )}
          </View>

          {!caps.manageVenues && (
            <View accessibilityRole="alert" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
              <CircleAlert size={18} color={colour.warning} />
              <Text style={[type.small, { color: colour.warning, flex: 1 }]}>You can see this venue but not change it: that needs the club's venues permission.</Text>
            </View>
          )}

          <Card style={{ gap: space.lg }}>
            <Field label="Venue Name" value={draft.name} onChange={(v) => edit({ name: v })} editable={caps.manageVenues} />
            <Field label="Address Line 1" value={draft.line1} onChange={(v) => edit({ line1: v })} editable={caps.manageVenues} />
            <Field label="Address Line 2" value={draft.line2} onChange={(v) => edit({ line2: v })} editable={caps.manageVenues} />
            <Field label="Town" value={draft.town} onChange={(v) => edit({ town: v })} editable={caps.manageVenues} />
            <Field label="County" value={draft.county} onChange={(v) => edit({ county: v })} editable={caps.manageVenues} />
            <Field label="Postcode" value={draft.postcode} onChange={(v) => edit({ postcode: v.toUpperCase() })} editable={caps.manageVenues} autoCapitalize="characters" />
            <Field label="Directions" value={draft.directions} onChange={(v) => edit({ directions: v })} editable={caps.manageVenues} multiline placeholder="How to find the ground, where to park" />
            {isNew && caps.manageVenues && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH_TARGET }}>
                <Text style={[type.small, { color: colour.ink, flex: 1 }]}>Make this the home ground</Text>
                <Switch accessibilityLabel="Make this the home ground" value={draft.setDefault} onValueChange={(v) => edit({ setDefault: v })} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} thumbColor={colour.surface} />
              </View>
            )}
            {problem && caps.manageVenues && dirty && <Text style={[type.small, { color: colour.warning }]}>{problem}</Text>}
            {message && (
              <View accessibilityRole={message.tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: message.tone === "error" ? colour.dangerSurface : colour.successSurface }}>
                <Text style={[type.small, { color: message.tone === "error" ? colour.danger : colour.forest800 }]}>{message.text}</Text>
              </View>
            )}
            {caps.manageVenues && (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {venue && dirty && <Button label="Discard" variant="secondary" onPress={() => { setDraft(venueInputFrom(venue)); setDirty(false); setMessage(null) }} disabled={busy} style={{ flex: 1 }} />}
                <Button label={isNew ? "Add Venue" : "Save Changes"} onPress={() => void save()} busy={busy} disabled={!dirty || !!problem} style={{ flex: 2 }} />
              </View>
            )}
          </Card>

          {venue && (
            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                This Ground
              </Text>
              <Card style={{ gap: space.sm }}>
                {maps && <Button label="Open in Maps" variant="secondary" onPress={openMaps} accessibilityHint={maps.kind === "coordinates" ? "Uses the pin Ovalball worked out from the postcode" : "Searches by the address"} />}
                {caps.manageVenues && venue.active && !venue.isDefaultHome && <Button label="Make Home Ground" variant="secondary" onPress={() => void run(() => setDefaultVenue(supabase, venue.id), "this venue", "This is now the club's home ground.")} disabled={busy} />}
                {caps.manageVenues && venue.active && !confirmDeactivate && <Button label="Deactivate Venue" variant="quiet" onPress={() => setConfirmDeactivate(true)} disabled={busy} />}
                {caps.manageVenues && venue.active && confirmDeactivate && (
                  <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
                    <Text style={[type.small, { color: colour.warning }]}>Deactivate {venue.name}? It will no longer be offered for new fixtures or training. Everything already recorded there is kept, and it can be reactivated later.</Text>
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Button label="Keep" variant="secondary" onPress={() => setConfirmDeactivate(false)} disabled={busy} style={{ flex: 1 }} />
                      <Button label="Confirm Deactivate" onPress={() => void run(async () => { await setVenueActive(supabase, venue.id, false); setConfirmDeactivate(false) }, "this venue", "Deactivated. Nothing recorded here was removed.")} busy={busy} style={{ flex: 1 }} />
                    </View>
                  </View>
                )}
                {caps.manageVenues && !venue.active && <Button label="Reactivate Venue" onPress={() => void run(() => setVenueActive(supabase, venue.id, true), "this venue", "Reactivated.")} busy={busy} />}
              </Card>
            </View>
          )}

          {venue && clubId && <PitchesSection clubId={clubId} venue={venue} pitches={pitches} canManage={caps.managePitches} busy={busy} run={run} />}
        </>
      )}
    </AdminScreen>
  )
}

function Field({ label, value, onChange, editable, multiline = false, placeholder, autoCapitalize = "words", keyboardType = "default" }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; multiline?: boolean; placeholder?: string; autoCapitalize?: "none" | "words" | "sentences" | "characters"; keyboardType?: "default" | "decimal-pad" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        autoCapitalize={autoCapitalize}
        autoCorrect={multiline}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        selectionColor={colour.pitch600}
        keyboardType={keyboardType}
        style={[type.body, { minHeight: multiline ? 88 : TOUCH_TARGET, paddingHorizontal: space.md, paddingVertical: multiline ? space.md : 0, textAlignVertical: multiline ? "top" : "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: editable ? colour.surface : "rgba(16,21,18,0.03)", color: editable ? colour.ink : colour.inkMuted }]}
      />
    </View>
  )
}

function PitchesSection({ clubId, venue, pitches, canManage, busy, run }: { clubId: string; venue: ClubVenue; pitches: ClubPitch[]; canManage: boolean; busy: boolean; run: (op: () => Promise<void>, subject: string, done?: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [configuringId, setConfiguringId] = useState<string | null>(null)
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          Pitches
        </Text>
        {canManage && venue.active && !adding && (
          <Pressable accessibilityRole="button" accessibilityLabel="Add Pitch" onPress={() => setAdding(true)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH_TARGET, paddingHorizontal: space.sm, opacity: pressed ? 0.7 : 1 })}>
            <Plus size={18} color={colour.forest800} strokeWidth={2.2} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Pitch</Text>
          </Pressable>
        )}
      </View>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {pitches.length === 0 && !adding && <Text style={[type.small, { color: colour.inkMuted, padding: space.lg }]}>No pitches at this ground yet.</Text>}
        {pitches.map((p, i) => (
          <View key={p.id} style={{ padding: space.lg, gap: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, opacity: p.active ? 1 : 0.7 }}>
            {renaming?.id === p.id ? (
              <View style={{ gap: space.sm }}>
                <Field label="Pitch Name" value={renaming.name} onChange={(v) => setRenaming({ id: p.id, name: v })} editable={!busy} />
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Cancel" variant="secondary" onPress={() => setRenaming(null)} disabled={busy} style={{ flex: 1 }} />
                  <Button label="Save Pitch" onPress={() => void run(async () => { await renameClubPitch(supabase, p.id, renaming.name); setRenaming(null) }, "this pitch")} busy={busy} disabled={!renaming.name.trim()} style={{ flex: 1 }} />
                </View>
              </View>
            ) : configuringId === p.id ? (
              <PitchConfigurationEditor
                pitch={p}
                busy={busy}
                onCancel={() => setConfiguringId(null)}
                onSave={async (input) => {
                  await run(() => setClubPitchConfiguration(supabase, p.id, input), "this pitch", "Pitch configuration saved.")
                  setConfiguringId(null)
                }}
              />
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{p.displayName}</Text>
                  {!p.active && <StatusPill label="Deactivated" tone="caution" />}
                </View>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{pitchConfigurationSummary(p)}</Text>
                {canManage && (
                  <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                    <Button label="Rename" variant="secondary" onPress={() => setRenaming({ id: p.id, name: p.displayName })} disabled={busy} style={{ flex: 1 }} />
                    <Button label="Configure" variant="secondary" onPress={() => setConfiguringId(p.id)} disabled={busy} style={{ flex: 1 }} />
                    <Button label={p.active ? "Deactivate" : "Reactivate"} variant="quiet" onPress={() => void run(() => setClubPitchActive(supabase, p.id, !p.active), "this pitch")} disabled={busy} style={{ flex: 1 }} />
                  </View>
                )}
              </>
            )}
          </View>
        ))}
        {adding && (
          <View style={{ padding: space.lg, gap: space.sm, borderTopWidth: pitches.length ? 1 : 0, borderTopColor: colour.line }}>
            <Field label="Pitch Name" value={name} onChange={setName} editable={!busy} placeholder="Pitch 3, Top field…" />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Cancel" variant="secondary" onPress={() => { setAdding(false); setName("") }} disabled={busy} style={{ flex: 1 }} />
              <Button label="Add Pitch" onPress={() => void run(async () => { await createClubPitch(supabase, clubId, name, venue.id); setAdding(false); setName("") }, "this pitch", "Pitch added at this ground.")} busy={busy} disabled={!name.trim()} style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </Card>
    </View>
  )
}

const PHYSICAL_SIZE_OPTIONS = ["full", "three_quarter", "half", "custom"] as const
const LAYOUT_OPTIONS = ["full_only", "two_halves", "four_quarters"] as const

/**
 * CA-M11.2 Grounds & Pitches: what this physical pitch is, and how the club has chosen to use it
 * concurrently -- native, in-place (matching Rename's own established pattern in this screen), never
 * a WebView or web hand-off (Section 12's own explicit instruction).
 */
function PitchConfigurationEditor({ pitch, busy, onCancel, onSave }: { pitch: ClubPitch; busy: boolean; onCancel: () => void; onSave: (input: PitchConfigurationInput) => Promise<void> }) {
  const [draft, setDraft] = useState<PitchConfigurationInput>(() => pitchConfigurationInputFrom(pitch))
  const [impact, setImpact] = useState<PitchConfigurationImpact | null>(null)
  const [checkingImpact, setCheckingImpact] = useState(false)
  const [impactChecked, setImpactChecked] = useState(false)

  const problem = pitchConfigurationInputProblem(draft)
  // Section 29's impact check is for NARROWING only -- widening (more areas, or a bigger physical size)
  // can never turn an existing valid allocation into a new conflict, so it would be pure noise here.
  const narrowing =
    layoutAreaCount(draft.layout) < layoutAreaCount(pitch.layout) ||
    pitchPhysicalSizeUnits({ physicalSizeCategory: draft.physicalSizeCategory, customLengthM: draft.physicalSizeCategory === "custom" ? Number(draft.customLengthM) || null : null, customWidthM: draft.physicalSizeCategory === "custom" ? Number(draft.customWidthM) || null : null }) <
      pitchPhysicalSizeUnits(pitch)

  function edit(patch: Partial<PitchConfigurationInput>) {
    setImpactChecked(false)
    setImpact(null)
    setDraft((d) => ({ ...d, ...patch }))
  }

  async function handleSave() {
    if (narrowing && !impactChecked) {
      setCheckingImpact(true)
      const result = await pitchConfigurationImpact(supabase, pitch.id)
      setCheckingImpact(false)
      setImpactChecked(true)
      if (result.affectedDates.length > 0) {
        setImpact(result)
        return
      }
    }
    await onSave(draft)
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Pitch Size</Text>
        <ChoiceRow options={PHYSICAL_SIZE_OPTIONS.map((c) => ({ value: c, label: physicalSizeCategoryLabel(c) }))} value={draft.physicalSizeCategory} onChange={(v) => edit({ physicalSizeCategory: v })} disabled={busy} />
      </View>

      {draft.physicalSizeCategory === "custom" && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Length (M)" value={draft.customLengthM} onChange={(v) => edit({ customLengthM: v })} editable={!busy} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Width (M)" value={draft.customWidthM} onChange={(v) => edit({ customWidthM: v })} editable={!busy} keyboardType="decimal-pad" />
          </View>
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>How Can This Pitch Be Used?</Text>
        <ChoiceRow options={LAYOUT_OPTIONS.map((l) => ({ value: l, label: layoutLabel(l) }))} value={draft.layout} onChange={(v) => edit({ layout: v })} disabled={busy} />
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {draft.layout === "full_only" ? "One fixture or training session at a time on this pitch." : `Up to ${draft.layout === "two_halves" ? 2 : 4} compatible-sized fixtures or training sessions at once.`}
        </Text>
      </View>

      {impact && impact.affectedDates.length > 0 && (
        <View style={{ gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.smallMedium, { color: colour.warning }]}>
            {impact.affectedDates.length} future date{impact.affectedDates.length === 1 ? "" : "s"} currently ha{impact.affectedDates.length === 1 ? "s" : "ve"} more than one booking on this pitch.
          </Text>
          <Text style={[type.caption, { color: colour.warning }]}>Narrowing this pitch's configuration may leave some of those overlapping. Nothing is moved or cancelled automatically -- review Pitch Allocation for those dates after saving.</Text>
        </View>
      )}

      {problem && <Text style={[type.small, { color: colour.warning }]}>{problem}</Text>}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy || checkingImpact} style={{ flex: 1 }} />
        <Button label={impact && impact.affectedDates.length > 0 ? "Save Anyway" : "Save Pitch"} onPress={() => void handleSave()} busy={busy || checkingImpact} disabled={!!problem} style={{ flex: 1 }} />
      </View>
    </View>
  )
}

/** A row of pressable choice chips -- the same selected/unselected treatment the pitch-allocation
 * Move sheet already uses for its own pitch picker, reused here for a small enum choice. */
function ChoiceRow<T extends string>({ options, value, onChange, disabled }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={o.label}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: selected ? colour.pitch600 : colour.line, backgroundColor: selected ? colour.mint100 : colour.surface, opacity: disabled ? 0.6 : 1 }}
          >
            <Text style={[type.small, { color: selected ? colour.forest800 : colour.ink }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
