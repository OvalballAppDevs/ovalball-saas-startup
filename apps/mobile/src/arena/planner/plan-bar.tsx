import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View } from "react-native"

import { Button } from "../../components/ui"
import { toMinutes, type ArenaDay } from "@ovalball/contracts/arena"

import { ChevronLeft, ChevronRight, Sparkles, TriangleAlert } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { Sheet } from "../../pitch-allocation/sheets"
import type { DayPlanner } from "./use-day-planner"
import { boardLabel, displacements, proposalWords, saveWords } from "./words"

export { proposalWords, saveWords }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * UNSAVED, SAID ONCE AT THE FOOT OF THE DAY. The first change anywhere -- a drag, the Allocate sheet, Auto
 * Allocate's proposal -- brings this bar up; Save sends every change to the server together (Discard drops them
 * all). Until then the board shows the plan and the server shows what is live: nothing here has been written.
 */
export function PlanBar({ planner, day, onSave, onReview, onRerun, onShow }: {
  planner: DayPlanner
  day: ArenaDay
  onSave: () => void
  onReview: () => void
  /** Work the day out again, reconsidering what Ovalball placed before -- the next step when filling the gaps alone could not. */
  onRerun: () => void
  /** Bring one proposed change into view on the board. */
  onShow: (key: string) => void
}) {
  const { counts, auto, saving, problem } = planner
  const proposed = auto.state === "proposed" ? auto.preview : null
  const words = saveWords(counts.total, counts.auto)
  // Ovalball's changes, in the order of the day, for stepping through them on the board.
  const autoKeys = useMemo(() => {
    const at = (id: string) => {
      const a = day.activities.find((x) => x.id === id)
      return a?.kind === "FIXTURE" ? toMinutes(planner.plan.get(`FIXTURE:${id}`)?.set.kickoff ?? a.kickoff) ?? 9999 : a?.kind === "TRAINING" ? toMinutes(a.start) ?? 9999 : 9999
    }
    return Array.from(planner.plan.values()).filter((c) => c.origin === "AUTO").sort((x, y) => at(x.id) - at(y.id)).map((c) => c.key)
  }, [planner.plan, day.activities])
  const [step, setStep] = useState(0)
  useEffect(() => { setStep(0) }, [proposed])
  const displaced = useMemo(() => displacements(planner.plan).map((d) => {
    const a = day.activities.find((x) => x.id === d.id)
    return { label: a ? boardLabel(a) : "A match", loses: d.loses }
  }), [planner.plan, day.activities])

  // VoiceOver hears the count change, as a sentence -- iOS has no live regions.
  const said = useRef<string | null>(null)
  useEffect(() => {
    const text = counts.total === 0 ? (said.current ? "No unsaved changes" : null) : words.status
    if (text && text !== said.current) AccessibilityInfo.announceForAccessibility(text)
    said.current = counts.total === 0 ? null : text
  }, [counts.total, words.status])

  if (auto.state === "calculating") {
    return (
      <Bar>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
          <ActivityIndicator size="small" color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} maxFontSizeMultiplier={1.6}>Ovalball is working out the day…</Text>
        </View>
      </Bar>
    )
  }
  if (auto.state === "failed" && counts.total === 0) {
    return (
      <Bar>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
          <TriangleAlert size={16} color={colour.warning} />
          <Text style={[type.small, { color: colour.ink, flex: 1 }]} maxFontSizeMultiplier={1.6}>{auto.message}</Text>
          <Action label="Dismiss" kind="quiet" onPress={planner.discardAuto} />
        </View>
      </Bar>
    )
  }
  if (counts.total === 0 && !proposed) return null

  const story = proposed ? proposalWords(proposed, counts.auto, displaced) : null
  const unresolved = proposed?.summary.unresolved ?? 0
  const mixed = counts.manual > 0 && counts.auto > 0
  // Nothing placed, something left: the next step is to let Ovalball rearrange what it placed before.
  const stuck = !!proposed && counts.total === 0 && unresolved > 0 && !proposed.rerun
  const review = proposed ? <Action label={unresolved > 0 ? `Review ${unresolved === 1 ? "Issue" : `${unresolved} Issues`}` : "Review"} kind="secondary" onPress={onReview} disabled={saving} /> : null
  const discard = counts.total === 0
    ? <Action label="Dismiss" kind="quiet" onPress={planner.discardAuto} disabled={saving} />
    : <Action label="Discard" kind="quiet" onPress={planner.discard} disabled={saving} hint="Drops every unsaved change on this day" />
  const commit = counts.total > 0
    ? <Action label={saving ? "Saving…" : words.action} kind="primary" onPress={onSave} disabled={saving} hint="Saves every change on this day together; Ovalball checks them first" />
    : stuck ? <Action label="Re-run Auto Allocation" kind="primary" onPress={onRerun} hint="Ovalball works the day out again and may move matches it placed itself -- never locked or hand-placed ones" /> : null
  const show = (i: number) => {
    const n = autoKeys.length
    if (n === 0) return
    const next = ((i % n) + n) % n
    setStep(next)
    onShow(autoKeys[next])
  }

  return (
    <Bar>
      {problem && (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
          <TriangleAlert size={14} color={colour.danger} />
          <Text style={[type.caption, { color: colour.danger, flex: 1 }]} maxFontSizeMultiplier={1.6}>{`Nothing was saved, and your changes are still staged. ${problem}`}</Text>
        </View>
      )}
      {story && !mixed ? (
        // AUTO ALLOCATE'S PLAN: what it changed, how, and what is left -- then the same Discard and the one Apply.
        <>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, marginBottom: space.sm }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
              <Sparkles size={15} color={colour.forest800} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily }]} maxFontSizeMultiplier={1.6}>{story.title}</Text>
              {story.details.length > 0 && (
                <Text style={[type.caption, { color: colour.inkMuted }]} maxFontSizeMultiplier={1.6}>
                  {story.details.map((d, i) => (
                    <Text key={d} style={d.includes("issue") || d.includes("would lose") ? { color: colour.warning, fontFamily: type.smallMedium.fontFamily } : undefined}>{`${i > 0 ? " · " : ""}${d}`}</Text>
                  ))}
                </Text>
              )}
            </View>
            {autoKeys.length > 1 && (
              // STEP THROUGH WHAT OVALBALL CHANGED: each change brought into view on the board in turn.
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: -8, marginRight: -space.sm }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous change" onPress={() => show(step - 1)} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                  <ChevronLeft size={18} color={colour.forest800} />
                </Pressable>
                <Text accessibilityLabel={`Change ${step + 1} of ${autoKeys.length}`} style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"], fontFamily: type.smallMedium.fontFamily }]} maxFontSizeMultiplier={1.4}>{`${step + 1} of ${autoKeys.length}`}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next change" onPress={() => show(step + 1)} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                  <ChevronRight size={18} color={colour.forest800} />
                </Pressable>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: space.xs }}>
            {discard}
            {review}
            {commit}
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 120, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colour.pitch600 }} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]} maxFontSizeMultiplier={1.6}>{words.status}</Text>
              {mixed && <Text style={[type.caption, { color: colour.inkMuted }]} maxFontSizeMultiplier={1.6}>{`${counts.auto} proposed by Ovalball`}</Text>}
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {discard}
            {review}
            {commit}
          </View>
        </View>
      )}
    </Bar>
  )
}

