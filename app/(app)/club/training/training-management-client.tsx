"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import { deactivatePlan, previewOccurrenceCount, reactivatePlan, savePlan, type ScheduleRuleInput } from "./actions"

export interface TeamOption {
  id: string
  label: string
}
export interface UpcomingSession {
  id: string
  teamLabel: string
  date: string
  startTime: string | null
  durationMinutes: number | null
  pitchName: string
  venueName: string
  source: "MANUAL" | "AUTOMATIC_PLAN"
}
export interface TrainingExceptionRow {
  trainingSessionId: string
  teamLabel: string
  date: string
  startTime: string | null
  pitchName: string
  reason: string
  severity: "hard" | "warning"
}
export interface VenueOption {
  id: string
  name: string
}
export interface PitchOption {
  id: string
  displayName: string
  venueId: string | null
}
export interface SeasonOption {
  id: string
  name: string
}
export interface PlanRule {
  id: string
  weekday: number
  startTime: string
  durationMinutes: number
  startsOn: string | null
  endsOn: string | null
}
export interface PlanRow {
  id: string
  teamId: string
  teamLabel: string
  seasonId: string | null
  scheduleMode: "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM"
  venueId: string
  venueName: string
  pitchId: string
  pitchName: string
  status: "ACTIVE" | "INACTIVE" | "NEEDS_ATTENTION"
  needsAttentionReason: string | null
  rules: PlanRule[]
}

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
]
const DURATIONS = [30, 45, 60, 75, 90, 105, 120]
const MODE_LABELS: Record<PlanRow["scheduleMode"], string> = { SEASON: "Season", SEASON_PRE_SEASON: "Season & Pre-Season", CUSTOM: "Custom Days" }

interface DraftRule {
  key: string
  weekday: number
  startTime: string
  durationMinutes: number
  startsOn: string
  endsOn: string
}

function emptyRule(key: string): DraftRule {
  return { key, weekday: 1, startTime: "18:00", durationMinutes: 60, startsOn: "", endsOn: "" }
}

function StatusBadge({ status }: { status: PlanRow["status"] }) {
  const config = {
    ACTIVE: { text: "Active", className: "bg-mint-100 text-forest-900" },
    INACTIVE: { text: "Inactive", className: "bg-ink/10 text-ink/60" },
    NEEDS_ATTENTION: { text: "Needs attention", className: "bg-amber-100 text-amber-900" },
  }[status]
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", config.className)}>
      {status === "NEEDS_ATTENTION" && <AlertTriangle className="size-3" />}
      {config.text}
    </span>
  )
}

