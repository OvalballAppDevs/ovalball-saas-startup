import { Pressable, ScrollView, Text, View } from "react-native"

import { ChevronDown, ChevronLeft, ChevronRight, MapPin } from "../../components/icons"
import { TOUCH_TARGET, colour, font, onForest, radius, space, surface, type } from "../../design/tokens"

export type PlanningMode = "day" | "week" | "month"
export type DayView = "pitches" | "rooms" | "list" | "catering"

export const PLANNING_MODES: { key: PlanningMode; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]
export const DAY_VIEWS: { key: DayView; label: string }[] = [
  { key: "pitches", label: "Pitches" },
  { key: "rooms", label: "Changing Rooms" },
  { key: "list", label: "List" },
  { key: "catering", label: "Catering" },
]

/**
 * WHERE AND WHEN, IN ONE ROW -- the forest under the header, read as one surface with it: the date (the
 * scoreboard's own letters, the Arena's display face) with its steps either side, the venue, and the view.
 * Beneath it, on the page, the day's four views as tabs. Everything else on the screen is the board.
 */
export function PlanningToolbar({
  mode,
  dateLabel,
  dateSpoken,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  onPickDate,
  showVenue,
  venueName,
  onPickVenue,
  onPickMode,
  dayView,
  onDayView,
}: {
  mode: PlanningMode
  dateLabel: string
  dateSpoken: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
  onPickDate: () => void
  showVenue: boolean
  venueName: string
  onPickVenue: () => void
  onPickMode: () => void
  dayView: DayView
  onDayView: (v: DayView) => void
}) {
  const modeLabel = PLANNING_MODES.find((m) => m.key === mode)?.label ?? "Day"
  return (
    <View>
      <View style={{ backgroundColor: surface.forest, paddingLeft: space.xs, paddingRight: space.sm, paddingBottom: space.xs, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center" }}>
          <Step label={prevLabel} onPress={onPrev}><ChevronLeft size={20} color={onForest.primary} /></Step>
          <Pressable accessibilityRole="button" accessibilityLabel={`${dateSpoken}. Choose a date`} onPress={onPickDate} hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 2, borderRadius: radius.md, backgroundColor: pressed ? surface.forestRaised : "transparent" })}>
            <Text style={{ fontFamily: font.display, fontSize: 25, lineHeight: 28, letterSpacing: 0.6, color: onForest.primary, includeFontPadding: false }} maxFontSizeMultiplier={1.3} numberOfLines={1}>{dateLabel}</Text>
          </Pressable>
          <Step label={nextLabel} onPress={onNext}><ChevronRight size={20} color={onForest.primary} /></Step>
        </View>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", justifyContent: "flex-end", gap: space.xs }}>
          {showVenue && (
            <Chip label={`Venue: ${venueName}. Change venue`} onPress={onPickVenue} shrink>
              <MapPin size={14} color={colour.mint300} />
              <Text style={[type.caption, { color: onForest.primary, fontFamily: type.smallMedium.fontFamily, fontSize: 13, lineHeight: 15, flexShrink: 1 }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{venueName}</Text>
            </Chip>
          )}
          <Chip label={`View: ${modeLabel}. Change to day, week or month`} onPress={onPickMode}>
            <Text style={[type.caption, { color: onForest.primary, fontFamily: type.smallMedium.fontFamily, fontSize: 13, lineHeight: 15 }]} maxFontSizeMultiplier={1.4}>{modeLabel}</Text>
          </Chip>
        </View>
      </View>

      {mode === "day" && (
        <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="Day view"
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.sm, gap: space.xs }}>
            {DAY_VIEWS.map((v) => {
              const on = v.key === dayView
              return (
                <Pressable key={v.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={v.label} onPress={() => onDayView(v.key)}
                  style={({ pressed }) => ({ flexGrow: 1, minHeight: TOUCH_TARGET, paddingHorizontal: space.sm, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
                  <Text style={[type.smallMedium, { color: on ? colour.ink : colour.inkMuted, fontFamily: on ? type.heading.fontFamily : type.smallMedium.fontFamily }]} numberOfLines={1} maxFontSizeMultiplier={1.5}>{v.label}</Text>
                  <View style={{ position: "absolute", left: space.sm, right: space.sm, bottom: 0, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: on ? colour.pitch600 : "transparent" }} />
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function Chip({ label, onPress, shrink, children }: { label: string; onPress: () => void; shrink?: boolean; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ flexShrink: shrink ? 1 : 0, minWidth: 0, minHeight: 36, marginVertical: 4, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.sm, paddingRight: space.sm - 2, borderRadius: radius.pill, borderWidth: 1, borderColor: onForest.line, backgroundColor: pressed ? "rgba(255,255,255,0.14)" : surface.forestRaised })}>
      {children}
      <ChevronDown size={14} color={onForest.secondary} />
    </Pressable>
  )
}

function Step({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ left: 4, right: 4 }}
      style={({ pressed }) => ({ width: 38, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: pressed ? surface.forestRaised : "transparent" })}>
      {children}
    </Pressable>
  )
}
