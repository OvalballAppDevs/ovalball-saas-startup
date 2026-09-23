import { Pressable, Text, View } from "react-native"

import { WEEKDAY_INITIALS, monthWeeks, type DayMarks } from "@ovalball/contracts"

import { calendarTone, onForest, space, type } from "../../design/tokens"

/**
 * THE MONTH, AS SEVEN COLUMNS OF LIGHT TEXT ON FOREST.
 *
 * NO BOX AROUND ANY DAY. A grid of outlined cells is a spreadsheet; a month is a
 * field of numbers with two of them marked. Only two days ever carry a shape --
 * the one you are reading and today -- and everything else is spacing.
 *
 * ONE COMBINED TREATMENT WHERE THEY COINCIDE. Today, selected, is a filled disc
 * with a ring around it: one mark saying both things, rather than two indicators
 * competing on the same number, which is what makes somebody look twice.
 *
 * ONE DOT, WHATEVER IS ON. Not one per event and not one per kind: a Saturday with
 * three matches and a session is still a Saturday with rugby on it, and the sheet
 * below names every one of them in words. A day with something CANCELLED draws the
 * dot hollow, so the difference survives greyscale and a screenshot.
 *
 * IT DRAWS ONLY WHAT IT IS GIVEN. No query, no clock, no authority -- the days come
 * from `monthWeeks` and the dots from `marksByDay`, both pure and both shared.
 */
export function MonthGrid({
  anchor,
  today,
  selected,
  marks,
  onSelect,
}: {
  anchor: string
  today: string
  selected: string | null
  marks: Map<string, DayMarks>
  onSelect: (iso: string) => void
}) {
  return (
    <View style={{ paddingHorizontal: space.md }}>
      <View style={{ flexDirection: "row", marginBottom: space.xs }}>
        {WEEKDAY_INITIALS.map((day) => (
          <View key={day} style={{ flex: 1, alignItems: "center" }}>
            <Text style={[type.caption, { color: onForest.faint, fontSize: 10.5, letterSpacing: 1 }]}>{day}</Text>
          </View>
        ))}
      </View>

      {monthWeeks(anchor).map((week) => (
        <View key={week[0].iso} style={{ flexDirection: "row" }}>
          {week.map((cell) => (
            <CalendarDay
              key={cell.iso}
              day={cell.day}
              inMonth={cell.inMonth}
              isToday={cell.iso === today}
              isSelected={cell.iso === selected}
              marks={marks.get(cell.iso) ?? null}
              onPress={() => onSelect(cell.iso)}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

export function CalendarDay({
  day,
  inMonth,
  isToday,
  isSelected,
  marks,
  onPress,
}: {
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  marks: DayMarks | null
  onPress: () => void
}) {
  const busy = Boolean(marks)
  /*
    THE SPOKEN LABEL CARRIES THE FACT, never a description of the decoration. A
    screen reader hears "3, matches and training" rather than "green dot" -- and
    what is actually on is always spelled out in the sheet below.
  */
  const spoken = [
    `${day}`,
    isToday ? "today" : null,
    marks?.fixture ? "matches" : null,
    marks?.training ? "training" : null,
    marks?.cancelled ? "something cancelled" : null,
    busy ? null : "nothing on",
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      // 46pt tall: the whole month fits an iPhone's forest half without any day
      // feeling cramped, and the row is a comfortable target across its full width.
      style={{ flex: 1, height: 46, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isSelected ? calendarTone.selected : "transparent",
          // TODAY IS A RING. When today is also the day being read, the ring sits
          // around the filled disc -- one combined mark rather than two competing.
          borderWidth: isToday ? 1.5 : 0,
          borderColor: calendarTone.today,
        }}
      >
        <Text
          style={[
            isSelected || isToday ? type.smallMedium : type.small,
            {
              color: isSelected ? calendarTone.selectedInk : inMonth ? onForest.primary : onForest.faint,
              fontSize: 15,
            },
          ]}
        >
          {day}
        </Text>
      </View>

      <View style={{ height: 6, justifyContent: "center" }}>
        {busy && (
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 2.5,
              // On the selected disc the dot would disappear into the fill, so it
              // takes the disc's own ink instead of the accent.
              backgroundColor: marks?.cancelled
                ? "transparent"
                : isSelected
                  ? calendarTone.selectedInk
                  : calendarTone.eventDot,
              borderWidth: marks?.cancelled ? 1 : 0,
              borderColor: isSelected ? calendarTone.selectedInk : calendarTone.eventDot,
            }}
          />
        )}
      </View>
    </Pressable>
  )
}
