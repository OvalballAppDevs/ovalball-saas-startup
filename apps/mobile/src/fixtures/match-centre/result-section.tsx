import { useCallback, useMemo, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"

import { fixtureResultMode, fixtureResultStatusLine, type FixtureResultMode } from "@ovalball/contracts"

import { supabase } from "../../auth/supabase"
import { useAppContexts } from "../../context/contexts"
import { invalidateAttention } from "../../attention/cache"
import { loadFixtureDetail, type FixtureDetail, type FixtureSide } from "../../agenda/fixture-detail"
import { loadFixtureAuthority } from "../../agenda/authority"
import { exactDate } from "../../agenda/presentation"
import { loadFixtureResult, type FixtureResultRead } from "../../fixtures/result-state"
import { ClubCrest } from "../../components/identity"
import { Button, CardSkeleton, ErrorState } from "../../components/ui"
import { ChevronRight, History } from "../../components/icons"
import { friendly, logDetail } from "../../errors/translate"
import { TOUCH_TARGET, colour, font, onForest, radius, space, type } from "../../design/tokens"

/**
 * MATCH RESULT -- THE EXISTING, PROVEN SECTION, LIFTED INTO MATCH CENTRE UNCHANGED.
 *
 * This is the Match Result screen's own code: the green score banner, the status chip, "Submitted by",
 * the respond-by deadline, the proposed change, and only the actions this viewer may take. It moved
 * from its own route into the Match Centre's Result section (owner brief, 2026-10-03: "the existing
 * Match Result component/lifecycle is canonical ... lifted into the consolidated Match Centre rather
 * than recreated"). Nothing about it was redesigned.
 *
 * ONE STATE MACHINE. Every button here calls `submit_fixture_result`, the same RPC the website's
 * fixture-thread result panel calls; confirming is submitting the same score, disputing is submitting
 * a different one. Which buttons appear is `fixtureResultMode` (packages/contracts), the shared rule,
 * and the server refuses anything the viewer may not do -- including any score before kick-off.
 *
 * WHAT IS ADDED: the result's own history (`fixture_result_submissions`), shown to the people whose RLS
 * returns it -- the result officers of either side -- and nobody else.
 */
export function MatchResultSection({ fixtureId, onChanged }: { fixtureId: string; onChanged?: () => void }) {
  const { sessionContext, active, contexts, refreshUnread } = useAppContexts()

  const [detail, setDetail] = useState<FixtureDetail | null>(null)
  const [result, setResult] = useState<FixtureResultRead | null>(null)
  const [canRecord, setCanRecord] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [form, setForm] = useState<{ home: string; away: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const myTeamIds = useMemo(
    () =>
      new Set([
        ...(sessionContext?.teamPermissions ?? []).map((t) => t.teamId),
        ...(sessionContext?.guardianRelationships ?? []).map((g) => g.teamId),
        ...(sessionContext?.linkedPlayerTeams ?? []).map((p) => p.teamId),
      ]),
    [sessionContext]
  )
  const myClubIds = useMemo(() => new Set(contexts.map((c) => c.clubId ?? (c.kind === "club" ? c.id : null)).filter((id): id is string => !!id)), [contexts])

  const load = useCallback(async () => {
    if (!fixtureId) return
    setProblem(null)
    try {
      const [loadedDetail, loadedResult, authority] = await Promise.all([
        loadFixtureDetail(supabase, fixtureId, myTeamIds),
        loadFixtureResult(supabase, fixtureId),
        loadFixtureAuthority(supabase, active),
      ])
      if (!loadedDetail || !loadedResult) {
        setProblem("This fixture is no longer available. It may have been removed.")
        return
      }
      setDetail(loadedDetail)
      setResult(loadedResult)
      setCanRecord(authority.recordResult)
      // THE RESULT'S HISTORY, under its own RLS: result officers of either side see it, nobody else.
      const { data: rows } = await supabase
        .from("fixture_result_submissions")
        .select("id, kind, home_score, away_score, submitted_by_club_id, note, created_at")
        .eq("fixture_id", fixtureId)
        .order("created_at", { ascending: true })
      setHistory((rows ?? []) as HistoryRow[])
    } catch (caught) {
      const failure = friendly(caught, "this result")
      logDetail("fixture result", failure)
      setProblem(failure.message)
    }
  }, [fixtureId, myTeamIds, active])

  // RE-READ ON EVERY ARRIVAL, not just the first mount: the router keeps this screen alive in its stack,
  // so a later notification tap lands on the same instance. It must show the result as it is now, and
  // never the notice left over from what this viewer did last time.
  useFocusEffect(
    useCallback(() => {
      setDone(null)
      setSaveError(null)
      setForm(null)
      void load()
    }, [load])
  )

  // HOME AND AWAY, from the viewer's own side. FixtureDetail is already flipped so `us` is the viewer's.
  const weAreHome = detail?.homeAway === "Home"
  const home: FixtureSide | null = detail ? (weAreHome ? detail.us : detail.them) : null
  const away: FixtureSide | null = detail ? (weAreHome ? detail.them : detail.us) : null

  const isParticipant = !!result && ((!!result.homeClubId && myClubIds.has(result.homeClubId)) || (!!result.awayClubId && myClubIds.has(result.awayClubId)))
  const mode: FixtureResultMode | null = result ? fixtureResultMode(result.state, { myClubIds, canRecord, isParticipant }) : null

  async function submit(homeScore: number, awayScore: number, confirmation: string) {
    if (!fixtureId) return
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.rpc("submit_fixture_result", { p_fixture_id: fixtureId, p_home_score: homeScore, p_away_score: awayScore })
    setSaving(false)
    if (error) {
      setSaveError(friendly(error, "this result").message)
      return
    }
    setForm(null)
    setDone(confirmation)
    // The job this screen exists for is now answered: the projection and the badge re-read from source.
    invalidateAttention()
    void refreshUnread()
    await load()
    onChanged?.()
  }

  function submitForm() {
    if (!form) return
    const h = Number(form.home)
    const a = Number(form.away)
    if (form.home === "" || form.away === "" || !Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      setSaveError("Enter both scores as whole numbers.")
      return
    }
    const s = result?.state
    const confirmation =
      mode === "confirm" || mode === "confirm_amendment"
        ? s && h === (mode === "confirm" ? s.homeScore : s.amendmentHomeScore) && a === (mode === "confirm" ? s.awayScore : s.amendmentAwayScore)
          ? "Result confirmed. It's now final."
          : "Contest sent. The other club has been told the score you believe."
        : mode === "final"
          ? "Change requested. The other club has been asked to agree it."
          : "Score submitted. The other club has been asked to confirm it."
    void submit(h, a, confirmation)
  }

  const state = result?.state
  // WHICH SIDE PUT THIS SCORE IN, named, so the viewer knows whose claim they are answering.
  const submittedBy =
    result && home && away && state?.submittedByClubId
      ? state.submittedByClubId === result.homeClubId
        ? home.clubName
        : state.submittedByClubId === result.awayClubId
          ? away.clubName
          : null
      : null
  const deadline = result?.deadlineAt && (state?.status === "awaiting_confirmation" || state?.status === "disputed") ? deadlineLabel(result.deadlineAt) : null

  return (
    <View style={{ gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!problem && (!detail || !result) && <CardSkeleton lines={5} />}

        {detail && result && state && home && away && mode && (
          <>
            {/* THE SCORE, as the submitted record has it -- home on the left, whichever side the viewer is. */}
            <View style={{ backgroundColor: colour.forest900, borderRadius: radius.xl, padding: space.lg, gap: space.md }}>
              <Text style={[type.caption, { color: onForest.secondary, textAlign: "center" }]}>
                {exactDate(detail.date)}
                {detail.kickoff ? ` · ${detail.kickoff.slice(0, 5)}` : ""}
                {detail.competitionName ? ` · ${detail.competitionName}` : ""}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                <Side side={home} />
                <View style={{ alignItems: "center", minWidth: 96 }}>
                  <Text accessibilityLabel={scoreLabel(home, away, state.homeScore, state.awayScore)} style={{ fontFamily: font.display, fontSize: 44, lineHeight: 48, color: colour.onForest, letterSpacing: 1 }}>
                    {state.homeScore ?? "–"} <Text style={{ color: onForest.secondary, fontSize: 28 }}>v</Text> {state.awayScore ?? "–"}
                  </Text>
                </View>
                <Side side={away} />
              </View>
              <View style={{ alignSelf: "center" }}>
                <StatusChip status={state.status} cancelled={state.cancelled} />
              </View>
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[type.body, { color: colour.ink }]}>{fixtureResultStatusLine(state, mode)}</Text>
              {!!submittedBy && state.status !== "none" && (
                <Text style={[type.smallMedium, { color: colour.ink }]}>Submitted by {submittedBy}</Text>
              )}
              {deadline && <Text style={[type.small, { color: colour.inkMuted }]}>{deadline}</Text>}
              {state.status === "amendment_pending" && state.amendmentHomeScore !== null && state.amendmentAwayScore !== null && (
                <Text style={[type.small, { color: colour.inkMuted }]}>
                  Proposed change: {home.clubName} {state.amendmentHomeScore}, {away.clubName} {state.amendmentAwayScore}.
                </Text>
              )}
              {state.resolvedBySiteAdmin && result.resolutionReason && (
                <Text style={[type.small, { color: colour.inkMuted }]}>Organiser's note: {result.resolutionReason}</Text>
              )}
            </View>

            {done && (
              <View accessibilityLiveRegion="polite" style={{ backgroundColor: colour.successSurface, borderRadius: radius.lg, padding: space.md }}>
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>{done}</Text>
              </View>
            )}

            {/* THE ACTIONS THIS VIEWER MAY TAKE, and nothing else. */}
            {!form && (
              <View style={{ gap: space.sm }}>
                {mode === "confirm" && state.homeScore !== null && state.awayScore !== null && (
                  <>
                    <Button label="Confirm Result" busy={saving} onPress={() => void submit(state.homeScore as number, state.awayScore as number, "Result confirmed. It's now final.")} />
                    <Button label="Contest Result" variant="secondary" onPress={() => setForm({ home: String(state.homeScore), away: String(state.awayScore) })} />
                  </>
                )}
                {mode === "confirm_amendment" && state.amendmentHomeScore !== null && state.amendmentAwayScore !== null && (
                  <>
                    <Button label="Confirm Change" busy={saving} onPress={() => void submit(state.amendmentHomeScore as number, state.amendmentAwayScore as number, "Change confirmed. The new score is final.")} />
                    <Button label="Contest Result" variant="secondary" onPress={() => setForm({ home: String(state.amendmentHomeScore), away: String(state.amendmentAwayScore) })} />
                  </>
                )}
                {mode === "awaiting_other_side" && <Button label="Revise Your Score" variant="secondary" onPress={() => setForm({ home: String(state.homeScore ?? ""), away: String(state.awayScore ?? "") })} />}
                {mode === "disputed" && <Button label="Submit Your Score" onPress={() => setForm({ home: "", away: "" })} />}
                {mode === "enter" && <Button label="Enter Result" onPress={() => setForm({ home: "", away: "" })} />}
                {mode === "final" && <Button label="Request Result Change" variant="secondary" onPress={() => setForm({ home: String(state.homeScore ?? ""), away: String(state.awayScore ?? "") })} />}
                {mode === "read_only" && isParticipant && !canRecord && state.status !== "final" && state.status !== "none" && (
                  <Text style={[type.small, { color: colour.inkMuted }]}>Results are confirmed by your club's result officers.</Text>
                )}
              </View>
            )}

            {form && (
              <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>
                  {mode === "confirm" || mode === "confirm_amendment" ? "THE SCORE YOU BELIEVE" : mode === "final" ? "THE CORRECTED SCORE" : "FINAL SCORE"}
                </Text>
                <ScoreField label={`${home.clubName} (home)`} value={form.home} onChange={(v) => setForm({ ...form, home: v })} />
                <ScoreField label={`${away.clubName} (away)`} value={form.away} onChange={(v) => setForm({ ...form, away: v })} />
                {saveError && <Text style={[type.small, { color: colour.danger }]}>{saveError}</Text>}
                <Button label={mode === "confirm" || mode === "confirm_amendment" ? "Send Contest" : mode === "final" ? "Request Change" : "Submit Score"} busy={saving} onPress={submitForm} />
                <Button label="Cancel" variant="quiet" onPress={() => { setForm(null); setSaveError(null) }} />
              </View>
            )}

            {!form && saveError && <Text style={[type.small, { color: colour.danger }]}>{saveError}</Text>}

            {history.length > 0 && (
              <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showHistory }}
                  accessibilityLabel={`Result history, ${history.length} ${history.length === 1 ? "entry" : "entries"}`}
                  onPress={() => setShowHistory((v) => !v)}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, opacity: pressed ? 0.7 : 1 })}
                >
                  <History size={17} color={colour.forest800} />
                  <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>Result History</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{history.length}</Text>
                  <View style={{ transform: [{ rotate: showHistory ? "90deg" : "0deg" }] }}>
                    <ChevronRight size={17} color={colour.inkSubtle} />
                  </View>
                </Pressable>
                {showHistory &&
                  history.map((h) => (
                    <View key={h.id} style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line, gap: 2 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>
                        {historyLabel(h.kind)}
                        {h.home_score !== null && h.away_score !== null ? ` · ${h.home_score}–${h.away_score}` : ""}
                      </Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>
                        {[h.submitted_by_club_id === result.homeClubId ? home.clubName : h.submitted_by_club_id === result.awayClubId ? away.clubName : null, historyWhen(h.created_at)].filter(Boolean).join(" · ")}
                      </Text>
                      {!!h.note && <Text style={[type.caption, { color: colour.inkMuted }]}>{h.note}</Text>}
                    </View>
                  ))}
              </View>
            )}
          </>
        )}
    </View>
  )
}

