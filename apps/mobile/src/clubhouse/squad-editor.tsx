import { useEffect, useMemo, useState } from "react"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { positionLabel, readTeamSquadDetails, setTeamSquadDetail, type TeamSquadDetails } from "@ovalball/contracts/match-centre/public-profiles"

import { supabase } from "../auth/supabase"
import { ChoiceSheet } from "../components/field-sheet"
import { Button, CardSkeleton } from "../components/ui"
import { ChevronDown } from "../components/icons"
import { friendly } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

type Draft = { shirtNumber: string; positionKey: string | null }

/**
 * SQUAD NUMBERS AND POSITIONS, for the people who manage the team's roster.
 *
 * The number and position belong to the player's place in THIS team (`team_squad_details`), so a player
 * in two sides can wear two numbers. Positions are the team's own rugby code's, plus the general words a
 * youth side uses; numbers run 0-99. One Save Changes for every row that changed; the server re-checks
 * `team.roster.manage` on each.
 */
export function SquadEditor({ teamId, onClose, onSaved }: { teamId: string; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets()
  const [details, setDetails] = useState<TeamSquadDetails | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [picker, setPicker] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void readTeamSquadDetails(supabase, teamId)
      .then((d) => {
        if (!live) return
        setDetails(d)
        setDrafts(Object.fromEntries(d.players.map((p) => [p.playerId, { shirtNumber: p.shirtNumber === null ? "" : String(p.shirtNumber), positionKey: p.positionKey }])))
      })
      .catch((caught) => live && setProblem(friendly(caught, "the squad").message))
    return () => {
      live = false
    }
  }, [teamId])

  const changed = useMemo(
    () =>
      (details?.players ?? []).filter((p) => {
        const d = drafts[p.playerId]
        return d && (d.shirtNumber !== (p.shirtNumber === null ? "" : String(p.shirtNumber)) || d.positionKey !== p.positionKey)
      }),
    [details, drafts]
  )

  const invalid = Object.values(drafts).some((d) => d.shirtNumber !== "" && !/^\d{1,2}$/.test(d.shirtNumber))

  async function save() {
    if (changed.length === 0 || invalid) return
    setSaving(true)
    setProblem(null)
    for (const p of changed) {
      const d = drafts[p.playerId]
      try {
        await setTeamSquadDetail(supabase, teamId, p.playerId, d.shirtNumber === "" ? null : Number(d.shirtNumber), d.positionKey)
      } catch (caught) {
        setSaving(false)
        setProblem(`${p.name}: ${friendly(caught, "the squad").message}`)
        onSaved()
        return
      }
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  const update = (playerId: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [playerId]: { ...all[playerId], ...patch } }))

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Numbers & Positions</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close without saving" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.sm }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          {!details && !problem && <CardSkeleton lines={4} />}
          {!!details && details.players.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>Nobody is in this squad yet.</Text>}
          {(details?.players ?? []).map((p) => {
            const d = drafts[p.playerId] ?? { shirtNumber: "", positionKey: null }
            return (
              <View key={p.playerId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
                <TextInput
                  accessibilityLabel={`Shirt number for ${p.name}`}
                  value={d.shirtNumber}
                  onChangeText={(t) => update(p.playerId, { shirtNumber: t.replace(/[^\d]/g, "").slice(0, 2) })}
                  keyboardType="number-pad"
                  placeholder="#"
                  placeholderTextColor={colour.inkSubtle}
                  maxLength={2}
                  style={[type.bodyMedium, { width: 52, minHeight: TOUCH_TARGET, textAlign: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink }]}
                />
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Position for ${p.name}: ${positionLabel(d.positionKey) ?? "not set"}. Change`}
                  onPress={() => setPicker(p.playerId)}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET, maxWidth: 150, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colour.lineStrong, opacity: pressed ? 0.85 : 1 })}
                >
                  <Text numberOfLines={1} style={[type.small, { color: d.positionKey ? colour.ink : colour.inkSubtle, flexShrink: 1 }]}>{positionLabel(d.positionKey) ?? "Position"}</Text>
                  <ChevronDown size={14} color={colour.inkSubtle} />
                </Pressable>
              </View>
            )
          })}
          {invalid && <Text style={[type.small, { color: colour.danger }]}>Shirt numbers run from 0 to 99.</Text>}
          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          {!!details && details.players.length > 0 && <Button label="Save Changes" busy={saving} disabled={changed.length === 0 || invalid} onPress={() => void save()} />}
        </ScrollView>
        <ChoiceSheet
          visible={picker !== null}
          title="Position"
          hint={details?.rugbyCode === "league" ? "Rugby league positions." : "Rugby union positions."}
          options={(details?.positions ?? []).map((k) => ({ id: k, name: positionLabel(k) ?? k }))}
          value={picker ? drafts[picker]?.positionKey ?? "" : ""}
          emptyMessage="No positions."
          onClose={() => setPicker(null)}
          saving={false}
          problem={null}
          onSave={(next) => {
            if (picker) update(picker, { positionKey: next || null })
            setPicker(null)
          }}
        />
      </View>
    </Modal>
  )
}
