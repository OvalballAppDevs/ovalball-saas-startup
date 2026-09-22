import { Image } from "expo-image"
import { Text, View, type StyleProp, type ViewStyle } from "react-native"

import { colour, radius, type } from "../design/tokens"

/**
 * THE THREE PICTURES, AND WHY THEY ARE THREE COMPONENTS.
 *
 * A PERSON has an avatar. A CLUB has a crest. A KIT is a kit. On the website these three were allowed
 * to stand in for one another, and the result was a team's playing shirt rendered where a club's crest
 * belonged -- on the club's own page, in its own navigation. It was not a styling mistake; it was a
 * `fallback` prop that made substitution possible, so the fix was to remove the prop rather than to
 * correct each call.
 *
 * The mobile app inherits the conclusion rather than the bug. There is no kit component here at all
 * yet, because nothing in this build has a legitimate reason to draw one. When one arrives it will be
 * its own component, and it will never be reachable from these two.
 *
 * WHEN THERE IS NO PICTURE, both fall back to initials on a neutral ground. Initials are honest: they
 * say "no picture" without pretending to be something else.
 */

function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A PERSON. `profiles.avatar_storage_path`, resolved to a signed URL by the canonical resolver. */
export function PersonAvatar({
  name,
  url,
  size = 44,
  style,
}: {
  name: string | null
  url: string | null
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  const label = name ? `${name}'s picture` : "Your picture"
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={url ? label : `${name ?? "You"}, no picture`}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colour.mint100,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} contentFit="cover" transition={120} />
      ) : (
        <Text style={[type.smallMedium, { color: colour.forest800, fontSize: size * 0.36 }]}>{initialsOf(name)}</Text>
      )}
    </View>
  )
}

/**
 * A CLUB. `resolveClubLogoUrl` decides the source -- the club's own upload, else the Club Directory's
 * branding logo, else nothing. There is no third source and there is deliberately no `fallback` prop:
 * a caller cannot pass a kit, because there is nowhere to pass one.
 */
export function ClubCrest({
  clubName,
  url,
  size = 44,
  style,
}: {
  clubName: string | null
  url: string | null
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={url ? `${clubName ?? "Club"} crest` : `${clubName ?? "Club"}, no crest`}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: colour.surface,
          borderWidth: 1,
          borderColor: colour.line,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size * 0.78, height: size * 0.78 }} contentFit="contain" transition={120} />
      ) : (
        <Text style={[type.smallMedium, { color: colour.forest800, fontSize: size * 0.3 }]}>{initialsOf(clubName)}</Text>
      )}
    </View>
  )
}