function Side({ side }: { side: FixtureSide }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: space.xs, minWidth: 0 }}>
      <ClubCrest clubName={side.clubName} url={side.crestUrl} size={52} />
      <Text numberOfLines={2} style={[type.smallMedium, { color: colour.onForest, textAlign: "center" }]}>
        {side.clubName}
      </Text>
      {!!side.teamName && (
        <Text numberOfLines={1} style={[type.caption, { color: onForest.secondary }]}>
          {side.teamName}
        </Text>
      )}
    </View>
  )
}

function StatusChip({ status, cancelled }: { status: string; cancelled: boolean }) {
  const label = cancelled
    ? "Cancelled"
    : status === "awaiting_confirmation"
      ? "Awaiting Confirmation"
      : status === "disputed"
        ? "Disputed"
        : status === "amendment_pending"
          ? "Change Proposed"
          : status === "final"
            ? "Final"
            : status === "external_recorded"
              ? "Recorded"
              : status === "unverified"
                ? "Unverified"
                : "No Result Yet"
  const tone = status === "disputed" ? "rgba(248,113,113,0.22)" : status === "final" || status === "external_recorded" ? "rgba(90,203,131,0.22)" : "rgba(251,191,36,0.20)"
  return (
    <View style={{ backgroundColor: tone, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 }}>
      <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{label}</Text>
    </View>
  )
}

