import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"

import { availabilityEventLabel, availabilityQuestion, availabilitySubject, type AvailabilityStatus } from "@ovalball/contracts"
import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"
import {
  attendanceOpensLabel,
  type MatchCentreAttendance,
  type SideAttendance,
} from "@ovalball/contracts/match-centre/attendance"
import {
  REMINDER_AUDIENCES,
  audienceCount,
  sendFixtureCommunication,
  sendOutcomeLine,
  type CommunicationCounts,
  type ReminderAudience,
} from "@ovalball/contracts/match-centre/communications"
import type { PlayerRecognition } from "@ovalball/contracts/match-centre/rewards"

import { supabase } from "../../auth/supabase"
import { AvailabilityChoice } from "../../components/availability-choice"
import { PlayerIdentity } from "../../components/player-identity"
import { BottomSheet } from "../../components/bottom-sheet"
import { Bell, CalendarDays, ChevronRight } from "../../components/icons"
import { Button } from "../../components/ui"
import { relativeDate } from "../../agenda/presentation"
import { friendly } from "../../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import type { MatchCentreView, MyAvailability } from "../../match-centre/load"

/**
 * ATTENDANCE -- one canonical model (`player_fixture_attendance`), one control, and each side drawn as
 * the server lets this viewer see it.
 *
 *   * a family answers for the players they hold -- "Can Ava make it?" -- and nobody else;
 *   * a side's own staff see the names, grouped by answer;
 *   * the other side's staff see NUMBERS ONLY -- the names were never sent;
 *   * the catering headcount is the server's, derived from the same answers, and shown in Arena Details.
 */
export function AttendanceSection({
  view,
  attendance,
  counts,
  recognition,
  today,
  onAnswer,
  onOpenAttendance,
  opening,
  onChanged,
}: {
  view: MatchCentreView
  attendance: MatchCentreAttendance | null
  counts: CommunicationCounts | null
  recognition: Map<string, PlayerRecognition[]>
  today: string
  onAnswer: (entry: MyAvailability, status: AvailabilityStatus) => Promise<boolean>
  onOpenAttendance: () => void
  opening: boolean
  onChanged: () => void
}) {
  const [reminding, setReminding] = useState(false)
  const what = availabilityEventLabel("fixture", relativeDate(view.date, today))
  const sideName = (side: "home" | "away") => (side === "home" ? view.home : view.away).clubName
  const ordered = attendance ? [...attendance.sides].sort((a, b) => (a.side === attendance.viewerSide ? -1 : b.side === attendance.viewerSide ? 1 : 0)) : []
  const staffSide = ordered.find((s) => s.visibility === "NAMES")

  return (
    <View style={{ gap: space.lg }}>
      {attendance && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            padding: space.md,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: attendance.open ? "rgba(50,166,101,0.35)" : colour.line,
            backgroundColor: attendance.open ? colour.successSurface : colour.surface,
          }}
        >
          <CalendarDays size={22} color={attendance.open ? colour.forest800 : colour.inkMuted} />
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>
              {view.cancelled ? "No answer needed" : attendance.open ? "Attendance is open" : attendanceOpensLabel(attendance.opensOn)}
            </Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {view.cancelled
                ? "This fixture has been cancelled."
                : attendance.open
                  ? attendance.openedEarlyAt
                    ? "Opened early by the team's staff."
                    : `Opened ${attendance.openDays} days before the match.`
                  : `It opens ${attendance.openDays} days before kick-off, and families are told when it does.`}
            </Text>
          </View>
        </View>
      )}

      {attendance?.canOpen && !view.cancelled && (
        <Button label="Open Attendance Now" busy={opening} onPress={onOpenAttendance} accessibilityHint="Opens attendance early and asks the families at once" />
      )}

      {/* THE VIEWER'S OWN ANSWERS -- one card per player they may answer for. */}
      {view.mine.map((entry) => (
        <View key={entry.playerId} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
          <PlayerIdentity
            name={entry.displayName}
            detail={(entry.isSelf ? null : (view.viewerSide === "home" ? view.home : view.away).teamName) ?? null}
            recognition={recognition.get(entry.playerId) ?? []}
            size={44}
          />
          {entry.canRespond ? (
            <AvailabilityChoice
              question={availabilityQuestion("fixture", entry.isSelf, entry.firstName)}
              subject={availabilitySubject(entry.isSelf, entry.firstName)}
              what={what}
              committed={entry.response}
              disabled={false}
              onChoose={(next) => onAnswer(entry, next)}
              ground="light"
            />
          ) : (
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{availabilityQuestion("fixture", entry.isSelf, entry.firstName)}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{entry.cannotRespondReason ?? "You cannot respond for this player."}</Text>
              {entry.response && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>Last answer: {ATTENDANCE_STATE_WORDS[entry.response]}</Text>
              )}
            </View>
          )}
        </View>
      ))}

      {ordered
        .filter((s) => s.visibility !== "NONE" && s.counts)
        .map((s) => (
          <SideCard key={s.side} side={s} name={sideName(s.side)} isOwn={s.side === attendance?.viewerSide} recognition={recognition} />
        ))}

      {/* Catering is in Arena Details, directly under the changing rooms. */}

      {/* REMINDERS, for the staff whose families these are -- and only once attendance is open. */}
      {view.canManageFixture && staffSide && attendance?.open && !view.cancelled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remind those who haven't responded"
          onPress={() => setReminding(true)}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET + 8,
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            paddingHorizontal: space.lg,
            borderRadius: radius.lg,
            borderWidth: 1.5,
            borderColor: colour.forest800,
            backgroundColor: pressed ? colour.chalk : colour.surface,
          })}
        >
          <Bell size={18} color={colour.forest800} />
          <Text style={[type.bodyMedium, { color: colour.forest800, flex: 1 }]}>Remind Those Who Haven't Responded</Text>
          <ChevronRight size={18} color={colour.forest800} />
        </Pressable>
      )}

      {reminding && counts && (
        <ReminderSheet
          fixtureId={view.fixtureId}
          counts={counts}
          onClose={() => setReminding(false)}
          onSent={() => {
            onChanged()
          }}
        />
      )}
    </View>
  )
}

