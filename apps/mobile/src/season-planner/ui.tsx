import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { addDays, clubDayState, clubDaySummaryWords, clubLogoUrlFromPath, CLUB_DAY_STATE_LABEL, isoWeekday, shortMatchDate, type BoardState, type ClubDayListItem, type ClubDayState, type IsoWeekday } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { searchDirectoryClubs, type DirectoryClub } from "../agenda/opponent-search"
import { ClubCrest } from "../components/identity"
import { ArrowRightLeft, Check, ChevronLeft, ChevronRight, Search, Users, X } from "../components/icons"
import { StatusPill } from "../components/ui"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, familyOnForest, font, onForest, radius, space, surface, type } from "../design/tokens"
import type { PlannerOpponent } from "./state"

/**
 * THE PLANNER'S PIECES. Existing tokens only: forest structure, chalk canvas, white cards, brand green for the one
 * primary action, and the board's states always as a WORD with their colour (never colour alone).
 */

/** The steps of a club day, drawn on the forest so the header and the progress read as one surface. */
export function ForestSteps({ labels, current }: { labels: string[]; current: number }) {
  const { fontScale } = useWindowDimensions()
  const oneLine = fontScale > LARGE_TEXT_SCALE
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${labels.length}: ${labels[current]}`}
      style={{ backgroundColor: surface.forest, paddingHorizontal: space.md, paddingBottom: space.md, gap: 6 }}
    >
      <View style={{ flexDirection: "row" }}>
        {labels.map((label, i) => {
          const done = i < current
          const on = i === current
          return (
            <View key={label} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch" }}>
                <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : i <= current ? colour.pitch400 : onForest.line }} />
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: on || done ? colour.pitch400 : "transparent",
                    borderWidth: 1.5,
                    borderColor: on || done ? colour.pitch400 : onForest.faint,
                  }}
                >
                  {done ? (
                    <Check size={14} color={colour.forest950} strokeWidth={3} />
                  ) : (
                    <Text allowFontScaling={false} style={[type.smallMedium, { color: on ? colour.forest950 : onForest.secondary }]}>
                      {i + 1}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, height: 2, backgroundColor: i === labels.length - 1 ? "transparent" : i < current ? colour.pitch400 : onForest.line }} />
              </View>
              {!oneLine && (
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[type.caption, { color: on ? onForest.primary : onForest.secondary, fontFamily: on ? font.bodySemi : font.body }]}>
                  {label}
                </Text>
              )}
            </View>
          )
        })}
      </View>
      {oneLine && <Text style={[type.small, { color: onForest.primary, fontFamily: font.bodySemi }]}>{`Step ${current + 1} of ${labels.length}: ${labels[current]}`}</Text>}
    </View>
  )
}

/** A white card on the chalk. */
export function PlannerCard({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  return <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, padding: padded ? space.md : 0, overflow: "hidden" }}>{children}</View>
}

export function SectionLabel({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
        {title}
      </Text>
      {action}
    </View>
  )
}

/**
 * HOME | AWAY. Two 44pt halves in one track; the chosen half is filled forest. Choosing the chosen half again
 * leaves the team out -- so "nothing chosen" honestly means "not in this club day".
 */
export function HomeAwayToggle({
  value,
  onChange,
  disabled = false,
  teamName,
}: {
  value: "home" | "away" | null
  onChange: (next: "home" | "away" | null) => void
  disabled?: boolean
  teamName: string
}) {
  const half = (key: "home" | "away", label: string) => {
    const on = value === key
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityLabel={`${teamName} ${label}`}
        accessibilityState={{ checked: on, disabled }}
        accessibilityHint={on ? "Leaves this team out of the club day" : undefined}
        disabled={disabled}
        onPress={() => onChange(on ? null : key)}
        style={({ pressed }) => ({
          minWidth: 64,
          minHeight: TOUCH_TARGET,
          paddingHorizontal: space.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? colour.forest800 : pressed ? colour.chalk : "transparent",
        })}
      >
        <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: on ? colour.onForest : colour.inkMuted }]}>
          {label}
        </Text>
      </Pressable>
    )
  }
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, overflow: "hidden", opacity: disabled ? 0.4 : 1, backgroundColor: colour.surface }}>
      {half("home", "Home")}
      <View style={{ width: 1, backgroundColor: colour.lineStrong }} />
      {half("away", "Away")}
    </View>
  )
}

/** A Home/Away word in its quiet pill. */
export function VenuePill({ venue }: { venue: "home" | "away" | string | null }) {
  const label = venue === "home" || venue === "Home" ? "Home" : venue === "away" || venue === "Away" ? "Away" : "TBC"
  return (
    <View style={{ paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colour.mint100 }}>
      <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: colour.rugby700 }]}>
        {label}
      </Text>
    </View>
  )
}

export function TeamIcon({ dim = false }: { dim?: boolean }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: dim ? colour.chalk : colour.mint100 }}>
      <Users size={18} color={dim ? colour.inkSubtle : colour.forest800} strokeWidth={1.9} />
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// BOARD STATES
// ---------------------------------------------------------------------------------------------------------------------

export const STATE_COLOUR: Record<BoardState | "unfilled", { dot: string; ground: string; ink: string }> = {
  confirmed: { dot: colour.pitch600, ground: colour.mint100, ink: colour.rugby700 },
  completed: { dot: colour.rugby700, ground: colour.mint100, ink: colour.rugby700 },
  planned: { dot: colour.pitch600, ground: colour.mint100, ink: colour.rugby700 },
  pending: { dot: familyOnForest.amber, ground: colour.warningSurface, ink: colour.warning },
  countered: { dot: familyOnForest.amber, ground: colour.warningSurface, ink: colour.warning },
  incoming: { dot: colour.info, ground: colour.infoSurface, ink: colour.info },
  declined: { dot: colour.danger, ground: colour.dangerSurface, ink: colour.danger },
  competition: { dot: colour.forest800, ground: colour.chalk, ink: colour.forest800 },
  unfilled: { dot: colour.inkSubtle, ground: colour.surface, ink: colour.inkMuted },
}

/** "● 4" -- a count with its state's dot, and the state's word for VoiceOver. */
export function CountDot({ state, count, word }: { state: keyof typeof STATE_COLOUR; count: number; word: string }) {
  return (
    <View accessible accessibilityLabel={`${count} ${word}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: STATE_COLOUR[state].dot }} />
      <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>
        {count}
      </Text>
    </View>
  )
}