/** LEAVING WITH UNSAVED CHANGES -- the same words as the bar, and Keep Editing; never a silent loss or a silent save. */
export function UnsavedSheet({ visible, total, auto, saving, onSave, onDiscard, onStay }: { visible: boolean; total: number; auto: number; saving: boolean; onSave: () => void; onDiscard: () => void; onStay: () => void }) {
  const words = saveWords(total, auto)
  const allAuto = total > 0 && auto === total
  return (
    <Sheet visible={visible} onClose={onStay} title={allAuto ? "Plan Not Applied" : "Unsaved Changes"}>
      <View style={{ gap: space.sm }}>
        <Text style={[type.small, { color: colour.inkMuted }]}>
          {allAuto
            ? `Ovalball's ${plural(total, "proposed change has", "proposed changes have")} not been applied yet.`
            : `${plural(total, "change", "changes")} on this day ${total === 1 ? "has" : "have"} not been saved.`}
        </Text>
        <Button label={words.action} onPress={onSave} busy={saving} />
        <Button label="Discard Changes" variant="secondary" onPress={onDiscard} disabled={saving} />
        <Button label="Keep Editing" variant="quiet" onPress={onStay} />
      </View>
    </Sheet>
  )
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm + 2, paddingBottom: space.sm + 2, backgroundColor: colour.surface, borderTopWidth: 1, borderTopColor: colour.lineStrong }}>
      {children}
    </View>
  )
}

function Action({ label, kind, onPress, disabled, hint }: { label: string; kind: "primary" | "secondary" | "quiet"; onPress: () => void; disabled?: boolean; hint?: string }) {
  const shade = kind === "primary"
    ? { bg: colour.pitch600, fg: colour.forest950, border: colour.pitch600 }
    : kind === "secondary"
      ? { bg: colour.surface, fg: colour.forest800, border: colour.lineStrong }
      : { bg: "transparent", fg: colour.forest800, border: "transparent" }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, paddingHorizontal: kind === "quiet" ? space.sm : space.md + 2, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: shade.border, backgroundColor: shade.bg, opacity: disabled ? 0.55 : pressed ? 0.85 : 1 })}>
      <Text style={[type.smallMedium, { color: shade.fg, fontFamily: kind === "primary" ? type.heading.fontFamily : type.smallMedium.fontFamily }]} maxFontSizeMultiplier={1.5}>{label}</Text>
    </Pressable>
  )
}
