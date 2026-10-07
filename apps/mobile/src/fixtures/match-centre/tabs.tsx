import { useEffect, useRef } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

import { MATCH_CENTRE_SECTION_LABEL, type MatchCentreSection } from "@ovalball/contracts/match-centre/sections"

import { colour, space, type } from "../../design/tokens"

/**
 * THE MATCH CENTRE'S SECTIONS -- one scrollable bar that stays at the top while a section scrolls. Every
 * game draws it: a fixture with all six sections, a tournament game with the ones a single game of a
 * tournament has. The words are the one canonical list (`MATCH_CENTRE_SECTION_LABEL`).
 */
export function MatchCentreTabs({
  tabs,
  section,
  onSelect,
}: {
  tabs: readonly MatchCentreSection[]
  section: MatchCentreSection
  onSelect: (next: MatchCentreSection) => void
}) {
  // A LINK THAT OPENS A LATER SECTION SHOWS ITS TAB. Each tab's position is remembered as it lays out,
  // and the bar scrolls the selected one into view -- otherwise Rewards, opened from a notification,
  // would be selected but off the edge of the screen.
  const bar = useRef<ScrollView>(null)
  const offsets = useRef<Record<string, number>>({})
  useEffect(() => {
    const x = offsets.current[section]
    if (x !== undefined) bar.current?.scrollTo({ x: Math.max(0, x - space.lg), animated: true })
  }, [section])

  return (
    <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
      <ScrollView ref={bar} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.sm }} accessibilityRole="tablist">
        {tabs.map((t) => {
          const selected = t === section
          return (
            <Pressable
              key={t}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={MATCH_CENTRE_SECTION_LABEL[t]}
              onPress={() => onSelect(t)}
              onLayout={(e) => {
                offsets.current[t] = e.nativeEvent.layout.x
                if (t === section) bar.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - space.lg), animated: false })
              }}
              style={({ pressed }) => ({
                minHeight: 48,
                paddingHorizontal: space.md,
                justifyContent: "center",
                borderBottomWidth: 3,
                borderBottomColor: selected ? colour.forest800 : "transparent",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: selected ? colour.forest800 : colour.inkMuted, fontFamily: selected ? "Inter_600SemiBold" : "Inter_500Medium" }]}>
                {MATCH_CENTRE_SECTION_LABEL[t]}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}
