import { Pressable, Text, View } from "react-native"

import {
  accessibilityLabel,
  activityLabel,
  cateringRows,
  conflictsFor,
  dayCountsLine,
  eventCateringLine,
  fixtureCateringLine,
  kindWord,
  needLines,
  needsAllocationAt,
  placeLine,
  readinessHeadline,
  readinessLines,
  timeRange,
  type ArenaActivity,
  type ArenaDay,
  type ArenaFixture,
  type ArenaTraining,
} from "@ovalball/contracts/arena"

import { Button } from "../components/ui"
import { ChevronRight, CircleCheck, Lock, RefreshCw, Sparkles, TriangleAlert, Utensils } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { activityTone } from "./style"

/**
 * ARE WE READY? -- facts, never a score: what the day holds, what still needs allocating, what clashes,
 * and what catering is known. Auto Allocate starts here, because this is where a gap is found.
 */
export function ReadinessCard({
  day,
  canManage,
  allVenues = false,
  needsHere,
  allocatableHere,
  onAutoAllocate,
  onRerun,
  onAttention,
}: {
  day: ArenaDay
  canManage: boolean
  /** One ground is chosen: the day's readiness is still the whole club's, and says so. */
  allVenues?: boolean
  /** What needs allocating where the person is looking -- Auto Allocate's preview is scoped the same way. */
  needsHere: number
  /** Home games and sessions where the person is looking: what a re-run could recalculate. */
  allocatableHere: number
  onAutoAllocate: () => void
  onRerun: () => void
  onAttention: () => void
}) {
  const r = day.readiness
  const ready = r.state === "READY"
  const lines = readinessLines(r)
  const counts = `${allVenues ? "Across all venues · " : ""}${dayCountsLine(r)}`
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: ready ? colour.line : colour.warning, backgroundColor: colour.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${readinessHeadline(r)}. ${counts}. ${lines.join(". ")}`}
        accessibilityHint={ready ? undefined : "Shows what needs attention"}
        onPress={onAttention}
        style={({ pressed }) => ({ padding: space.md, gap: 4, backgroundColor: ready ? colour.surface : colour.warningSurface, opacity: pressed ? 0.9 : 1 })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {ready ? <CircleCheck size={18} color={colour.forest800} /> : <TriangleAlert size={18} color={colour.warning} />}
          <Text style={[type.heading, { color: ready ? colour.forest800 : colour.warning }]}>{readinessHeadline(r)}</Text>
        </View>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{counts}</Text>
        {lines.map((l) => (
          <Text key={l} style={[type.smallMedium, { color: /incomplete/.test(l) ? colour.inkMuted : colour.warning }]}>{`• ${l}`}</Text>
        ))}
        {r.cateringKnown > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
            <Utensils size={14} color={colour.inkMuted} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>{`Catering · ${r.cateringKnown} attending${r.cateringIncomplete > 0 ? " so far" : ""}`}</Text>
          </View>
        )}
      </Pressable>
      {canManage && (needsHere > 0 || allocatableHere > 0) && (
        <View style={{ gap: space.sm, padding: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
          {needsHere > 0 && <Button label="Auto Allocate" icon={<Sparkles size={16} color={colour.onForest} />} accessibilityHint="Previews a plan for what still needs allocating before anything changes" onPress={onAutoAllocate} />}
          <Button
            label="Re-run Auto Allocation"
            variant="secondary"
            icon={<RefreshCw size={16} color={colour.forest800} />}
            accessibilityHint="Recalculates unlocked allocations using current facility availability and team preferences"
            onPress={onRerun}
          />
        </View>
      )}
    </View>
  )
}

/** NEEDS ALLOCATION -- near the top, never in a drawer: each one with what is missing and Allocate. */
export function NeedsAllocation({ day, venueId, canManage, onAllocate, onOpen }: { day: ArenaDay; venueId: string | null; canManage: boolean; onAllocate: (a: ArenaFixture | ArenaTraining) => void; onOpen: (a: ArenaActivity) => void }) {
  // The chosen ground's, by the same rule as the board's queue and the Unallocated chip.
  const needs = needsAllocationAt(day, venueId)
  if (needs.length === 0) return null
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.warning }]}>{`NEEDS ALLOCATION · ${needs.length}`}</Text>
      {needs.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.warning, backgroundColor: colour.surface }}>
          <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel(day, a)} onPress={() => onOpen(a)} style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>{activityLabel(a)}</Text>
            <Text style={[type.caption, { color: colour.inkSubtle }]}>{a.kind === "FIXTURE" ? `${timeRange(a)} · ${a.playMinutes} mins` : timeRange(a)}</Text>
            {needLines(day, a).map((l) => <Text key={l} style={[type.caption, { color: colour.warning }]}>{l}</Text>)}
          </Pressable>
          {canManage && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Allocate ${activityLabel(a)}`} onPress={() => onAllocate(a)}
              style={({ pressed }) => ({ alignSelf: "center", minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: colour.forest800, opacity: pressed ? 0.85 : 1 })}>
              <Text style={[type.smallMedium, { color: colour.onForest }]}>Allocate</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  )
}