/** One overview number, Bebas, with its word -- read as "12 confirmed". */
export function StatTile({ value, label, state, onPress, hint }: { value: number; label: string; state: keyof typeof STATE_COLOUR; onPress?: () => void; hint?: string }) {
  const c = STATE_COLOUR[state]
  const body = (
    <>
      <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: font.display, fontSize: 30, lineHeight: 32, color: c.ink, fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={[type.caption, { color: c.ink }]}>
        {label}
      </Text>
    </>
  )
  const frame = { flex: 1, minWidth: 0, borderRadius: radius.md, backgroundColor: c.ground, borderWidth: 1, borderColor: colour.line, paddingVertical: space.md, paddingHorizontal: space.sm, gap: 2 } as const
  // A tile that leads somewhere is a button and says where; one that only counts stays a plain label.
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${value} ${label}`} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [frame, { opacity: pressed ? 0.85 : 1 }]}>
        {body}
      </Pressable>
    )
  }
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={frame}>
      {body}
    </View>
  )
}

/** A board state as a word in its colour. */
export function StatePill({ state, label }: { state: keyof typeof STATE_COLOUR; label: string }) {
  const tone = state === "confirmed" || state === "completed" || state === "planned" ? "positive" : state === "declined" ? "negative" : state === "pending" || state === "countered" ? "caution" : "neutral"
  return <StatusPill label={label} tone={tone} />
}

// ---------------------------------------------------------------------------------------------------------------------
// OPPONENT
// ---------------------------------------------------------------------------------------------------------------------

export function OpponentCard({ opponent, onClear, onEdit }: { opponent: PlannerOpponent; onClear?: () => void; onEdit?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <ClubCrest clubName={opponent.name} url={opponent.crestUrl} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={[type.heading, { color: colour.ink }]}>
          {opponent.name}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <StatusPill label={opponent.onOvalball ? "On Ovalball" : "Not on Ovalball"} tone={opponent.onOvalball ? "positive" : "neutral"} />
        </View>
      </View>
      {onEdit && (
        <Pressable accessibilityRole="button" accessibilityLabel="Change the club" onPress={onEdit} hitSlop={8} style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: colour.chalk }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
        </Pressable>
      )}
      {onClear && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${opponent.name}`} onPress={onClear} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <X size={20} color={colour.inkMuted} />
        </Pressable>
      )}
    </View>
  )
}

