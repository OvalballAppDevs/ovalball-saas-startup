import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"

import {
  clock,
  conflictsFor,
  dietaryLine,
  longDay,
  toMinutes,
  eventCateringLine,
  fixtureCateringLine,
  kindWord,
  activityLabel,
  activityTitle,
  needLines,
  needsAllocation,
  placeLine,
  setArenaLock,
  timeRange,
  type AllocationPart,
  type AllocationPreview,
  type ArenaActivity,
  type ArenaDay,
  type ArenaFixture,
  type ArenaTraining,
  type PreviewItem,
} from "@ovalball/contracts/arena"

import { supabase } from "../auth/supabase"
import { Button } from "../components/ui"
import { CircleCheck, Lock, Sparkles, TriangleAlert, Undo2 } from "../components/icons"
import { friendlyAction, logDetail } from "../errors/translate"
import { Sheet } from "../pitch-allocation/sheets"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { centreName } from "./navigation"
import { changeFor, plannedParts, planKey, type Allocatable, type PartKey } from "./planner/plan"
import { fixturePitchWindow, fixtureRoomWindow, trainingMinutes, trainingRoomWindow } from "./planner/rules"
import { displacements, proposalWords, saveWords } from "./planner/words"
import { lockedWords } from "./planner/words"
import type { DayPlanner } from "./planner/use-day-planner"
import { activityTone } from "./style"

function Line({ label, value, unsaved }: { label: string; value: string; unsaved?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: 4 }}>
      <Text style={[type.caption, { color: colour.inkSubtle, width: 96 }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
        {value}
        {unsaved && <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>  Unsaved</Text>}
      </Text>
    </View>
  )
}

function Clash({ message, tone = "hard" }: { message: string; tone?: "hard" | "warning" }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", padding: space.sm, borderRadius: radius.md, backgroundColor: tone === "hard" ? colour.dangerSurface : colour.warningSurface }}>
      <TriangleAlert size={14} color={tone === "hard" ? colour.danger : colour.warning} />
      <Text style={[type.caption, { color: tone === "hard" ? colour.danger : colour.warning, flex: 1 }]}>{message}</Text>
    </View>
  )
}

const roomName = (day: ArenaDay, id: string | null) => (id ? day.rooms.find((r) => r.id === id)?.name ?? "Room" : null)
const pitchNameOf = (day: ArenaDay, id: string | null) => (id ? day.pitches.find((p) => p.id === id)?.name ?? "Pitch" : null)
const venueNameOf = (day: ArenaDay, id: string | null) => (id ? day.venues.find((v) => v.id === id)?.name ?? "Venue" : null)

/** What a staged change alters, part by part, in words: "Pitch: Pitch 1 → Pitch 2". */
function changeLines(day: ArenaDay, a: Allocatable, planner: DayPlanner): string[] {
  const change = changeFor(planner.plan, a)
  if (!change) return []
  const name = (k: PartKey, v: string | null | undefined) =>
    (k === "pitchId" ? pitchNameOf(day, v ?? null) : k === "venueId" ? venueNameOf(day, v ?? null) : k === "kickoff" ? v ?? null : roomName(day, v ?? null)) ?? "None"
  const word: Record<PartKey, string> = a.kind === "TRAINING"
    ? { venueId: "Venue", pitchId: "Pitch", kickoff: "Start", homeRoomId: "Changing room", awayRoomId: "Away changing room", officialsRoomId: "Officials room" }
    : { venueId: "Venue", pitchId: "Pitch", kickoff: "Kick-off", homeRoomId: "Home changing room", awayRoomId: "Away changing room", officialsRoomId: "Officials room" }
  return (Object.keys(change.set) as PartKey[]).map((k) => `${word[k]}: ${name(k, change.expected[k])} → ${name(k, change.set[k])}`)
}

/** A section of the allocation: its name, then its lines. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.forest800, fontFamily: type.heading.fontFamily }]}>{title}</Text>
      {children}
    </View>
  )
}

/**
 * THE WHOLE ALLOCATION, TOGETHER -- opened from either board, for any activity: what it is, who, when, where, the
 * pitch with its warm-up, match and clearing, every changing room with the time it is held (home, away, officials,
 * or a session's own), what is locked, what clashes and what is not saved yet. Never its centre: the way to the
 * fixture, the session, the tournament or the event is one button, and that is also where a time Arena may not
 * move is changed.
 */
