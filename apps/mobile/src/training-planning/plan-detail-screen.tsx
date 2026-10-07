import { useCallback, useEffect, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../auth/supabase"
import { routeForIntent } from "../links/destinations"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../components/ui"
import { TextField } from "../components/form"
import { ChevronLeft, ChevronRight } from "../components/icons"
import { colour, elevation, radius, space, type } from "../design/tokens"
import {
  deactivateTrainingPlan,
  loadTrainingPlanDetail,
  loadTrainingPlanSessions,
  reactivateTrainingPlan,
  type TrainingPlanDetail,
  type TrainingPlanUpcomingSession,
} from "./data"
import { bufferLabel } from "./create-plan/times-and-details-logic"
import { repeatWeekdaysLabel } from "./create-plan/review-logic"
import { isSessionPast, rulesShareOneTime, sessionDisplayStatus, sessionRowLabel, sortSessionsByDate, upcomingCountLabel } from "./plan-detail-logic"
import { friendly, logDetail } from "../errors/translate"
import { libraryAsset } from "../media/stock-assets"

const heroPhoto = libraryAsset("training-huddle-01")

/** A batch's worth of sessions -- enough to feel complete without rendering a season in one go. */
const SESSIONS_PAGE_SIZE = 25

type Tab = "overview" | "sessions" | "settings"

/**
 * TRAINING PLAN DETAIL -- the destination Training Planning Home's own team row already links to
 * once a team has a plan (`/admin/training-planning/plan/[planId]`). Step 7 replaces the Step 6
 * placeholder with the approved mock-up's own structure: a photographic hero (reusing
 * `training-huddle-01`, the same asset Review & Create's own hero already uses -- no new generation
 * needed), Active/Inactive status, and Overview / Sessions / Settings tabs.
 */
export function PlanDetailScreen({ planId }: { planId: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [plan, setPlan] = useState<TrainingPlanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("overview")
  const [busy, setBusy] = useState(false)

  /**
   * SESSIONS TAB'S OWN PAGE OF HISTORY -- separate from `plan` because it is a different query
   * (every occurrence, not just the next 30 upcoming ones) and grows by `SESSIONS_PAGE_SIZE` on
   * demand rather than all at once. `sessionsVersion` is bumped every time the plan itself is
   * reloaded (first mount, pull-to-refresh, coming back into focus) so a schedule edit made
   * elsewhere is reflected here the next time this tab is open, rather than showing a stale page.
   */
  const [sessions, setSessions] = useState<TrainingPlanUpcomingSession[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false)
  const [sessionsVersion, setSessionsVersion] = useState(0)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setPlan(await loadTrainingPlanDetail(supabase, planId))
      setSessionsVersion((v) => v + 1)
    } catch (caught) {
      const failure = friendly(caught, "this training plan")
      logDetail("training-planning plan-detail", failure)
      setProblem(failure.message)
    } finally {
      setLoading(false)
    }
  }, [planId])
  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    if (tab !== "sessions") return
    let cancelled = false
    void loadTrainingPlanSessions(supabase, planId, 0, SESSIONS_PAGE_SIZE).then((page) => {
      if (cancelled) return
      setSessions(page.rows)
      setSessionsTotal(page.total)
    })
    return () => {
      cancelled = true
    }
  }, [tab, planId, sessionsVersion])

  async function showMoreSessions() {
    setSessionsLoadingMore(true)
    try {
      const page = await loadTrainingPlanSessions(supabase, planId, sessions.length, SESSIONS_PAGE_SIZE)
      setSessions((current) => [...current, ...page.rows])
      setSessionsTotal(page.total)
    } finally {
      setSessionsLoadingMore(false)
    }
  }

  /**
   * DEACTIVATE / REACTIVATE, EACH WITH ITS OWN OVALBALL CONFIRMATION -- neither fires from a bare
   * button press any more. `deactivate_training_plan` itself requires a real reason (it refuses an
   * empty one), so the sheet asks for one rather than sending a hardcoded string on the person's
   * behalf; `reactivate_training_plan` takes none, so its own sheet is confirmation only. The copy
   * is deliberately explicit that this is the RECURRING PLAN, not one session -- the same
   * distinction `CancelSheet`'s `kind` prop draws for a single occurrence.
   */
  const [pendingLifecycle, setPendingLifecycle] = useState<"deactivate" | "reactivate" | null>(null)
  const [lifecycleReason, setLifecycleReason] = useState("")

  async function confirmLifecycle() {
    if (!plan || !pendingLifecycle) return
    setBusy(true)
    try {
      if (pendingLifecycle === "reactivate") await reactivateTrainingPlan(supabase, plan.id)
      else await deactivateTrainingPlan(supabase, plan.id, lifecycleReason)
      setPendingLifecycle(null)
      setLifecycleReason("")
      await load()
    } catch (caught) {
      setProblem(friendly(caught, "this training plan").message)
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = plan ? sortSessionsByDate(plan.upcomingSessions.filter((s) => !isSessionPast(s.occurrenceDate, today))) : []
  const nextSession = upcoming[0] ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl * 2 }} showsVerticalScrollIndicator={false}>
        <View style={{ height: 220 }}>
          <Image source={heroPhoto} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(7,28,20,0.42)" }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin/training-planning" as never))}
            hitSlop={8}
            style={{
              position: "absolute",
              top: insets.top + space.xs,
              left: space.sm,
              width: 40,
              height: 40,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(7,28,20,0.45)",
            }}
          >
            <ChevronLeft size={22} color={colour.chalk} strokeWidth={2.2} />
          </Pressable>
          <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.md, gap: 4 }}>
            <Text style={[type.display, { color: colour.chalk }]}>{plan?.teamLabel ?? "Training Plan"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={[type.small, { color: "rgba(248,250,247,0.9)" }]}>Training Plan</Text>
              {plan && (
                <StatusPill
                  label={plan.status === "ACTIVE" ? "Active" : plan.status === "NEEDS_ATTENTION" ? "Needs Attention" : "Inactive"}
                  tone={plan.status === "ACTIVE" ? "positive" : plan.status === "NEEDS_ATTENTION" ? "caution" : "neutral"}
                />
              )}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colour.line, paddingHorizontal: space.lg }}>
          {(["overview", "sessions", "settings"] as const).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
              onPress={() => setTab(k)}
              style={{ paddingVertical: space.sm, marginRight: space.lg, borderBottomWidth: 2, borderBottomColor: tab === k ? colour.pitch600 : "transparent" }}
            >
              <Text style={[type.smallMedium, { color: tab === k ? colour.ink : colour.inkMuted, textTransform: "capitalize" }]}>{k}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ padding: space.lg, gap: space.md }}>
          {loading && <CardSkeleton lines={6} />}
          {problem && <ErrorState message={problem} onRetry={() => void load()} />}
          {!loading && !problem && !plan && <ErrorState message="This training plan is not available to you." />}

          {plan && tab === "overview" && (
            <OverviewTab plan={plan} nextSession={nextSession} onEdit={() => router.push(`/admin/training-planning/plan/${plan.id}/edit` as never)} />
          )}
          {plan && tab === "sessions" && (
            <SessionsTab
              plan={plan}
              sessions={sessions}
              total={sessionsTotal}
              loadingMore={sessionsLoadingMore}
              onShowMore={() => void showMoreSessions()}
              onOpenSession={(id) => router.push(routeForIntent({ kind: "TRAINING", sessionId: id }) as never)}
            />
          )}
          {plan && tab === "settings" && (
            <SettingsTab
              plan={plan}
              busy={busy}
              onEdit={() => router.push(`/admin/training-planning/plan/${plan.id}/edit` as never)}
              onToggleActive={() => setPendingLifecycle(plan.status === "INACTIVE" ? "reactivate" : "deactivate")}
            />
          )}
        </View>
      </ScrollView>

      {plan && (
        <LifecycleConfirmSheet
          plan={plan}
          pending={pendingLifecycle}
          reason={lifecycleReason}
          onChangeReason={setLifecycleReason}
          busy={busy}
          onClose={() => {
            setPendingLifecycle(null)
            setLifecycleReason("")
          }}
          onConfirm={() => void confirmLifecycle()}
        />
      )}
    </View>
  )
}

