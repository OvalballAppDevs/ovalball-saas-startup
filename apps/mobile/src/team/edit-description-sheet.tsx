import { useState } from "react"
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { setTeamDescription } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { friendly } from "../errors/translate"
import { X } from "../components/icons"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

const MAX = 500

/**
 * EDIT TEAM DESCRIPTION -- a real, focused native composer for "About This Team" (owner brief Section
 * C), not a hand-off to Team Settings. Follows `AnnounceSheet`'s established shape -- a Modal lifted
 * above the keyboard, one job -- rather than the generic list-oriented `BottomSheet`, because a
 * multi-line field fighting the keyboard is exactly the problem that sheet already exists to solve.
 *
 * Saves through `setTeamDescription` (SECURITY DEFINER RPC, re-checks authority server-side); this
 * sheet's own gate is a convenience for someone who reached it honestly, never the real one.
 */
export function EditDescriptionSheet({
  teamId,
  current,
  onClose,
  onSaved,
}: {
  teamId: string
  current: string | null
  onClose: () => void
  onSaved: (description: string | null) => void
}) {
  const insets = useSafeAreaInsets()
  const [text, setText] = useState(current ?? "")
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function save() {
    setProblem(null)
    setSaving(true)
    try {
      await setTeamDescription(supabase, teamId, text)
      // The same trim-to-null the server applies, mirrored here so the card updates immediately without
      // a second read -- "About This Team" already treats an empty value as null, never an empty string.
      onSaved(text.trim().length === 0 ? null : text.trim())
    } catch (caught) {
      setProblem(friendly(caught, "this description").message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={saving ? undefined : onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.lg, paddingBottom: insets.bottom + space.lg, paddingHorizontal: space.lg, gap: space.md, maxHeight: "88%" }, elevation.sheet]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Edit Team Description</Text>
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>Tell people about this team</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onClose} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed || saving ? 0.5 : 1 })}>
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
            {problem && (
              <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>
            )}

            <View>
              <TextInput
                accessibilityLabel="Team description"
                multiline
                autoFocus
                editable={!saving}
                value={text}
                onChangeText={(next) => setText(next.slice(0, MAX))}
                placeholder="A friendly note about this side -- who plays, what to expect."
                placeholderTextColor={colour.inkSubtle}
                style={[type.body, { minHeight: 120, color: colour.ink, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.chalk, textAlignVertical: "top" }]}
              />
              <Text style={[type.caption, { color: colour.inkSubtle, marginTop: space.xs, textAlign: "right" }]}>{text.length}/{MAX}</Text>
            </View>

            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={onClose} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET + 4, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface, opacity: saving ? 0.5 : 1 })}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.forest800, opacity: saving ? 0.7 : pressed ? 0.88 : 1 })}>
                {saving && <ActivityIndicator size="small" color={colour.onForest} />}
                <Text style={[type.smallMedium, { color: colour.onForest }]}>Save</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
