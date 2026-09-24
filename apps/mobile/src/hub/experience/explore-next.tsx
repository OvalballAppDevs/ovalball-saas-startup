import { Pressable, ScrollView, Text, View } from "react-native"
import { hubEntityTypeLabel, type HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"

import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { HubOverline } from "../ui"
import { HubTypeIcon } from "./type-icon"

/**
 * EXPLORE NEXT -- the graph made tactile.
 *
 * A horizontal rail of the canonical relationships of the thing being read: a term, the rule it
 * cites, the officiating angle, the coaching angle. Every card is a real destination reached
 * through the one route table; the type label and glyph say where the path leads. Nothing here is
 * chosen by popularity or at random -- `exploreNext` in the shared package picks the spread.
 */
export function HubExploreNext({ items, onOpen, heading = "Explore Next" }: { items: HubRelatedEntity[]; onOpen: (entity: HubRelatedEntity) => void; heading?: string }) {
  if (items.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      <HubOverline tone="forest">{heading}</HubOverline>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }} style={{ marginHorizontal: -space.lg, paddingHorizontal: space.lg }}>
        {items.map((item) => (
          <Pressable
            key={item.href}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${hubEntityTypeLabel(item.type)}`}
            onPress={() => onOpen(item)}
            style={({ pressed }) => ({
              width: 168,
              minHeight: TOUCH_TARGET * 2,
              padding: space.md,
              gap: space.sm,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: pressed ? "rgba(50,166,101,0.5)" : colour.line,
              backgroundColor: pressed ? "rgba(220,247,229,0.5)" : colour.surface,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <HubTypeIcon type={item.type} size={14} color={colour.forest800} />
              <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, textTransform: "uppercase" }]} numberOfLines={1}>
                {hubEntityTypeLabel(item.type)}
              </Text>
            </View>
            <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={3}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