function PlanForm({
  clubId,
  teams,
  venues,
  pitches,
  seasons,
  editingPlan,
  onClose,
  onSaved,
}: {
  clubId: string
  teams: TeamOption[]
  venues: VenueOption[]
  pitches: PitchOption[]
  seasons: SeasonOption[]
  editingPlan: PlanRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [teamId, setTeamId] = useState(editingPlan?.teamId ?? teams[0]?.id ?? "")
  const [scheduleMode, setScheduleMode] = useState<PlanRow["scheduleMode"]>(editingPlan?.scheduleMode ?? "SEASON")
  const [seasonId, setSeasonId] = useState(editingPlan?.seasonId ?? seasons[0]?.id ?? "")
  const [venueId, setVenueId] = useState(editingPlan?.venueId ?? "")
  const [pitchId, setPitchId] = useState(editingPlan?.pitchId ?? "")
  const [rules, setRules] = useState<DraftRule[]>(
    editingPlan && editingPlan.rules.length > 0
      ? editingPlan.rules.map((r, i) => ({ key: `existing-${i}`, weekday: r.weekday, startTime: r.startTime.slice(0, 5), durationMinutes: r.durationMinutes, startsOn: r.startsOn ?? "", endsOn: r.endsOn ?? "" }))
      : [emptyRule("rule-0")]
  )
  const [nextKey, setNextKey] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const pitchesForVenue = useMemo(() => pitches.filter((p) => p.venueId === venueId), [pitches, venueId])

  // Section 10: if venue changes, an incompatible preferred pitch selection is invalidated.
  function handleVenueChange(v: string) {
    setVenueId(v)
    if (pitchId && !pitches.some((p) => p.id === pitchId && p.venueId === v)) setPitchId("")
    setPreviewCount(null)
  }

  function updateRule(key: string, patch: Partial<DraftRule>) {
    setRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setPreviewCount(null)
  }
  function addRule() {
    setRules((rs) => [...rs, emptyRule(`rule-${nextKey}`)])
    setNextKey((k) => k + 1)
  }
  function removeRule(key: string) {
    setRules((rs) => rs.filter((r) => r.key !== key))
    setPreviewCount(null)
  }

  function toRuleInputs(): ScheduleRuleInput[] {
    return rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      durationMinutes: r.durationMinutes,
      startsOn: scheduleMode === "CUSTOM" ? r.startsOn || null : null,
      endsOn: scheduleMode === "CUSTOM" ? r.endsOn || null : null,
    }))
  }

  function validate(): string | null {
    if (!teamId) return "A team is required."
    if (scheduleMode !== "CUSTOM" && !seasonId) return "A season is required for this schedule mode."
    if (!venueId) return "A preferred training venue is required."
    if (!pitchId) return "A preferred training pitch is required."
    if (rules.length === 0) return "At least one schedule row is required."
    for (const r of rules) {
      if (!r.startTime) return "Every schedule row needs a start time."
      if (scheduleMode === "CUSTOM" && (!r.startsOn || !r.endsOn)) return "Every custom schedule row needs a from and to date."
      if (scheduleMode === "CUSTOM" && r.startsOn && r.endsOn && r.startsOn > r.endsOn) return "A schedule row's from date cannot be after its to date."
    }
    return null
  }

  async function handlePreview() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setPreviewing(true)
    const result = await previewOccurrenceCount(clubId, scheduleMode, scheduleMode === "CUSTOM" ? null : seasonId, toRuleInputs())
    setPreviewing(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPreviewCount(result.data.count)
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(true)
    const result = await savePlan(clubId, editingPlan?.id ?? null, teamId, scheduleMode, scheduleMode === "CUSTOM" ? null : seasonId, venueId, pitchId, toRuleInputs())
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={editingPlan ? "Edit Training Plan" : "New Training Plan"} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">{editingPlan ? "Edit Training Plan" : "New Training Plan"}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tp-team" className="text-xs font-medium text-ink/60">
              Team
            </label>
            <select
              id="tp-team"
              value={teamId}
              disabled={!!editingPlan}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600 disabled:bg-ink/5"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tp-mode" className="text-xs font-medium text-ink/60">
              Schedule Mode
            </label>
            <select
              id="tp-mode"
              value={scheduleMode}
              onChange={(e) => {
                setScheduleMode(e.target.value as PlanRow["scheduleMode"])
                setPreviewCount(null)
              }}
              className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
            >
              <option value="SEASON">Season</option>
              <option value="SEASON_PRE_SEASON">Season &amp; Pre-Season</option>
              <option value="CUSTOM">Custom Days</option>
            </select>
          </div>

          {scheduleMode !== "CUSTOM" && (
            <div className="sm:col-span-2">
              <label htmlFor="tp-season" className="text-xs font-medium text-ink/60">
                Season
              </label>
              <select id="tp-season" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600">
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="tp-venue" className="text-xs font-medium text-ink/60">
              Preferred Training Venue
            </label>
            <select id="tp-venue" value={venueId} onChange={(e) => handleVenueChange(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600">
              <option value="">Select a venue…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tp-pitch" className="text-xs font-medium text-ink/60">
              Preferred Training Pitch
            </label>
            <select
              id="tp-pitch"
              value={pitchId}
              disabled={!venueId}
              onChange={(e) => {
                setPitchId(e.target.value)
                setPreviewCount(null)
              }}
              className="mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600 disabled:bg-ink/5"
            >
              <option value="">{venueId ? "Select a pitch…" : "Select a venue first"}</option>
              {pitchesForVenue.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-wide text-ink/60 uppercase">Weekly Schedule</p>
            <button type="button" onClick={addRule} className="inline-flex items-center gap-1 text-xs font-medium text-pitch-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
              <Plus className="size-3.5" />
              Add day
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-3">
            {rules.map((r) => (
              <div key={r.key} className="rounded-lg border border-ink/10 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label htmlFor={`weekday-${r.key}`} className="text-[11px] font-medium text-ink-muted">
                      Day
                    </label>
                    <select
                      id={`weekday-${r.key}`}
                      value={r.weekday}
                      onChange={(e) => updateRule(r.key, { weekday: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`start-${r.key}`} className="text-[11px] font-medium text-ink-muted">
                      Start time
                    </label>
                    <input
                      id={`start-${r.key}`}
                      type="time"
                      value={r.startTime}
                      onChange={(e) => updateRule(r.key, { startTime: e.target.value })}
                      className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                    />
                  </div>
                  <div>
                    <label htmlFor={`duration-${r.key}`} className="text-[11px] font-medium text-ink-muted">
                      Duration
                    </label>
                    <select
                      id={`duration-${r.key}`}
                      value={r.durationMinutes}
                      onChange={(e) => updateRule(r.key, { durationMinutes: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                    >
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {d} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end justify-end">
                    {rules.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove this day"
                        onClick={() => removeRule(r.key)}
                        className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-destructive-text outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive/40"
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {scheduleMode === "CUSTOM" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`from-${r.key}`} className="text-[11px] font-medium text-ink-muted">
                        From date
                      </label>
                      <input
                        id={`from-${r.key}`}
                        type="date"
                        value={r.startsOn}
                        onChange={(e) => updateRule(r.key, { startsOn: e.target.value })}
                        className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                      />
                    </div>
                    <div>
                      <label htmlFor={`to-${r.key}`} className="text-[11px] font-medium text-ink-muted">
                        To date
                      </label>
                      <input
                        id={`to-${r.key}`}
                        type="date"
                        value={r.endsOn}
                        onChange={(e) => updateRule(r.key, { endsOn: e.target.value })}
                        className="mt-1 h-9 w-full rounded-lg border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-chalk px-3 py-2.5">
          <p className="text-xs text-ink/60">{previewCount !== null ? `This will create ${previewCount} planned training session${previewCount === 1 ? "" : "s"}.` : "Preview how many sessions this schedule creates."}</p>
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={handlePreview} disabled={previewing}>
            {previewing ? "Calculating…" : "Preview"}
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-9" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="h-9" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : editingPlan ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function TrainingManagementClient({
  clubId,
  overview,
  teams,
  teamsWithoutPlan,
  venues,
  pitches,
  seasons,
  plans,
  upcomingSessions,
  upcomingTeamFilter,
  exceptions,
}: {
  clubId: string
  overview: { active_plan_count: number; teams_without_plan_count: number; upcoming_session_count: number; needs_attention_plan_count: number }
  teams: TeamOption[]
  teamsWithoutPlan: TeamOption[]
  venues: VenueOption[]
  pitches: PitchOption[]
  seasons: SeasonOption[]
  plans: PlanRow[]
  upcomingSessions: UpcomingSession[]
  upcomingTeamFilter: string | null
  exceptions: TrainingExceptionRow[]
}) {
  const router = useRouter()
  const [formState, setFormState] = useState<{ open: boolean; editing: PlanRow | null; forTeamId?: string }>({ open: false, editing: null })
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const activePlans = plans.filter((p) => p.status !== "INACTIVE")
  const archivedPlans = plans.filter((p) => p.status === "INACTIVE")

  function refresh() {
    setFormState({ open: false, editing: null })
    setRefreshKey((k) => k + 1)
    // Server Components re-fetch via revalidatePath (server action) --
    // a full navigation refresh is the simplest reliable way to reflect
    // that in this server-rendered page without duplicating its queries
    // client-side.
    if (typeof window !== "undefined") window.location.reload()
  }

  async function handleToggleTeam(team: TeamOption, currentPlan: PlanRow | undefined) {
    if (!currentPlan) {
      setFormState({ open: true, editing: null, forTeamId: team.id })
      return
    }
    setBusyPlanId(currentPlan.id)
    setError(null)
    const result = currentPlan.status === "INACTIVE" ? await reactivatePlan(clubId, currentPlan.id) : await deactivatePlan(clubId, currentPlan.id, "Turned off via Automatic Training Booking control.")
    setBusyPlanId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    refresh()
  }

  return (
    <div className="mt-8">
      {/* Section 6: overview cards -- current/future emphasis, no historical clutter by default. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Active Plans</p>
          <p className="mt-1 font-display text-2xl text-ink">{overview.active_plan_count}</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Teams Without a Plan</p>
          <p className="mt-1 font-display text-2xl text-ink">{overview.teams_without_plan_count}</p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Upcoming Sessions</p>
          <p className="mt-1 font-display text-2xl text-ink">{overview.upcoming_session_count}</p>
        </div>
        <div className={cn("rounded-xl border p-4", overview.needs_attention_plan_count > 0 ? "border-amber-300 bg-amber-50" : "border-ink/10 bg-white")}>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Needs Attention</p>
          <p className="mt-1 font-display text-2xl text-ink">{overview.needs_attention_plan_count}</p>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive-text">{error}</p>}

      {/* Section 7-8: Automatic Training Booking control -- every active operational team, toggle on/off. */}
      <div className="mt-8">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-2.5 shrink-0 rounded-full bg-pitch-600" aria-hidden="true" />
          <h2 className="font-display text-lg text-ink">Automatic Training Booking</h2>
        </div>
        <p className="mt-1 text-sm text-ink-muted">Turn on for a team to configure its recurring schedule -- Ovalball then keeps that team&apos;s planned sessions generated for you.</p>
        <div className="mt-3 flex flex-col divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">
          {teams.length === 0 && <p className="px-4 py-6 text-sm text-ink-muted">No active teams at this club yet.</p>}
          {teams.map((team) => {
            const plan = activePlans.find((p) => p.teamId === team.id)
            const isOn = !!plan && plan.status !== "INACTIVE"
            return (
              <div key={team.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{team.label}</p>
                  {plan && (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {MODE_LABELS[plan.scheduleMode]} · {plan.pitchName} · {plan.venueName}
                      {plan.status === "NEEDS_ATTENTION" && plan.needsAttentionReason ? ` · ${plan.needsAttentionReason}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {plan && plan.status !== "NEEDS_ATTENTION" && (
                    <button type="button" onClick={() => setFormState({ open: true, editing: plan })} className="text-xs font-medium text-pitch-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                      Edit
                    </button>
                  )}
                  {plan?.status === "NEEDS_ATTENTION" && (
                    <button type="button" onClick={() => setFormState({ open: true, editing: plan })} className="text-xs font-medium text-amber-800 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                      Resolve
                    </button>
                  )}
                  <Switch
                    checked={isOn}
                    disabled={busyPlanId === plan?.id}
                    onCheckedChange={() => handleToggleTeam(team, plan)}
                    aria-label={`Automatic Training Booking for ${team.label}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Section 51: overview table of every active/needs-attention plan. */}
      {activePlans.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg text-ink">Active Training Plans</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-chalk text-xs font-medium tracking-wide text-ink-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5">Schedule</th>
                  <th className="px-4 py-2.5">Venue / Pitch</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {activePlans.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-medium text-ink">{p.teamLabel}</td>
                    <td className="px-4 py-2.5 text-ink/70">
                      {MODE_LABELS[p.scheduleMode]}
                      {p.rules.length > 0 && (
                        <span className="ml-1.5 text-xs text-ink-muted">
                          ({p.rules.map((r) => WEEKDAYS.find((w) => w.value === r.weekday)?.label.slice(0, 3)).join(", ")})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink/70">
                      {p.venueName} / {p.pitchName}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => setFormState({ open: true, editing: p })} className="text-xs font-medium text-pitch-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 6: teams without a training plan. */}
      {teamsWithoutPlan.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg text-ink">Teams Without a Training Plan</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {teamsWithoutPlan.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFormState({ open: true, editing: null, forTeamId: t.id })}
                className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/70 outline-none hover:border-pitch-400 hover:text-pitch-700 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {t.label} — set up
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section 6/35-36: Exceptions / Conflicts -- real pitch double-bookings
          across training AND fixtures, computed with the exact same
          detectResourceConflicts engine Pitch Allocation uses (Section 60's
          "shared resource-allocation layer"), not a second ad hoc check. */}
      {exceptions.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-700" />
            <h2 className="font-display text-lg text-ink">Exceptions / Conflicts</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Real pitch double-bookings in the next 30 days -- nothing here has been silently dropped or moved.</p>
          <div className="mt-3 flex flex-col gap-2">
            {exceptions.map((e) => (
              <div key={e.trainingSessionId} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm", e.severity === "hard" ? "border-destructive/30 bg-destructive/5" : "border-amber-300 bg-amber-50")}>
                <div>
                  <span className="font-medium text-ink">{e.teamLabel}</span>
                  <span className="ml-2 text-ink/60">
                    {e.date} {e.startTime?.slice(0, 5)} · {e.pitchName}
                  </span>
                  <p className="mt-0.5 text-xs text-ink-muted">{e.reason}</p>
                </div>
                <a href="/calendar/pitch-allocation" className="shrink-0 text-xs font-medium text-pitch-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                  Resolve in Pitch Allocation
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 53: Upcoming Training Sessions -- today onward, optional team filter, capped list rather than dumping all history. */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-ink">Upcoming Training Sessions</h2>
          <div>
            <label htmlFor="upcoming-team-filter" className="sr-only">
              Filter by team
            </label>
            <select
              id="upcoming-team-filter"
              value={upcomingTeamFilter ?? ""}
              onChange={(e) => router.push(e.target.value ? `/club/training?team=${e.target.value}` : "/club/training")}
              className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {upcomingSessions.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No upcoming training sessions{upcomingTeamFilter ? " for this team" : ""}.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-chalk text-xs font-medium tracking-wide text-ink-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Venue / Pitch</th>
                  <th className="px-4 py-2.5">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {upcomingSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 text-ink/80">{s.date}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{s.teamLabel}</td>
                    <td className="px-4 py-2.5 text-ink/70">
                      {s.startTime?.slice(0, 5) ?? "--:--"}
                      {s.durationMinutes ? ` (${s.durationMinutes} min)` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-ink/70">
                      {s.venueName} / {s.pitchName}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{s.source === "AUTOMATIC_PLAN" ? "Automatic" : "Manual"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-ink/10 px-4 py-2 text-xs text-ink-muted">Showing the next 14 days{upcomingTeamFilter ? "" : " across every team"}.</p>
          </div>
        )}
      </div>

      {archivedPlans.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">Past / archived plans ({archivedPlans.length})</summary>
          <div className="mt-3 flex flex-col gap-2">
            {archivedPlans.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-ink/10 bg-white px-4 py-2.5 text-sm">
                <span className="text-ink/70">
                  {p.teamLabel} · {MODE_LABELS[p.scheduleMode]}
                </span>
                <button type="button" onClick={() => reactivatePlan(clubId, p.id).then(refresh)} className="text-xs font-medium text-pitch-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-pitch-400">
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {formState.open && (
        <PlanForm
          key={refreshKey}
          clubId={clubId}
          teams={formState.forTeamId ? teams.filter((t) => t.id === formState.forTeamId) : teams}
          venues={venues}
          pitches={pitches}
          seasons={seasons}
          editingPlan={formState.editing}
          onClose={() => setFormState({ open: false, editing: null })}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
