import { Pressable, Text, View } from "react-native"

import { monthLabel } from "@ovalball/contracts"

import { ChevronLeft, ChevronRight } from "../icons"
import { calendarTone, onForest, space, surface, type } from "../../design/tokens"

/**
 * THE CALENDAR'S OWN CHROME, on the forest ground it shares with the header above
 * it and the tab bar below it.
 *
 * THE WHOLE POINT IS THAT IT IS ONE SURFACE. What this replaced was a white header,
 * then a white season dropdown, then a white Pre/Main bar, then a white
 * Week/Month/Season selector, and only then a green calendar -- five panels for one
 * screen, which is what makes a product look like an administration tool. Forest
 * runs from behind the status bar to the top of the event sheet, and the month is
 * the only thing in it.
 */

/** The month, and the two ways out of it. */
export function CalendarHeading({
  anchor,
  onStep,
  trailing,
}: {
  anchor: string
  onStep: (direction: -1 | 1) => void
  /** A compact control belonging to the heading row -- the season menu, where there is one. */
  trailing?: React.ReactNode
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: space.lg,
        gap: space.sm,
      }}
    >
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[type.title, { color: onForest.primary, fontSize: 26, flexShrink: 1 }]}
      >
        {monthLabel(anchor)}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {trailing}
        <RoundStep label="Previous month" onPress={() => onStep(-1)}>
          <ChevronLeft size={20} color={calendarTone.controlInk} strokeWidth={2.6} />
        </RoundStep>
        <RoundStep label="Next month" onPress={() => onStep(1)}>
          <ChevronRight size={20} color={calendarTone.controlInk} strokeWidth={2.6} />
        </RoundStep>
      </View>
    </View>
  )
}

/**
 * A round step, not a boxed button.
 *
 * 38pt of visible control with 10pt of slop around it, which clears the touch
 * target without a rectangle big enough to compete with the month's own name.
 */
function RoundStep({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: calendarTone.control,
        opacity: pressed ? 0.82 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

/**
 * MONTH | LIST — presentation only, over one set of rows.
 *
 * Two ways to read the same canonical agenda: the grid with a day's detail beneath
 * it, or the same days in a row. There is no second query and no second model, which
 * is the rule this control has to keep: a toggle that fetched differently would be
 * two calendars wearing one name.
 *
 * It is a low dark surface rather than a white segmented control, so it reads as
 * part of the forest rather than as a form sitting on top of it.
 */
export function CalendarModeSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { key: T; label: string; hint: string }[]
  onChange: (next: T) => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        marginHorizontal: space.lg,
        backgroundColor: surface.forestRaised,
        borderRadius: 12,
        padding: 3,
      }}
    >
      {options.map((option) => {
        const selected = option.key === value
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.hint}
            onPress={() => onChange(option.key)}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9,
              backgroundColor: selected ? calendarTone.control : "transparent",
            }}
          >
            <Text
              style={[
                type.smallMedium,
                { color: selected ? calendarTone.controlInk : onForest.secondary, fontSize: 13 },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
