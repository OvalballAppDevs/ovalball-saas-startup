import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { formatHasBracket } from "@ovalball/contracts/tournaments/knockout"
import type { TournamentDetail } from "@ovalball/contracts/club/tournament-detail"
import {
  continueGoesToPlan,
  deletePlanSheet,
  deleteTournamentPlan,
  planningCard,
  readPlanSummaries,
  shortDay,
  type PlanSummary,
  type PlanningIntent,
} from "@ovalball/contracts/tournaments/schedule"

import { CompetitionChooser } from "./detail-chrome"
import { KNOCKOUT_RED, KNOCKOUT_RED_SURFACE } from "./knockout-planning"
import { supabase } from "../auth/supabase"
import { CalendarDays, ChevronRight, Eye, LayoutGrid, Pencil, Trash2, TriangleAlert, Trophy } from "../components/icons"
import { Button, Card, StatusPill } from "../components/ui"
import { friendlyRefusal, logDetail } from "../errors/translate"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { Sheet } from "../pitch-allocation/sheets"
import { colour, radius, space, type } from "../design/tokens"

/**
 * TOURNAMENT PLANNING, AS THE ORGANISER MEETS IT.
 *
 * The Planning tab of the tournament the organiser already has open, so it inherits that screen's
 * header, its tabs and its navigation. Nothing here is a second tournament surface.
 *
 * IT CREATES NOTHING BY BEING OPENED. `get_tournament_plan_summaries` reads where each competition has
 * got to without starting a plan; "No plan yet" is the truth until somebody presses Plan Tournament.
 *
 * THE STATE DECIDES THE CONTROLS (20270736), in one place -- `planningCard`:
 *
 *   NO PLAN    Plan Tournament                      the first-time wizard
 *   DRAFT      Continue Planning, Delete Draft      the plan once it has games, the setup before
 *   PUBLISHED  View Plan, Edit Plan, Edit Tables,   the plan, the plan in edit mode, the tables step,
 *              Delete Plan                          and a sheet that says what deleting would do
 *
 * The wizard is never the way to look at, or change, a plan that already exists: "View Plan" used to
 * open it on step one, writing the live plan on every Continue.
 *
 * THE CATEGORY IS NOT ASKED AGAIN. It is already on the tournament; this shows what it is and what it
 * means, and Edit opens the tournament's own details, where changing it legitimately lives.
 */
