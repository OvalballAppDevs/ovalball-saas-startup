import { Pressable, Text, View } from "react-native"
import { listTime, unreadLabel, type MessengerRow, type PresenceState } from "@ovalball/contracts"

import { ClubCrest, PersonAvatar } from "../identity"
import { BellOff, ChevronRight, LifeBuoy, Megaphone } from "../icons"
import { TOUCH_TARGET, colour, font, messenger, onForest, space, type } from "../../design/tokens"

/**
 * ONE CONVERSATION ROW, wherever a conversation is listed on a phone.
 *
 * Messages Home draws it on the forest ground and the compact messenger draws it on white; the row is
 * the same row, from the same canonical `MessengerRow`, so a conversation never reads one way in the
 * dropdown and another in the full list.
 *
 * WHO IT IS WITH decides the picture: a PERSON gets their own picture (initials where none) and, in a
 * direct conversation, the presence dot the server allows; a club or fixture thread gets the club's
 * crest; announcements and Support get their own symbol. A person is never given a crest.
 */
export function ConversationRow({
  row,
  presence,
  tone,
  onPress,
  dense = false,
  muted = false,
}: {
  /** The person has muted this conversation: it stays listed, quieter, with a bell-off mark. */
  muted?: boolean
  row: MessengerRow
  presence?: PresenceState | null
  tone: "forest" | "light"
  onPress?: () => void
  dense?: boolean
}) {
  const unread = row.unreadCount > 0
  const onDark = tone === "forest"
  const titleInk = onDark ? onForest.primary : colour.ink
  const quietInk = onDark ? onForest.secondary : colour.inkMuted
  const avatarSize = dense ? 40 : 48
  const spoken = [
    row.title,
    presence?.label ?? null,
    row.kind === "direct" ? null : row.context,
    row.preview,
    unread ? unreadLabel(row.unreadCount) : null,
    muted ? "Muted" : null,
    onPress ? null : "Open this on the Ovalball website",
  ]
    .filter(Boolean)
    .join(". ")

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={spoken}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + (dense ? 12 : 24),
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: dense ? 9 : 12,
        paddingHorizontal: dense ? space.md : space.lg,
        backgroundColor: pressed ? (onDark ? messenger.pressedOnForest : messenger.pressed) : "transparent",
        opacity: onPress ? 1 : 0.72,
      })}
    >
      <View>
        <RowPicture row={row} size={avatarSize} onDark={onDark} />
        {presence?.online && (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: dense ? 12 : 14,
              height: dense ? 12 : 14,
              borderRadius: 7,
              backgroundColor: colour.pitch400,
              borderWidth: 2,
              borderColor: onDark ? colour.forest950 : colour.surface,
            }}
          />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.8} style={[type.body, { color: titleInk, flex: 1, fontSize: dense ? 15 : 16, fontFamily: unread ? font.bodySemi : font.bodyMedium }]}>
            {row.title}
          </Text>
          {muted && <BellOff size={13} color={quietInk} strokeWidth={2} />}
          <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: unread ? (onDark ? colour.pitch400 : colour.rugby700) : quietInk, fontFamily: unread ? type.smallMedium.fontFamily : type.caption.fontFamily }]}>
            {listTime(row.activityAt)}
          </Text>
        </View>
        {!dense && row.kind !== "direct" && !!row.context && (
          <Text numberOfLines={1} style={[type.caption, { color: quietInk, marginTop: 1 }]}>
            {row.context}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 3 }}>
          <Text numberOfLines={dense ? 1 : 2} maxFontSizeMultiplier={1.8} style={[type.small, { color: unread ? titleInk : quietInk, flex: 1, fontSize: dense ? 13 : 14, fontFamily: unread ? font.bodyMedium : font.body }]}>
            {row.preview ?? "No messages yet"}
          </Text>
          {unread ? (
            <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: onDark ? colour.pitch400 : colour.pitch600, alignItems: "center", justifyContent: "center" }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: onDark ? colour.forest950 : colour.onForest, fontSize: 10.5, lineHeight: 13, fontFamily: font.bodySemi }}>
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </Text>
            </View>
          ) : !onPress ? (
            <Text style={[type.caption, { color: quietInk }]}>On the web</Text>
          ) : dense ? null : (
            <ChevronRight size={15} color={onDark ? onForest.faint : colour.inkSubtle} />
          )}
        </View>
      </View>
    </Pressable>
  )
}

function RowPicture({ row, size, onDark }: { row: MessengerRow; size: number; onDark: boolean }) {
  if (row.kind === "direct") return <PersonAvatar name={row.title} url={row.avatarUrl ?? null} size={size} />
  if (row.kind === "announcement" || row.kind === "support") {
    const Icon = row.kind === "announcement" ? Megaphone : LifeBuoy
    return (
      <View
        accessibilityElementsHidden
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: onDark ? messenger.wellOnForest : colour.mint100 }}
      >
        <Icon size={size * 0.44} color={onDark ? colour.mint300 : colour.forest800} strokeWidth={1.9} />
      </View>
    )
  }
  return <ClubCrest clubName={row.title} url={row.logoUrl} size={size} />
}

/** Rows grouped for the filter chips -- only the kinds that actually exist in this person's list are offered. */
export type InboxFilter = "all" | "unread" | "direct" | "groups" | "announcements"

export function matchesFilter(row: MessengerRow, filter: InboxFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "unread":
      return row.unreadCount > 0
    case "direct":
      return row.kind === "direct"
    case "groups":
      return row.kind === "fixture" || row.kind === "request" || row.kind === "club"
    case "announcements":
      return row.kind === "announcement"
  }
}

/** Search across what is already listed -- never a directory of people. */
export function matchesSearch(row: MessengerRow, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return [row.title, row.context, row.preview].some((text) => (text ?? "").toLowerCase().includes(q))
}