function ScoreField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} score`}
        value={value}
        onChangeText={(next) => onChange(next.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="0"
        placeholderTextColor={colour.inkSubtle}
        style={[type.title, { minHeight: TOUCH_TARGET + 8, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlign: "center" }]}
      />
    </View>
  )
}

function scoreLabel(home: FixtureSide, away: FixtureSide, homeScore: number | null, awayScore: number | null): string {
  if (homeScore === null || awayScore === null) return `${home.clubName} versus ${away.clubName}, no score yet`
  return `${home.clubName} ${homeScore}, ${away.clubName} ${awayScore}`
}

function deadlineLabel(iso: string): string {
  const at = new Date(iso)
  const ms = at.getTime() - Date.now()
  const when = at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  if (ms <= 0) return `The confirmation window closed ${when}.`
  const hours = Math.round(ms / 3_600_000)
  return `Respond by ${when} (${hours <= 1 ? "under an hour" : `${hours} hours`} left).`
}

interface HistoryRow {
  id: string
  kind: string
  home_score: number | null
  away_score: number | null
  submitted_by_club_id: string | null
  note: string | null
  created_at: string
}

function historyLabel(kind: string): string {
  switch (kind) {
    case "initial":
      return "Score submitted"
    case "confirmation":
      return "Confirmed"
    case "dispute":
      return "Contested"
    case "amendment_proposal":
      return "Change proposed"
    case "amendment_confirmation":
      return "Change confirmed"
    case "amendment_dispute":
      return "Change contested"
    case "site_admin_resolution":
      return "Resolved by Ovalball"
    case "external_recorded":
      return "Recorded"
    case "auto_finalized":
      return "Final -- no reply before the deadline"
    case "auto_unverified":
      return "Left unverified -- the dispute was not settled in time"
    default:
      return "Updated"
  }
}

function historyWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}
