import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import {
  EMPTY_TOURNAMENT_FILTERS,
  TOURNAMENT_AGE_GROUPS,
  TOURNAMENT_FORMAT_LABELS,
  type TournamentFilters,
  type TournamentFormat,
  type TournamentRelationship,
  type TournamentVisibility,
} from "@ovalball/contracts/club/tournaments"

import { BottomSheet } from "../components/bottom-sheet"
import { Button } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * TOURNAMENT FILTERS -- a designed bottom sheet, not a modal alert.
 *
 * Deliberately small. Four groups a person actually uses when they are looking for one tournament
 * among many, and nothing else: what our relationship to it is, whether it is open to the network,
 * how it is run, and which age group it is for. Scheduling filters belong to the planning phase and
 * are not invented here.
 *
 * An empty group means "no opinion" and matches everything in it -- never "none", which would show a
 * person an empty list for having opened the sheet and closed it again.
 */
export function TournamentFilterSheet({
  visible,
  initial,
  ageGroupsPresent,
  onClose,
  onApply,
}: {
  visible: boolean
  initial: TournamentFilters
  /** Only the grades that actually appear in this club's tournaments -- offering U7…U16+ when none
   * exist would be a menu of dead ends. */
  ageGroupsPresent: string[]
  onClose: () => void
  onApply: (filters: TournamentFilters) => void
}) {
  const [draft, setDraft] = useState<TournamentFilters>(initial)

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  const ages = ageGroupsPresent.length > 0 ? ageGroupsPresent : [...TOURNAMENT_AGE_GROUPS]

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter Tournaments">
      <View style={{ gap: space.lg }}>
        <Group label="STATUS">
          {(["hosting", "attending", "past"] as TournamentRelationship[]).map((r) => (
            <Chip
              key={r}
              label={r === "hosting" ? "Hosting" : r === "attending" ? "Attending" : "Past"}
              on={draft.relationships.includes(r)}
              onPress={() => setDraft((d) => ({ ...d, relationships: toggle(d.relationships, r) }))}
            />
          ))}
        </Group>

        <Group label="VISIBILITY">
          {(["public", "private"] as TournamentVisibility[]).map((v) => (
            <Chip
              key={v}
              label={v === "public" ? "Public" : "Private"}
              on={draft.visibilities.includes(v)}
              onPress={() => setDraft((d) => ({ ...d, visibilities: toggle(d.visibilities, v) }))}
            />
          ))}
        </Group>

        <Group label="FORMAT">
          {(Object.keys(TOURNAMENT_FORMAT_LABELS) as TournamentFormat[]).map((f) => (
            <Chip
              key={f}
              label={TOURNAMENT_FORMAT_LABELS[f].label}
              on={draft.formats.includes(f)}
              onPress={() => setDraft((d) => ({ ...d, formats: toggle(d.formats, f) }))}
            />
          ))}
        </Group>

        <Group label="AGE GROUP">
          {ages.map((a) => (
            <Chip key={a} label={a} on={draft.ageGroups.includes(a)} onPress={() => setDraft((d) => ({ ...d, ageGroups: toggle(d.ageGroups, a) }))} />
          ))}
        </Group>

        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          <View style={{ flex: 1 }}>
            <Button label="Clear Filters" variant="secondary" onPress={() => setDraft(EMPTY_TOURNAMENT_FILTERS)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Apply Filters" onPress={() => onApply(draft)} />
          </View>
        </View>
      </View>
    </BottomSheet>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>{children}</View>
    </View>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 36,
        paddingHorizontal: space.md,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        backgroundColor: on ? colour.forest800 : colour.surface,
        borderWidth: 1,
        borderColor: on ? colour.forest800 : colour.line,
      }}
    >
      <Text style={[type.caption, { color: on ? "#FFFFFF" : colour.ink, fontFamily: "Inter_600SemiBold" }]}>{label}</Text>
    </Pressable>
  )
}

export const FILTER_SHEET_TOUCH_TARGET = TOUCH_TARGET