function LifecycleConfirmSheet({
  plan,
  pending,
  reason,
  onChangeReason,
  busy,
  onClose,
  onConfirm,
}: {
  plan: TrainingPlanDetail
  pending: "deactivate" | "reactivate" | null
  reason: string
  onChangeReason: (next: string) => void
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const deactivating = pending === "deactivate"
  const insets = useSafeAreaInsets()
  const visible = pending !== null

  /*
    A KEYBOARD-AVOIDING MODAL, NOT `BottomSheet` -- the same call `AnnounceSheet` and
    `EditDescriptionSheet` already made: a reason field fighting the keyboard is exactly the
    problem `BottomSheet`'s plain (non-scrolling, non-avoiding) content View cannot solve, and
    genuinely could not solve here -- the Deactivate button ended up rendered behind the keyboard,
    entirely out of reach, the first time this was tested live.
  */
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={busy ? undefined : onClose} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          style={[
            {
              backgroundColor: colour.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: space.lg,
              paddingBottom: insets.bottom + space.lg,
              paddingHorizontal: space.lg,
              gap: space.md,
              maxHeight: "88%",
            },
            elevation.sheet,
          ]}
        >
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {deactivating ? "Deactivate This Training Plan?" : "Reactivate This Training Plan?"}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              {deactivating
                ? `This deactivates ${plan.teamLabel}'s whole recurring training plan -- not one session. Its upcoming sessions that have not been individually edited will be cancelled, and no new sessions will be generated until it is reactivated. Sessions that were edited on their own, and everything that has already happened, are not affected.`
                : `This makes ${plan.teamLabel}'s recurring training plan active again and regenerates its upcoming sessions from today onward. Sessions cancelled by the deactivation are restored; nothing that already happened is changed.`}
            </Text>
            {deactivating && (
              <TextField label="Why it is being deactivated" value={reason} onChange={onChangeReason} multiline placeholder="Season has ended, team has folded, replaced by a new plan" />
            )}
            <Button
              label={deactivating ? "Deactivate Plan" : "Reactivate Plan"}
              variant={deactivating ? "danger" : "primary"}
              onPress={onConfirm}
              busy={busy}
              disabled={deactivating && reason.trim().length === 0}
            />
            <Button label="Cancel" variant="quiet" onPress={onClose} disabled={busy} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function OverviewTab({ plan, nextSession, onEdit }: { plan: TrainingPlanDetail; nextSession: TrainingPlanDetail["upcomingSessions"][number] | null; onEdit: () => void }) {
  return (
    <>
      {!!plan.needsAttentionReason && (
        <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.small, { color: colour.warning }]}>{plan.needsAttentionReason}</Text>
        </View>
      )}
      <Card>
        <FieldRow icon="calendar" label="Plan Type" value={planTypeLabel(plan.scheduleMode)} sub={plan.seasonName ?? undefined} />
        <FieldRow icon="calendar" label="Dates" value={rulesShareOneTime(plan.rules) ? "Follows the season" : "Varies by weekday"} />
        <FieldRow icon="repeat" label="Repeats" value={plan.rules.length ? repeatWeekdaysLabel(plan.rules.map((r) => r.weekday)) : "—"} />
        <FieldRow
          icon="clock"
          label="Time"
          value={rulesShareOneTime(plan.rules) && plan.rules[0] ? `${plan.rules[0].startTime} (${plan.rules[0].durationMinutes} min)` : "—"}
          sub={plan.warmUpMinutes > 0 || plan.packUpMinutes > 0 ? `Warm up: ${bufferLabel(plan.warmUpMinutes)} · Pack up: ${bufferLabel(plan.packUpMinutes)}` : undefined}
        />
        <FieldRow icon="pin" label="Venue & Pitch" value={plan.venueName ?? "—"} sub={plan.pitchName ?? undefined} last={!plan.defaultSessionNotes} />
        {!!plan.defaultSessionNotes && <FieldRow icon="notes" label="Notes" value={plan.defaultSessionNotes} last />}
      </Card>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <SummaryTile label="Next Session" value={nextSession ? sessionRowLabel(nextSession.occurrenceDate) : "None"} detail={nextSession ? `${nextSession.startTime ?? ""} · ${nextSession.pitchName ?? "—"}` : undefined} />
        <SummaryTile label="Upcoming" value={upcomingCountLabel(plan.upcomingSessions)} detail={plan.totalUpcomingCount > plan.upcomingSessions.length ? `${plan.totalUpcomingCount} in total` : "Throughout the season"} />
      </View>

      <Button label="Edit Plan Details" onPress={onEdit} />
    </>
  )
}