export function ActivitySheet({
  day,
  activity: a,
  canManage,
  canLock = canManage,
  planner,
  onClose,
  onAllocate,
  onOpen,
  onLocked,
}: {
  day: ArenaDay
  activity: ArenaActivity | null
  canManage: boolean
  /** Locking writes at once, so it is offered only where there is a real allocation to hold. */
  canLock?: boolean
  planner: DayPlanner
  onClose: () => void
  onAllocate: (a: ArenaFixture | ArenaTraining) => void
  onOpen: (a: ArenaActivity) => void
  onLocked: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { setProblem(null) }, [a?.id])
  if (!a) return <Sheet visible={false} onClose={onClose} title="">{null}</Sheet>
  const tone = activityTone(a)
  const allocatable = (a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING"
  const own = allocatable ? (a as Allocatable) : null
  const change = own ? changeFor(planner.plan, own) : null
  const parts = own ? plannedParts(planner.plan, own) : null
  const moved = (k: PartKey) => !!change && k in change.set
  // The server's clashes are about where it is SAVED; once it is moved in the plan, the plan's own check speaks.
  const clashes = change ? [] : conflictsFor(day.conflicts, a.id)
  const plannedClash = own && change && parts?.pitchId ? planner.clashAt(own, parts.pitchId, toMinutes(parts.kickoff)) : null
  const locks: AllocationPart[] = own ? own.locks : []
  const lockable: AllocationPart[] = a.kind === "FIXTURE"
    ? ([a.pitchId ? "pitch" : null, a.homeRoomId ? "home_room" : null, a.awayRoomId ? "away_room" : null, a.officialsRoomId ? "officials_room" : null].filter(Boolean) as AllocationPart[])
    : a.kind === "TRAINING" ? ([a.pitchId ? "pitch" : null, a.roomId ? "home_room" : null].filter(Boolean) as AllocationPart[]) : []
  const start = parts ? toMinutes(parts.kickoff) : null
  // Who else trains on the same pitch at the same time (sharing, never a clash).
  const sharingWith = a.kind === "TRAINING" && parts?.pitchId && start !== null
    ? planner.draft.filter((o) => o.resourceType === "PITCH" && o.resourceId === parts.pitchId && o.activityType === "TRAINING" && o.activityId !== a.id
      && o.from < start + trainingMinutes(a) && start < o.until).map((o) => o.label)
    : []
  const locked = locks.length > 0

  async function toggleLock() {
    if (!a || !allocatable) return
    setBusy(true)
    setProblem(null)
    try {
      await setArenaLock(supabase, a.kind as "FIXTURE" | "TRAINING", a.id, locked ? [] : lockable)
      onLocked(locked ? `${activityTitle(a)} is unlocked. Auto Allocate may change it again.` : `${activityTitle(a)} is locked. Auto Allocate will leave it as it is.`)
    } catch (cause) {
      const failure = friendlyAction(cause, "lock", "this allocation")
      logDetail("arena lock", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible onClose={onClose} title={activityTitle(a)}>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: tone.surface }}>
            <Text style={[type.caption, { color: tone.text, fontFamily: type.smallMedium.fontFamily }]}>{kindWord(a)}</Text>
          </View>
          <Text style={[type.small, { color: colour.inkMuted }]}>{timeRange(a)}</Text>
        </View>

        {/* NOT SAVED YET: what the plan does to it, and the way back */}
        {own && change && (
          <View accessibilityLiveRegion="polite" style={{ gap: 4, padding: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: change.origin === "AUTO" ? colour.pitch400 : colour.pitch600, backgroundColor: "rgba(220,247,229,0.4)" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {change.origin === "AUTO" && <Sparkles size={14} color={colour.pitch600} />}
              <Text style={[type.smallMedium, { color: colour.forest800, flex: 1 }]}>{change.origin === "AUTO" ? "Proposed by Auto Allocate, not saved yet" : "Moved, not saved yet"}</Text>
            </View>
            {changeLines(day, own, planner).map((l) => <Text key={l} style={[type.caption, { color: colour.ink }]}>{l}</Text>)}
            {change.notes.map((n) => <Text key={n} style={[type.caption, { color: colour.inkMuted }]}>{n}</Text>)}
            <Pressable accessibilityRole="button" accessibilityLabel={change.origin === "AUTO" ? "Remove this proposal" : "Undo this change"} onPress={() => planner.undo(planKey(own.kind, own.id))}
              style={({ pressed }) => ({ alignSelf: "flex-start", marginTop: 4, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.8 : 1 })}>
              <Undo2 size={14} color={colour.forest800} />
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{change.origin === "AUTO" ? "Remove Proposal" : "Undo"}</Text>
            </Pressable>
          </View>
        )}

        {a.kind === "FIXTURE" && a.home && parts && (() => {
          const pw = start !== null ? fixturePitchWindow(start, a.playMinutes, day.policy) : null
          const meet = toMinutes(a.meetTime)
          const room = (role: "HOME" | "AWAY" | "OFFICIALS", id: string | null) => {
            const w = start !== null ? fixtureRoomWindow(start, a.playMinutes, meet, role, day.policy) : null
            return id ? `${roomName(day, id)}${w ? ` · ${clock(w.from)}–${clock(w.until)}` : ""}` : null
          }
          return (
            <View style={{ gap: space.sm }}>
              <View>
                <Line label="When" value={`${longDay(a.date)} · kick-off ${parts.kickoff ?? "not yet set"}`} unsaved={moved("kickoff")} />
                {!a.time.editable && a.time.reason && <Text style={[type.caption, { color: colour.inkMuted, paddingVertical: 2 }]}>{a.time.reason}</Text>}
                {a.time.editable && a.requiresOpponentAgreement && <Text style={[type.caption, { color: colour.inkMuted, paddingVertical: 2 }]}>{`A new kick-off is sent to ${a.opponentName} to agree.`}</Text>}
              </View>
              <Section title="Pitch">
                <Line label="Venue" value={venueNameOf(day, parts.venueId) ?? "Not allocated"} unsaved={moved("venueId")} />
                <Line label="Pitch" value={pitchNameOf(day, parts.pitchId) ?? "Not allocated"} unsaved={moved("pitchId")} />
                {pw && parts.pitchId && <Line label="Held" value={`Warm-up ${clock(pw.from)} · Match ${clock(pw.playFrom)}–${clock(pw.playUntil)} · Clear by ${clock(pw.until)}`} />}
              </Section>
              <Section title="Changing Rooms">
                {a.noChangingRooms ? <Line label="Rooms" value="Played without changing rooms" /> : (
                  <>
                    <Line label="Home" value={room("HOME", parts.homeRoomId) ?? "Not allocated"} unsaved={moved("homeRoomId")} />
                    <Line label="Away" value={room("AWAY", parts.awayRoomId) ?? "Not allocated"} unsaved={moved("awayRoomId")} />
                    <Line label="Officials" value={room("OFFICIALS", parts.officialsRoomId) ?? "None set"} unsaved={moved("officialsRoomId")} />
                    {start !== null && (parts.homeRoomId || parts.awayRoomId) && <Text style={[type.caption, { color: colour.inkMuted }]}>{`Each room is then turned round, until ${clock(fixtureRoomWindow(start, a.playMinutes, meet, "HOME", day.policy).turnaroundUntil)}.`}</Text>}
                  </>
                )}
              </Section>
              <View>
                <Line label="Catering" value={fixtureCateringLine(a) ?? "—"} />
                <Line label="Pitch size" value={a.fit.basis === "REGULATION" ? `${a.fit.source}` : a.fit.basis === "CATEGORY" ? `Counted by category (${a.fit.footprint ?? "unknown"} pitch)` : "No size held for this grade"} />
              </View>
            </View>
          )
        })()}
        {a.kind === "FIXTURE" && !a.home && (
          <View>
            <Line label="Kick-off" value={a.kickoff ?? "Not yet set"} />
            <Line label="Where" value={a.venueName ?? `At ${a.opponentName}`} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>An away fixture uses none of the club's pitches or rooms.</Text>
          </View>
        )}
        {a.kind === "TRAINING" && parts && (() => {
          const rw = trainingRoomWindow(a, start, day.policy)
          const needsRoom = planner.needsOf(a).includes("ROOMS")
          return (
            <View style={{ gap: space.sm }}>
              <View>
                <Line label="When" value={`${longDay(a.date)} · ${start !== null ? `${clock(start)}–${clock(start + trainingMinutes(a))}` : "time to be set"}`} unsaved={moved("kickoff")} />
                {!a.time.editable && a.time.reason && <Text style={[type.caption, { color: colour.inkMuted, paddingVertical: 2 }]}>{a.time.reason}</Text>}
              </View>
              <Section title="Pitch">
                <Line label="Venue" value={venueNameOf(day, parts.venueId) ?? "Not allocated"} unsaved={moved("venueId")} />
                <Line label="Pitch" value={pitchNameOf(day, parts.pitchId) ?? "Not allocated"} unsaved={moved("pitchId")} />
                {sharingWith.length > 0 && <Line label="Shared with" value={sharingWith.join(", ")} />}
              </Section>
              <Section title="Changing Room">
                {a.needsRoom || parts.homeRoomId ? (
                  <>
                    <Line label="Room" value={parts.homeRoomId ? `${roomName(day, parts.homeRoomId)}${rw ? ` · ${clock(rw.from)}–${clock(rw.until)}` : ""}` : needsRoom ? "Needs a room" : "Not allocated"} unsaved={moved("homeRoomId")} />
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      {`${a.roomRequest === "SESSION" ? "Asked for this session" : "Asked for by the team's training plan"}${parts.homeRoomId && rw ? `; turned round by ${clock(rw.turnaroundUntil)}` : ""}. One team per room.`}
                    </Text>
                  </>
                ) : (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>No changing room asked for. A team asks for one in the Training Centre.</Text>
                )}
              </Section>
            </View>
          )
        })()}
        {a.kind === "TOURNAMENT" && (
          <View>
            <Line label="Pitches reserved" value={placeLine(day, a)} />
            {a.reservations.map((r) => (
              <Line key={r.id} label={pitchNameOf(day, r.pitchId) ?? "Pitch"} value={`${r.from}–${r.until} · ${r.areas === 1 ? "one game at a time" : `${r.areas} games at once`}${r.markedByOrganiser ? " (marked out by the organiser)" : ""}`} />
            ))}
            <Line label="Games" value={a.hasPublishedPlan ? `${a.gameCount} on the published plan` : "No published plan yet"} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>{`The tournament's own plan places its games inside these reservations. Arena keeps the pitches clear for it; it never moves its games. ${a.time.reason ?? ""}`.trim()}</Text>
            {a.conflicts.map((c) => <Clash key={`${c.code}-${c.at}-${c.message}`} message={c.message} />)}
          </View>
        )}
        {a.kind === "EVENT" && (
          <View>
            <Line label="Where" value={placeLine(day, a)} />
            {a.pitchIds.length > 0 && <Line label="Held" value={`${a.start ?? "All day"}${a.end ? `–${a.end}` : ""} · reserved, so nothing else is allocated there`} />}
            {a.pitchIds.length === 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>No pitch is reserved for this event, so it holds none.</Text>}
            {a.time.reason && <Text style={[type.caption, { color: colour.inkMuted }]}>{a.time.reason}</Text>}
            {eventCateringLine(a) && <Line label="Catering" value={eventCateringLine(a)!} />}
            {dietaryLine(a) && <Line label="Dietary" value={dietaryLine(a)!} />}
          </View>
        )}

        {clashes.map((c) => <Clash key={c.key} message={c.message} tone={c.severity === "hard" ? "hard" : "warning"} />)}
        {plannedClash && <Clash message={plannedClash.message} />}
        {problem && <Clash message={problem} />}

        {/* LOCKED: exactly what is locked, and what that means -- never the whole allocation when it is only part */}
        {own && locked && (() => {
          const unlockedParts = lockable.filter((p) => !locks.includes(p))
          return (
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.sm, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
              <Lock size={16} color={colour.forest800} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>Locked Allocation</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{`Auto Allocate will leave ${lockedWords(locks)} unchanged.${unlockedParts.length > 0 ? ` It may still change ${lockedWords(unlockedParts)}.` : ""} You can still move it yourself.`}</Text>
              </View>
            </View>
          )
        })()}

        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {canManage && own && (
            <Button label={parts?.pitchId ? "Edit Allocation" : "Allocate"} onPress={() => onAllocate(own)} />
          )}
          {canManage && own && parts?.pitchId && (
            <Button label="Remove from Pitch" variant="secondary" onPress={() => planner.removeFromPitch(own)} accessibilityHint="Moves it back to Unallocated; nothing is saved until you press Save" />
          )}
          {/* Locking holds what is SAVED, so it waits until a staged change to this activity is saved or undone. */}
          {canLock && !change && (lockable.length > 0 || locked) && (
            <Button
              label={locked ? "Unlock" : "Lock Allocation"}
              variant="secondary"
              busy={busy}
              icon={<Lock size={16} color={colour.ink} />}
              onPress={() => void toggleLock()}
              accessibilityHint={locked ? "Lets Auto Allocate change it again" : "Auto Allocate will leave it exactly as it is"}
            />
          )}
          <Button label={centreName(a)} variant="quiet" onPress={() => onOpen(a)} />
        </View>
      </View>
    </Sheet>
  )
}


/**
 * AUTO ALLOCATE'S PLAN, ITEM BY ITEM -- what it would change and why (preference, availability, size, the
 * warm-up and clearing, reservations, locks), what it could not place and why, each proposal removable on its
 * own. The proposal is already on the board as unsaved changes; Apply Plan saves it with the rest of the plan,
 * Discard Plan drops Auto Allocate's part of it. Nothing has been written.
 */
export function AutoPlanSheet({ preview, planner, visible, onClose, onAllocate, onApply, onRerun }: {
  preview: AllocationPreview | null
  planner: DayPlanner
  visible: boolean
  onClose: () => void
  onAllocate: (id: string, kind: "FIXTURE" | "TRAINING") => void
  onApply: () => void
  /** Work the day out again, unlocked allocations included -- offered when filling the gaps alone left something. */
  onRerun: () => void
}) {
  if (!preview) return <Sheet visible={false} onClose={onClose} title="">{null}</Sheet>
  const unresolved = preview.items.filter((i) => i.outcome === "UNRESOLVED")
  const proposed = preview.items.filter((i) => i.outcome !== "UNRESOLVED" && i.changes.length > 0)
  const staged = (i: PreviewItem) => planner.plan.get(planKey(i.kind, i.id))
  // What the proposal takes from a match, and who it goes to -- said on that match, never hidden in a count.
  const taken = displacements(planner.plan)
  const takenFrom = new Map(taken.map((d) => [d.id, d]))
  const nothing = planner.counts.total === 0
  return (
    <Sheet visible={visible} onClose={onClose} title={preview.rerun ? "Re-run Auto Allocation" : "Auto Allocate Plan"}>
      <View style={{ gap: space.md }}>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {preview.rerun
            ? "Recalculate unlocked allocations using current facility availability and team preferences. Locked and hand-made allocations stay as they are."
            : "Allocates what still needs a pitch or a changing room, using facility availability and team preferences. It is on the board now; nothing changes until you apply it."}
        </Text>
        {(() => {
          const story = proposalWords(preview, planner.counts.auto, taken.map((d) => ({ label: planner.plan.get(`FIXTURE:${d.id}`)?.label ?? planner.plan.get(`TRAINING:${d.id}`)?.label ?? "A match", loses: d.loses })))
          return (
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: radius.lg, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
              <Sparkles size={16} color={colour.pitch600} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>{story.title}</Text>
                {story.details.map((d) => <Text key={d} style={[type.caption, { color: d.includes("issue") || d.includes("would lose") ? colour.warning : colour.inkMuted }]}>{d}</Text>)}
              </View>
            </View>
          )
        })()}

        {unresolved.length > 0 && (
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.warning, fontFamily: type.heading.fontFamily }]}>Needs Attention</Text>
            {unresolved.map((i) => (
              <View key={`${i.kind}-${i.id}`} style={{ gap: 4, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(138,90,0,0.3)", backgroundColor: colour.warningSurface }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{i.title}</Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>{i.window}</Text>
                {takenFrom.has(i.id) && (
                  <Text style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily }]}>
                    {`Ovalball's plan gives its ${takenFrom.get(i.id)!.loses === "pitch" ? "pitch" : "changing rooms"} to ${takenFrom.get(i.id)!.to.join(" and ") || "another match"}, and finds it none.`}
                  </Text>
                )}
                {i.explanation.map((e) => <Text key={e} style={[type.caption, { color: colour.warning }]}>{e}</Text>)}
                <Button label="Allocate" variant="secondary" onPress={() => onAllocate(i.id, i.kind)} />
              </View>
            ))}
          </View>
        )}

        {proposed.length > 0 && (
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>Proposed Changes</Text>
            {proposed.map((i) => {
              const change = staged(i)
              return (
                <View key={`${i.kind}-${i.id}`} style={{ gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line, opacity: change ? 1 : 0.6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <CircleCheck size={14} color={colour.forest800} />
                    <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={2}>{i.title}</Text>
                  </View>
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{i.window}</Text>
                  {i.explanation.map((e) => <Text key={e} style={[type.caption, { color: colour.inkMuted }]}>{e}</Text>)}
                  {change?.origin === "AUTO" ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove the proposal for ${i.title}`} onPress={() => planner.undo(change.key)}
                      style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 })}>
                      <Undo2 size={14} color={colour.forest800} />
                      <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>Remove from Plan</Text>
                    </Pressable>
                  ) : (
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>{change ? "Changed by you since." : "Removed from the plan."}</Text>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {!preview.rerun && unresolved.length > 0 && (
          <View style={{ gap: space.xs, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Auto Allocate filled the gaps only. A re-run also reconsiders what Ovalball placed before (never locked or hand-placed allocations), so it may move another match to make space, and says so if it does.</Text>
            <Button label="Re-run Auto Allocation" variant={nothing ? "primary" : "secondary"} icon={<Sparkles size={16} color={nothing ? colour.onForest : colour.forest800} />} onPress={onRerun} />
          </View>
        )}
        <View style={{ gap: space.sm }}>
          {nothing ? (
            <Button label="Close" variant="secondary" onPress={() => { planner.discardAuto(); onClose() }} />
          ) : (
            <>
              <Button label={saveWords(planner.counts.total, planner.counts.auto).action} onPress={onApply} busy={planner.saving} />
              {planner.counts.auto > 0 && <Button label="Discard Ovalball's Changes" variant="secondary" onPress={() => { planner.discardAuto(); onClose() }} accessibilityHint="Your own unsaved changes stay" />}
            </>
          )}
        </View>
      </View>
    </Sheet>
  )
}

/** NEEDS ATTENTION -- everything still needing allocation and every clash, with the way to fix each. */
export function AttentionSheet({
  day,
  visible,
  canManage,
  onClose,
  onAllocate,
  onOpen,
}: {
  day: ArenaDay
  visible: boolean
  canManage: boolean
  onClose: () => void
  onAllocate: (a: ArenaFixture | ArenaTraining) => void
  onOpen: (a: ArenaActivity) => void
}) {
  const needs = needsAllocation(day.activities)
  const hard = day.conflicts.filter((c) => c.severity === "hard")
  const tournamentClashes = day.activities.flatMap((a) => (a.kind === "TOURNAMENT" ? a.conflicts.map((c) => ({ a, c })) : []))
  return (
    <Sheet visible={visible} onClose={onClose} title="Needs Attention">
      <View style={{ gap: space.md }}>
        {needs.length === 0 && hard.length === 0 && tournamentClashes.length === 0 && (
          <Text style={[type.small, { color: colour.inkMuted }]}>Everything has a venue, a pitch and the changing rooms it needs, and nothing clashes.</Text>
        )}
        {needs.map((a) => (
          <View key={a.id} style={{ gap: 4, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colour.line }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{activityLabel(a)}</Text>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>{timeRange(a)}</Text>
            {needLines(day, a).map((l) => <Text key={l} style={[type.caption, { color: colour.warning }]}>{l}</Text>)}
            {canManage && <Button label="Allocate" variant="secondary" onPress={() => onAllocate(a)} />}
          </View>
        ))}
        {hard.map((c) => {
          const a = day.activities.find((x) => c.activityIds.includes(x.id))
          // THE WAY OUT OF A CLASH, not just its sentence: move either side. Each opens the Allocate sheet, which
          // names what is free instead -- the server re-checks whatever is chosen.
          const movable = day.activities.filter(
            (x): x is ArenaFixture | ArenaTraining => c.activityIds.includes(x.id) && ((x.kind === "FIXTURE" && x.home) || x.kind === "TRAINING"),
          )
          return (
            <View key={c.key} style={{ gap: space.xs, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colour.line }}>
              <Pressable accessibilityRole="button" accessibilityLabel={c.message} accessibilityHint="Shows what it is" onPress={() => a && onOpen(a)}>
                <Clash message={c.message} />
              </Pressable>
              {canManage && movable.map((x) => (
                <Button key={x.id} label={`Move ${activityTitle(x)}`} variant="secondary" onPress={() => onAllocate(x)} />
              ))}
            </View>
          )
        })}
        {tournamentClashes.map(({ a, c }) => (
          <Pressable key={`${a.id}-${c.code}-${c.at}-${c.message}`} accessibilityRole="button" accessibilityLabel={`${a.title}: ${c.message}`} onPress={() => onOpen(a)}>
            <Clash message={`${a.title}: ${c.message}`} />
          </Pressable>
        ))}
      </View>
    </Sheet>
  )
}
