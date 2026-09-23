import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import type { FamilyMember } from "@ovalball/contracts"

import { useFamily } from "../family/family"
import { TOUCH_TARGET, calendarTone, colour, onForest, radius, space, type } from "../design/tokens"

/**
 * ALL · PIPPA · GEORGE.
 *
 * A CHILD FILTER, AND NOTHING ELSE. Not a team selector, not an age-grade
 * selector, not a player picker. Every value in it comes from
 * `resolveFamilyScope` by way of the family projection, so the row cannot offer
 * a child this guardian does not hold -- there is no list here to be wrong.
 *
 * IT DISAPPEARS FOR A SINGLE-CHILD FAMILY. `hasChoice` counts DISTINCT children,
 * so a parent of one sees nothing at all even when that child plays for two
 * sides: a chooser between one thing and itself is a control that cannot do
 * anything, and offering "Pippa · Pippa" would be a team selector wearing a
 * child's name.
 *
 * THE CHILD'S OWN FACE, where there is one. A parent scanning a row of children
 * recognises a photograph before a name, and the picture is the child's -- never
 * the guardian's, never a crest. Where there is none, initials: youth
 * participation does not require a photograph and initials are the honest
 * answer rather than a degraded one.
 *
 * SELECTION IS NEVER CARRIED BY COLOUR ALONE. The chosen chip is filled, ringed
 * and announced with `accessibilityState.selected`.
 */
export function ChildFilter({
  style,
  tone = "chalk",
}: {
  style?: object
  /**
   * The ground the chips are standing on. On the Calendar they sit on forest, so
   * an unselected chip becomes a light outline rather than a white pill -- a row of
   * white pills on the brand ground is the fragmented look the rebuild removed.
   */
  tone?: "chalk" | "forest"
}) {
  const { projection, selectedPlayerId, hasChoice, select } = useFamily()
  if (!hasChoice) return null

  // One chip per DISTINCT child. A child on two teams is one person.
  const seen = new Set<string>()
  const children: FamilyMember[] = []
  for (const member of projection.members) {
    if (seen.has(member.playerId)) continue
    seen.add(member.playerId)
    children.push(member)
  }

  return (
    <View style={style}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // A family of five should scroll rather than wrap into a second row that
        // pushes the week's rugby off the screen.
        contentContainerStyle={{ flexDirection: "row", gap: space.sm, paddingRight: space.lg }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Show one child, or all of them"
      >
        <Chip label="All" tone={tone} selected={selectedPlayerId === null} onPress={() => select(null)} />
        {children.map((child) => (
          <Chip
            key={child.playerId}
            label={child.shortLabel}
            tone={tone}
            avatarUrl={child.avatarUrl}
            initials={child.initials}
            selected={selectedPlayerId === child.playerId}
            onPress={() => select(child.playerId)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

function Chip({
  label,
  avatarUrl,
  initials,
  selected,
  onPress,
  tone,
}: {
  label: string
  avatarUrl?: string | null
  initials?: string
  selected: boolean
  onPress: () => void
  tone: "chalk" | "forest"
}) {
  const onForestGround = tone === "forest"
  const selectedGround = onForestGround ? calendarTone.selected : colour.forest800
  const selectedInk = onForestGround ? calendarTone.selectedInk : colour.onForest
  const restingGround = onForestGround ? "transparent" : colour.surface
  const restingEdge = onForestGround ? onForest.line : colour.lineStrong
  const restingInk = onForestGround ? onForest.primary : colour.ink
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: avatarUrl || initials ? space.xs : space.lg,
        paddingRight: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? selectedGround : restingEdge,
        backgroundColor: selected ? selectedGround : restingGround,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {(avatarUrl || initials) && (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected
              ? onForestGround
                ? "rgba(7,28,20,0.18)"
                : "rgba(255,255,255,0.18)"
              : onForestGround
                ? "rgba(255,255,255,0.14)"
                : colour.mint100,
          }}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={{ width: 30, height: 30 }} contentFit="cover" transition={120} />
          ) : (
            <Text style={[type.caption, { color: selected ? selectedInk : restingInk, fontFamily: "Inter_600SemiBold" }]}>
              {initials}
            </Text>
          )}
        </View>
      )}
      {/* Long names shrink rather than truncating: a child's name is not a chip
          label somebody chose, it is what they are called. */}
      <Text
        numberOfLines={1}
        style={[type.smallMedium, { color: selected ? selectedInk : restingInk, flexShrink: 1, maxWidth: 150 }]}
      >
        {label}
      </Text>
    </Pressable>
  )
}
