import { Pressable, Text, View } from "react-native"

import { ChevronRight } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * NEEDS ATTENTION — the reusable treatment, established once.
 *
 * WHAT IT IS FOR. Exceptional work: an unanswered availability request, a fixture request waiting, a
 * join request, a subscription that failed. Everything the navigation deliberately does NOT hold,
 * because navigation is for recurring jobs and this is for the thing that happens to be true today.
 *
 * IT IS NOT AN ALARM LIST. A red block of five rows teaches people to ignore it, and most of what
 * lands here is simply a job -- somebody has not said whether they can play. So the default tone is
 * quiet and informational, `urgent` is reserved for something genuinely at risk, and nothing is red
 * merely because it is outstanding. Priority is expressed by ORDER first and colour second.
 *
 * EVERY ITEM IS A DESTINATION. An item that cannot be acted on is a notification, not attention --
 * so each row takes an `onPress` and reads as a row you go through, with a chevron that says so.
 */

export interface AttentionItem {
  key: string
  label: string
  /** The count, where one exists. Rendered as part of the sentence, never as a bare badge. */
  detail?: string | null
  urgent?: boolean
  /**
   * WHO THIS JOB BELONGS TO, where it belongs to a person.
   *
   * A family of two gets one row per child, and a picture is how a parent finds
   * the right one without reading. Passed in as a node rather than as a name and a
   * URL, because the caller holds the projection and this component must not start
   * resolving an identity of its own.
   */
  leading?: React.ReactNode
  onPress?: () => void
}

export function NeedsAttention({ items, showHeading = true }: { items: AttentionItem[]; showHeading?: boolean }) {
  if (items.length === 0) return null

  // Urgent first, then the order the caller gave -- which is the domain's own sense of priority.
  const ordered = [...items].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)))

  return (
    <View>
      {showHeading && (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Needs Attention
        </Text>
        <View
          style={{
            minWidth: 22,
            height: 22,
            paddingHorizontal: 7,
            borderRadius: radius.pill,
            backgroundColor: colour.forest800,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[type.caption, { color: colour.onForest, fontFamily: type.smallMedium.fontFamily }]}>
            {ordered.length}
          </Text>
        </View>
      </View>
      )}

      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {ordered.map((item, index) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={[item.label, item.detail].filter(Boolean).join(". ")}
            disabled={!item.onPress}
            onPress={item.onPress}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 8,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.lg,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colour.line,
              backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
            })}
          >
            {/* A 3pt rule rather than a coloured background: present enough to rank the row, quiet
                enough that five of them do not read as five errors. */}
            <View
              style={{
                width: 3,
                alignSelf: "stretch",
                borderRadius: 2,
                backgroundColor: item.urgent ? colour.warning : colour.pitch600,
              }}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {item.leading}
              <Text style={[type.small, { color: colour.ink }]}>{item.label}</Text>
              {!!item.detail && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>{item.detail}</Text>
              )}
            </View>
            {item.onPress && <ChevronRight size={17} color={colour.inkSubtle} />}
          </Pressable>
        ))}
      </View>
    </View>
  )
}