/** One side's attendance: count tiles always, names grouped by answer only for that side's own staff. */
function SideCard({ side, name, isOwn, recognition }: { side: SideAttendance; name: string; isOwn: boolean; recognition: Map<string, PlayerRecognition[]> }) {
  const [open, setOpen] = useState<string | null>(null)
  const c = side.counts!
  const tiles: { key: string; label: string; value: number; ink: string; ground: string }[] = [
    { key: "ATTENDING", label: ATTENDANCE_STATE_WORDS.ATTENDING, value: c.attending, ink: colour.forest800, ground: colour.successSurface },
    { key: "UNSURE", label: ATTENDANCE_STATE_WORDS.UNSURE, value: c.unsure, ink: colour.warning, ground: colour.warningSurface },
    { key: "CANNOT_ATTEND", label: ATTENDANCE_STATE_WORDS.CANNOT_ATTEND, value: c.cannotAttend, ink: colour.danger, ground: colour.dangerSurface },
    { key: "AWAITING", label: ATTENDANCE_STATE_WORDS.AWAITING, value: c.awaiting, ink: colour.inkMuted, ground: colour.chalk },
  ]
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]} numberOfLines={2}>
          {isOwn ? "Team Attendance" : name}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {c.squad} {c.squad === 1 ? "player" : "players"}
        </Text>
      </View>
      {!isOwn && side.visibility === "COUNTS" && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>Numbers only. Each club sees its own players' names.</Text>
      )}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {tiles.map((t) => (
          <View key={t.key} accessible accessibilityLabel={`${t.label}: ${t.value}`} style={{ flex: 1, alignItems: "center", paddingVertical: space.md, borderRadius: radius.md, backgroundColor: t.ground, gap: 2 }}>
            <Text style={[type.display, { color: t.ink, fontSize: 26, lineHeight: 28 }]}>{t.value}</Text>
            <Text numberOfLines={2} style={[type.caption, { color: t.ink, textAlign: "center", fontSize: 11 }]}>{t.label}</Text>
          </View>
        ))}
      </View>
      {side.players &&
        tiles.map((t) => {
          const people = side.players!.filter((p) => (t.key === "AWAITING" ? p.status === null : p.status === t.key))
          if (people.length === 0) return null
          const expanded = open === t.key
          return (
            <View key={t.key} style={{ borderTopWidth: 1, borderTopColor: colour.line }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${t.label}, ${people.length}`}
                onPress={() => setOpen(expanded ? null : t.key)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.ink }} />
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                  {t.label} <Text style={{ color: colour.inkMuted }}>({people.length})</Text>
                </Text>
                <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </View>
              </Pressable>
              {expanded && (
                <View style={{ gap: space.sm, paddingBottom: space.sm }}>
                  {people.map((p) => (
                    <PlayerIdentity key={p.playerId} name={p.displayName ?? p.firstName} recognition={recognition.get(p.playerId) ?? []} size={32} />
                  ))}
                </View>
              )}
            </View>
          )
        })}
    </View>
  )
}

/** A reminder to the families who have not answered, or are unsure -- never to those who said yes or no. */
function ReminderSheet({ fixtureId, counts, onClose, onSent }: { fixtureId: string; counts: CommunicationCounts; onClose: () => void; onSent: () => void }) {
  const [audience, setAudience] = useState<ReminderAudience>("ATTENDANCE_REMINDER")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setProblem(null)
    try {
      const result = await sendFixtureCommunication(supabase, fixtureId, audience, note.trim() || null)
      setOutcome(sendOutcomeLine(result))
      onSent()
    } catch (caught) {
      setProblem(friendly(caught, "this reminder").message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible title="Send a Reminder" onClose={onClose}>
      <View style={{ gap: space.md }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>Choose who to remind. Families who have already said yes or no are not chased.</Text>
        <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
          {REMINDER_AUDIENCES.map((a) => {
            const chosen = audience === a.key
            const n = audienceCount(counts, a.key)
            return (
              <Pressable
                key={a.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`${a.label}${n !== null ? `, ${n}` : ""}`}
                onPress={() => setAudience(a.key)}
                style={{
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: chosen ? colour.forest800 : colour.line,
                  backgroundColor: chosen ? colour.successSurface : colour.surface,
                }}
              >
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{a.label}</Text>
                {n !== null && <Text style={[type.small, { color: colour.inkMuted }]}>{n}</Text>}
              </Pressable>
            )
          })}
        </View>
        <TextInput
          accessibilityLabel="Add a note (optional)"
          placeholder="Add a note (optional)"
          placeholderTextColor={colour.inkSubtle}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
          style={[type.body, { minHeight: 72, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, textAlignVertical: "top" }]}
        />
        {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
        {!!outcome && (
          <Text accessibilityLiveRegion="polite" style={[type.smallMedium, { color: colour.forest800 }]}>
            {outcome}
          </Text>
        )}
        {outcome ? <Button label="Done" onPress={onClose} /> : <Button label="Send Reminder" busy={busy} onPress={() => void send()} />}
      </View>
    </BottomSheet>
  )
}
