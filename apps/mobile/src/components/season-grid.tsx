import { Pressable, Text, View } from "react-native"
import type { AgendaItem } from "@ovalball/contracts"
import { buildSeasonGrid, describeWeek, mondayOf, weekStartLabel, type SeasonMonth, type SeasonWeek } from "@ovalball/contracts"

import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE SHAPE OF A SEASON, AS SQUARES.
 *
 * ONE SQUARE PER WEEK, AND THE UNIT IS THE POINT. Week view answers "what is on this week" and Month
 * answers "when in October"; neither answers WHAT DOES OUR YEAR LOOK LIKE -- where the matches
 * cluster, where the away runs are, which weeks are rest. A season is thirty-odd weeks, which fits on
 * a phone as squares and does not fit as days.
 *
 * EMPTY WEEKS ARE DRAWN. That is the whole reason this works: a three-week gap in February should be
 * three empty squares, because the gap is information. Dropping them would compress the year and
 * destroy the rhythm the view exists to show.
 *
 * MONTHS ARE KEPT ONLY AS HEADINGS, because "early October" is how people talk about a season and
 * "week 6" is not -- though the week number is there for the coach who does count that way.
 *
 * THE ARRANGEMENT IS THE WEBSITE'S OWN `buildSeasonGrid`, now shared. It is pure: it takes events the
 * server already authorised and arranges them, holds no scope and makes no authority decision. So this
 * view cannot widen anything -- there is nothing here to widen from.
 */

export function SeasonGrid({
  rangeStart,
  rangeEnd,
  items,
  today,
  selectedWeek,
  onSelectWeek,
}: {
  rangeStart: string
  rangeEnd: string
  items: AgendaItem[]
  today: string
  selectedWeek: string | null
  onSelectWeek: (mondayIso: string) => void
}) {
  const months = buildSeasonGrid(rangeStart, rangeEnd, items.map(toGridEvent))
  const thisWeek = mondayOf(today)

  return (
    <View style={{ gap: space.lg }}>
      {months.map((month) => (
        <Month key={month.key} month={month} thisWeek={thisWeek} selectedWeek={selectedWeek} onSelectWeek={onSelectWeek} />
      ))}
    </View>
  )
}

function Month({
  month,
  thisWeek,
  selectedWeek,
  onSelectWeek,
}: {
  month: SeasonMonth
  thisWeek: string
  selectedWeek: string | null
  onSelectWeek: (mondayIso: string) => void
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: space.lg }]}>
        {month.label.toUpperCase()} {month.year}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg }}>
        {month.weeks.map((week) => (
          <WeekSquare
            key={week.startIso}
            week={week}
            isThisWeek={week.startIso === thisWeek}
            isSelected={week.startIso === selectedWeek}
            onPress={() => onSelectWeek(week.startIso)}
          />
        ))}
      </View>
    </View>
  )
}

/**
 * ONE WEEK.
 *
 * The square carries three things at a glance: which week it is, how many matches are in it, and
 * whether they are home or away. Colour is never the only signal -- the counts are numbers and the
 * spoken label says the whole week in words, so a square makes sense to somebody who cannot see it.
 *
 * A REST WEEK IS A REAL ANSWER and is drawn as one: empty, quiet, and still a square. It is not an
 * absence of data.
 */
function WeekSquare({
  week,
  isThisWeek,
  isSelected,
  onPress,
}: {
  week: SeasonWeek
  isThisWeek: boolean
  isSelected: boolean
  onPress: () => void
}) {
  const { day, month } = weekStartLabel(week.startIso)
  const matches = week.homeMatches + week.awayMatches + week.undecidedMatches

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`Week ${week.weekNumber}, from ${day} ${month}. ${describeWeek(week)}`}
      accessibilityHint="Shows this week's rugby"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 62,
        minHeight: 62,
        borderRadius: radius.md,
        borderWidth: isSelected ? 2 : 1,
        borderColor: isSelected ? colour.forest800 : isThisWeek ? colour.pitch600 : colour.line,
        backgroundColor: week.isRest ? colour.surface : colour.mint100,
        padding: space.xs,
        justifyContent: "space-between",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={[type.caption, { color: colour.inkMuted, fontSize: 9 }]}>
        {day} {month}
      </Text>

      {/* THE COUNTS, AS NUMBERS. A coloured block alone tells somebody there is "something" on; a
          number tells them there are three. Home and away are separated because an away run is the
          thing a season view exists to make visible. */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
        {week.homeMatches > 0 && <Count value={week.homeMatches} tone={colour.forest800} />}
        {week.awayMatches > 0 && <Count value={week.awayMatches} tone={colour.messengerBlue} />}
        {week.undecidedMatches > 0 && <Count value={week.undecidedMatches} tone={colour.inkMuted} />}
        {matches === 0 && week.trainingSessions > 0 && (
          <Text style={[type.caption, { color: colour.forest800, fontSize: 10 }]}>{week.trainingSessions}×</Text>
        )}
      </View>

      <Text style={[type.caption, { color: isThisWeek ? colour.pitch600 : colour.inkSubtle, fontSize: 9 }]}>
        W{week.weekNumber}
      </Text>
    </Pressable>
  )
}

function Count({ value, tone }: { value: number; tone: string }) {
  return (
    <View
      style={{
        minWidth: 16,
        height: 16,
        borderRadius: 4,
        backgroundColor: tone,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 2,
      }}
    >
      <Text style={[type.caption, { color: colour.onForest, fontSize: 10, lineHeight: 13 }]}>{value}</Text>
    </View>
  )
}

/**
 * An agenda item as the grid's own event shape.
 *
 * A lossy projection on purpose: the grid needs to count and arrange, not to render. Everything it
 * drops -- crests, kits, attendance -- belongs to the rows the week panel shows when a square is
 * tapped, which are the real `AgendaItem`s rather than these.
 */
function toGridEvent(item: AgendaItem) {
  return {
    id: item.key,
    kind: item.kind,
    date: item.date,
    time: item.time,
    // Training is never given a home or away, here or anywhere else.
    homeAway: item.kind === "fixture" ? (item.homeAway ?? "") : "",
    teamDisplayName: item.us.teamName ?? item.us.clubName,
    opposition: item.them?.clubName ?? "",
    laneId: item.teamId,
    status: item.status ?? "",
    venue: item.pitch ?? item.venue,
    canEdit: false,
  }
}