export function TournamentPlanningTab({ detail, onEditDetails }: { detail: TournamentDetail; onEditDetails?: () => void }) {
  const router = useRouter()
  const tabBar = useTabBarHeight()
  const [grade, setGrade] = useState<string>(detail.ageGroups[0] ?? "")
  const [summaries, setSummaries] = useState<PlanSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PlanSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setSummaries(await readPlanSummaries(supabase, detail.id))
    } catch (caught) {
      const failure = friendlyRefusal(caught, "planning")
      logDetail("tournament planning summaries", failure)
      setProblem(failure.message)
    }
  }, [detail.id])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const summary = summaries?.find((s) => s.ageGroup === grade) ?? null
  const card = planningCard(summary)
  const isKnockout = formatHasBracket(detail.format)

  function go(intent: PlanningIntent) {
    const params = { tournamentId: detail.id, ageGroup: grade }
    const wizard = (step?: string) => router.push({ pathname: "/admin/tournaments/plan/[tournamentId]", params: step ? { ...params, step } : params } as never)
    const planScreen = (mode?: "edit") => router.push({ pathname: "/admin/tournaments/plan/draft/[tournamentId]", params: mode ? { ...params, mode } : params } as never)
    setNotice(null)
    switch (intent) {
      case "plan": wizard(); return
      case "continue": summary && continueGoesToPlan(summary) ? planScreen("edit") : wizard(); return
      case "view": planScreen(); return
      case "edit": planScreen("edit"); return
      case "tables": wizard("1"); return
      case "delete": setDeleting(summary); return
    }
  }

  async function confirmDelete() {
    if (!deleting?.planId) return
    setBusy(true)
    setProblem(null)
    try {
      const done = await deleteTournamentPlan(supabase, deleting.planId)
      setDeleting(null)
      setNotice(
        done.wasPublished
          ? `The ${done.ageGroup} plan has been deleted and every participating team has been told the schedule was withdrawn.`
          : `The ${done.ageGroup} draft has been deleted.`
      )
      await load()
    } catch (caught) {
      const failure = friendlyRefusal(caught, "this plan")
      logDetail("tournament plan delete", failure)
      setDeleting(null)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
      {/* WHICH COMPETITION IS BEING PLANNED. A tournament running U12 and U16 is two competitions with
          two plans, so the context is chosen before anything below it means anything. */}
      <CompetitionChooser ageGroups={detail.ageGroups} selected={grade} onSelect={setGrade} labelFor={(g) => `Plan ${g}`} />

      {/* WHERE THIS COMPETITION'S PLAN HAS GOT TO, and the controls that state allows. */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>Tournament Plan</Text>
          {!!summaries && <StatusPill label={card.pill} tone={card.kind === "published" ? "positive" : card.kind === "draft" ? "caution" : "neutral"} />}
        </View>
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
          <View style={{ width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
            <CalendarDays size={18} color={card.kind === "none" ? colour.inkMuted : colour.forest800} strokeWidth={1.9} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {/* The status line only where it says more than the pill does. */}
            {(!summaries || card.status.toLowerCase() !== card.pill.toLowerCase()) && (
              <Text style={[type.smallMedium, { color: colour.ink }]}>{summaries ? card.status : "Reading the plan…"}</Text>
            )}
            {!!summaries && <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>{card.body}</Text>}
            {!!summary?.firstDay && card.kind !== "none" && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {summary.firstDay === summary.lastDay ? shortDay(summary.firstDay) : `${shortDay(summary.firstDay)} to ${shortDay(summary.lastDay ?? summary.firstDay)}`}
              </Text>
            )}
          </View>
        </View>

        {!!card.attention && (
          <View accessibilityRole="alert" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.sm, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
            <TriangleAlert size={16} color={colour.warning} strokeWidth={2} />
            <Text style={[type.small, { flex: 1, color: colour.warning, lineHeight: 20 }]}>{card.attention}</Text>
          </View>
        )}

        {!!summaries && (
          <Button
            label={card.primary.label}
            disabled={!grade}
            accessibilityHint={grade ? `${card.primary.label} for the ${grade} competition` : undefined}
            icon={card.primary.intent === "view" ? <Eye size={17} color={colour.onForest} strokeWidth={2} /> : undefined}
            trailing={card.primary.intent === "view" ? undefined : <ChevronRight size={18} color={colour.onForest} strokeWidth={2.2} />}
            onPress={() => go(card.primary.intent)}
          />
        )}
        {card.secondary.map((c) => (
          <Button
            key={c.intent}
            label={c.label}
            variant="secondary"
            icon={c.intent === "edit" ? <Pencil size={16} color={colour.forest800} strokeWidth={2} /> : c.intent === "tables" ? <LayoutGrid size={16} color={colour.forest800} strokeWidth={2} /> : undefined}
            onPress={() => go(c.intent)}
          />
        ))}
        {!!card.remove && (
          <Button label={card.remove.label} variant="danger" icon={<Trash2 size={16} color={colour.danger} strokeWidth={2} />} onPress={() => go("delete")} />
        )}
      </Card>

      {/* THE CATEGORY ALREADY CHOSEN, and what it means in one sentence. */}
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>Tournament Category</Text>
          {!!onEditDetails && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit tournament details"
              hitSlop={10}
              onPress={onEditDetails}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Edit</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
          {/* THE FORMAT'S OWN ACCENT: a cup is marked in red and a league in forest. Only the mark
              changes colour; the card is the app's. */}
          <View style={{ width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: isKnockout ? KNOCKOUT_RED_SURFACE : colour.chalk, borderWidth: 1, borderColor: isKnockout ? KNOCKOUT_RED : colour.line }}>
            <Trophy size={18} color={isKnockout ? KNOCKOUT_RED : colour.forest800} strokeWidth={1.9} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{categoryName(detail.format)}</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>{categoryMeaning(detail.format)}</Text>
          </View>
        </View>
      </Card>

      {!!notice && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.forest800, lineHeight: 18 }]}>{notice}</Text>
      )}
      {!!problem && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>
      )}

      <DeletePlanSheet summary={deleting} busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />
    </ScrollView>
  )
}

/**
 * DELETE PLAN, SAID BEFORE IT IS DONE: what goes (the games, their times and pitches, the tables and
 * settings), what stays (the teams and the reserved pitches), who is told -- and, once any game has a
 * result, that it cannot be done, and why. Sporting history is never deleted as a planning step.
 */
function DeletePlanSheet({ summary, busy, onCancel, onConfirm }: { summary: PlanSummary | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const words = summary ? deletePlanSheet(summary) : null
  return (
    <Sheet visible={!!summary} onClose={onCancel} title={words?.title ?? ""}>
      {!!words && (
        <View style={{ gap: space.md }}>
          <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>{words.body}</Text>
          {words.confirm ? (
            <>
              <Button label={words.confirm} variant="danger" busy={busy} icon={<Trash2 size={16} color={colour.danger} strokeWidth={2} />} onPress={onConfirm} />
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </>
          ) : (
            <Button label="Close" variant="secondary" onPress={onCancel} />
          )}
        </View>
      )}
    </Sheet>
  )
}

/** The category in the product's own words. The tournament already holds it; this only names it. */
export function categoryName(format: string | null): string {
  switch (format) {
    case "round_robin": return "Round Robin"
    case "knockout": return "Knockout"
    case "swiss": return "Swiss"
    case "tri_fixture": return "Tri-Fixture"
    case "hybrid": return "Hybrid"
    default: return "Not set"
  }
}

/** One sentence saying what the category actually does, so an organiser need not already know. */
export function categoryMeaning(format: string | null): string {
  switch (format) {
    case "round_robin": return "Each team plays every other team in their table."
    case "knockout": return "Teams are drawn against each other and the winner goes through."
    case "swiss": return "Teams are paired each round against others on a similar record."
    case "tri_fixture": return "Three teams share a pitch, each playing the other two."
    case "hybrid": return "Group games first, then a knockout stage between the leaders."
    default: return "Choose a category on the tournament's details before planning."
  }
}
