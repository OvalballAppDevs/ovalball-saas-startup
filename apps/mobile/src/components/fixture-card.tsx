import { Text, View } from "react-native"

import type { NextFixture } from "../context/home-data"
import { dateParts, relativeDay } from "../context/home-data"
import { Card, StatusPill } from "./ui"
import { Clock, MapPin } from "./icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE FIXTURE CARD — the most-looked-at object in the product.
 *
 * A DATE BLOCK, NOT A DATE STRING. "Sat 15 Jan" in a sentence has to be read; a calendar block is
 * recognised. It is the first thing on the card because "when" is the question people open Ovalball
 * to answer, and the display face is used for the numeral so the card carries the brand rather than
 * just the information.
 *
 * AND IT SAYS "SATURDAY" WHEN THAT IS WHAT MATTERS. A fixture three days away is a different fact
 * from one in March; making somebody work out which is which from a date is a small tax charged on
 * every glance.
 *
 * AVAILABILITY IS PART OF THE FIXTURE, not a separate panel. Whether the side is covered is the second
 * question, always, and the three counts carry a WORD each -- a coloured number alone is unreadable to
 * anybody who does not separate the greens and the ambers. Absent where the viewer may not see the
 * squad's responses: null is not zero, and rendering zeroes would say "nobody is available".
 */
export function FixtureCard({ fixture, onPress }: { fixture: NextFixture; onPress?: () => void }) {
  const parts = dateParts(fixture.date)
  const soon = relativeDay(fixture.date)
  const venue = fixture.homeAway ? fixture.homeAway.charAt(0).toUpperCase() + fixture.homeAway.slice(1).toLowerCase() : null

  return (
    <Card onPress={onPress} accessibilityLabel={`Fixture against ${fixture.opponent}, ${soon ?? parts.weekday} ${parts.day} ${parts.month}`}>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View
          style={{
            width: 56,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            backgroundColor: colour.mint100,
            alignItems: "center",
          }}
        >
          <Text style={[type.overline, { color: colour.forest800, fontSize: 10 }]}>{parts.weekday}</Text>
          <Text style={[type.displaySmall, { color: colour.forest800, marginTop: -2 }]}>{parts.day}</Text>
          <Text style={[type.caption, { color: colour.forest800, fontSize: 10, marginTop: -2 }]}>{parts.month}</Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
            <Text style={[type.bodyMedium, { color: colour.ink, flex: 1 }]} numberOfLines={2}>
              vs {fixture.opponent}
            </Text>
            {fixture.status && <StatusPill label={titleise(fixture.status)} tone={toneFor(fixture.status)} />}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 4, flexWrap: "wrap" }}>
            {soon && (
              <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{soon}</Text>
            )}
            {!!fixture.kickoff && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Clock size={13} color={colour.inkMuted} />
                <Text style={[type.caption, { color: colour.inkMuted }]}>{fixture.kickoff.slice(0, 5)}</Text>
              </View>
            )}
            {venue && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MapPin size={13} color={colour.inkMuted} />
                <Text style={[type.caption, { color: colour.inkMuted }]}>{venue}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {fixture.availability && <AvailabilityStrip availability={fixture.availability} />}
    </Card>
  )
}

function AvailabilityStrip({ availability }: { availability: NonNullable<NextFixture["availability"]> }) {
  const cells = [
    { label: "Available", value: availability.available, bg: colour.successSurface, fg: colour.forest800 },
    { label: "Not replied", value: availability.awaiting, bg: colour.warningSurface, fg: colour.warning },
    { label: "Unavailable", value: availability.unavailable, bg: colour.dangerSurface, fg: colour.danger },
  ]
  return (
    <View
      accessible
      accessibilityLabel={cells.map((c) => `${c.value} ${c.label.toLowerCase()}`).join(", ")}
      style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}
    >
      {cells.map((cell) => (
        <View key={cell.label} style={{ flex: 1, backgroundColor: cell.bg, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.sm }}>
          <Text style={[type.title, { color: cell.fg }]}>{cell.value}</Text>
          <Text style={[type.caption, { color: cell.fg, fontSize: 11 }]} numberOfLines={1}>
            {cell.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

function titleise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, " ")
}

/** Booked is settled; everything else is in progress and must not borrow the settled colour. */
function toneFor(status: string): "positive" | "caution" | "neutral" {
  const lower = status.toLowerCase()
  if (lower === "booked" || lower === "confirmed") return "positive"
  if (lower === "cancelled" || lower === "postponed") return "caution"
  return "neutral"
}
