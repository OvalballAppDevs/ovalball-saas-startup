import { Image, Pressable, Text, View } from "react-native"
import type { KitConfig } from "@ovalball/contracts/agenda/kit"

import { RugbyKit } from "../components/rugby-kit"
import { Shirt, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE SHIRT BESIDE A TEAM'S NAME.
 *
 * `club_kits` is the one canonical source of playing colours and it is held PER CLUB, so every side a
 * club brings wears that club's kit here. Ovalball does not record a kit per team; drawing a different
 * shirt for an A and a B squad would be inventing data, and taking colours from the crest would be
 * worse -- two clubs with similar badges routinely play in nothing alike.
 *
 * A club with no kit row gets the NEUTRAL shirt: an outline, in the same silhouette, so the row still
 * reads as a team rather than showing a hole where a colour should be.
 */
export function TeamKit({ kit, clubName, size = 30 }: { kit: KitConfig | null; clubName?: string; size?: number }) {
  if (!kit) {
    return (
      <View accessibilityLabel={clubName ? `${clubName}, no playing colours recorded` : undefined} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Shirt size={size - 8} color={colour.inkSubtle} strokeWidth={1.6} />
      </View>
    )
  }
  return <RugbyKit kit={kit} clubName={clubName} size={size} outline="rgba(16,21,18,0.14)" />
}

/** A club's crest, or its initial where the directory holds no logo. Never tinted or substituted. */
export function ClubCrest({ url, name, size = 28 }: { url: string | null; name: string; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: radius.sm }} resizeMode="contain" />
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
      <Text style={[type.caption, { color: colour.inkSubtle, fontFamily: "Inter_600SemiBold" }]}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

/**
 * ONE TEAM IN THE COMPETITION.
 *
 * The badge on the right says what KIND of side this is, and the three kinds are genuinely different
 * things rather than three statuses of one thing: our own side, another Ovalball club's side (added,
 * with nothing for them to answer), and a club that is not on Ovalball at all.
 */
export function TeamRow({
  name,
  kit,
  clubName,
  badge,
  onRemove,
}: {
  name: string
  kit: KitConfig | null
  clubName?: string
  badge?: string
  onRemove?: () => void
}) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
      }}
    >
      <TeamKit kit={kit} clubName={clubName} />
      <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.ink }]}>
        {name}
      </Text>
      {!!badge && (
        <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
          <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{badge}</Text>
        </View>
      )}
      {onRemove && (
        <Pressable
          accessibilityRole="button"
          // THE CLUB IS PART OF THE ANSWER. Three clubs can each bring an "Under 12 Boys", and a
          // button announced as "Remove Under 12 Boys" three times tells a screen-reader user which
          // side they are about to take out of the tournament: none of them.
          accessibilityLabel={clubName ? `Remove ${clubName} ${name}` : `Remove ${name}`}
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => ({ width: 28, height: 28, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
        >
          <X size={16} color={colour.inkSubtle} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  )
}
