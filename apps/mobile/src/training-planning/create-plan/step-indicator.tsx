import { Text, View } from "react-native"

import { Check } from "../../components/icons"
import { colour, radius, space, type } from "../../design/tokens"

export const WIZARD_STEPS = ["Team & Type", "Dates & Frequency", "Venue & Pitch", "Times & Details", "Review & Create"] as const

/**
 * THE ONE WIZARD PROGRESS INDICATOR -- shared by Create Training Plan's Pages 2-6 (correction brief
 * Section 3: "This must become a reusable wizard component because Pages 3-6 use exactly the same
 * progress model. Do not rebuild it independently on every page."). `currentStep` is 1-indexed to match
 * how the reference numbers the five steps on-screen.
 */
export function WizardStepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <View style={{ gap: 6 }}>
      {WIZARD_STEPS.map((label, i) => {
        const step = i + 1
        const done = step < currentStep
        const active = step === currentStep
        return (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 26 }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: done || active ? colour.pitch600 : colour.line,
              }}
            >
              {done ? <Check size={12} color={colour.forest950} strokeWidth={2.5} /> : <Text style={[type.caption, { color: active ? colour.forest950 : colour.inkSubtle, fontWeight: "700", lineHeight: 14 }]}>{step}</Text>}
            </View>
            <Text style={[type.smallMedium, { color: active ? colour.ink : done ? colour.inkMuted : colour.inkSubtle, fontWeight: active ? "700" : "500" }]}>{label}</Text>
          </View>
        )
      })}
    </View>
  )
}
