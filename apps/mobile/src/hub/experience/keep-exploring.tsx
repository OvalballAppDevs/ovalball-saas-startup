import { Pressable, Text, View } from "react-native"
import { hubEntityTypeLabel, type HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"

import { ChevronRight } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { HubOverline } from "../ui"
import { HubTypeIcon } from "./type-icon"

/**
 * KEEP EXPLORING -- the foot of a detail page.
 *
 * One to four canonical relationship destinations, as rows, so the page never ends in a footnote.
 * A thinly connected entity (one relationship in the graph) still gets its one row; only an entity
 * with nothing related at all ends without the foot.
 * The same projection as Explore Next; the rail shows the spread up top, this shows the next steps
 * at the bottom. It is never a feed: the list is the graph's, not an engagement score's.
 */
export function HubKeepExploring({ items, onOpen, limit = 4 }: { items: HubRelatedEntity[]; onOpen: (entity: HubRelatedEntity) => void; limit?: number }) {
  const rows = items.slice(0, Math.max(1, Math.min(limit, 4)))
  if (rows.length === 0) return null
  return (
    <View style={{ gap: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colour.line }}>
      <HubOverline tone="forest">Keep Exploring</HubOverline>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {rows.map((item, i) => (
          <Pressable
            key={item.href}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${hubEntityTypeLabel(item.type)}`}
            onPress={() => onOpen(item)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 12,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colour.line,
              backgroundColor: pressed ? "rgba(220,247,229,0.5)" : "transparent",
            })}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(220,247,229,0.7)", alignItems: "center", justifyContent: "center" }}>
              <HubTypeIcon type={item.type} size={16} color={colour.forest800} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{hubEntityTypeLabel(item.type)}</Text>
            </View>
            <ChevronRight size={18} color="rgba(16,21,18,0.3)" />
          </Pressable>
        ))}
      </View>
    </View>
  )
}