function SessionsTab({
  plan,
  sessions,
  total,
  loadingMore,
  onShowMore,
  onOpenSession,
}: {
  plan: TrainingPlanDetail
  sessions: TrainingPlanUpcomingSession[]
  total: number
  loadingMore: boolean
  onShowMore: () => void
  onOpenSession: (id: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>
        ALL SESSIONS{total > 0 ? ` · ${total}` : ""}
      </Text>
      <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
        {sessions.length === 0 && <Text style={[type.small, { color: colour.inkMuted, padding: space.lg }]}>No sessions yet.</Text>}
        {sessions.map((s, i) => {
          const status = sessionDisplayStatus(s.occurrenceDate, s.status, today)
          const cancelled = status === "cancelled"
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              onPress={() => onOpenSession(s.id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                padding: space.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colour.line,
                backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
                opacity: cancelled ? 0.6 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    type.smallMedium,
                    { color: cancelled ? colour.inkMuted : colour.ink, textDecorationLine: cancelled ? "line-through" : "none" },
                  ]}
                >
                  {sessionRowLabel(s.occurrenceDate)} · {s.startTime ?? "—"}
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  {plan.venueName ?? "—"} · {s.pitchName ?? "—"}
                  {cancelled ? " · Cancelled" : status === "completed" ? " · Completed" : ""}
                  {s.isOverridden ? " · Edited" : ""}
                </Text>
              </View>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          )
        })}
      </View>
      {sessions.length < total && (
        <Button label={loadingMore ? "Loading…" : "Show More Sessions"} variant="secondary" onPress={onShowMore} busy={loadingMore} />
      )}
    </>
  )
}

