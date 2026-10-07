import { useCallback, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  pitchConfigurationInputFrom,
  pitchConfigurationInputProblem,
  readClubVenues,
  renameClubPitch,
  setClubPitchActive,
  setClubPitchConfiguration,
  setClubPitchDescription,
  venueErrorMessage,
  type ClubPitch,
  type PitchConfigurationInput,
} from "@ovalball/contracts/club/venues"
import { bookingsAheadSentence, readResourceBookingsAhead } from "@ovalball/contracts/arena"
import { layoutAreaCount, layoutLabel, physicalSizeCategoryLabel, pitchConfigurationImpact, pitchPhysicalSizeUnits, type PitchConfigurationImpact } from "@ovalball/contracts/pitch-allocation"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"
import { setPitchCover, uploadPitchCoverPhoto } from "@ovalball/contracts/pitch-media"

import { supabase } from "../../../../../../src/auth/supabase"
import { useAdminCentreAccess } from "../../../../../../src/admin/access"
import { AdminScreen } from "../../../../../../src/admin/screen"
import { PhotoPicker, applyCoverWrite } from "../../../../../../src/venue/photo-picker"
import { coverWriteFor, draftPhotoFromCover, type DraftPhoto } from "../../../../../../src/venue/create-venue-logic"
import { Field, TextField } from "../../../../../../src/components/form"
import { Button, CardSkeleton, ErrorState } from "../../../../../../src/components/ui"
import { BottomSheet } from "../../../../../../src/components/bottom-sheet"
import { friendly, logDetail, type FriendlyError } from "../../../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../../src/design/tokens"


const PHYSICAL_SIZE_OPTIONS = ["full", "three_quarter", "half", "custom"] as const
const LAYOUT_OPTIONS = ["full_only", "two_halves", "four_quarters"] as const

/**
 * EDIT PITCH -- one existing pitch, matching the Venue Detail mock-up's Phone 3: photo (the Add Venue
 * wizard's own `PhotoPicker` + Pitch stock library), name, size, layout (the old inline
 * `PitchConfigurationEditor`'s own narrowing-impact check, unchanged), Additional Notes (the pitch's
 * real `description` column, newly reachable through `set_club_pitch_description`), Deactivate / Save.
 * Every write updates THIS pitch's row -- never a second pitch, and Save never creates one.
 */
