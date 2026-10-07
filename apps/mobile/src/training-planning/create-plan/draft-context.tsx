import { createContext, useCallback, useContext, useMemo, useState } from "react"

import type { ClubPitch, ClubVenue } from "@ovalball/contracts/club/venues"

import type { OrderedTeamOption, CanonicalSeason } from "../data"
import { minutesBetween } from "./times-and-details-logic"

/**
 * THE CREATE TRAINING PLAN DRAFT -- one piece of state, held for the lifetime of the wizard's own
 * navigator stack (`app/(tabs)/admin/training-planning/create/_layout.tsx`), so moving forward and
 * back between steps never loses a selection, and nothing is written to the server until Review &
 * Create (Section 7 of the correction brief: "Do not write the final Training Plan to the server
 * merely because the user moved between wizard steps"). Leaving the wizard entirely (Cancel, or
 * navigating away) unmounts this provider and the draft is gone -- a fresh Create Training Plan always
 * starts empty, which is the correct behaviour for an abandoned draft, not a bug to work around.
 *
 * DATES & FREQUENCY FIELDS (Page 3) capture the wizard's own intent -- `startDate`/`endDate`/
 * `repeatWeekdays` are plain draft values, mapped onto `training_plans`/`training_plan_schedule_rules`
 * by Review & Create (`data.ts`'s `createTrainingPlan`). There is deliberately no "no end date" field:
 * resolved, not deferred -- see `dates-and-frequency-screen.tsx`'s own header comment for why an
 * open-ended plan cannot be honestly saved today (bounded `generate_series`, no rolling-regeneration
 * job), so the toggle the reference mock-up shows was never built rather than built and silently
 * discarded on save.
 *
 * `repeatWeekdays` uses the SAME 0=Sunday..6=Saturday numbering `training_plan_schedule_rules.weekday`
 * and `extract(dow from ...)` already use server-side (`20261011010000_training_management_recurrence_and_generation.sql`),
 * so a later screen can hand these values straight to `save_training_plan`'s `p_rules` without a second
 * day-numbering convention to keep in sync.
 */
export interface TrainingPlanDraft {
  team: OrderedTeamOption | null
  planType: "SEASON" | "SEASON_PRE_SEASON" | null
  season: CanonicalSeason | null
  startDate: string | null
  endDate: string | null
  /** 0=Sunday .. 6=Saturday, deduplicated, unordered as stored (screens sort for display). */
  repeatWeekdays: number[]
  /**
   * PAGE 4 -- VENUE & PITCH. Real `venues`/`club_pitches` rows, the same ones Arena Planning and Pitch
   * Allocation already read (`loadVenuesAndPitchesForClub`, `data.ts`) -- never a text name. Their `id`s
   * map straight onto `training_plans.preferred_venue_id`/`preferred_pitch_id`, both NOT NULL foreign
   * keys already defined in the schema (`20261011000000_training_management_schema.sql`), so Review &
   * Create's eventual `save_training_plan` call needs no translation step from what this page captures.
   */
  venue: ClubVenue | null
  pitch: ClubPitch | null
  /**
   * PAGE 5 -- TIMES & DETAILS. `startTime`/`durationMinutes` are the CANONICAL pair -- confirmed by
   * reading the actual schema: `training_plan_schedule_rules.start_time`/`duration_minutes` and
   * `override_training_session`'s own parameters both store exactly this pair, never an independent
   * end_time. `endTime` is never stored in the draft; every screen derives it with
   * `deriveEndTime` (`times-and-details-logic.ts`) so it can never silently disagree with what the
   * server itself computes (`end_time = start_time + make_interval(mins => duration_minutes)`).
   *
   * `warmUpMinutes`/`coolDownMinutes`/`notes` are RESOLVED (Step 6 correction pass, migration
   * `20270584000000`): `training_plans` gained its own `warm_up_minutes`/`pack_up_minutes`/
   * `default_session_notes` columns -- deliberately separate from `club_scheduling_policy`'s CLUB-WIDE
   * fixture buffer (a different concept, a different scope) and never read by the pitch/fixture
   * occupancy engine (`pitch-allocation/training-conflicts.ts` still resolves a session's occupied
   * window as exactly start -> start + duration). Review & Create passes these straight through to
   * `save_training_plan`'s three new trailing parameters.
   */
  startTime: string | null
  durationMinutes: number | null
  warmUpMinutes: number
  coolDownMinutes: number
  notes: string
  /** "Needs a changing room" at every session of the plan (20270738): Arena Planning gives the room, one team per room. */
  needsChangingRoom: boolean
}

const EMPTY_DRAFT: TrainingPlanDraft = {
  team: null,
  planType: null,
  season: null,
  startDate: null,
  endDate: null,
  repeatWeekdays: [],
  venue: null,
  pitch: null,
  startTime: "18:00",
  durationMinutes: 60,
  // Defaults to None per the product owner's own instruction -- a plan is not assumed to carry a
  // buffer just because the mock-up's own illustrative screenshot showed one.
  warmUpMinutes: 0,
  coolDownMinutes: 0,
  notes: "",
  needsChangingRoom: false,
}

