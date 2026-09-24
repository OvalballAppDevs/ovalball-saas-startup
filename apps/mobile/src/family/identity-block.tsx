import { Pressable, Text, View } from "react-native"

import { useFamily } from "./family"
import { StackedAvatars, distinctChildren, teamsFor } from "./child-selector"
import { PersonAvatar } from "../components/identity"
import { ChevronDown } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHOSE RUGBY THIS SCREEN IS READING (CA-M9).
 *
 * The header above names the signed-in PERSON and the context they stand in; this names the CHILD (or
 * all of them) whose rugby the page shows, and opens the selector. The two are never the same picture:
 * a child's avatar is never the person's, and neither is ever a crest or a kit.
 *
 * Absent for a family of one -- a selector between one thing and itself is furniture.
 */
export function FamilyIdentityBlock({ onOpen }: { onOpen: () => void }) {
  const { projection, selected, selectedPlayerId, hasChoice } = useFamily()
  if (!hasChoice) return null
  const children = distinctChildren(projection.members)
  const teams = selected ? teamsFor(projection.members, selected.playerId) : []
  const title = selected ? selected.fullName : "All Children"
  const caption = selected
    ? teams.map((t) => t.teamName).join(" · ") + (teams[0] ? ` · ${teams[0].clubName}` : "")
    : children.map((c) => c.firstName).join(", ")

  return (
    <View style={{ paddingHorizontal: space.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${title}. ${caption}. Change whose rugby is shown`}
        onPress={onOpen}
        style={({ pressed }) => ({
          minHeight: TOUCH_TARGET + 12,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: pressed ? colour.chalk : colour.surface,
        })}
      >
        {selected ? (
          <PersonAvatar name={selected.fullName} url={selected.avatarUrl} initials={selected.initials} size={40} />
        ) : (
          <StackedAvatars members={children} size={32} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.inkSubtle, letterSpacing: 0.6 }]}>{selectedPlayerId ? "SHOWING" : "SHOWING ALL"}</Text>
          <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
          {!!caption && <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{caption}</Text>}
        </View>
        <ChevronDown size={18} color={colour.inkSubtle} />
      </Pressable>
    </View>
  )
}
