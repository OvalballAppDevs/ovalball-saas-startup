import { Pressable, Text, View } from "react-native"

import {
  WEEKDAY_INITIALS,
  monthLabel,
  monthWeeks,
  type DayMarks,
} from "@ovalball/contracts"

import { ChevronLeft, ChevronRight } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE MONTH, ON A DARK FOREST PANEL.
 *
 * The shape the owner asked for: the month named at the top left, a pair of round
 * steps at the top right, a weekday header, and six rows of days with a dot under
 * the ones that have rugby on them. The day you are looking at is a filled disc;
 * today is a ring, so "where am I" and "what am I reading" are two different marks
 * rather than one that has to mean both.
 *
 * WHY A GRID AT ALL, having argued against one. A desktop month grid squeezed onto
 * a phone is a bad idea; a month grid DESIGNED for a phone, with a day's detail in
 * a sheet beneath it, is how every native calendar works -- and it answers "what
 * has this family got on in October" in one glance, which a scrolling list cannot.
 * The rule it must not break is that tapping a day gives you the WORDS; the dots
 * are a summary, never the answer.
 *
 * MONDAY FIRST. The reference opens on Sunday and Ovalball does not, because a
 * rugby week is Tuesday's training through Sunday's match -- and the Calendar's own
 * week strip has always started there. Two calendars in one app disagreeing about
 * which column Monday is in would be worse than either choice alone.
 *
 * IT DRAWS ONLY WHAT IT IS GIVEN. No query, no clock, no authority: the days come
 * from `monthWeeks` and the dots from `marksByDay`, both pure and both shared.
 */
export function MonthCalendar({
  anchor,
  today,
  selected,
  marks,
  onSelect,
  onStep,
}: {
  /** Any day inside the month being shown. */
  anchor: string
  today: string
  /** The day whose events are in the sheet below. */
  selected: string | null
  marks: Map<string, DayMarks>
  onSelect: (iso: string) => void
  onStep: (direction: -1 | 1) => void
}) {
  return (
    <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.chalk, fontSize: 21 }]}>
          {monthLabel(anchor)}
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Step label="Previous month" onPress={() => onStep(-1)}>
            <ChevronLeft size={19} color={colour.forest950} strokeWidth={2.4} />
          </Step>
          <Step label="Next month" onPress={() => onStep(1)}>
            <ChevronRight size={19} color={colour.forest950} strokeWidth={2.4} />
          </Step>
        </View>
      </View>

      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_INITIALS.map((day) => (
          <View key={day} style={{ flex: 1, alignItems: "center" }}>
            <Text style={[type.caption, { color: "rgba(248,250,247,0.45)", fontSize: 10, letterSpacing: 0.8 }]}>
              {day}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ gap: 2 }}>
        {monthWeeks(anchor).map((week) => (
          <View key={week[0].iso} style={{ flexDirection: "row" }}>
            {week.map((cell) => (
              <Day
                key={cell.iso}
                iso={cell.iso}
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
    </View>
  )
}

function Step({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colour.pitch600,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {children}
    </Pressable>
  )
}

function Day({
  iso,
  day,
  inMonth,
  isToday,
  isSelected,
  marks,
  onPress,
}: {
  iso: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  marks: DayMarks | null
  onPress: () => void
}) {
  const busy = Boolean(marks)
  /*
    THE SPOKEN LABEL CARRIES THE FACT, not a description of the decoration. A
    screen reader hears "3 October, matches and training" rather than "green dot" --
    and the dots below are a summary the list beneath the grid always spells out.
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
      style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: TOUCH_TARGET }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isSelected ? colour.pitch600 : "transparent",
          // TODAY IS A RING, the day you are reading is a disc. Two different
          // questions deserve two different marks -- one mark doing both is how a
          // person loses track of which day they are actually looking at.
          borderWidth: isToday && !isSelected ? 1.5 : 0,
          borderColor: colour.pitch400,
        }}
      >
        <Text
          style={[
            isSelected || isToday ? type.smallMedium : type.small,
            {
              color: isSelected
                ? colour.forest950
                : inMonth
                  ? colour.chalk
                  : "rgba(248,250,247,0.32)",
              fontSize: 14,
            },
          ]}
        >
          {day}
        </Text>
      </View>

      {/* ONE DOT FOR RUGBY PLAYED, ONE FOR RUGBY TRAINED. Never one per event: a
          Saturday with four matches is still a Saturday with matches, and four dots
          under a two-digit number is a smudge. A cancelled day is HOLLOW rather
          than merely a different colour, so the difference survives greyscale. */}
      <View style={{ height: 5, flexDirection: "row", gap: 3, marginTop: 1 }}>
        {marks?.fixture && <Dot tone={colour.pitch400} hollow={marks.cancelled} />}
        {marks?.training && <Dot tone={colour.mint300} hollow={marks.cancelled} />}
      </View>
    </Pressable>
  )
}

function Dot({ tone, hollow }: { tone: string; hollow: boolean }) {
  return (
    <View
      style={{
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: hollow ? "transparent" : tone,
        borderWidth: hollow ? 1 : 0,
        borderColor: tone,
      }}
    />
  )
}
