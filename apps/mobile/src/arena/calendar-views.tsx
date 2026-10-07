import { Pressable, Text, View } from "react-native"

import { weekDayIsQuiet, weekDayLines, weekDayNeedsAttention, type ArenaRangeDay } from "@ovalball/contracts/arena"

import { ChevronRight, TriangleAlert } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { addDays, monthStart, shortDate, weekdayShort } from "./style"

/**
 * THE WEEK -- each day's activity and what needs attention, in counts. A day opens Day view. This is a
 * preview into planning, not a second planner: nothing is changed from here.
 */
export function WeekView({ days, today, onOpenDay }: { days: ArenaRangeDay[]; today: string; onOpenDay: (date: string) => void }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {days.map((d, i) => {
        const quiet = weekDayIsQuiet(d)
        const attention = weekDayNeedsAttention(d)
        const lines = weekDayLines(d)
        return (
          <Pressable
            key={d.date}
            accessibilityRole="button"
            accessibilityLabel={`${d.date === today ? "Today, " : ""}${weekdayShort(d.date)} ${shortDate(d.date)}. ${quiet ? "Nothing booked" : lines.join(", ")}`}
            onPress={() => onOpenDay(d.date)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : d.date === today ? colour.mint100 : colour.surface })}
          >
            <View style={{ width: 52 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{weekdayShort(d.date)}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{shortDate(d.date)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {quiet ? (
                <Text style={[type.caption, { color: colour.inkSubtle }]}>Nothing booked</Text>
              ) : (
                lines.map((l) => <Text key={l} style={[type.caption, { color: /unallocated|clash/.test(l) ? colour.warning : colour.ink }]}>{l}</Text>)
              )}
            </View>
            {attention && <TriangleAlert size={16} color={colour.warning} />}
            <ChevronRight size={16} color={colour.inkSubtle} />
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * THE MONTH -- a compact grid: how much is on each day, and a mark where something needs attention.
 * The detail is a tap away, in Day view.
 */
export function MonthView({ days, monthOf, today, onOpenDay }: { days: ArenaRangeDay[]; monthOf: string; today: string; onOpenDay: (date: string) => void }) {
  const first = monthStart(monthOf)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const dow = (() => { const w = weekdayShort(first); return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(w) })()
  const cells: (string | null)[] = []
  for (let i = 0; i < dow; i++) cells.push(null)
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row" }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <Text key={w} style={[type.caption, { flex: 1, textAlign: "center", color: colour.inkSubtle }]}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={{ flexDirection: "row", gap: 4 }}>
          {cells.slice(row * 7, row * 7 + 7).map((date, i) => {
            if (!date) return <View key={`empty-${row}-${i}`} style={{ flex: 1 }} />
            const d = byDate.get(date)
            const total = d ? d.homeGames + d.awayGames + d.training + d.tournaments + d.events : 0
            const attention = d ? weekDayNeedsAttention(d) : false
            // The column is the flex item, never the bordered cell: padding and borders would otherwise widen a
            // week with fewer empty days, and the grid would stop lining up.
            return (
              <View key={date} style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${weekdayShort(date)} ${shortDate(date)}. ${total === 0 ? "Nothing booked" : `${total} ${total === 1 ? "activity" : "activities"}`}${attention ? ", needs attention" : ""}`}
                  onPress={() => onOpenDay(date)}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, padding: 4, borderRadius: radius.sm, borderWidth: date === today ? 2 : 1, borderColor: date === today ? colour.pitch600 : attention ? colour.warning : colour.line, backgroundColor: pressed ? colour.chalk : total > 0 ? colour.surface : colour.chalk, alignItems: "center", gap: 2 })}
                >
                  <Text style={[type.caption, { color: colour.ink, fontFamily: type.smallMedium.fontFamily }]}>{Number(date.slice(8))}</Text>
                  {total > 0 && <Text style={[type.caption, { color: colour.forest800, fontVariant: ["tabular-nums"] }]}>{total}</Text>}
                  {attention && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.warning }} />}
                </Pressable>
              </View>
            )
          })}
        </View>
      ))}
      <Text style={[type.caption, { color: colour.inkMuted }]}>Each day shows how many activities it holds. An amber mark means something needs allocating or clashes.</Text>
    </View>
  )
}
