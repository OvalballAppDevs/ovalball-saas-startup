import { View } from "react-native"
import { Image } from "expo-image"

import { OVALBALL_MASTER_ICON, type NotificationFamily } from "../notifications/family"

/**
 * A NOTIFICATION'S FAMILY TILE -- the same tile in the bell's quick view, the Notifications Centre and
 * the foreground banner. A family without a glyph of its own is drawn with the real Ovalball master
 * icon at its own proportions, never a redrawn ring.
 */
export function NotificationGlyph({
  family,
  size = 34,
  onForest = false,
  shape = "tile",
}: {
  family: NotificationFamily
  size?: number
  onForest?: boolean
  /** "circle" in lists (the quick view and the Centre), "tile" on the banner. */
  shape?: "circle" | "tile"
}) {
  const corner = shape === "circle" ? size / 2 : Math.round(size * 0.3)
  if (family.Icon === null) {
    return (
      <Image
        source={OVALBALL_MASTER_ICON}
        style={{ width: size, height: size, borderRadius: corner }}
        contentFit="cover"
        accessible={false}
      />
    )
  }
  const Icon = family.Icon
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: corner,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: onForest ? "rgba(255,255,255,0.08)" : family.tint,
      }}
    >
      <Icon size={Math.round(size * 0.5)} color={onForest ? family.onForest : family.accent} strokeWidth={1.9} />
    </View>
  )
}