/** Search the canonical Club Directory -- every club in the code, on Ovalball or not -- in a sheet. */
export function OpponentSearchSheet({
  visible,
  onClose,
  onChoose,
  rugbyCode,
  excludeClubId,
}: {
  visible: boolean
  onClose: () => void
  onChoose: (club: DirectoryClub) => void
  rugbyCode: string | null
  excludeClubId: string | null
}) {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<DirectoryClub[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!visible) return
    const needle = query.trim()
    if (needle.length < 2) {
      setResults(null)
      return
    }
    let live = true
    setBusy(true)
    const timer = setTimeout(() => {
      void searchDirectoryClubs(supabase, needle, { rugbyCode, excludeClubId })
        .then((clubs) => live && setResults(clubs))
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, visible, rugbyCode, excludeClubId])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: space.lg, gap: space.md, backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
          <Text accessibilityRole="header" style={[type.title, { color: colour.ink, flex: 1 }]}>
            Playing Against
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
            <X size={22} color={colour.ink} />
          </Pressable>
        </View>
        <View style={{ padding: space.lg, gap: space.md, flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.lineStrong }}>
            <Search size={18} color={colour.inkMuted} />
            <TextInput
              accessibilityLabel="Search clubs"
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search clubs"
              placeholderTextColor={colour.inkSubtle}
              autoCorrect={false}
              selectionColor={colour.pitch600}
              style={[type.body, { flex: 1, color: colour.ink, paddingVertical: 10 }]}
            />
            {busy && <ActivityIndicator color={colour.forest800} />}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: insets.bottom + space.xl, gap: space.sm }}>
            {results === null && <Text style={[type.small, { color: colour.inkMuted }]}>Type at least two letters of the club's name.</Text>}
            {results?.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No clubs match “{query.trim()}”.</Text>}
            {results?.map((club) => (
              <Pressable
                key={club.directoryId}
                accessibilityRole="button"
                accessibilityLabel={`${club.name}${club.town ? `, ${club.town}` : ""}, ${club.onOvalball ? "on Ovalball" : "not on Ovalball"}`}
                onPress={() => onChoose(club)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: pressed ? colour.mint100 : colour.surface, borderWidth: 1, borderColor: colour.line })}
              >
                <ClubCrest clubName={club.name} url={club.crestUrl} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={2} style={[type.bodyMedium, { color: colour.ink }]}>
                    {club.name}
                  </Text>
                  {!!club.town && <Text style={[type.caption, { color: colour.inkMuted }]}>{[club.town, club.county].filter(Boolean).join(", ")}</Text>}
                </View>
                <StatusPill label={club.onOvalball ? "On Ovalball" : "Not on Ovalball"} tone={club.onOvalball ? "positive" : "neutral"} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// THE RETURN-DATE CALENDAR
// ---------------------------------------------------------------------------------------------------------------------

const DAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}
function shiftMonth(iso: string, by: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 10)
}

/**
 * A month of the season. The playing-day column is marked; days outside the season or already past cannot be
 * chosen; a day the club already has commitments on carries a small count. It never says a day is "free".
 */
