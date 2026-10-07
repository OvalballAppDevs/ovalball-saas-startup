import { Pressable, Text } from "react-native"

import { colour, radius, space, type } from "../design/tokens"

/**
 * A FILTER CHIP -- one option among several, with an optional count. Moved here from the Event Centre so the
 * Stock Media Library's categories and the Event Centre's audiences are the same control rather than two.
 */
export function FilterChip({ label, selected, onPress, count }: { label: string; selected: boolean; onPress: () => void; count?: number | null }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count !== undefined && count !== null ? `${label}, ${count}` : label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? colour.forest800 : colour.lineStrong, backgroundColor: selected ? colour.forest800 : colour.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink }]}>{label}</Text>
      {count !== undefined && count !== null && <Text style={[type.caption, { color: selected ? colour.onForestMuted : colour.inkMuted }]}>{count}</Text>}
    </Pressable>
  )
}
