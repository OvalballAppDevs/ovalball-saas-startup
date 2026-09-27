import { Pressable, Text, View } from "react-native"
import type { AgendaItem, FamilyMember } from "@ovalball/contracts"
import { needsAttendanceResponse } from "@ovalball/contracts"
import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"

import { dateBlock, homeAwayLabel, opponentLine, resultOutcome, shortVenue, spokenAgendaItem } from "../agenda/presentation"
import { ChildMark } from "./child-mark"
import { ClubCrest, PersonAvatar } from "./identity"
import { MapPin } from "./icons"
import { Skeleton } from "./ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/** THE SHAPE A FIXTURE ROW WILL BE (Section 24), so the list never flashes "No fixtures" while loading
 * and never jumps when the real rows arrive. */
export function FixtureRowSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}
    >
      <View style={{ width: 34, alignItems: "center", gap: 4 }}>
        <Skeleton height={9} width={24} />
        <Skeleton height={16} width={20} />
        <Skeleton height={9} width={24} />
      </View>
      <Skeleton height={38} width={38} style={{ borderRadius: 19 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton height={14} width="70%" />
        <Skeleton height={11} width="45%" />
      </View>
      <Skeleton height={20} width={48} style={{ borderRadius: radius.pill }} />
    </View>
  )
}

/**
 * THE FIXTURES AGENDA'S OWN ROW (owner correction pass, physical review): the date-block-on-the-left
 * anatomy from the approved mockup. Deliberately NOT `AgendaRow` -- that component is shared with the
 * Calendar and Home, which still group by day heading and still want the row's OWN time rather than its
 * date; forking a second row here means neither of those has to change to satisfy this screen's very
 * different layout. `AgendaItem` stays the one canonical shape either way -- this is presentation only.
 *
 * Meet time is deliberately never shown here (Section 4): it is match-day operational detail, kept for
 * Fixture Detail/Edit/Match Centre, not for scanning a season.
 */
export interface AgendaSibling {
  member: FamilyMember
  attendance: AgendaItem["attendance"]
  outstanding: boolean
}