function SettingsTab({ plan, busy, onEdit, onToggleActive }: { plan: TrainingPlanDetail; busy: boolean; onEdit: () => void; onToggleActive: () => void }) {
  return (
    <>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>PLAN SETTINGS</Text>
      <Card>
        <FieldRow icon="calendar" label="Plan Type & Season" value={planTypeLabel(plan.scheduleMode)} sub={plan.seasonName ?? undefined} />
        <FieldRow icon="calendar" label="Dates & Repeat Days" value={plan.rules.length ? repeatWeekdaysLabel(plan.rules.map((r) => r.weekday)) : "—"} />
        <FieldRow
          icon="clock"
          label="Default Session Time"
          value={rulesShareOneTime(plan.rules) && plan.rules[0] ? `${plan.rules[0].startTime} (${plan.rules[0].durationMinutes} min)` : "—"}
          sub={`Warm up: ${bufferLabel(plan.warmUpMinutes)} · Pack up: ${bufferLabel(plan.packUpMinutes)}`}
        />
        <FieldRow icon="pin" label="Venue & Pitch" value={plan.venueName ?? "—"} sub={plan.pitchName ?? undefined} />
        <FieldRow icon="notes" label="Default Notes" value={plan.defaultSessionNotes ?? "None"} last />
      </Card>

      <Button label="Edit Plan Details" onPress={onEdit} />

      <View style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colour.line }}>
        <Button label={plan.status === "INACTIVE" ? "Reactivate Plan" : "Deactivate Plan"} variant={plan.status === "INACTIVE" ? "primary" : "quiet"} onPress={onToggleActive} busy={busy} />
      </View>
    </>
  )
}

function planTypeLabel(mode: string): string {
  return mode === "SEASON" ? "Season Long" : mode === "SEASON_PRE_SEASON" ? "Pre Season" : "Custom"
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, overflow: "hidden", ...elevation.card }}>{children}</View>
}

function FieldRow({ label, value, sub, last }: { icon: string; label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <View style={{ padding: space.md, gap: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: colour.line }}>
      <Text style={[type.overline, { color: colour.inkSubtle }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{value}</Text>
      {!!sub && <Text style={[type.caption, { color: colour.inkMuted }]}>{sub}</Text>}
    </View>
  )
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={{ flex: 1, borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: 2 }}>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{value}</Text>
      {!!detail && (
        <Text style={[type.caption, { color: colour.inkSubtle }]} numberOfLines={1}>
          {detail}
        </Text>
      )}
    </View>
  )
}