export default function EditPitchScreen() {
  const router = useRouter()
  const { pitchId } = useLocalSearchParams<{ venueId: string; pitchId: string }>()
  const { clubId } = useAdminCentreAccess()

  const [pitch, setPitch] = useState<ClubPitch | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [config, setConfig] = useState<PitchConfigurationInput | null>(null)
  const [photo, setPhoto] = useState<DraftPhoto>({ kind: "none" })
  // Seeded ONCE from the stored cover, so a refocus never puts it back over a Reset to Default.
  const photoSeeded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [impact, setImpact] = useState<PitchConfigurationImpact | null>(null)
  // What is booked on the pitch from today, in words, for the deactivation step.
  const [bookingsAhead, setBookingsAhead] = useState<string | null>(null)
  const [impactChecked, setImpactChecked] = useState(false)
  const [checkingImpact, setCheckingImpact] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadError(null)
    try {
      const all = await readClubVenues(supabase, clubId)
      const found = all.pitches.find((p) => p.id === pitchId) ?? null
      setPitch(found)
      if (found) {
        setName((n) => (n ? n : found.displayName))
        setDescription((d) => (d ? d : (found.description ?? "")))
        setConfig((c) => c ?? pitchConfigurationInputFrom(found))
        if (!photoSeeded.current) {
          photoSeeded.current = true
          setPhoto(draftPhotoFromCover(resolvePitchCover({ supabase, coverImagePath: found.coverImagePath, coverStockKey: found.coverStockKey })))
        }
      }
    } catch (cause) {
      const translated = friendly(cause, "this pitch")
      logDetail("admin:pitch-edit", translated)
      setLoadError(translated)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, pitchId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const configProblem = config ? pitchConfigurationInputProblem(config) : null
  const narrowing =
    !!pitch &&
    !!config &&
    (layoutAreaCount(config.layout) < layoutAreaCount(pitch.layout) ||
      pitchPhysicalSizeUnits({ physicalSizeCategory: config.physicalSizeCategory, customLengthM: config.physicalSizeCategory === "custom" ? Number(config.customLengthM) || null : null, customWidthM: config.physicalSizeCategory === "custom" ? Number(config.customWidthM) || null : null }) < pitchPhysicalSizeUnits(pitch))

  function editConfig(patch: Partial<PitchConfigurationInput>) {
    setImpactChecked(false)
    setImpact(null)
    setConfig((c) => (c ? { ...c, ...patch } : c))
  }

  async function save() {
    if (!pitch || !config || !clubId) return
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
    setBusy(true)
    setProblem(null)
    try {
      if (name.trim() !== pitch.displayName) await renameClubPitch(supabase, pitch.id, name.trim())
      await setClubPitchConfiguration(supabase, pitch.id, config)
      if (description.trim() !== (pitch.description ?? "")) await setClubPitchDescription(supabase, pitch.id, description)
      const photoProblem = await applyCoverWrite(coverWriteFor(photo, pitch), {
        set: (selection) => setPitchCover(supabase, pitch.id, selection),
        upload: (bytes, mimeType) => uploadPitchCoverPhoto(supabase, clubId, pitch.id, bytes, mimeType),
      })
      if (photoProblem) {
        setProblem(`The pitch was saved, but its photo was not changed. ${photoProblem}`)
        return
      }
      router.back()
    } catch (cause) {
      setProblem(venueErrorMessage(cause, friendly(cause, "this pitch").message))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (!pitch) return
    setBusy(true)
    setProblem(null)
    try {
      await setClubPitchActive(supabase, pitch.id, false)
      router.back()
    } catch (cause) {
      setProblem(venueErrorMessage(cause, friendly(cause, "this pitch").message))
    } finally {
      setBusy(false)
      setConfirmDeactivate(false)
    }
  }

  if (loading && !pitch) {
    return (
      <AdminScreen section="Edit Pitch">
        <CardSkeleton lines={4} />
      </AdminScreen>
    )
  }
  if (loadError) {
    return (
      <AdminScreen section="Edit Pitch">
        <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />
      </AdminScreen>
    )
  }
  if (!pitch || !config) {
    return (
      <AdminScreen section="Edit Pitch">
        <ErrorState message="This pitch is not available to you." />
      </AdminScreen>
    )
  }

  return (
    <AdminScreen
      section="Edit Pitch"
      footer={
        <View style={{ padding: space.lg, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk, gap: space.sm }}>
          {!confirmDeactivate && <Button label="Deactivate Pitch" variant="danger" onPress={() => { setConfirmDeactivate(true); void readResourceBookingsAhead(supabase, "PITCH", pitch.id).then((b) => setBookingsAhead(bookingsAheadSentence(b))).catch(() => setBookingsAhead(null)) }} disabled={busy} />}
          {confirmDeactivate && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>Deactivate {pitch.displayName}? It will no longer be offered for new fixtures or training. Everything already recorded on it is kept, and it can be reactivated later.</Text>
              {!!bookingsAhead && (
                <Text accessibilityRole="alert" style={[type.small, { color: colour.warning }]}>{`${bookingsAhead} They stay on it until you move them, and Arena Planning shows each one as needing attention.`}</Text>
              )}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Keep Pitch" variant="secondary" onPress={() => setConfirmDeactivate(false)} disabled={busy} style={{ flex: 1 }} />
                <Button label="Deactivate" variant="danger" onPress={() => void deactivate()} busy={busy} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <Button label={impact && impact.affectedDates.length > 0 ? "Save Anyway" : "Save Changes"} onPress={() => void save()} busy={busy || checkingImpact} disabled={!!configProblem || !name.trim()} />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCH PHOTO</Text>
        <PhotoPicker photo={photo} onChange={setPhoto} domain="PITCH" label="Pitch Photos" seed={String(pitchId ?? "")} />
      </View>

      <Field label="Pitch Name">
        <TextField label="Pitch Name" value={name} onChange={setName} placeholder="Main Pitch" />
      </Field>

      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Pitch Size</Text>
        <ChoiceRow options={PHYSICAL_SIZE_OPTIONS.map((c) => ({ value: c, label: physicalSizeCategoryLabel(c) }))} value={config.physicalSizeCategory} onChange={(v) => editConfig({ physicalSizeCategory: v })} disabled={busy} />
      </View>

      {config.physicalSizeCategory === "custom" && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Length (m)">
              <TextField label="Length (m)" value={config.customLengthM} onChange={(v) => editConfig({ customLengthM: v })} keyboardType="decimal-pad" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Width (m)">
              <TextField label="Width (m)" value={config.customWidthM} onChange={(v) => editConfig({ customWidthM: v })} keyboardType="decimal-pad" />
            </Field>
          </View>
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Layout</Text>
        <ChoiceRow options={LAYOUT_OPTIONS.map((l) => ({ value: l, label: layoutLabel(l) }))} value={config.layout} onChange={(v) => editConfig({ layout: v })} disabled={busy} />
      </View>

      <Field label="Additional Notes (Optional)">
        <TextField label="Additional Notes (Optional)" value={description} onChange={setDescription} placeholder="Floodlit, 4G surface, etc." multiline />
      </Field>

      {impact && impact.affectedDates.length > 0 && (
        <View style={{ gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.smallMedium, { color: colour.warning }]}>
            {impact.affectedDates.length} future date{impact.affectedDates.length === 1 ? "" : "s"} currently ha{impact.affectedDates.length === 1 ? "s" : "ve"} more than one booking on this pitch.
          </Text>
          <Text style={[type.caption, { color: colour.warning }]}>Narrowing this pitch's configuration may leave some of those overlapping. Nothing is moved or cancelled automatically -- review Pitch Allocation for those dates after saving.</Text>
        </View>
      )}

      {!!configProblem && <Text style={[type.small, { color: colour.warning }]}>{configProblem}</Text>}
      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
    </AdminScreen>
  )
}

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