interface DraftContextValue {
  draft: TrainingPlanDraft
  setTeam: (team: OrderedTeamOption) => void
  setPlanType: (planType: "SEASON" | "SEASON_PRE_SEASON") => void
  setSeason: (season: CanonicalSeason | null) => void
  setStartDate: (date: string | null) => void
  setEndDate: (date: string | null) => void
  toggleRepeatWeekday: (weekday: number) => void
  setVenue: (venue: ClubVenue) => void
  setPitch: (pitch: ClubPitch) => void
  setStartTime: (time: string) => void
  setDurationMinutes: (minutes: number) => void
  setEndTime: (time: string) => void
  setWarmUpMinutes: (minutes: number) => void
  setCoolDownMinutes: (minutes: number) => void
  setNotes: (notes: string) => void
  setNeedsChangingRoom: (needs: boolean) => void
  isDirty: boolean
}

const DraftContext = createContext<DraftContextValue | null>(null)

export function TrainingPlanDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<TrainingPlanDraft>(EMPTY_DRAFT)

  const setTeam = useCallback((team: OrderedTeamOption) => setDraft((d) => ({ ...d, team })), [])
  const setPlanType = useCallback((planType: "SEASON" | "SEASON_PRE_SEASON") => setDraft((d) => ({ ...d, planType })), [])
  const setSeason = useCallback((season: CanonicalSeason | null) => setDraft((d) => ({ ...d, season })), [])
  const setStartDate = useCallback((startDate: string | null) => setDraft((d) => ({ ...d, startDate })), [])
  const setEndDate = useCallback((endDate: string | null) => setDraft((d) => ({ ...d, endDate })), [])
  const toggleRepeatWeekday = useCallback(
    (weekday: number) => setDraft((d) => ({ ...d, repeatWeekdays: d.repeatWeekdays.includes(weekday) ? d.repeatWeekdays.filter((w) => w !== weekday) : [...d.repeatWeekdays, weekday] })),
    []
  )
  // Switching venue clears a previously-chosen pitch that belonged to the OLD venue -- a pitch is
  // never left selected once it can no longer be reached from Select Pitch's own venue-filtered list.
  const setVenue = useCallback((venue: ClubVenue) => setDraft((d) => ({ ...d, venue, pitch: d.pitch?.venueId === venue.id ? d.pitch : null })), [])
  const setPitch = useCallback((pitch: ClubPitch) => setDraft((d) => ({ ...d, pitch })), [])
  // Changing Start Time preserves the current duration -- the displayed End Time shifts with it,
  // matching the brief's own example ("Start 18:30 -> End 19:30"), never left stale against a new start.
  const setStartTime = useCallback((startTime: string) => setDraft((d) => ({ ...d, startTime })), [])
  const setDurationMinutes = useCallback((durationMinutes: number) => setDraft((d) => ({ ...d, durationMinutes })), [])
  // Editing End Time directly recomputes duration from (start, new end) -- the inverse of the above,
  // so the three values can never disagree with each other in the UI.
  const setEndTime = useCallback((endTime: string) => setDraft((d) => (d.startTime ? { ...d, durationMinutes: minutesBetween(d.startTime, endTime) } : d)), [])
  const setWarmUpMinutes = useCallback((warmUpMinutes: number) => setDraft((d) => ({ ...d, warmUpMinutes })), [])
  const setCoolDownMinutes = useCallback((coolDownMinutes: number) => setDraft((d) => ({ ...d, coolDownMinutes })), [])
  const setNotes = useCallback((notes: string) => setDraft((d) => ({ ...d, notes })), [])
  const setNeedsChangingRoom = useCallback((needsChangingRoom: boolean) => setDraft((d) => ({ ...d, needsChangingRoom })), [])
  const isDirty = draft.team !== null || draft.planType !== null

  const value = useMemo(
    () => ({
      draft,
      setTeam,
      setPlanType,
      setSeason,
      setStartDate,
      setEndDate,
      toggleRepeatWeekday,
      setVenue,
      setPitch,
      setStartTime,
      setDurationMinutes,
      setEndTime,
      setWarmUpMinutes,
      setCoolDownMinutes,
      setNotes,
      setNeedsChangingRoom,
      isDirty,
    }),
    [draft, setTeam, setPlanType, setSeason, setStartDate, setEndDate, toggleRepeatWeekday, setVenue, setPitch, setStartTime, setDurationMinutes, setEndTime, setWarmUpMinutes, setCoolDownMinutes, setNotes, setNeedsChangingRoom, isDirty]
  )
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
}

export function useTrainingPlanDraft(): DraftContextValue {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error("useTrainingPlanDraft must be used within TrainingPlanDraftProvider")
  return ctx
}
