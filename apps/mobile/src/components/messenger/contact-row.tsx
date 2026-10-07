import { ActivityIndicator, Pressable, Text, View } from "react-native"
import type { PresenceState } from "@ovalball/contracts"

import { ClubCrest, PersonAvatar } from "../identity"
import { ChevronRight, Users } from "../icons"
import { TOUCH_TARGET, colour, space, type } from "../../design/tokens"

/**
 * A PERSON OR GROUP YOU CAN MESSAGE -- one row, wherever somebody chooses who to write to.
 *
 * Messenger-style, not a directory card: the picture (a person's own, initials otherwise; a club's crest only for a
 * group), the name, one line of who they are to you, and a quiet presence line where the server allows it. Rows sit
 * directly on the canvas with an inset hairline between them.
 */
export function ContactRow({
  name,
  context,
  avatarUrl,
  presence,
  group = false,
  first,
  busy = false,
  dimmed = false,
  compact = false,
  onPress,
}: {
  name: string
  context: string | null
  avatarUrl?: string | null
  presence?: PresenceState | null
  /** A group conversation: shown by its club identity, never as a person. */
  group?: boolean
  first: boolean
  busy?: boolean
  dimmed?: boolean
  compact?: boolean
  onPress: () => void
}) {
  const size = compact ? 40 : 46
  const spoken = [`${group ? "Open" : "Message"} ${name}`, context, presence?.label].filter(Boolean).join(", ")
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ busy, disabled: dimmed }}
      disabled={busy || dimmed}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + (compact ? 10 : 18),
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: compact ? 8 : 10,
        paddingHorizontal: compact ? space.md : space.lg,
        backgroundColor: pressed ? colour.line : "transparent",
        opacity: dimmed ? 0.5 : 1,
      })}
    >
      <View>
        {group ? <ClubCrest clubName={name} url={avatarUrl ?? null} size={size} /> : <PersonAvatar name={name} url={avatarUrl ?? null} size={size} />}
        {!!presence?.online && (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: colour.pitch400, borderWidth: 2, borderColor: colour.chalk }}
          />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.8} style={[type.bodyMedium, { color: colour.ink, fontSize: compact ? 15 : 16 }]}>
          {name}
        </Text>
        {!!context && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {group && <Users size={12} color={colour.inkSubtle} strokeWidth={2} />}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[type.caption, { color: colour.inkMuted, flex: 1, fontSize: 13 }]}>
              {context}
            </Text>
          </View>
        )}
        {!!presence?.label && (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={[type.caption, { color: presence.online ? colour.rugby700 : colour.inkSubtle }]}>
            {presence.label}
          </Text>
        )}
      </View>
      {busy ? <ActivityIndicator color={colour.forest800} /> : <ChevronRight size={16} color={colour.inkSubtle} />}
      {/* THE SEPARATOR STARTS AFTER THE PICTURE, so the list reads as people rather than a table. */}
      {!first && <View style={{ position: "absolute", top: 0, right: 0, left: (compact ? space.md : space.lg) + size + space.md, height: 1, backgroundColor: colour.line }} />}
    </Pressable>
  )
}

/** A quiet section label over a group of rows. */
export function ContactSection({ title, children, compact = false }: { title: string | null; children: React.ReactNode; compact?: boolean }) {
  return (
    <View>
      {!!title && (
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: compact ? space.md : space.lg, paddingTop: compact ? space.md : space.lg, paddingBottom: space.xs }]}
        >
          {title.toUpperCase()}
        </Text>
      )}
      {children}
    </View>
  )
}