export function FixtureListRow({
  item,
  today,
  isNext = false,
  onPress,
  child = null,
  siblings,
  addResult = false,
  onAddResult,
  canRecordResult = false,
}: {
  item: AgendaItem
  today: string
  /** The very first legitimate (non-cancelled) upcoming fixture -- a subtle NEXT mark and a faint tint,
   * never a second card size or a separate section. */
  isNext?: boolean
  onPress: () => void
  child?: FamilyMember | null
  siblings?: AgendaSibling[]
  /** True for a past fixture with no result yet, where the viewer holds `fixture.result.record`. */
  addResult?: boolean
  onAddResult?: () => void
  /** False for a past fixture with no result where the viewer does NOT hold `fixture.result.record` --
   * shown as "Result pending" text rather than a button nobody here may press. */
  canRecordResult?: boolean
}) {
  const block = dateBlock(item.date)
  const cancelled = item.status === "Cancelled"
  const home = homeAwayLabel(item.homeAway)
  const outcome = resultOutcome(item.result)
  const venue = shortVenue(item.venue)
  const outstanding = item.playerId !== null && !item.attendance && needsAttendanceResponse(item, today)

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${isNext ? "Next. " : ""}${spokenAgendaItem(item, today)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: isNext ? colour.pitch600 : colour.line,
        backgroundColor: isNext ? colour.mint100 : colour.surface,
        opacity: pressed ? 0.94 : cancelled ? 0.65 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
        <View style={{ width: 34, alignItems: "center", gap: 1 }}>
          {isNext && (
            <Text style={[type.caption, { color: colour.forest800, fontSize: 9, letterSpacing: 0.4 }]}>NEXT</Text>
          )}
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.weekday}</Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontSize: 18, lineHeight: 20 }]}>{block.day}</Text>
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.month}</Text>
        </View>

        <ClubCrest clubName={item.them?.clubName ?? null} url={item.them?.crestUrl ?? null} size={38} />

        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {siblings && siblings.length > 1 ? (
            <SiblingMarks siblings={siblings} />
          ) : (
            !!child && <ChildMark member={child} style={{ marginBottom: 1 }} />
          )}
          <Text
            numberOfLines={1}
            style={[
              type.bodyMedium,
              { color: colour.ink, fontSize: 15, textDecorationLine: cancelled ? "line-through" : "none" },
            ]}
          >
            {opponentLine(item)}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {item.us.teamName ?? item.us.clubName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            {venue ? (
              <>
                <MapPin size={11} color={colour.inkSubtle} />
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>
                  {home?.spoken && home.spoken !== "Neutral" ? `${home.spoken} · ${venue}` : venue}
                </Text>
              </>
            ) : (
              <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>Venue TBC</Text>
            )}
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {cancelled ? (
            <Pill label="Cancelled" tone="neutral" />
          ) : outcome ? (
            <>
              <Text style={[type.bodyMedium, { color: colour.ink, fontSize: 16 }]}>
                {item.result!.ourScore}–{item.result!.theirScore}
              </Text>
              <Pill label={outcome.label} tone={outcome.tone} />
            </>
          ) : addResult ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add Result"
              onPress={onAddResult}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET - 12,
                paddingHorizontal: space.sm,
                borderRadius: radius.pill,
                backgroundColor: colour.forest800,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.caption, { color: colour.onForest, fontSize: 11 }]}>Add Result</Text>
            </Pressable>
          ) : item.result === null && item.kind === "fixture" && !canRecordResult && item.date < today ? (
            <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>Result pending</Text>
          ) : (
            !!home && item.kind === "fixture" && <HomeAwayPill home={home.short} />
          )}
          {item.attendance ? (
            <Attendance value={item.attendance} />
          ) : (
            outstanding && <Attendance value={null} />
          )}
        </View>
      </View>
    </Pressable>
  )
}

/** Restrained text pills, not the circular H/A mark -- Section 8's own instruction for this card. */
function HomeAwayPill({ home }: { home: string }) {
  if (home !== "H" && home !== "A") return null
  const tone = home === "H" ? { bg: colour.mint100, fg: colour.forest800 } : { bg: "rgba(16,21,18,0.06)", fg: colour.inkMuted }
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 }}>
      <Text style={[type.caption, { color: tone.fg, fontSize: 11 }]}>{home === "H" ? "Home" : "Away"}</Text>
    </View>
  )
}

function Pill({ label, tone }: { label: string; tone: "positive" | "negative" | "neutral" }) {
  const shades = {
    positive: { bg: colour.mint100, fg: colour.forest800 },
    negative: { bg: colour.dangerSurface, fg: colour.danger },
    neutral: { bg: "rgba(16,21,18,0.06)", fg: colour.inkMuted },
  }
  const shade = shades[tone]
  return (
    <View style={{ backgroundColor: shade.bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 }}>
      <Text style={[type.caption, { color: shade.fg, fontSize: 11 }]}>{label}</Text>
    </View>
  )
}

function SiblingMarks({ siblings }: { siblings: AgendaSibling[] }) {
  return (
    <View accessible={false} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: 2 }}>
      {siblings.map((s) => (
        <View key={s.member.playerId} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <PersonAvatar name={s.member.fullName} url={s.member.avatarUrl} initials={s.member.initials} size={16} />
          <Text style={[type.caption, { color: colour.ink, fontSize: 11 }]}>{s.member.shortLabel}</Text>
        </View>
      ))}
    </View>
  )
}

function Attendance({ value }: { value: AgendaItem["attendance"] }) {
  const label = ATTENDANCE_STATE_WORDS[value ?? "AWAITING"]
  const colours = value === "ATTENDING" ? colour.forest800 : value === "CANNOT_ATTEND" ? colour.danger : colour.warning
  return <Text style={[type.caption, { color: colours, fontSize: 10 }]}>{label}</Text>
}
