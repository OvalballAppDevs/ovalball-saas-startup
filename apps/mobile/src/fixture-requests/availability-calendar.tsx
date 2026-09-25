import { Pressable, ScrollView, Text, View } from "react-native"

import { WEEKDAY_INITIALS, monthLabel, monthWeeks, type CompareDay, type DayAvailability } from "@ovalball/contracts"

import { ChevronLeft, ChevronRight } from "../components/icons"
import { dateBlock } from "../agenda/presentation"
import { TOUCH_TARGET, colour, onForest, radius, space, statusOnForest, type } from "../design/tokens"

/**
 * THE SHARED SCHEDULING CALENDAR (CA-M11.4) -- "when can these two teams realistically play?", drawn
 * on the same dark-forest ground the app's own Calendar already uses (Section 62's own instruction),
 * inside the Request Fixture composer rather than a separate destination.
 *
 * ONE COMBINED SIGNAL PER DAY, NEVER A SCORE. A day is either a GOOD OPTION (both sides free -- the
 * calm tone), OUR OWN COMMITMENT (warning tone -- we already know why this day is hard), THEIR
 * COMMITMENT (a quiet ring -- known, but never described further than "busy"), or genuinely open with
 * nothing known either way (no mark at all -- Section 20's own "do not claim availability if partner
 * information is unknown"). The agenda list below names every day in words; the grid is for scanning a
 * whole month at a glance, not for reading in isolation.
 */

export type CalendarView = "month" | "list"

function dotFor(day: CompareDay | undefined): { colour: string; ring?: boolean } | null {
  if (!day) return null
  if (day.isGoodOption) return { colour: statusOnForest.calm.ground.replace("0.22", "1") }
  if (day.ours !== "available") return { colour: statusOnForest.warning.ground.replace("0.18", "1") }
  if (day.partner && day.partner !== "no_known_clash") return { colour: onForest.secondary, ring: true }
  return null
}

export function AvailabilityMonthGrid({
  anchor,
  today,
  selected,
  byDate,
  onSelect,
  onShiftMonth,
}: {
  anchor: string
  today: string
  selected: string | null
  byDate: Map<string, CompareDay>
  onSelect: (iso: string) => void
  onShiftMonth: (direction: -1 | 1) => void
}) {
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: colour.forest950, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onShiftMonth(-1)} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={18} color={onForest.primary} />
        </Pressable>
        <Text style={[type.smallMedium, { color: onForest.primary }]}>{monthLabel(anchor)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => onShiftMonth(1)} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ChevronRight size={18} color={onForest.primary} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row" }}>
        {WEEKDAY_INITIALS.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center" }}>
            <Text style={[type.caption, { color: onForest.faint, fontSize: 10, letterSpacing: 1 }]}>{d}</Text>
          </View>
        ))}
      </View>

      {monthWeeks(anchor).map((week) => (
        <View key={week[0].iso} style={{ flexDirection: "row" }}>
          {week.map((cell) => {
            const isSelected = cell.iso === selected
            const isToday = cell.iso === today
            const mark = dotFor(byDate.get(cell.iso))
            return (
              <Pressable
                key={cell.iso}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${cell.day}${isToday ? ", today" : ""}${mark?.colour === statusOnForest.calm.ground.replace("0.22", "1") ? ", good option, both sides free" : mark?.ring ? ", partner busy" : mark ? ", we have a commitment" : ""}`}
                onPress={() => onSelect(cell.iso)}
                style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? colour.pitch600 : "transparent", borderWidth: isToday && !isSelected ? 1.5 : 0, borderColor: colour.pitch400 }}>
                  <Text style={[isSelected ? type.smallMedium : type.small, { color: isSelected ? colour.forest950 : cell.inMonth ? onForest.primary : onForest.faint, fontSize: 14 }]}>{cell.day}</Text>
                </View>
                <View style={{ height: 6, justifyContent: "center" }}>
                  {mark && (
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: mark.ring ? "transparent" : isSelected ? colour.forest950 : mark.colour, borderWidth: mark.ring ? 1 : 0, borderColor: isSelected ? colour.forest950 : onForest.secondary }} />
                  )}
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, paddingTop: space.xs }}>
        <Legend colour={statusOnForest.calm.ground.replace("0.22", "1")} label="Good option" />
        <Legend colour={statusOnForest.warning.ground.replace("0.18", "1")} label="We're committed" />
        <Legend colour={onForest.secondary} ring label="They're busy" />
      </View>
    </View>
  )
}

function Legend({ colour: dot, label, ring }: { colour: string; label: string; ring?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ring ? "transparent" : dot, borderWidth: ring ? 1 : 0, borderColor: dot }} />
      <Text style={[type.caption, { color: onForest.secondary, fontSize: 11 }]}>{label}</Text>
    </View>
  )
}

/** Our own side's word for the day -- specific (Section 15's own distinction: OUR side may say what
 * kind of commitment it is; the partner's side never goes past "Busy"). */
function ourDetailLabel(status: DayAvailability): string {
  if (status === "available") return "Available"
  if (status === "fixture") return "Fixture"
  if (status === "training") return "Training"
  if (status === "club_event") return "Club event"
  if (status === "busy") return "Busy"
  return "Request pending"
}

function partnerLabel(status: DayAvailability | null): string {
  if (status === null) return "Unknown"
  if (status === "no_known_clash") return "No known clash"
  if (status === "request_pending") return "Request pending"
  return "Busy"
}

/**
 * FIND A DATE -- the compare list (Section 19/20), the primary detailed view. Chronological only,
 * never a score. A "Good option" chip is the ONLY judgement made, and it is a plain fact (both sides
 * read Available), not a ranking.
 */
export function AvailabilityAgendaList({ days, selected, onSelect }: { days: CompareDay[]; selected: string | null; onSelect: (iso: string) => void }) {
  return (
    <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
      <View style={{ gap: space.sm }}>
        {days.map((d) => {
          const block = dateBlock(d.date)
          const isSelected = d.date === selected
          return (
            <Pressable
              key={d.date}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${block.weekday} ${block.day} ${block.month}. Us: ${ourDetailLabel(d.ours)}. Partner: ${partnerLabel(d.partner)}.${d.isGoodOption ? " Good option." : ""}`}
              onPress={() => onSelect(d.date)}
              style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 6, borderRadius: radius.lg, borderWidth: 1, borderColor: isSelected ? colour.pitch600 : colour.line, backgroundColor: isSelected ? colour.mint100 : colour.surface, paddingHorizontal: space.md, paddingVertical: space.sm }}
            >
              <View style={{ width: 44 }}>
                <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.weekday.slice(0, 3).toUpperCase()}</Text>
                <Text style={[type.smallMedium, { color: colour.ink, fontSize: 18 }]}>{block.day}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.small, { color: colour.ink }]}>{block.month}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  Us: {ourDetailLabel(d.ours)} · Partner: {partnerLabel(d.partner)}
                </Text>
              </View>
              {d.isGoodOption && (
                <View style={{ paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colour.pitch600 }}>
                  <Text style={[type.caption, { color: colour.chalk, fontSize: 10, fontFamily: "Inter_600SemiBold" }]}>Good Option</Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}
