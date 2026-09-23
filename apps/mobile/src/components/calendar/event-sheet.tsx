import { Pressable, Text, View } from "react-native"


import { CalendarDays } from "../icons"
import { colour, space, surface, type } from "../../design/tokens"

/**
 * THE CHALK SHEET — the day's rugby, risen over the month.
 *
 * Large rounded top corners and a grab handle, pulled up over the forest so it
 * reads as a panel drawn out of the calendar rather than as the next section down
 * the page. It is deliberately NOT draggable: the visual language is what the
 * design needs, and a gesture that fights the scroll view underneath it would cost
 * more in jitter than it buys in delight.
 */
export function EventSheet({
  children,
  heading,
  count,
}: {
  children: React.ReactNode
  /** The day, or the range, in words. */
  heading: string
  /** "2 events", where saying so helps. Omitted for a list that names its own days. */
  count?: number
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: surface.chalk,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        paddingTop: space.sm,
        // Lifted over the forest rather than butted against it.
        marginTop: -12,
      }}
    >
      <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colour.line }} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: space.sm,
          gap: space.sm,
        }}
      >
        <Text accessibilityRole="header" numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15, flexShrink: 1 }]}>
          {heading}
        </Text>
        {typeof count === "number" && count > 0 && (
          <Text style={[type.caption, { color: colour.inkSubtle }]}>
            {count === 1 ? "1 event" : `${count} events`}
          </Text>
        )}
      </View>
      {children}
    </View>
  )
}

/**
 * A DAY WITH NOTHING ON IT IS AN ANSWER, not a blank.
 *
 * The sheet stays, because collapsing it would make the screen jump every time
 * somebody tapped a quiet Wednesday. No error illustration: an empty day is
 * completely ordinary, and drawing it as a failure teaches people to distrust the
 * calendar.
 */
export function CalendarEmptyDay({ body, action }: { body: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.md }}>
      <CalendarDays size={26} color={colour.inkSubtle} />
      <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>{body}</Text>
      {action}
    </View>
  )
}

/** A day's heading inside the List view, where the sheet names a range rather than a day. */
export function ListDayHeading({ label }: { label: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={[type.smallMedium, { color: colour.ink, fontSize: 14, paddingHorizontal: space.lg, paddingTop: space.md }]}
    >
      {label}
    </Text>
  )
}
