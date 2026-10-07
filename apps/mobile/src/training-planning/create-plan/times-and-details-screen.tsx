import { useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Sheet } from "../../pitch-allocation/sheets"
import { TextField, TimeField } from "../../components/form"
import { Button } from "../../components/ui"
import { Check, ChevronDown } from "../../components/icons"
import { colour, elevation, radius, space, type } from "../../design/tokens"
import { useTrainingPlanDraft } from "./draft-context"
import { BUFFER_OPTIONS, DURATION_OPTIONS, bufferLabel, canContinueTimesStep, deriveEndTime, durationLabel, validateTimeRange } from "./times-and-details-logic"
import { WizardHero } from "./wizard-hero"
import { WizardStepIndicator } from "./step-indicator"
import { libraryAsset } from "../../media/stock-assets"

// REUSED, not regenerated where a suitable candidate genuinely exists -- see the Page 5 report for
// the full Higgsfield generation/rejection record for this specific hero.
const heroPhoto = libraryAsset("training-player-ball-01")

/**
 * CREATE TRAINING PLAN -- STEP 4: TIMES & DETAILS.
 *
 * `startTime`/`durationMinutes` are the canonical (start, duration) pair the schema itself stores
 * (`training_plan_schedule_rules.start_time`/`duration_minutes`); End Time is always DERIVED
 * (`deriveEndTime`), never a third independently-stored value, so the three displayed numbers can
 * never disagree with each other or with what the server will compute.
 *
 * Warm Up / Cool Down / Notes are draft-only -- see `draft-context.tsx`'s own comment on why: no
 * per-plan schema column exists for any of the three yet (Page 5 report's own schema-gap section).
 */
export function TimesAndDetailsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { draft, setStartTime, setEndTime, setDurationMinutes, setWarmUpMinutes, setCoolDownMinutes, setNotes, setNeedsChangingRoom } = useTrainingPlanDraft()
  const [picker, setPicker] = useState<"duration" | "warmUp" | "coolDown" | "room" | null>(null)
  const scrollRef = useRef<ScrollView>(null)

  const onBack = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))

  const endTime = draft.startTime && draft.durationMinutes !== null ? deriveEndTime(draft.startTime, draft.durationMinutes) : null
  const timeError = draft.startTime && endTime ? validateTimeRange(draft.startTime, endTime) : null
  const canContinue = canContinueTimesStep(draft) && !timeError

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <StatusBar style="light" />
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: space.xl * 2 + 96 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <WizardHero heroPhoto={heroPhoto} heading="Times & Details" onClose={onBack} />

          <View style={{ paddingHorizontal: space.lg, marginTop: space.lg, gap: space.lg }}>
            <WizardStepIndicator currentStep={4} />

            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>START TIME</Text>
                <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, ...elevation.card }}>
                  <TimeField label="Start Time" value={draft.startTime} onChange={(next) => next && setStartTime(next)} />
                </View>
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>END TIME</Text>
                <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, ...elevation.card }}>
                  <TimeField label="End Time" value={endTime} onChange={(next) => next && setEndTime(next)} />
                </View>
              </View>
            </View>
            {!!timeError && <Text style={[type.caption, { color: colour.danger }]}>{timeError}</Text>}

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>DURATION</Text>
              <OptionField label={draft.durationMinutes !== null ? durationLabel(draft.durationMinutes) : "Select a duration"} onPress={() => setPicker("duration")} />
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>WARM UP (BEFORE)</Text>
              <OptionField label={bufferLabel(draft.warmUpMinutes)} onPress={() => setPicker("warmUp")} />
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>COOL DOWN / PACK UP (AFTER)</Text>
              <OptionField label={bufferLabel(draft.coolDownMinutes)} onPress={() => setPicker("coolDown")} />
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>CHANGING ROOM</Text>
              <OptionField label={draft.needsChangingRoom ? "Needs a changing room" : "Not needed"} onPress={() => setPicker("room")} />
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>NOTES (OPTIONAL)</Text>
              <TextField
                label="Notes"
                value={draft.notes}
                onChange={setNotes}
                multiline
                placeholder="Bring water and appropriate training kit."
                onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
              />
            </View>
          </View>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, paddingBottom: space.lg + insets.bottom, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
          <View style={{ flex: 1 }}>
            <Button label="Back" variant="secondary" onPress={onBack} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Next" variant="primary" disabled={!canContinue} onPress={() => router.push("/admin/training-planning/create/review" as never)} />
          </View>
        </View>

        <Sheet visible={picker === "duration"} onClose={() => setPicker(null)} title="Duration">
          <OptionList
            options={DURATION_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))}
            selected={draft.durationMinutes}
            onSelect={(v) => {
              setDurationMinutes(v)
              setPicker(null)
            }}
          />
        </Sheet>
        <Sheet visible={picker === "room"} onClose={() => setPicker(null)} title="Changing Room">
          <OptionList
            options={[{ value: 1, label: "Needs a changing room" }, { value: 0, label: "Not needed" }]}
            selected={draft.needsChangingRoom ? 1 : 0}
            onSelect={(v) => {
              setNeedsChangingRoom(v === 1)
              setPicker(null)
            }}
          />
        </Sheet>
        <Sheet visible={picker === "warmUp"} onClose={() => setPicker(null)} title="Warm Up (before)">
          <OptionList
            options={BUFFER_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))}
            selected={draft.warmUpMinutes}
            onSelect={(v) => {
              setWarmUpMinutes(v)
              setPicker(null)
            }}
          />
        </Sheet>
        <Sheet visible={picker === "coolDown"} onClose={() => setPicker(null)} title="Cool Down / Pack Up (after)">
          <OptionList
            options={BUFFER_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))}
            selected={draft.coolDownMinutes}
            onSelect={(v) => {
              setCoolDownMinutes(v)
              setPicker(null)
            }}
          />
        </Sheet>
      </View>
    </KeyboardAvoidingView>
  )
}

function OptionField({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.92 : 1,
        ...elevation.card,
      })}
    >
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{label}</Text>
      <ChevronDown size={18} color={colour.inkMuted} />
    </Pressable>
  )
}

function OptionList({ options, selected, onSelect }: { options: { value: number; label: string }[]; selected: number | null; onSelect: (value: number) => void }) {
  return (
    <View style={{ gap: 2 }}>
      {options.map((o) => {
        const on = o.value === selected
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onSelect(o.value)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              minHeight: 48,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              backgroundColor: on ? colour.mint100 : pressed ? "rgba(16,21,18,0.03)" : "transparent",
            })}
          >
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{o.label}</Text>
            {on && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
          </Pressable>
        )
      })}
    </View>
  )
}
