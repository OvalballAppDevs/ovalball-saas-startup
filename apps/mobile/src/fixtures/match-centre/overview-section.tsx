import { Pressable, Text, View } from "react-native"

import { matchStatusPresentation, type WeatherResult } from "@ovalball/contracts"
import { cateringLine, type MatchCentreAttendance } from "@ovalball/contracts/match-centre/attendance"
import type { FixtureAnnouncement } from "@ovalball/contracts/match-centre/communications"
import type { MatchCentreSection } from "@ovalball/contracts/match-centre/sections"
import type { MatchRewards } from "@ovalball/contracts/match-centre/rewards"

import { AwardBadge } from "../../components/player-identity"
import { MatchConditions } from "../../components/match-conditions"
import { Button } from "../../components/ui"
import { ChevronRight, ClipboardList, Megaphone, Pencil, Trophy, Users, Utensils } from "../../components/icons"
import { exactDate, kickoffLabel } from "../../agenda/presentation"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import type { FixtureDetail } from "../../agenda/fixture-detail"
import type { MatchCentreView } from "../../match-centre/load"
import { resultQualifier } from "./hero"

/**
 * OVERVIEW -- the match at a glance, before, on and after the day. It is a summary that routes to the
 * section that owns each thing, never a giant form: staff get one contextual Edit, families read.
 *
 * After the match the same page leads with the result and the award winners -- there is no separate
 * post-match screen.
 */
