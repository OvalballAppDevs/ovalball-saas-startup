import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Check, ChevronLeft } from "../components/icons"
import { colour, radius, space, surface, type } from "../design/tokens"

export const ADD_VENUE_STEPS_WITH_CHANGING_ROOMS = ["Venue Details", "Add Pitches", "Add Changing Rooms", "Review & Create"] as const
export const ADD_VENUE_STEPS_WITHOUT_CHANGING_ROOMS = ["Venue Details", "Add Pitches", "Review & Create"] as const

/**
 * THE HORIZONTAL STEP HEADER the approved Venues & Pitches mock-up shows -- deliberately a different
 * shape from Create Training Plan's own vertical `WizardStepIndicator`
 * (`training-planning/create-plan/step-indicator.tsx`): that one is a 5-step list read top-to-bottom,
 * this one is circles in a row with a connecting line, exactly as approved. Reusing the vertical
 * component here would mean redesigning the approved mock-up rather than building it.
 *
 * FOUR STEPS WHEN CHANGING ROOMS ARE INVOLVED, three when they are not (`wizardStepCount` in
 * `create-venue-logic.ts` is the one source of truth every screen reads this from) -- the step list
 * itself changes shape rather than a step being greyed out, because a wizard that is genuinely three
 * steps long must never claim to be four.
 */
export function AddVenueHeader({ step, includeChangingRooms, onBack }: { step: number; includeChangingRooms: boolean; onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const steps = includeChangingRooms ? ADD_VENUE_STEPS_WITH_CHANGING_ROOMS : ADD_VENUE_STEPS_WITHOUT_CHANGING_ROOMS
  return (
    <View style={{ backgroundColor: surface.forest, paddingTop: insets.top + space.xs, paddingBottom: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/admin/venues" as never)))}
          hitSlop={8}
          style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[type.smallMedium, { color: colour.chalk }]}>Add Venue</Text>
          <Text style={[type.caption, { color: "rgba(248,250,247,0.7)" }]}>
            Step {step} of {steps.length}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ marginTop: space.md, marginHorizontal: space.lg, backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.md, flexDirection: "row" }}>
        {steps.map((label, i) => {
          const n = i + 1
          const done = n < step
          const active = n === step
          return (
            <View key={label} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : done || active ? colour.pitch600 : colour.line }} />
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: done ? colour.pitch600 : active ? colour.forest800 : colour.line,
                  }}
                >
                  {done ? <Check size={14} color={colour.onForest} strokeWidth={2.5} /> : <Text style={[type.caption, { color: active ? colour.onForest : colour.inkSubtle, fontWeight: "700" }]}>{n}</Text>}
                </View>
                <View style={{ flex: 1, height: 2, backgroundColor: i === steps.length - 1 ? "transparent" : done ? colour.pitch600 : colour.line }} />
              </View>
              <Text style={[type.caption, { color: active ? colour.ink : colour.inkSubtle, textAlign: "center" }]} numberOfLines={2}>
                {label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** Back / primary action, pinned to the bottom -- the wizard's one sticky footer shape. */
/** The wizard's sticky action bar.
 *
 * `primaryHint` says what is still missing while the primary is unavailable, so a person is never
 * left guessing which field is holding them up. */
export function WizardFooter({ backLabel = "Back", onBack, primaryLabel, onPrimary, primaryDisabled, primaryBusy, primaryHint }: { backLabel?: string; onBack: () => void; primaryLabel: string; onPrimary: () => void; primaryDisabled?: boolean; primaryBusy?: boolean; primaryHint?: string | null }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk, gap: space.sm }}>
      {primaryDisabled && !!primaryHint && (
        <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>{primaryHint}</Text>
      )}
      <View style={{ flexDirection: "row", gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        onPress={onBack}
        disabled={primaryBusy}
        style={({ pressed }) => ({ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
      >
        <Text style={[type.smallMedium, { color: colour.ink }]}>{backLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        onPress={onPrimary}
        disabled={primaryDisabled || primaryBusy}
        style={({ pressed }) => ({
          flex: 2,
          minHeight: 48,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          // The brand colour at reduced opacity, matching the canonical `Button`. Repainting it in
          // `lineStrong` grey made an unavailable action look like a broken one.
          backgroundColor: colour.forest800,
          opacity: primaryDisabled ? 0.45 : pressed ? 0.88 : 1,
        })}
      >
        <Text style={[type.smallMedium, { color: colour.onForest }]}>{primaryBusy ? "Please Wait…" : primaryLabel}</Text>
      </Pressable>
      </View>
    </View>
  )
}
