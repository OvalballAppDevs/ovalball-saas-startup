import { useState } from "react"
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import DateTimePicker from "@react-native-community/datetimepicker"

import { fixtureOccupiedWindow, pitchSuitable, type AllocationConflict, type AllocationFixture, type PitchAllocationBoard, type PitchOption } from "@ovalball/contracts/pitch-allocation"

import { minutesToTime, xToSnappedMinutes, START_MINUTES, END_MINUTES, SLOT_MINUTES, kickoffMinutes } from "./geometry"
import { Button } from "../components/ui"
import { TriangleAlert, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/** A bottom sheet with a title and a close control; the same frame every sheet on the board uses. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, maxHeight: "86%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.md }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]} numberOfLines={2}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
              <X size={20} color={colour.inkMuted} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: 4 }}>
      <Text style={[type.caption, { color: colour.inkSubtle, width: 112 }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{value}</Text>
    </View>
  )
}

/**
 * THE FIXTURE, IN FULL: what a card cannot say. Every field the board knows, the complete reserved
 * interval, any clash with its reason, and whether this position is saved or staged.
 */
export function FixtureDetailSheet({ fixture, board, conflict, pitchName, staged, savedPosition, canManage, onClose, onMove, onRemove, onUndo, onOpenFixture }: {
  fixture: AllocationFixture | null
  board: PitchAllocationBoard
  conflict: AllocationConflict | null
  pitchName: string | null
  staged: boolean
  savedPosition: { pitchName: string | null; kickoffTime: string | null } | null
  canManage: boolean
  onClose: () => void
  onMove: () => void
  onRemove: () => void
  onUndo: () => void
  onOpenFixture: () => void
}) {
  const w = fixture ? fixtureOccupiedWindow(fixture, { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }) : null
  return (
    <Sheet visible={fixture !== null} onClose={onClose} title={fixture ? `${fixture.homeTeamLabel} v ${fixture.opponentLabel}` : ""}>
      {fixture && (
        <View style={{ gap: space.md }}>
          <View>
            <Line label="Home side" value={fixture.homeTeamLabel} />
            <Line label="Opponent" value={fixture.opponentLabel} />
            <Line label="Age group" value={fixture.ageGroup ?? (fixture.category === "youth" ? "Youth" : "Senior")} />
            <Line label="Status" value={fixture.status} />
            <Line label="Pitch" value={pitchName ?? "Not on a pitch"} />
            <Line label="Kick-off" value={fixture.kickoffTime ? fixture.kickoffTime.slice(0, 5) : "Not set"} />
            {w && (
              <>
                <Line label="Warm-up from" value={minutesToTime(w.start)} />
                <Line label="Match" value={`${minutesToTime(w.playStart)} – ${minutesToTime(w.playEnd)}${fixture.durationConfidence === "unresolved" ? " (duration estimated)" : ""}`} />
                <Line label="Pitch clear at" value={minutesToTime(w.end)} />
                <Line label="Pitch reserved" value={`${minutesToTime(w.start)} – ${minutesToTime(w.end)}`} />
              </>
            )}
            {fixture.requiresOpponentAgreement && <Line label="Kick-off changes" value="Proposed to the other club for confirmation when saved" />}
            <Line label="This position" value={staged ? `Staged, not yet saved${savedPosition ? ` (saved: ${savedPosition.pitchName ?? "no pitch"}${savedPosition.kickoffTime ? ` at ${savedPosition.kickoffTime.slice(0, 5)}` : ""})` : ""}` : "Saved"} />
          </View>
          {conflict && (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: conflict.severity === "hard" ? colour.dangerSurface : colour.warningSurface, borderRadius: radius.md, padding: space.md }}>
              <TriangleAlert size={16} color={conflict.severity === "hard" ? colour.danger : colour.warning} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{conflict.reason}</Text>
            </View>
          )}
          {canManage && (
            <View style={{ gap: space.sm }}>
              <Button label="Move Fixture" onPress={onMove} accessibilityHint="Choose a pitch and a kick-off time without dragging" />
              {(fixture.pitchId || staged) && <Button label={fixture.pitchId ? "Remove from Pitch" : "Undo Staged Change"} variant="secondary" onPress={fixture.pitchId ? onRemove : onUndo} />}
              {staged && fixture.pitchId && <Button label="Undo Staged Change" variant="quiet" onPress={onUndo} />}
            </View>
          )}
          <Button label="Open Fixture" variant={canManage ? "quiet" : "secondary"} onPress={onOpenFixture} />
        </View>
      )}
    </Sheet>
  )
}

/**
 * MOVE WITHOUT DRAGGING -- the accessible path to the same staging model: a pitch, a kick-off on the
 * canonical 15-minute grid, the reserved window it would make, and the clash it would cause, before
 * anything is staged.
 */
