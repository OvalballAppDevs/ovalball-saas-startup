import { useEffect, useState } from "react"
import { Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import DateTimePicker from "@react-native-community/datetimepicker"

import { Sheet } from "../../pitch-allocation/sheets"
import { CalendarDays, Info } from "../../components/icons"
import { Button } from "../../components/ui"
import { colour, elevation, radius, space, type } from "../../design/tokens"
import { useTrainingPlanDraft } from "./draft-context"
import { canContinueDatesStep, deriveDefaultDates, validateDateOrder } from "./dates-and-frequency-logic"
import { WizardHero } from "./wizard-hero"
import { WizardStepIndicator } from "./step-indicator"
import { libraryAsset } from "../../media/stock-assets"

const heroPhoto = libraryAsset("training-coaching-01")

/** 0=Sunday..6=Saturday -- the same convention `training_plan_schedule_rules.weekday` and
 * `extract(dow from ...)` already use server-side. Displayed Monday-first per the reference, stored
 * with Postgres's own Sunday-first numbering so no second convention exists anywhere in the flow. */
const WEEKDAYS: { weekday: number; short: string }[] = [
  { weekday: 1, short: "Mon" },
  { weekday: 2, short: "Tue" },
  { weekday: 3, short: "Wed" },
  { weekday: 4, short: "Thu" },
  { weekday: 5, short: "Fri" },
  { weekday: 6, short: "Sat" },
  { weekday: 0, short: "Sun" },
]

/**
 * CREATE TRAINING PLAN -- STEP 2: DATES & FREQUENCY.
 *
 * Start/End derive from the canonical season selected on Page 2 -- Season Long from the season's own
 * `starts_on`/`ends_on`, Pre Season from `pre_season_starts_on`/`ends_on` -- ONLY as an initial default,
 * computed once when this screen first has no dates yet (`draft.startDate === null`), never overwritten
 * again on a later visit. Editing these fields changes the DRAFT training-plan boundary, never the
 * canonical season row itself -- nothing in this screen writes to `public.seasons`.
 *
 * NO "NO END DATE" OPTION -- resolved, not merely deferred (Step 6 correction brief Section 7). Every
 * generation path (`internal.resolve_training_plan_occurrence_dates`) uses a bounded Postgres
 * `generate_series(start, end, ...)`, and nothing in this codebase re-runs generation on a rolling
 * horizon (no `pg_cron` job calls `generate_training_plan_sessions` -- confirmed absent by reading
 * every migration that touches it). An open-ended plan would therefore either generate zero future
 * sessions past whatever date it was created, or require a genuinely new scheduled-regeneration
 * feature -- neither of which this wizard can honestly promise today. Per the brief's own instruction
 * ("if no: remove the UI rather than presenting a dishonest option"), the toggle shown in the reference
 * mock-up is deliberately NOT built. End Date is always required.
 */
export function DatesAndFrequencyScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { draft, setStartDate, setEndDate, toggleRepeatWeekday } = useTrainingPlanDraft()
  const [picker, setPicker] = useState<"start" | "end" | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)

  useEffect(() => {
    if (draft.startDate !== null || !draft.season) return
    const defaults = deriveDefaultDates(draft.planType, draft.season)
    if (defaults) {
      setStartDate(defaults.startDate)
      setEndDate(defaults.endDate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.season, draft.planType])

  const onBack = () => (navigation.canGoBack() ? router.back() : router.replace("/admin/training-planning/create" as never))

  const onChangeStart = (iso: string) => {
    setStartDate(iso)
    setDateError(validateDateOrder(iso, draft.endDate))
  }
  const onChangeEnd = (iso: string) => {
    const error = validateDateOrder(draft.startDate, iso)
    if (error) {
      setDateError(error)
      return
    }
    setDateError(null)
    setEndDate(iso)
  }

  const canContinue = canContinueDatesStep(draft) && !dateError

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 + 96 }} showsVerticalScrollIndicator={false}>
        <WizardHero heroPhoto={heroPhoto} heading="Dates & Frequency" onClose={onBack} />

        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg, gap: space.lg }}>
          <WizardStepIndicator currentStep={2} />

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>START DATE</Text>
            <DateField label={draft.startDate ? formatDate(draft.startDate) : "Select a date"} onPress={() => setPicker("start")} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>END DATE</Text>
            <DateField label={draft.endDate ? formatDate(draft.endDate) : "Select a date"} onPress={() => setPicker("end")} />
          </View>

          {dateError && <Text style={[type.caption, { color: colour.danger }]}>{dateError}</Text>}

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>REPEAT</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {WEEKDAYS.map((d) => (
                <WeekdayChip key={d.weekday} label={d.short} selected={draft.repeatWeekdays.includes(d.weekday)} onPress={() => toggleRepeatWeekday(d.weekday)} />
              ))}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.mint100, padding: space.md }}>
            <Info size={18} color={colour.forest800} />
            <Text style={[type.small, { color: colour.forest800, flex: 1 }]}>You can edit or cancel individual sessions after the plan is created.</Text>
          </View>
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, paddingBottom: space.lg + insets.bottom, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <View style={{ flex: 1 }}>
          <Button label="Back" variant="secondary" onPress={onBack} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Next" variant="primary" disabled={!canContinue} onPress={() => router.push("/admin/training-planning/create/venue" as never)} />
        </View>
      </View>

      {Platform.OS !== "web" && (
        <Sheet visible={picker !== null} onClose={() => setPicker(null)} title={picker === "start" ? "Start Date" : "End Date"}>
          <DateTimePicker
            value={new Date(`${(picker === "start" ? draft.startDate : draft.endDate) ?? draft.startDate ?? new Date().toISOString().slice(0, 10)}T12:00:00`)}
            mode="date"
            display="inline"
            onChange={(_e, next) => {
              if (!next) return
              const iso = toIso(next)
              if (picker === "start") onChangeStart(iso)
              else onChangeEnd(iso)
              setPicker(null)
            }}
          />
        </Sheet>
      )}
    </View>
  )
}

function DateField({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        padding: space.md,
        backgroundColor: colour.surface,
        opacity: disabled ? 0.5 : pressed ? 0.92 : 1,
        ...elevation.card,
      })}
    >
      <CalendarDays size={18} color={colour.inkMuted} />
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{label}</Text>
    </Pressable>
  )
}

function WeekdayChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 56,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colour.pitch600 : colour.line,
        backgroundColor: selected ? colour.pitch600 : colour.surface,
        paddingHorizontal: space.sm,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={[type.smallMedium, { color: selected ? colour.forest950 : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}