export function SeasonMonthCalendar({
  anchor,
  onAnchor,
  selected,
  onSelect,
  seasonStart,
  seasonEnd,
  today,
  playingDay,
  pressure,
}: {
  anchor: string
  onAnchor: (iso: string) => void
  selected: string | null
  onSelect: (iso: string) => void
  seasonStart: string
  seasonEnd: string
  today: string
  playingDay: IsoWeekday
  /** Commitments the club already has per date. */
  pressure: Map<string, number>
}) {
  const first = monthStart(anchor)
  const cells = useMemo(() => {
    const out: (string | null)[] = []
    const lead = isoWeekday(first) - 1
    for (let i = 0; i < lead; i += 1) out.push(null)
    for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) out.push(d)
    while (out.length % 7) out.push(null)
    return out
  }, [first])
  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
  const canPrev = shiftMonth(first, -1) >= monthStart(seasonStart)
  const canNext = shiftMonth(first, 1) <= seasonEnd
  return (
    <PlannerCard>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" disabled={!canPrev} onPress={() => onAnchor(shiftMonth(first, -1))} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: canPrev ? 1 : 0.3 }}>
          <ChevronLeft size={20} color={colour.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1, textAlign: "center" }]}>
          {title}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={!canNext} onPress={() => onAnchor(shiftMonth(first, 1))} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: canNext ? 1 : 0.3 }}>
          <ChevronRight size={20} color={colour.ink} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row" }}>
        {DAY_HEADS.map((d, i) => (
          <Text key={d} allowFontScaling={false} style={[type.caption, { flex: 1, textAlign: "center", color: i + 1 === playingDay ? colour.rugby700 : colour.inkMuted, fontFamily: i + 1 === playingDay ? font.bodySemi : font.body }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space.xs }}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: TOUCH_TARGET + 4 }} />
          const inSeason = d >= seasonStart && d <= seasonEnd && d >= today
          const preferred = isoWeekday(d) === playingDay
          const on = d === selected
          const count = pressure.get(d) ?? 0
          const label = [
            new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
            preferred ? "preferred playing day" : null,
            !inSeason ? "not available to plan" : count > 0 ? `${count} ${count === 1 ? "commitment" : "commitments"} already` : "no known clash",
          ]
            .filter(Boolean)
            .join(", ")
          return (
            <View key={d} style={{ width: `${100 / 7}%`, height: TOUCH_TARGET + 4, alignItems: "center", justifyContent: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: on, disabled: !inSeason }}
                disabled={!inSeason}
                onPress={() => onSelect(d)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? colour.pitch600 : preferred && inSeason ? colour.mint100 : "transparent",
                  opacity: inSeason ? 1 : 0.3,
                }}
              >
                <Text allowFontScaling={false} style={[type.smallMedium, { color: on ? colour.onForest : preferred ? colour.rugby700 : colour.ink }]}>
                  {Number(d.slice(8))}
                </Text>
                {count > 0 && !on && <View style={{ position: "absolute", bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: familyOnForest.amber }} />}
              </Pressable>
            </View>
          )
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm, flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.mint100, borderWidth: 1, borderColor: colour.pitch600 }} />
          <Text style={[type.caption, { color: colour.inkMuted }]}>Preferred playing day ({DAY_NAMES[playingDay - 1]})</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: familyOnForest.amber }} />
          <Text style={[type.caption, { color: colour.inkMuted }]}>Club already has fixtures or requests</Text>
        </View>
      </View>
    </PlannerCard>
  )
}

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

// ---------------------------------------------------------------------------------------------------------------------
// A CLUB DAY, AS A CARD -- the opponent's crest, which way it went, the date, and its own live state.
// ---------------------------------------------------------------------------------------------------------------------

const DAY_STATE_PILL: Record<ClubDayState, keyof typeof STATE_COLOUR> = {
  confirmed: "confirmed",
  partly_confirmed: "confirmed",
  awaiting: "pending",
  needs_attention: "countered",
  declined: "declined",
  withdrawn: "unfilled",
}