export function MoveSheet({ fixture, board, pitchName, previewFor, onClose, onStage }: {
  fixture: AllocationFixture | null
  board: PitchAllocationBoard
  pitchName: (id: string | null) => string
  previewFor: (fixtureId: string, pitchId: string, minutes: number) => AllocationConflict | null
  onClose: () => void
  onStage: (pitchId: string, minutes: number) => void
}) {
  const [pitchId, setPitchId] = useState<string | null>(fixture?.pitchId ?? null)
  const [minutes, setMinutes] = useState<number>(kickoffMinutes(fixture?.kickoffTime ?? null) ?? 10 * 60)
  const [typed, setTyped] = useState(minutesToTime(kickoffMinutes(fixture?.kickoffTime ?? null) ?? 10 * 60))
  const active = board.pitches.filter((p) => p.active)
  const suitable = (p: PitchOption) => (fixture ? pitchSuitable(p, fixture.requiredPitchSize) : true)
  const ordered = [...active].sort((a, b) => Number(suitable(b)) - Number(suitable(a)))
  const preview = fixture && pitchId ? previewFor(fixture.fixtureId, pitchId, minutes) : null
  const w = fixture ? fixtureOccupiedWindow({ ...fixture, kickoffTime: minutesToTime(minutes) }, { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }) : null
  const base = new Date()
  base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  const snapTyped = (value: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return
    const [h, m] = value.split(":").map(Number)
    const snapped = Math.min(Math.max(Math.round((h * 60 + m) / SLOT_MINUTES) * SLOT_MINUTES, START_MINUTES), END_MINUTES - SLOT_MINUTES)
    setMinutes(snapped)
    setTyped(minutesToTime(snapped))
  }
  return (
    <Sheet visible={fixture !== null} onClose={onClose} title={fixture ? `Move ${fixture.homeTeamLabel} v ${fixture.opponentLabel}` : ""}>
      {fixture && (
        <View style={{ gap: space.md }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Kick-off Time</Text>
            {Platform.OS === "web" ? (
              <TextInput accessibilityLabel="Kick-off time" value={typed} onChangeText={(v) => { const clean = v.replace(/[^\d:]/g, "").slice(0, 5); setTyped(clean); snapTyped(clean) }} placeholder="14:00" placeholderTextColor={colour.inkSubtle} keyboardType="numbers-and-punctuation" style={[type.body, { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, backgroundColor: colour.surface }]} />
            ) : (
              <DateTimePicker value={base} mode="time" minuteInterval={15} display={Platform.OS === "ios" ? "compact" : "default"} accessibilityLabel="Kick-off time" onChange={(_e, next) => { if (!next) return; const m = next.getHours() * 60 + next.getMinutes(); const snapped = Math.min(Math.max(Math.round(m / SLOT_MINUTES) * SLOT_MINUTES, START_MINUTES), END_MINUTES - SLOT_MINUTES); setMinutes(snapped); setTyped(minutesToTime(snapped)) }} />
            )}
            <Text style={[type.caption, { color: colour.inkSubtle }]}>Kick-offs sit on the quarter hour, as on the board.</Text>
          </View>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Pitch</Text>
          <View style={{ gap: space.xs }}>
            {ordered.map((p) => {
              const on = pitchId === p.id
              const ok = suitable(p)
              return (
                <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${p.displayName}${ok ? "" : ", too small for this age group"}`} onPress={() => setPitchId(p.id)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.line, backgroundColor: on ? colour.mint100 : colour.surface }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.small, { color: colour.ink }]}>{p.displayName}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{pitchName(p.venueId)}{p.sizeCategory ? ` · ${p.sizeCategory}` : ""}{ok ? "" : " · too small for this age group"}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
          {w && pitchId && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>Pitch reserved {minutesToTime(w.start)} – {minutesToTime(w.end)} (warm-up from {minutesToTime(w.start)}, match {minutesToTime(w.playStart)} – {minutesToTime(w.playEnd)}, clear at {minutesToTime(w.end)}).</Text>
          )}
          {preview && (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              <TriangleAlert size={14} color={preview.severity === "hard" ? colour.danger : colour.warning} />
              <Text style={[type.caption, { color: preview.severity === "hard" ? colour.danger : colour.warning, flex: 1 }]}>{preview.reason}</Text>
            </View>
          )}
          {pitchId && !preview && <Text style={[type.caption, { color: colour.forest800 }]}>No clash on this pitch at that time.</Text>}
          <Button label="Stage This Move" onPress={() => pitchId && onStage(pitchId, minutes)} disabled={!pitchId} />
        </View>
      )}
    </Sheet>
  )
}

/** Save / Discard / Stay -- the safe way off a dirty board. */
export function LeaveSheet({ visible, count, onSave, onDiscard, onStay }: { visible: boolean; count: number; onSave: () => void; onDiscard: () => void; onStay: () => void }) {
  return (
    <Sheet visible={visible} onClose={onStay} title="You have staged changes">
      <Text style={[type.small, { color: colour.inkMuted }]}>{count} change{count === 1 ? "" : "s"} on this day {count === 1 ? "has" : "have"} not been saved.</Text>
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Button label={`Save Changes (${count})`} onPress={onSave} />
        <Button label="Discard Changes" variant="secondary" onPress={onDiscard} />
        <Button label="Stay Here" variant="quiet" onPress={onStay} />
      </View>
    </Sheet>
  )
}

export { xToSnappedMinutes }
