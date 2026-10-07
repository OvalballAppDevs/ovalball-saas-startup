import { useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"
import type { ClubPitch, ClubVenue } from "@ovalball/contracts/club/venues"

import { supabase } from "../auth/supabase"
import { Sheet } from "../pitch-allocation/sheets"
import { TextField, TimeField } from "../components/form"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { Check, ChevronDown, ChevronLeft } from "../components/icons"
import { TOUCH_TARGET, colour, elevation, radius, space, surface, type } from "../design/tokens"
import { createTrainingPlan, loadSeasonsForClub, loadTrainingPlanDetail, loadVenuesAndPitchesForClub, type CanonicalSeason, type TrainingPlanDetail } from "./data"
import { BUFFER_OPTIONS, DURATION_OPTIONS, bufferLabel, deriveEndTime, durationLabel } from "./create-plan/times-and-details-logic"
import { draftToSavePlanArgs } from "./create-plan/review-logic"
import type { TrainingPlanDraft } from "./create-plan/draft-context"
import { friendly, logDetail } from "../errors/translate"
import { coverPhotoSource } from "../media/stock-assets"


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
 * EDIT PLAN DETAILS -- reuses the EXACT canonical write Review & Create uses (`createTrainingPlan` /
 * `save_training_plan`, `data.ts`), passing the plan's own id so the RPC's own "update" path runs
 * instead of "create": replace schedule rules, reconcile future non-overridden sessions, regenerate.
 * No second persistence path. Team is NOT editable here -- `save_training_plan` supports changing
 * `p_team_id`, but moving an existing plan onto a different team is not a real product operation this
 * screen offers; changing team means creating a new plan for that team instead.
 */
export function EditPlanScreen({ planId }: { planId: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [clubId, setClubId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)

  const [planType, setPlanType] = useState<"SEASON" | "SEASON_PRE_SEASON">("SEASON")
  const [seasons, setSeasons] = useState<CanonicalSeason[]>([])
  const [season, setSeason] = useState<CanonicalSeason | null>(null)
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([])
  const [startTime, setStartTime] = useState<string | null>(null)
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null)
  const [warmUpMinutes, setWarmUpMinutes] = useState(0)
  const [coolDownMinutes, setCoolDownMinutes] = useState(0)
  const [notes, setNotes] = useState("")
  const [needsChangingRoom, setNeedsChangingRoom] = useState(false)
  const [venues, setVenues] = useState<ClubVenue[]>([])
  const [pitches, setPitches] = useState<ClubPitch[]>([])
  const [venue, setVenue] = useState<ClubVenue | null>(null)
  const [pitch, setPitch] = useState<ClubPitch | null>(null)

  const [picker, setPicker] = useState<"season" | "duration" | "warmUp" | "coolDown" | "venue" | "pitch" | "room" | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const plan = await loadTrainingPlanDetail(supabase, planId)
        if (!plan || cancelled) return
        setClubId(plan.clubId)
        setTeamId(plan.teamId)
        setPlanType(plan.scheduleMode === "SEASON_PRE_SEASON" ? "SEASON_PRE_SEASON" : "SEASON")
        setRepeatWeekdays(plan.rules.map((r) => r.weekday))
        setStartTime(plan.rules[0]?.startTime ?? "18:00")
        setDurationMinutes(plan.rules[0]?.durationMinutes ?? 60)
        setWarmUpMinutes(plan.warmUpMinutes)
        setCoolDownMinutes(plan.packUpMinutes)
        setNotes(plan.defaultSessionNotes ?? "")
        setNeedsChangingRoom(plan.needsChangingRoom)

        const [seasonsResult, venuesResult] = await Promise.all([loadSeasonsForClub(supabase, plan.clubId), loadVenuesAndPitchesForClub(supabase, plan.clubId)])
        if (cancelled) return
        setSeasons(seasonsResult.seasons)
        setSeason(seasonsResult.seasons.find((s) => s.id === plan.seasonId) ?? seasonsResult.seasons.find((s) => s.id === seasonsResult.currentSeasonId) ?? null)
        setVenues(venuesResult.venues)
        setPitches(venuesResult.pitches)
        setVenue(venuesResult.venues.find((v) => v.id === plan.venueId) ?? null)
        setPitch(venuesResult.pitches.find((p) => p.id === plan.pitchId) ?? null)
      } catch (caught) {
        const failure = friendly(caught, "this training plan")
        logDetail("training-planning edit-plan", failure)
        setProblem(failure.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [planId])

  function toggleWeekday(weekday: number) {
    setRepeatWeekdays((d) => (d.includes(weekday) ? d.filter((w) => w !== weekday) : [...d, weekday]))
  }

  // `team` is fixed to the plan's OWN team (never editable here) -- `save_training_plan` supports
  // changing `p_team_id`, but reassigning an existing plan to a different team is not a real product
  // operation this screen offers, so the loaded team_id is carried through untouched.
  const draft: TrainingPlanDraft | null =
    teamId && season && venue && pitch
      ? {
          team: { teamId, displayName: "", teamLabel: "", category: "senior", ageGroup: null, gender: null, coverImagePath: null, coverStockKey: null },
          planType,
          season,
          startDate: null,
          endDate: null,
          repeatWeekdays,
          venue,
          pitch,
          startTime,
          durationMinutes,
          warmUpMinutes,
          coolDownMinutes,
          notes,
          needsChangingRoom,
        }
      : null

  async function onSave() {
    if (!clubId || !draft) return
    setBusy(true)
    setProblem(null)
    try {
      const args = draftToSavePlanArgs(clubId, draft)
      if (!args) throw new Error("Please complete every field before saving.")
      await createTrainingPlan(supabase, { ...args, p_plan_id: planId })
      router.back()
    } catch (caught) {
      setProblem(friendly(caught, "this training plan").message)
    } finally {
      setBusy(false)
    }
  }

  const endTime = startTime && durationMinutes !== null ? deriveEndTime(startTime, durationMinutes) : null
  const canSave = !!season && !!venue && !!pitch && !!startTime && durationMinutes !== null && repeatWeekdays.length > 0

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.xs, paddingBottom: space.sm, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: surface.forest }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
        </Pressable>
        <Text style={[type.smallMedium, { color: colour.chalk }]}>Edit Plan Details</Text>
      </View>

      {loading && (
        <View style={{ padding: space.lg }}>
          <CardSkeleton lines={8} />
        </View>
      )}
      {problem && !loading && (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void 0} />
        </View>
      )}

      {!loading && (
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>PLAN TYPE</Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {(["SEASON", "SEASON_PRE_SEASON"] as const).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: planType === m }}
                  onPress={() => setPlanType(m)}
                  style={{ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: planType === m ? 2 : 1, borderColor: planType === m ? colour.pitch600 : colour.line, backgroundColor: planType === m ? colour.mint100 : colour.surface }}
                >
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{m === "SEASON" ? "Season Long" : "Pre Season"}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>SEASON</Text>
            <OptionField label={season?.name ?? "Select a season"} onPress={() => setPicker("season")} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>REPEAT</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {WEEKDAYS.map((d) => {
                const selected = repeatWeekdays.includes(d.weekday)
                return (
                  <Pressable
                    key={d.weekday}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggleWeekday(d.weekday)}
                    style={{ minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: selected ? colour.pitch600 : colour.line, backgroundColor: selected ? colour.pitch600 : colour.surface, paddingHorizontal: space.sm }}
                  >
                    <Text style={[type.smallMedium, { color: selected ? colour.forest950 : colour.ink }]}>{d.short}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>START TIME</Text>
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, ...elevation.card }}>
                <TimeField label="Start Time" value={startTime} onChange={(v) => v && setStartTime(v)} />
              </View>
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[type.overline, { color: colour.inkSubtle }]}>END TIME</Text>
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, justifyContent: "center", minHeight: 52 }}>
                <Text style={[type.smallMedium, { color: colour.inkMuted }]}>{endTime ?? "—"}</Text>
              </View>
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>DURATION</Text>
            <OptionField label={durationMinutes !== null ? durationLabel(durationMinutes) : "Select a duration"} onPress={() => setPicker("duration")} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>WARM UP (BEFORE)</Text>
            <OptionField label={bufferLabel(warmUpMinutes)} onPress={() => setPicker("warmUp")} />
          </View>
          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>COOL DOWN / PACK UP (AFTER)</Text>
            <OptionField label={bufferLabel(coolDownMinutes)} onPress={() => setPicker("coolDown")} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>VENUE</Text>
            <OptionField image={venue ? coverPhotoSource("VENUE", resolveVenueCover({ supabase, coverImagePath: venue.coverImagePath, coverStockKey: venue.coverStockKey }), venue.id) : null} label={venue?.name ?? "Select a venue"} onPress={() => setPicker("venue")} />
          </View>
          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>PITCH</Text>
            <OptionField image={pitch ? coverPhotoSource("PITCH", resolvePitchCover({ supabase, coverImagePath: pitch.coverImagePath, coverStockKey: pitch.coverStockKey }), pitch.id) : null} label={pitch?.displayName ?? "Select a pitch"} onPress={() => venue && setPicker("pitch")} disabled={!venue} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>CHANGING ROOM</Text>
            <OptionField label={needsChangingRoom ? "Needs a changing room" : "Not needed"} onPress={() => setPicker("room")} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: colour.inkSubtle }]}>DEFAULT NOTES (OPTIONAL)</Text>
            <TextField label="Notes" value={notes} onChange={setNotes} multiline placeholder="Bring water and appropriate training kit." />
          </View>

          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

          <Button label="Save Changes" onPress={() => void onSave()} busy={busy} disabled={!canSave} />
        </ScrollView>
      )}

      <Sheet visible={picker === "season"} onClose={() => setPicker(null)} title="Season">
        <View style={{ gap: 2 }}>
          {seasons.map((s) => (
            <Pressable key={s.id} accessibilityRole="button" onPress={() => { setSeason(s); setPicker(null) }} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: season?.id === s.id ? colour.mint100 : "transparent" }}>
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{s.name}</Text>
              {season?.id === s.id && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
            </Pressable>
          ))}
        </View>
      </Sheet>
      <Sheet visible={picker === "duration"} onClose={() => setPicker(null)} title="Duration">
        <OptionList options={DURATION_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))} selected={durationMinutes} onSelect={(v) => { setDurationMinutes(v); setPicker(null) }} />
      </Sheet>
      <Sheet visible={picker === "room"} onClose={() => setPicker(null)} title="Changing Room">
        <OptionList options={[{ value: 1, label: "Needs a changing room" }, { value: 0, label: "Not needed" }]} selected={needsChangingRoom ? 1 : 0} onSelect={(v) => { setNeedsChangingRoom(v === 1); setPicker(null) }} />
      </Sheet>
      <Sheet visible={picker === "warmUp"} onClose={() => setPicker(null)} title="Warm Up (before)">
        <OptionList options={BUFFER_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))} selected={warmUpMinutes} onSelect={(v) => { setWarmUpMinutes(v); setPicker(null) }} />
      </Sheet>
      <Sheet visible={picker === "coolDown"} onClose={() => setPicker(null)} title="Cool Down / Pack Up (after)">
        <OptionList options={BUFFER_OPTIONS.map((o) => ({ value: o.minutes, label: o.label }))} selected={coolDownMinutes} onSelect={(v) => { setCoolDownMinutes(v); setPicker(null) }} />
      </Sheet>
      <Sheet visible={picker === "venue"} onClose={() => setPicker(null)} title="Venue">
        <View style={{ gap: 2 }}>
          {venues.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              onPress={() => {
                setVenue(v)
                if (pitch?.venueId !== v.id) setPitch(null)
                setPicker(null)
              }}
              style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: venue?.id === v.id ? colour.mint100 : "transparent" }}
            >
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{v.name}</Text>
              {venue?.id === v.id && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
            </Pressable>
          ))}
        </View>
      </Sheet>
      <Sheet visible={picker === "pitch"} onClose={() => setPicker(null)} title="Pitch">
        <View style={{ gap: 2 }}>
          {pitches
            .filter((p) => p.venueId === venue?.id)
            .map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => { setPitch(p); setPicker(null) }} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: pitch?.id === p.id ? colour.mint100 : "transparent" }}>
                <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{p.displayName}</Text>
                {pitch?.id === p.id && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
              </Pressable>
            ))}
        </View>
      </Sheet>
    </View>
  )
}

function OptionField({ image, label, onPress, disabled }: { image?: { uri: string } | number | null; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: colour.surface, opacity: disabled ? 0.5 : pressed ? 0.92 : 1, ...elevation.card })}
    >
      {image !== undefined && (image ? <Image source={image} accessible={false} contentFit="cover" style={{ width: 36, height: 36, borderRadius: radius.sm }} /> : <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colour.line }} />)}
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
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
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onSelect(o.value)} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: on ? colour.mint100 : "transparent" }}>
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{o.label}</Text>
            {on && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
          </Pressable>
        )
      })}
    </View>
  )
}
