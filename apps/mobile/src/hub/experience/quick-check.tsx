import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import type { QuickCheck } from "@ovalball/contracts/rugby-hub/quick-check"
import { hubEntityTypeLabel, type HubRelatedEntity } from "@ovalball/contracts/rugby-hub/related"

import { Check, CircleAlert } from "../../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { HubOverline } from "../ui"

/**
 * QUICK CHECK -- a small, deterministic challenge on a knowledge page.
 *
 * The question, the answers and the explanation all come from the shared derivation over canonical
 * content (`quick-check.ts`); this component only asks and answers. The verdict is said in words
 * ("That's right" / "Not quite") beside the colour, never by colour alone. State resets whenever the
 * check changes, so a new page never shows a stale verdict. No animation beyond what the platform
 * does: Reduce Motion needs nothing switched off because nothing moves.
 */
export function HubQuickCheck({ check, onOpen }: { check: QuickCheck; onOpen: (entity: HubRelatedEntity) => void }) {
  const [chosen, setChosen] = useState<string | null>(null)
  useEffect(() => setChosen(null), [check.id])
  const answered = chosen !== null
  const correct = answered && check.options.find((o) => o.key === chosen)?.correct === true

  return (
    <View style={{ gap: space.md, padding: space.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: "rgba(90,203,131,0.5)", backgroundColor: "rgba(220,247,229,0.45)" }}>
      <HubOverline tone="forest">Quick Check</HubOverline>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.forest900, fontFamily: "Inter_600SemiBold" }]}>
        {check.prompt}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Answers" style={{ gap: space.sm }}>
        {check.options.map((option) => {
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
                backgroundColor: showCorrect ? colour.successSurface : showWrong ? colour.dangerSurface : colour.surface,
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
        <View accessibilityRole="alert" style={{ gap: space.sm }}>
          <Text style={[type.smallMedium, { color: correct ? colour.forest900 : colour.danger, fontFamily: "Inter_600SemiBold" }]}>{correct ? "That's right." : "Not quite."}</Text>
          <Text style={[type.small, { color: "rgba(16,21,18,0.8)" }]}>{check.explanation}</Text>
          {check.explore.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {check.explore.slice(0, 3).map((e) => (
                <Pressable key={e.href} accessibilityRole="button" accessibilityLabel={`${e.title}, ${hubEntityTypeLabel(e.type)}`} onPress={() => onOpen(e)} style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: pressed ? colour.pitch600 : colour.lineStrong, backgroundColor: colour.surface })}>
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
