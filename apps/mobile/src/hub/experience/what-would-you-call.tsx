import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import type { WhatWouldYouCall } from "@ovalball/contracts/rugby-hub/quick-check"
import { hubEntityTypeLabel, type HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"

import { Check, CircleAlert, Gavel, Radio, Scale, TriangleAlert } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { HubOverline } from "../ui"

/**
 * WHAT WOULD YOU CALL? -- officiating made interactive.
 *
 * The scenario is the concept's own account of what happens (optionally with the visual the
 * VISUALS half supplies), the answers are the decisions of the same family, and the reveal is
 * the canonical explanation: how it is signalled, the common misunderstanding, the rules cited.
 * Educational, not an examination -- the concept says what the call is; this only asks first.
 */
export function HubWhatWouldYouCall({ call, visual, onOpen }: { call: WhatWouldYouCall; visual?: React.ReactNode; onOpen: (entity: HubRelatedEntity) => void }) {
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => setChosen(null), [call.id])
  const answered = chosen !== null
  const correct = answered && call.options.find((o) => o.key === chosen)?.correct === true

  return (
    <View style={{ gap: space.md, padding: space.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Gavel size={16} color={colour.forest800} strokeWidth={2} />
        <HubOverline tone="forest">What Would You Call?</HubOverline>
      </View>
      {visual}
      <Text style={[type.body, { color: "rgba(16,21,18,0.85)" }]}>{call.scenario}</Text>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.forest900, fontFamily: "Inter_600SemiBold" }]}>
        {call.prompt}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Decisions" style={{ gap: space.sm }}>
        {call.options.map((option) => {
          const picked = chosen === option.key
          const showCorrect = answered && option.correct
          const showWrong = answered && picked && !option.correct
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked, disabled: answered }}
              accessibilityLabel={option.label}
              disabled={answered}
              onPress={() => setChosen(option.key)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: showCorrect ? colour.pitch600 : showWrong ? colour.danger : pressed ? "rgba(50,166,101,0.5)" : colour.lineStrong,
                backgroundColor: showCorrect ? colour.successSurface : showWrong ? colour.dangerSurface : colour.chalk,
              })}
            >
              <Text style={[type.body, { color: colour.ink, flex: 1 }]}>{option.label}</Text>
              {showCorrect && <Check size={18} color={colour.pitch600} strokeWidth={2.4} />}
              {showWrong && <CircleAlert size={18} color={colour.danger} strokeWidth={2} />}
            </Pressable>
          )
        })}
      </View>
      {answered && (
        <View accessibilityRole="alert" style={{ gap: space.md }}>
          <Text style={[type.smallMedium, { color: correct ? colour.forest900 : colour.danger, fontFamily: "Inter_600SemiBold" }]}>{correct ? "That's the call." : "Not that one."}</Text>
          <Block icon={<Radio size={15} color={colour.forest800} />} heading="How It's Signalled" text={call.explanation} />
          {call.misunderstanding && <Block icon={<TriangleAlert size={15} color={colour.warning} />} heading="Common Misunderstanding" text={call.misunderstanding} />}
          {call.laws.length > 0 && (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Scale size={15} color={colour.forest800} />
                <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, textTransform: "uppercase" }]}>The Law</Text>
              </View>
              {call.laws.map((law) => (
                <Text key={law.factKey} style={[type.small, { color: "rgba(16,21,18,0.8)" }]}>
                  {law.valueText ?? law.factKey}
                </Text>
              ))}
            </View>
          )}
          {call.explore.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {call.explore.slice(0, 3).map((e) => (
                <Pressable key={e.href} accessibilityRole="button" accessibilityLabel={`${e.title}, ${hubEntityTypeLabel(e.type)}`} onPress={() => onOpen(e)} style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: pressed ? colour.pitch600 : colour.lineStrong, backgroundColor: colour.chalk })}>
                  <Text style={[type.small, { color: colour.forest900, fontFamily: "Inter_500Medium" }]}>{e.title}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

function Block({ icon, heading, text }: { icon: React.ReactNode; heading: string; text: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon}
        <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, textTransform: "uppercase" }]}>{heading}</Text>
      </View>
      <Text style={[type.small, { color: "rgba(16,21,18,0.8)" }]}>{text}</Text>
    </View>
  )
}
