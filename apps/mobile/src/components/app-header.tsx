import { Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppContexts } from "../context/contexts"
import { ClubCrest, PersonAvatar } from "./identity"
import { Bell, ChevronDown } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE HEADER — who I am, what I am operating as, and what needs me.
 *
 * NOT THE DESKTOP IDENTITY BLOCK. The sidebar's version can afford an avatar, a name, a role, a club
 * and a switcher stacked vertically because it has a column to itself. A phone has about 56pt before
 * the header is stealing the content's room, so this is one row: the person on the left, the context
 * in the middle as the tappable thing, notifications on the right.
 *
 * THE CONTEXT IS THE BUTTON, and it is the widest target on the row, because switching is the single
 * most characteristic thing this product does. A chevron says so; an avatar that silently opens a
 * menu does not.
 *
 * THE AVATAR IS THE PERSON. It stays the signed-in adult even when the selected context is a child --
 * the header says who you ARE, and the context row beside it says what you are looking at. This is the
 * platform-wide invariant, and the components it uses have nowhere to pass a club crest.
 */
export function AppHeader({
  onOpenContexts,
  onOpenNotifications,
  unreadCount = 0,
}: {
  onOpenContexts: () => void
  onOpenNotifications?: () => void
  unreadCount?: number
}) {
  const insets = useSafeAreaInsets()
  const { person, active, contexts, club } = useAppContexts()
  const switchable = contexts.length > 1
  // The OWNING CLUB's identity, from the provider -- so every screen shows the same crest and the same
  // initials. Taking it as a prop is how the team's own initials ended up where the club's belong on
  // the screens that did not pass it.
  const clubName = club.name
  const crestUrl = club.crestUrl

  const caption = active
    ? active.subjectName
      ? [active.subjectClubName, active.label].filter(Boolean).join(" · ")
      : [clubName && clubName !== active.label ? clubName : null, active.roleLabel].filter(Boolean).join(" · ")
    : ""

  return (
    <View
      style={{
        paddingTop: insets.top + space.sm,
        paddingBottom: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: colour.chalk,
        borderBottomWidth: 1,
        borderBottomColor: colour.line,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
      }}
    >
      <PersonAvatar name={person.firstName} url={person.avatarUrl} size={36} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? `Viewing ${active.label}, ${caption}` : "No context selected"}
        accessibilityHint={switchable ? "Opens the clubs, teams and children you can switch to" : undefined}
        accessibilityState={{ disabled: !switchable }}
        disabled={!switchable}
        onPress={onOpenContexts}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.sm,
          marginLeft: -space.xs,
          borderRadius: radius.md,
          backgroundColor: pressed ? "rgba(16,21,18,0.05)" : "transparent",
        })}
      >
        {active && !active.subjectName && <ClubCrest clubName={clubName ?? active.label} url={crestUrl ?? active.logoUrl} size={30} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
            {active?.label ?? "Ovalball"}
          </Text>
          {!!caption && (
            <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
              {caption}
            </Text>
          )}
        </View>
        {switchable && <ChevronDown size={16} color={colour.inkMuted} />}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onPress={onOpenNotifications}
        hitSlop={8}
        style={({ pressed }) => ({
          width: TOUCH_TARGET,
          height: TOUCH_TARGET,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          backgroundColor: pressed ? "rgba(16,21,18,0.05)" : "transparent",
        })}
      >
        <Bell size={21} color={colour.ink} strokeWidth={1.9} />
        {unreadCount > 0 && (
          <View
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              minWidth: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colour.pitch600,
            }}
          />
        )}
      </Pressable>
    </View>
  )
}