/** THE ACTIVITY LIST -- the day in time order, for accessibility and small screens: time, what, where, catering. */
export function ActivityList({ day, activities, onOpen }: { day: ArenaDay; activities: ArenaActivity[]; onOpen: (a: ArenaActivity) => void }) {
  if (activities.length === 0) {
    return (
      <View style={{ padding: space.md, gap: 4, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Nothing here</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Nothing matches this filter on this day.</Text>
      </View>
    )
  }
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {activities.map((a, i) => {
        const tone = activityTone(a)
        const clash = conflictsFor(day.conflicts, a.id).some((c) => c.severity === "hard") || (a.kind === "TOURNAMENT" && a.conflicts.length > 0)
        const catering = a.kind === "FIXTURE" ? fixtureCateringLine(a) : a.kind === "EVENT" ? eventCateringLine(a) : null
        const locked = (a.kind === "FIXTURE" || a.kind === "TRAINING") && a.locks.length > 0
        return (
          <Pressable
            key={`${a.kind}-${a.id}`}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel(day, a)}
            onPress={() => onOpen(a)}
            style={({ pressed }) => ({ flexDirection: "row", gap: space.sm, paddingVertical: space.sm, paddingRight: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
          >
            <View style={{ width: 4, backgroundColor: tone.accent }} />
            <View style={{ width: 52 }}>
              <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{timeRange(a).split("–")[0]}</Text>
              {timeRange(a).includes("–") && <Text style={[type.caption, { color: colour.inkSubtle, fontVariant: ["tabular-nums"] }]}>{timeRange(a).split("–")[1]}</Text>}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>{activityLabel(a)}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>{`${kindWord(a)} · ${placeLine(day, a)}`}</Text>
              {catering && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>{catering}</Text>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                {clash && <Badge tone="warn" icon={<TriangleAlert size={11} color={colour.warning} />} label="Clash" />}
                {(a.kind === "FIXTURE" && a.home && a.needs.length > 0) || (a.kind === "TRAINING" && a.needs.length > 0) ? <Badge tone="warn" label="Needs allocation" /> : null}
                {locked && <Badge tone="calm" icon={<Lock size={11} color={colour.forest800} />} label="Locked" />}
              </View>
            </View>
            <ChevronRight size={16} color={colour.inkSubtle} style={{ alignSelf: "center" }} />
          </Pressable>
        )
      })}
    </View>
  )
}

function Badge({ tone, label, icon }: { tone: "warn" | "calm"; label: string; icon?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: tone === "warn" ? colour.warningSurface : colour.mint100 }}>
      {icon}
      <Text style={[type.caption, { color: tone === "warn" ? colour.warning : colour.forest800 }]}>{label}</Text>
    </View>
  )
}

/**
 * CATERING TODAY -- the Match Centre's and the Event Centre's own counts, side by side. Attendance
 * Ovalball cannot see is said to be unavailable, never counted as nobody; names stay in those centres.
 */
export function CateringView({ day, onOpen }: { day: ArenaDay; onOpen: (a: ArenaActivity) => void }) {
  const { rows, totalKnown, incomplete } = cateringRows(day)
  if (rows.length === 0) {
    return (
      <View style={{ padding: space.md, gap: 4, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>No catering needed</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Nothing on this day has asked for catering.</Text>
      </View>
    )
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {rows.map((r, i) => {
          const a = day.activities.find((x) => x.id === r.id)
          return (
            <Pressable key={r.id} accessibilityRole="button"
              // An event's detail already says its number ("3 expected"); a fixture's names each side, so its total is added.
              accessibilityLabel={`${r.label}. ${r.detail}.${a?.kind === "FIXTURE" && r.known !== null && r.known > 0 ? ` ${r.known}${r.incomplete ? " so far" : ""} in total.` : ""}${r.dietary ? ` ${r.dietary}.` : ""}`}
              onPress={() => a && onOpen(a)}
              style={({ pressed }) => ({ padding: space.md, gap: 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={2}>{r.label}</Text>
                {r.known !== null && (
                  <Text style={[type.smallMedium, { color: r.known === 0 ? colour.inkMuted : colour.forest800, fontVariant: ["tabular-nums"] }]}>
                    {r.known === 0 ? "None yet" : `${r.known}${r.incomplete ? " so far" : ""}`}
                  </Text>
                )}
              </View>
              <Text style={[type.caption, { color: r.incomplete ? colour.warning : colour.inkMuted }]}>{r.detail}</Text>
              {r.dietary && <Text style={[type.caption, { color: colour.inkMuted }]}>{r.dietary}</Text>}
            </Pressable>
          )
        })}
      </View>
      <View accessible accessibilityLabel={`${incomplete > 0 ? "Total so far" : "Total"}: ${totalKnown}${incomplete > 0 ? `; ${incomplete} ${incomplete === 1 ? "total is" : "totals are"} incomplete` : ""}.`}
        style={{ flexDirection: "row", justifyContent: "space-between", padding: space.md, borderRadius: radius.lg, backgroundColor: colour.forest950 }}>
        <Text style={[type.smallMedium, { color: colour.onForest }]}>{incomplete > 0 ? "Total So Far" : "Total"}</Text>
        <Text style={[type.heading, { color: colour.onForest, fontVariant: ["tabular-nums"] }]}>{totalKnown}</Text>
      </View>
      {incomplete > 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>{`${incomplete} ${incomplete === 1 ? "total includes" : "totals include"} a side whose attendance Ovalball cannot see, so the real number may be higher.`}</Text>}
    </View>
  )
}