export function ClubDayCard({ day, onPress }: { day: ClubDayListItem; onPress: () => void }) {
  const state = clubDayState(day)
  const waitingForUs = day.direction === "received" && day.pending + day.countered > 0
  const label = waitingForUs ? "Needs your answer" : CLUB_DAY_STATE_LABEL[state]
  const crest = clubLogoUrlFromPath(supabase, day.opponentLogoPath)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Club day ${day.direction === "sent" ? "with" : "from"} ${day.opponentName}, ${shortMatchDate(day.date)}, ${day.total} ${day.total === 1 ? "fixture" : "fixtures"}. ${label}. ${clubDaySummaryWords(day)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colour.chalk : colour.surface,
        borderWidth: waitingForUs ? 2 : 1,
        borderColor: waitingForUs ? colour.pitch600 : colour.line,
      })}
    >
      <ClubCrest clubName={day.opponentName} url={crest} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {/* Wraps at large text sizes: the date is never squeezed out by the state. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: space.sm, rowGap: 4 }}>
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {day.direction === "sent" ? "Sent" : "Received"} · {shortMatchDate(day.date)}
          </Text>
          <StatePill state={waitingForUs ? "incoming" : DAY_STATE_PILL[state]} label={label} />
        </View>
        <Text numberOfLines={2} style={[type.bodyMedium, { color: colour.ink }]}>
          {day.opponentName}
        </Text>
        {/* The counts are the point of the card: they wrap rather than trail off. */}
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {day.total} {day.total === 1 ? "fixture" : "fixtures"} · {clubDaySummaryWords(day)}
        </Text>
      </View>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// THE WEEK, AS A RUGBY CLUB SAYS IT: "week commencing 1 November", the day the club usually plays, and every other day
