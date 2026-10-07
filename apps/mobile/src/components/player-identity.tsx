import { Image } from "expo-image"
import { Text, View, type StyleProp, type ViewStyle } from "react-native"

import type { AwardCategoryKey, PlayerRecognition } from "@ovalball/contracts/match-centre/rewards"

import { PersonAvatar } from "./identity"
import { colour, space, type } from "../design/tokens"

/**
 * THE AWARD BADGE FAMILY -- Parents' Player of the Match (trophy), Coaches' Player of the Match (medal),
 * Opposition Player of the Match (handshake shield) and the Beast Award (bear). Generated on Higgsfield as
 * one family, checked by eye, and bundled: the app never fetches a badge, so it draws offline and at once.
 */
const BADGE: Record<AwardCategoryKey, number> = {
  FAMILY_OR_SELF_PLAYER: require("../../assets/awards/parents-potm.png"),
  COACHES_PLAYER: require("../../assets/awards/coaches-potm.png"),
  OPPOSITION_PLAYER: require("../../assets/awards/opposition-potm.png"),
  WORK_ETHIC: require("../../assets/awards/beast.png"),
}

export function AwardBadge({ categoryKey, size = 28, label }: { categoryKey: AwardCategoryKey; size?: number; label: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Image source={BADGE[categoryKey]} style={{ width: size, height: size }} contentFit="contain" />
    </View>
  )
}

/**
 * ONE PLAYER, DRAWN THE SAME WAY EVERYWHERE -- avatar, name, an optional line of context, and the
 * player's CURRENT recognition.
 *
 * Current means what they won at their side's last match, kept until the side plays again; the server
 * decides that (`get_player_recognition`). At most two badges are shown so a name never becomes a
 * trophy cabinet -- the history belongs to the player's own recognition list, not to every row.
 */
export function PlayerIdentity({
  name,
  avatarUrl = null,
  initials,
  detail,
  recognition = [],
  size = 36,
  tone = "chalk",
  style,
  trailing,
}: {
  name: string
  avatarUrl?: string | null
  initials?: string
  detail?: string | null
  recognition?: PlayerRecognition[]
  size?: number
  tone?: "chalk" | "forest"
  style?: StyleProp<ViewStyle>
  trailing?: React.ReactNode
}) {
  const shown = recognition.slice(0, 2)
  const ink = tone === "forest" ? colour.onForest : colour.ink
  const muted = tone === "forest" ? colour.onForestMuted : colour.inkMuted
  const spoken = [name, detail, ...shown.map((r) => r.awardName)].filter(Boolean).join(", ")
  return (
    <View accessible accessibilityLabel={spoken} style={[{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }, style]}>
      <PersonAvatar name={name} url={avatarUrl} size={size} initials={initials} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: ink, flexShrink: 1 }]}>
            {name}
          </Text>
          {shown.map((r) => (
            <AwardBadge key={`${r.fixtureId}-${r.categoryKey}`} categoryKey={r.categoryKey} size={20} label={r.awardName} />
          ))}
        </View>
        {!!detail && (
          <Text numberOfLines={1} style={[type.caption, { color: muted }]}>
            {detail}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  )
}
