import { View } from "react-native"

import type { ClubAccents } from "@ovalball/contracts"

import { radius } from "../../design/tokens"

/**
 * A RUGBY BALL IN THE CLUB'S OWN COLOURS — drawn, never generated.
 *
 * The approved design puts a club-coloured ball behind the hero. There is exactly
 * one way to do that wrongly and it is tempting: generate and store a bespoke
 * image per club. That would be a second source of club branding, it would go
 * stale the moment a Club Admin changed the kit, and it would need a pipeline
 * nobody asked for.
 *
 * So the ball is ONE application-owned shape whose bands take the club's canonical
 * accents. A club that changes its home kit on the web changes this on the next
 * read, because it is the same `club_kits` row underneath and there is nothing in
 * between.
 *
 * IT IS DECORATION AND IT KNOWS IT. Nothing is written on it, nothing is read from
 * it, and it is hidden from assistive technology entirely -- a screen reader
 * hearing "rugby ball" before the match it is behind would be noise.
 */
export function ClubBall({ accents, size = 150 }: { accents: ClubAccents; size?: number }) {
  const height = size * 0.62
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        width: size,
        height,
        borderRadius: height / 2,
        backgroundColor: accents.primary,
        overflow: "hidden",
        // The long axis of a ball, tipped the way one sits on a tee.
        transform: [{ rotate: "-24deg" }],
        opacity: 0.9,
      }}
    >
      {/* Two hoops in the club's second colour: enough to read as a kit rather
          than as a coloured oval, and nothing that needs an image. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: size * 0.3,
          width: size * 0.12,
          backgroundColor: accents.secondary,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: size * 0.56,
          width: size * 0.12,
          backgroundColor: accents.secondary,
        }}
      />
      {/* The seam, in whichever of the two reads on the ball's own ground. */}
      <View
        style={{
          position: "absolute",
          left: size * 0.16,
          right: size * 0.16,
          top: height / 2 - 1,
          height: 2,
          borderRadius: 1,
          backgroundColor: accents.onPrimary,
          opacity: 0.45,
        }}
      />
    </View>
  )
}

/**
 * A club's colours as a quiet band at the edge of a surface.
 *
 * The approved design's diagonal motif, kept to an edge: a stripe behind reading
 * material is a stripe that makes reading harder, and the club is already present
 * in the crest, the ball and the accents.
 */
export function ClubAccentEdge({ accents, height = 4 }: { accents: ClubAccents; height?: number }) {
  return (
    <View accessible={false} pointerEvents="none" style={{ flexDirection: "row", height, borderRadius: radius.pill, overflow: "hidden" }}>
      <View style={{ flex: 2, backgroundColor: accents.primary }} />
      <View style={{ flex: 1, backgroundColor: accents.secondary }} />
    </View>
  )
}
