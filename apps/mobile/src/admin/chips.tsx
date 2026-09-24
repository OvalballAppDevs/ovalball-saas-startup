import { Pressable, Text, View } from "react-native"

import { colour, radius, space, type } from "../design/tokens"

/**
 * ONE CHOICE FROM A SHORT LIST, as pills -- the same control the People screens draw for a filter or a
 * role. Nothing is chosen until somebody chooses it: a caller that wants no pre-selection passes null.
 */
export function ChoiceChips<T extends string>({ label, options, value, onChange, hint }: { label: string; options: { key: T; label: string }[]; value: T | null; onChange: (key: T) => void; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      {hint && <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {options.map((o) => {
          const on = value === o.key
          return (
            <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label} onPress={() => onChange(o.key)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
              <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
            </Pressable>
          )
        })}
        {options.length === 0 && <Text style={[type.caption, { color: colour.inkSubtle }]}>Nothing to choose from.</Text>}
      </View>
    </View>
  )
}

/** A quiet in-page notice: what just happened, or a warning that must not be missed. */
export function Notice({ tone, text }: { tone: "ok" | "error" | "warning"; text: string }) {
  const bg = tone === "error" ? colour.dangerSurface : tone === "warning" ? colour.warningSurface : colour.successSurface
  const fg = tone === "error" ? colour.danger : tone === "warning" ? colour.warning : colour.forest800
  return (
    <View accessibilityRole={tone === "error" ? "alert" : undefined} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: bg }}>
      <Text style={[type.small, { color: fg }]}>{text}</Text>
    </View>
  )
}
