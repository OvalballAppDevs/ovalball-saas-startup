import { useEffect, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"

import { Field, TextField } from "../components/form"
import { Button } from "../components/ui"
import { Minus, Plus } from "../components/icons"
import { colour, elevation, radius, space, type } from "../design/tokens"
import { changingRoomDraftValid, changingRoomTypeLabel, emptyChangingRoomDraft, type ChangingRoomDraft, type ChangingRoomType } from "./create-venue-logic"
import { PhotoPicker } from "./photo-picker"


const ROOM_TYPE_OPTIONS: { value: ChangingRoomType; label: string }[] = [
  { value: "full_size", label: changingRoomTypeLabel("full_size") },
  { value: "smaller", label: changingRoomTypeLabel("smaller") },
  { value: "match_officials", label: changingRoomTypeLabel("match_officials") },
]

/**
 * ADD / EDIT ONE DRAFT CHANGING ROOM -- mirrors `PitchEditorSheet` exactly (same sheet chrome, same
 * Cancel/Save footer shape), the only differences being the two-action photo picker the brief asks
 * for and the quantity control. Quantity expands into that many individually-addressable canonical
 * rows only at RPC-creation time (`create-venue-data.ts`) -- never a decorative count stored as-is.
 */
export function ChangingRoomEditorSheet({ visible, initial, onClose, onSave, onDelete }: { visible: boolean; initial: ChangingRoomDraft | null; onClose: () => void; onSave: (room: ChangingRoomDraft) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState<ChangingRoomDraft>(initial ?? emptyChangingRoomDraft("new"))
  useEffect(() => {
    if (visible) setDraft(initial ?? emptyChangingRoomDraft(String(Date.now())))
  }, [visible, initial])

  const valid = changingRoomDraftValid(draft)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, maxHeight: "90%", gap: space.md }, elevation.sheet]}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {initial ? "Edit Changing Room" : "Add Changing Room"}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
            <PhotoPicker photo={draft.photo} onChange={(photo) => setDraft((d) => ({ ...d, photo }))} domain="CHANGING_ROOM" label="Changing Room Photos" overline="CHANGING ROOM PHOTO" />

            <Field label="Changing Room Name">
              <TextField label="Changing Room Name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} placeholder="Home Changing Room" />
            </Field>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>TYPE OF CHANGING ROOM</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {ROOM_TYPE_OPTIONS.map((o) => {
                  const on = o.value === draft.roomType
                  return (
                    <Pressable
                      key={o.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={o.label}
                      onPress={() => setDraft((d) => ({ ...d, roomType: o.value }))}
                      style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.line, backgroundColor: on ? colour.forest800 : colour.surface }}
                    >
                      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>QUANTITY</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Decrease quantity"
                  disabled={draft.quantity <= 1}
                  onPress={() => setDraft((d) => ({ ...d, quantity: Math.max(1, d.quantity - 1) }))}
                  style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, alignItems: "center", justifyContent: "center", opacity: draft.quantity <= 1 ? 0.4 : pressed ? 0.85 : 1 })}
                >
                  <Minus size={17} color={colour.ink} />
                </Pressable>
                <Text style={[type.heading, { color: colour.ink, minWidth: 28, textAlign: "center" }]}>{draft.quantity}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Increase quantity"
                  onPress={() => setDraft((d) => ({ ...d, quantity: d.quantity + 1 }))}
                  style={({ pressed }) => ({ width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
                >
                  <Plus size={17} color={colour.ink} />
                </Pressable>
              </View>
              <View style={{ borderRadius: radius.md, backgroundColor: colour.chalk, padding: space.sm }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>You can add more than one of this type, for example multiple home or away changing rooms.</Text>
              </View>
            </View>
          </ScrollView>

          <View style={{ gap: space.sm }}>
            <Button label="Save Changing Room" onPress={() => onSave(draft)} disabled={!valid} />
            {onDelete ? <Button label="Delete Changing Room" variant="danger" onPress={onDelete} /> : <Button label="Cancel" variant="quiet" onPress={onClose} />}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
