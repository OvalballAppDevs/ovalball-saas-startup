import { useEffect, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Field, TextField } from "../components/form"
import { SideIdentityFields } from "./side-identity-fields"
import { Info, X } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * A CLUB THAT IS NOT ON OVALBALL.
 *
 * NO EMAIL, NO ACCOUNT, NO INVITATION. Plenty of clubs a festival invites are simply not on Ovalball,
 * and the organiser knows perfectly well who is coming. Demanding an email address to write that down
 * would make the tournament wrong rather than make the club join.
 *
 * So this records two facts -- who the club is, and which side they are bringing -- and the side is
 * saved as `external_recorded`: a statement about who is attending, never a request they must answer.
 * The side needs its own name because a club with no Ovalball teams has no team row to point at, and
 * a club may well bring two.
 *
 * ITS OWN KEYBOARD-AWARE MODAL RATHER THAN THE SHARED `BottomSheet`, which has no keyboard handling:
 * found in the Simulator, where raising the keyboard for Club Name buried the Team Name field and the
 * Add Team button underneath it, with no way to scroll to them. This is the only sheet in the Create
 * Tournament flow that asks a person to type, so the handling lives here rather than being pushed into
 * a shared component every other sheet in the app also uses.
 */
export function ExternalClubSheet({
  visible,
  ageGroup,
  tournamentAgeGroups,
  onClose,
  onAdd,
}: {
  visible: boolean
  ageGroup: string
  /** The grades this tournament runs. A manually recorded club goes into one of them, chosen -- never
   * inferred from whatever was typed as its alias. */
  tournamentAgeGroups: string[]
  onClose: () => void
  onAdd: (input: { clubName: string; ageGroup: string; alias: string | null }) => void
}) {
  const insets = useSafeAreaInsets()
  const [clubName, setClubName] = useState("")
  const [side, setSide] = useState("")
  // Preselected to the competition the sheet was opened from; still explicit, still changeable.
  const [grade, setGrade] = useState(ageGroup)

  useEffect(() => {
    if (!visible) {
      setClubName("")
      setSide("")
    } else {
      // Reopening from a different competition tab preselects that competition.
      setGrade(ageGroup)
    }
  }, [visible, ageGroup])

  const club = clubName.trim()
  // THE ALIAS IS NOT THE GRADE. It used to fall back to the age group, which made "U12" look like a
  // side's name and meant an unnamed side carried a label nobody typed.
  const alias = side.trim() || null
  const valid = club.length > 1

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(7,28,20,0.45)" }}>
        <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + space.sm }}>
          <View style={{ alignItems: "center", paddingTop: space.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md }}>
            <Text style={[type.title, { flex: 1, color: colour.ink }]}>Add Club Manually</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Use this only if the club cannot be found in Ovalball.
            </Text>

            <Field label="Club Name">
              <TextField label="Club Name" value={clubName} onChange={setClubName} placeholder="Ribblesdale Wanderers RUFC" />
            </Field>

            <SideIdentityFields
              ageGroups={tournamentAgeGroups}
              ageGroup={grade}
              onAgeGroup={setGrade}
              alias={side}
              onAlias={setSide}
            />

            <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
              <View style={{ paddingTop: 1 }}>
                <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
              </View>
              <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
                No invitation or email is sent. This records the side as taking part in this tournament.
                Add the club again with a different team name if they are bringing more than one side.
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add Team"
              disabled={!valid}
              onPress={() => {
                onAdd({ clubName: club, ageGroup: grade, alias })
                onClose()
              }}
              style={({ pressed }) => ({
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: colour.forest800,
                opacity: !valid ? 0.45 : pressed ? 0.88 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: colour.onForest }]}>Add Team</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