// of that week one tap away -- an ad-hoc Wednesday is never a fight.
// ---------------------------------------------------------------------------------------------------------------------
export function WeekCard({
  weekStart,
  date,
  preferredDay,
  teamDays,
  onChangeWeek,
  onChooseDay,
}: {
  weekStart: string
  date: string
  /** The club's day for the week (highlighted); null when nothing is set. */
  preferredDay: IsoWeekday | null
  /** How many of the club's teams usually play on each weekday. */
  teamDays: Map<IsoWeekday, number>
  onChangeWeek: () => void
  onChooseDay: (iso: string) => void
}) {
  const monthWord = new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
  const chosenDay = isoWeekday(date)
  const preferred = preferredDay ? addDays(weekStart, preferredDay - 1) : null
  return (
    <PlannerCard padded={false}>
      <View style={{ padding: space.md, flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.overline, { color: colour.inkMuted }]}>WEEK COMMENCING</Text>
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 30, lineHeight: 33, letterSpacing: 0.5, color: colour.ink }}>
            {monthWord.toUpperCase()}
          </Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {date === preferred || !preferred ? "Preferred fixture day" : "Fixture day (not the usual day)"}
          </Text>
          <Text style={[type.heading, { color: date === preferred || !preferred ? colour.rugby700 : colour.warning }]}>{shortMatchDate(date).toUpperCase()}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change the week"
          onPress={onChangeWeek}
          style={({ pressed }) => ({ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: pressed ? colour.mint300 : colour.mint100 })}
        >
          <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Change</Text>
        </Pressable>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Day of the week" style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colour.line, paddingHorizontal: space.xs, paddingVertical: space.sm }}>
        {(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const).map((label, i) => {
          const day = (i + 1) as IsoWeekday
          const iso = addDays(weekStart, i)
          const on = day === chosenDay
          const isPreferred = day === preferredDay
          const teams = teamDays.get(day) ?? 0
          return (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${DAY_NAMES[i]} ${Number(iso.slice(8))}${isPreferred ? ", the club's usual day" : ""}${teams ? `, ${teams} ${teams === 1 ? "team usually plays" : "teams usually play"}` : ""}`}
              onPress={() => onChooseDay(iso)}
              style={{ flex: 1, alignItems: "center", gap: 2, minHeight: TOUCH_TARGET + 12, justifyContent: "center" }}
            >
              <Text allowFontScaling={false} style={[type.caption, { color: isPreferred ? colour.rugby700 : colour.inkMuted, fontFamily: isPreferred ? font.bodySemi : font.body }]}>
                {label}
              </Text>
              <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: on ? colour.forest800 : isPreferred ? colour.mint100 : "transparent" }}>
                <Text allowFontScaling={false} style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>
                  {Number(iso.slice(8))}
                </Text>
              </View>
              <View style={{ height: 5, flexDirection: "row", gap: 2 }}>
                {teams > 0 && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colour.pitch600 }} />}
              </View>
            </Pressable>
          )
        })}
      </View>
    </PlannerCard>
  )
}

/** A team row's state, unmistakable: one short word and its tone. */
export function StateTag({ label, tone }: { label: string; tone: "positive" | "caution" | "negative" | "neutral" | "info" }) {
  const c =
    tone === "positive"
      ? { bg: colour.mint100, fg: colour.rugby700 }
      : tone === "caution"
        ? { bg: colour.warningSurface, fg: colour.warning }
        : tone === "negative"
          ? { bg: colour.dangerSurface, fg: colour.danger }
          : tone === "info"
            ? { bg: colour.infoSurface, fg: colour.info }
            : { bg: "rgba(16,21,18,0.06)", fg: colour.inkMuted }
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.bg }}>
      <Text maxFontSizeMultiplier={1.3} style={[type.overline, { color: c.fg, letterSpacing: 0.6 }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// TWO CLUBS ON THE FOREST -- the planning (requesting) club on the left, the other club on the right, each with its own
// crest (the canonical crest or its initials fallback, never kit artwork), the date as the headline and how it stands.
// One band for a Club Day and for one fixture request inside it, so both read as the same place.
// ---------------------------------------------------------------------------------------------------------------------
export interface BandClub {
  name: string
  crestUrl: string | null
}

export function ClubPairBand({ left, right, headline, lines, children }: { left: BandClub; right: BandClub; headline: string; lines: string[]; children?: ReactNode }) {
  return (
    <View style={{ backgroundColor: surface.forest, paddingHorizontal: space.lg, paddingBottom: space.xl, paddingTop: space.sm, gap: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: space.md }}>
        <BandSide club={left} caption="Requesting" />
        <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 36, height: 36, marginTop: 14, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: onForest.line }}>
          <ArrowRightLeft size={18} color={onForest.primary} />
        </View>
        <BandSide club={right} caption="Opposition" />
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ fontFamily: font.display, fontSize: 30, lineHeight: 33, letterSpacing: 0.5, color: onForest.primary, textAlign: "center" }}>
          {headline}
        </Text>
        {lines.map((line) => (
          <Text key={line} maxFontSizeMultiplier={1.6} style={[type.small, { color: onForest.secondary, textAlign: "center" }]}>
            {line}
          </Text>
        ))}
      </View>
      {children}
    </View>
  )
}

function BandSide({ club, caption }: { club: BandClub; caption: string }) {
  return (
    <View accessible accessibilityLabel={`${caption}: ${club.name}`} style={{ alignItems: "center", gap: space.xs, width: 128 }}>
      <ClubCrest clubName={club.name} url={club.crestUrl} size={64} />
      <Text numberOfLines={3} maxFontSizeMultiplier={1.4} style={[type.smallMedium, { color: onForest.primary, textAlign: "center" }]}>
        {club.name}
      </Text>
    </View>
  )
}

/** A state on the forest, as words with a dot -- for the band's one summary line. */
export function OnForestPill({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: space.lg, rowGap: 4, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.08)", alignSelf: "center" }}
    >
      {children}
    </View>
  )
}

export function OnForestCount({ dot, text }: { dot: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} />
      <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: onForest.primary }]}>
        {text}
      </Text>
    </View>
  )
}

/** A list inside a bottom sheet that scrolls once it is taller than most of the screen -- a club can field 20 sides. */
export function SheetList({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions()
  return (
    <ScrollView style={{ maxHeight: Math.round(height * 0.5) }} contentContainerStyle={{ gap: space.sm }} showsVerticalScrollIndicator>
      {children}
    </ScrollView>
  )
}
