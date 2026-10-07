import { Pressable, Text, View } from "react-native"

import {
  READINESS_ACTION_LABEL,
  readinessChecklist,
  readinessHeadline,
  type PlanReadiness,
  type ReadinessAction,
} from "@ovalball/contracts/tournaments/readiness"

import { CircleCheck, Info, TriangleAlert } from "../components/icons"
import { Card, StatusPill } from "../components/ui"
import { colour, radius, space, type } from "../design/tokens"

/**
 * WHAT THIS PLAN NEEDS NEXT -- the server's answer, drawn the same way wherever a plan is looked at.
 *
 * Planning's Review and the Generated Draft Plan both lead with this, so the organiser can always answer
 * "what do I do next?" by looking: a tick for what is already right (only facts the server confirmed), a
 * warning sign and a route for each thing that is not, and a plain note for anything worth knowing that
 * stops nothing. Nothing on it is decided here; `internal.tournament_plan_readiness` is the whole rule,
 * and Generate and Publish refuse with the same sentences.
 *
 * `stage` narrows what is shown: before generation only the blockers that stop Generate are relevant,
 * because "generate the fixtures first" is not news on the screen whose button does exactly that.
 */
export function ReadinessPanel({
  readiness,
  stage,
  onAction,
}: {
  readiness: PlanReadiness
  stage: "generate" | "publish"
  onAction: (action: ReadinessAction) => void
}) {
  const headline = stage === "generate"
    ? readiness.readyToGenerate ? { tone: "ready" as const, title: "Ready to generate" } : { tone: "attention" as const, title: "Needs attention" }
    : readinessHeadline(readiness)
  const blockers = readiness.blockers.filter((b) => (stage === "generate" ? b.stage === "generate" : true))
  const checks = stage === "publish" ? readinessChecklist(readiness) : []
  const tone = headline.tone === "attention" ? "caution" : "positive"

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>
          {stage === "generate" ? "Before You Generate" : "Readiness"}
        </Text>
        <StatusPill label={headline.title} tone={tone} />
      </View>

      {checks.map((c) =>
        c.ok ? (
          <Row key={c.text} icon={<CircleCheck size={17} color={colour.forest800} strokeWidth={2} />} text={c.text} />
        ) : null
      )}

      {blockers.map((b) => (
        <View
          key={b.code}
          accessibilityRole="alert"
          style={{ gap: space.xs, padding: space.sm, borderRadius: radius.md, backgroundColor: colour.warningSurface }}
        >
          <Row icon={<TriangleAlert size={17} color={colour.warning} strokeWidth={2} />} text={b.message} strong />
          {b.action !== "none" && READINESS_ACTION_LABEL[b.action] ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={READINESS_ACTION_LABEL[b.action]}
              hitSlop={8}
              onPress={() => onAction(b.action)}
              style={({ pressed }) => ({ alignSelf: "flex-start", paddingLeft: 25, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.rugby700 }]}>{READINESS_ACTION_LABEL[b.action]}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {readiness.warnings
        // Said once: when games already lack kick-offs, the blocker above names the same missing pitches.
        .filter((w) => !(w.code === "NO_PITCHES" && blockers.some((b) => b.code === "UNSCHEDULED")))
        .map((w) => (
        <View key={w.code} style={{ gap: 2 }}>
          <Row icon={<Info size={17} color={colour.inkMuted} strokeWidth={2} />} text={w.message} muted />
          {w.action !== "none" && READINESS_ACTION_LABEL[w.action] && w.code !== "AWAITING_REPLY" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={READINESS_ACTION_LABEL[w.action]}
              hitSlop={8}
              onPress={() => onAction(w.action)}
              style={({ pressed }) => ({ alignSelf: "flex-start", paddingLeft: 25, paddingVertical: 2, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.rugby700 }]}>{READINESS_ACTION_LABEL[w.action]}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {blockers.length === 0 && readiness.warnings.length === 0 && checks.length === 0 && (
        <Row icon={<CircleCheck size={17} color={colour.forest800} strokeWidth={2} />} text="Everything this competition needs is in place." />
      )}
    </Card>
  )
}

function Row({ icon, text, strong, muted }: { icon: React.ReactNode; text: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
      <View style={{ paddingTop: 1 }}>{icon}</View>
      <Text style={[strong ? type.smallMedium : type.small, { flex: 1, color: muted ? colour.inkMuted : colour.ink, lineHeight: 20 }]}>{text}</Text>
    </View>
  )
}
