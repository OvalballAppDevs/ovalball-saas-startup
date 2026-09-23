import { Text, View, type StyleProp, type ViewStyle } from "react-native"

import type { FamilyMember } from "@ovalball/contracts"

import { PersonAvatar } from "./identity"
import { colour, space, type } from "../design/tokens"

/**
 * WHOSE RUGBY THIS IS — one mark, drawn the same way everywhere.
 *
 * A guardian of two opens Home and the first question is not "when" but "who".
 * Before this, a family row said the child's first name in grey metadata beside
 * the venue, which meant the answer to the most important question was the
 * quietest thing on the row -- and in the aggregated view it left the parent
 * inferring the child from the team's age grade, which is exactly what the
 * product rule forbids.
 *
 * THE IDENTITY COMES FROM `FamilyProjection` AND NOWHERE ELSE. The picture, the
 * initials and the short label are all its answers, so a child's face on Home is
 * the same face as on the chip above it and the same name as in the Match Centre.
 * This component reconstructs none of them, which is the point of it existing.
 *
 * A CHILD'S PICTURE IS NOT A CREST AND NOT THE SIGNED-IN PERSON'S AVATAR. It is
 * drawn by `PersonAvatar` from the child's own private-bucket signed URL, and a
 * child with no photograph gets their initials -- a first-class state, not a
 * placeholder waiting to be filled.
 */
export function ChildMark({
  member,
  size = 22,
  style,
  tone = "chalk",
}: {
  member: FamilyMember
  size?: number
  style?: StyleProp<ViewStyle>
  /** The ground the mark stands on. On forest the name is chalk, or it vanishes. */
  tone?: "chalk" | "forest"
}) {
  return (
    // One accessible element, because "Pippa" is one fact. VoiceOver reading a
    // picture and then a name is the same thing said twice.
    <View accessible accessibilityLabel={member.shortLabel} style={[{ flexDirection: "row", alignItems: "center", gap: space.xs }, style]}>
      <PersonAvatar name={member.fullName} url={member.avatarUrl} initials={member.initials} size={size} />
      <Text numberOfLines={1} style={[type.smallMedium, { color: tone === "forest" ? colour.chalk : colour.ink, flexShrink: 1 }]}>
        {member.shortLabel}
      </Text>
    </View>
  )
}
