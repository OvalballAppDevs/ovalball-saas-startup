import { useEffect, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"

import type { ClubPitch } from "@ovalball/contracts/club/venues"

import { Field, TextField } from "../components/form"
import { Button } from "../components/ui"
import { colour, elevation, radius, space, type } from "../design/tokens"
import { PhotoPicker } from "./photo-picker"
import { emptyPitchDraft, pitchDraftValid, type PitchDraft } from "./create-venue-logic"


const SIZE_OPTIONS: { value: ClubPitch["physicalSizeCategory"]; label: string }[] = [
  { value: "full", label: "Full Size" },
  { value: "three_quarter", label: "Three-Quarter" },
  { value: "half", label: "Half Size" },
  { value: "custom", label: "Custom" },
]
const LAYOUT_OPTIONS: { value: ClubPitch["layout"]; label: string }[] = [
  { value: "full_only", label: "Full Only" },
  { value: "two_halves", label: "Two Halves" },
  { value: "four_quarters", label: "Four Quarters" },
]

/**
 * ADD / EDIT ONE DRAFT PITCH -- canonical fields only (`physical_size_category`/`layout`, the exact
 * enums `set_club_pitch_configuration` accepts), never invented display strings. Floodlights are not a
 * canonical `club_pitches` column (confirmed against the live schema before building this), so a
 * floodlit ground is recorded in the free-text Notes field, the same way the existing Venue/Pitch
 * management screens already handle anything outside the structured columns -- not a new migration for
 * a cosmetic mock-up detail.
 */
export function PitchEditorSheet({ visible, initial, onClose, onSave, onDelete }: { visible: boolean; initial: PitchDraft | null; onClose: () => void; onSave: (pitch: PitchDraft) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState<PitchDraft>(initial ?? emptyPitchDraft("new"))
  useEffect(() => {
    if (visible) setDraft(initial ?? emptyPitchDraft(String(Date.now())))
  }, [visible, initial])

  const valid = pitchDraftValid(draft)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, maxHeight: "90%", gap: space.md }, elevation.sheet]}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {initial ? "Edit Pitch" : "Add Pitch"}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
            <PhotoPicker photo={draft.photo} onChange={(photo) => setDraft((d) => ({ ...d, photo }))} domain="PITCH" label="Pitch Photos" />
            <Field label="Pitch Name">
              <TextField label="Pitch Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} placeholder="Main Pitch" />
            </Field>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>SIZE</Text>
              <SegmentedRow options={SIZE_OPTIONS} value={draft.physicalSizeCategory} onChange={(physicalSizeCategory) => setDraft((d) => ({ ...d, physicalSizeCategory }))} />
            </View>

            {draft.physicalSizeCategory === "custom" && (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Field label="Length (m)">
                    <TextField label="Length (m)" value={draft.customLengthM} onChange={(customLengthM) => setDraft((d) => ({ ...d, customLengthM }))} placeholder="20" />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Width (m)">
                    <TextField label="Width (m)" value={draft.customWidthM} onChange={(customWidthM) => setDraft((d) => ({ ...d, customWidthM }))} placeholder="15" />
                  </Field>
                </View>
              </View>
            )}

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>LAYOUT</Text>
              <SegmentedRow options={LAYOUT_OPTIONS} value={draft.layout} onChange={(layout) => setDraft((d) => ({ ...d, layout }))} />
            </View>

            <Field label="Notes (Optional)">
              <TextField label="Notes (Optional)" value={draft.description} onChange={(description) => setDraft((d) => ({ ...d, description }))} placeholder="Floodlit, 4G surface, etc." multiline />
            </Field>
          </ScrollView>

          <View style={{ gap: space.sm }}>
            <Button label="Save Pitch" onPress={() => onSave(draft)} disabled={!valid} />
            {onDelete ? <Button label="Delete Pitch" variant="danger" onPress={onDelete} /> : <Button label="Cancel" variant="quiet" onPress={onClose} />}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function SegmentedRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.line, backgroundColor: on ? colour.forest800 : colour.surface }}
          >
            <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