export function OverviewSection({
  view,
  weather,
  attendance,
  rewards,
  latest,
  detail,
  canEdit,
  canCancel,
  today,
  responding,
  onEdit,
  onCancel,
  onAcceptKickoff,
  onDeclineKickoff,
  onGo,
}: {
  view: MatchCentreView
  weather: WeatherResult
  attendance: MatchCentreAttendance | null
  rewards: MatchRewards | null
  latest: FixtureAnnouncement | null
  detail: FixtureDetail | null
  canEdit: boolean
  canCancel: boolean
  today: string
  responding: boolean
  onEdit: () => void
  onCancel: () => void
  onAcceptKickoff: () => void
  onDeclineKickoff: () => void
  onGo: (section: MatchCentreSection) => void
}) {
  const status = matchStatusPresentation(view.status)
  const mySide = attendance?.sides.find((s) => s.side === attendance.viewerSide && s.counts)
  const winners = (rewards?.awards ?? []).filter((a) => a.state === "DECIDED" && a.winner)
  const played = view.kickedOff && !view.cancelled
  const qualifier = resultQualifier(view.resultStatus)

  return (
    <View style={{ gap: space.lg }}>
      {/* A PROPOSED KICK-OFF CHANGE is a decision for the staff, made here rather than reported as saved. */}
      {!!detail?.proposedKickoff && !view.cancelled && (
        <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, gap: space.xs }}>
          <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.warning }]}>
            {detail.proposedKickoff.byUs ? "Change proposed — waiting for the other club" : "The other club has proposed a change"}
          </Text>
          <Text style={[type.small, { color: colour.warning }]}>
            {exactDate(detail.proposedKickoff.date)}
            {detail.proposedKickoff.time ? ` · ${detail.proposedKickoff.time}` : ""}. Until it is agreed, this match stays at {detail.kickoff ?? "the agreed time"}.
          </Text>
          {canEdit && !detail.proposedKickoff.byUs && <Button label="Accept" busy={responding} onPress={onAcceptKickoff} />}
          {canEdit && <Button label={detail.proposedKickoff.byUs ? "Withdraw" : "Decline"} variant="secondary" busy={responding} onPress={onDeclineKickoff} />}
        </View>
      )}

      {/* AFTER THE MATCH: the result first, then who was recognised. */}
      {played && view.result && (
        <NavCard
          icon={<ClipboardList size={20} color={colour.forest800} />}
          title="Final Score"
          body={`${view.home.clubName} ${view.result.homeScore}–${view.result.awayScore} ${view.away.clubName}${qualifier ? ` · ${qualifier}` : ""}`}
          onPress={() => onGo("result")}
        />
      )}
      {winners.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Awards. ${winners.map((w) => `${w.name}: ${w.winner?.displayName ?? w.winner?.firstName}`).join(". ")}`}
          onPress={() => onGo("rewards")}
          style={({ pressed }) => ({ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.sm, opacity: pressed ? 0.85 : 1 })}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Trophy size={18} color={colour.forest800} />
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Awards</Text>
            <ChevronRight size={18} color={colour.inkSubtle} />
          </View>
          {winners.map((w) => (
            <View key={`${w.teamId}-${w.categoryKey}`} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <AwardBadge categoryKey={w.categoryKey} size={32} label={w.name} />
              <View style={{ flex: 1 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{w.winner?.displayName ?? w.winner?.firstName}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{w.name}</Text>
              </View>
            </View>
          ))}
        </Pressable>
      )}

      {/* THE MATCH'S FACTS. One contextual Edit for the staff who may change them. */}
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Match Details</Text>
          {canEdit && !view.cancelled && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit match details"
              onPress={onEdit}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Pencil size={15} color={colour.forest800} />
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
            </Pressable>
          )}
        </View>
        <Row label="Status" value={status.label} />
        <Row label="Date" value={exactDate(view.date)} />
        <Row label="Meet" value={kickoffLabel(view.meetTime) ?? "Not set"} muted={!view.meetTime} />
        <Row label="Kick-off" value={kickoffLabel(view.kickoffTime) ?? "Not set"} muted={!view.kickoffTime} />
        <Row label="Venue" value={view.venue.name ?? "To be confirmed"} muted={!view.venue.name} onPress={() => onGo("arena")} />
        <Row label="Pitch" value={view.pitch.name ?? "Not set"} muted={!view.pitch.name} onPress={() => onGo("arena")} />
        {!!view.competitionName && <Row label="Competition" value={view.competitionName} />}
        {!!view.matchType && <Row label="Match Type" value={view.matchType} />}
        <Row label="Notes" value={view.notes ?? "None"} muted={!view.notes} last />
      </View>

      {!played && (
        <MatchConditions
          venueName={view.venue.name}
          postcode={view.venue.postcode}
          addressLines={view.venue.addressLines}
          pitchName={view.pitch.name}
          weather={weather}
        />
      )}

      {mySide?.counts && (
        <NavCard
          icon={<Users size={20} color={colour.forest800} />}
          title="Attendance"
          body={
            attendance?.open
              ? `${mySide.counts.attending} attending · ${mySide.counts.unsure} unsure · ${mySide.counts.cannotAttend} can't attend · ${mySide.counts.awaiting} awaiting`
              : "Attendance is not open yet."
          }
          onPress={() => onGo("attendance")}
        />
      )}

      {attendance?.catering.required && attendance.catering.total !== undefined && (
        <NavCard
          icon={<Utensils size={20} color={colour.forest800} />}
          title={`Catering · ${attendance.catering.total}`}
          body={cateringLine(attendance.catering, { home: view.home.clubName, away: view.away.clubName }) ?? ""}
          onPress={() => onGo("attendance")}
        />
      )}

      {!!latest && (
        <NavCard
          icon={<Megaphone size={20} color={colour.forest800} />}
          title={latest.kind === "REMINDER" ? "Latest Reminder" : "Latest Announcement"}
          body={latest.body ?? "Attendance reminder sent."}
          onPress={() => onGo("changing-room")}
        />
      )}

      {canCancel && !view.cancelled && view.date >= today && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel this fixture"
          onPress={onCancel}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET + 6,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            backgroundColor: colour.danger,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Cancel Fixture</Text>
        </Pressable>
      )}
    </View>
  )
}

function Row({ label, value, muted, last, onPress }: { label: string; value: string; muted?: boolean; last?: boolean; onPress?: () => void }) {
  const content = (
    <>
      <Text style={[type.small, { color: colour.inkMuted, width: 92 }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: muted ? colour.inkSubtle : colour.ink, fontSize: 15, flex: 1 }]}>{value}</Text>
      {onPress && <ChevronRight size={16} color={colour.inkSubtle} />}
    </>
  )
  const style = {
    minHeight: TOUCH_TARGET,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: colour.line,
  }
  if (!onPress) return <View style={style}>{content}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [style, { backgroundColor: pressed ? colour.chalk : "transparent" }]}>
      {content}
    </Pressable>
  )
}

function NavCard({ icon, title, body, onPress }: { icon: React.ReactNode; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: pressed ? colour.chalk : colour.surface,
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text numberOfLines={3} style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{body}</Text>
      </View>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}
