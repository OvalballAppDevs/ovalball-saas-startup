import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { canSelect, longMatchDate, newClientMessageId, sendClubDay, teamDayState, weekCommencingLabel, type PlannerTeam, type SendItem, type TeamDayState } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { TextSheet } from "../../../../src/components/field-sheet"
import { CalendarDays, CircleAlert, CircleCheck, MessageSquare, Send, ShieldCheck } from "../../../../src/components/icons"
import { Button, ErrorState, Skeleton } from "../../../../src/components/ui"
import { useSeasonPlanner, type PendingSend } from "../../../../src/season-planner/state"
import { plannerProblem, useClubDay } from "../../../../src/season-planner/data"
import { ForestSteps, OpponentCard, PlannerCard, SectionLabel, TeamIcon, VenuePill } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * REVIEW & SEND. Re-reads the day from the server -- a fixture accepted elsewhere a minute ago shows here -- and the
 * send re-checks again on the server, so nothing rests on a stale screen. The counts on this screen and on the
 * result are the server's per-team answers, never the number that was asked for.
 */
export default function ReviewClubDay() {
  const router = useRouter()
  const planner = useSeasonPlanner()
  const draft = planner.draft
  const isReturn = draft?.mode === "return"
  const opponent = draft?.opponent ?? null
  const date = draft?.matchDate ?? null
  const clubDay = useClubDay(planner.clubId, opponent?.clubId ?? null, date)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<PlannerTeam | null>(null)

  const evaluated = useMemo(() => {
    if (!draft || !clubDay.day || !opponent?.clubId || !date) return null
    const byTeam = new Map(clubDay.day.teams.map((t) => [t.teamId, t]))
    const ready: { team: PlannerTeam; item: SendItem; side: string }[] = []
    const attention: { team: PlannerTeam | null; teamId: string; reason: string }[] = []
    for (const [teamId, sel] of Object.entries(draft.selections)) {
      const team = byTeam.get(teamId)
      if (!team) {
        attention.push({ team: null, teamId, reason: "This team is no longer active." })
        continue
      }
      const state = teamDayState(team, date, opponent.clubId)
      const side = team.compatible.find((c) => c.teamId === sel.targetTeamId)
      if (!side) attention.push({ team, teamId, reason: `${opponent.name} no longer have the team it was paired with.` })
      else if (!canSelect(state)) attention.push({ team, teamId, reason: stateReason(state, opponent.name) })
      else if (state.kind === "pending_elsewhere" && !sel.acknowledge) attention.push({ team, teamId, reason: `Already has a pending request with ${state.commitment.opponent ?? "another club"} that day.` })
      else ready.push({ team, side: side.displayName, item: { requestingTeamId: teamId, targetTeamId: sel.targetTeamId, venue: sel.venue, acknowledgePending: sel.acknowledge, note: sel.note ?? null } })
    }
    // A return club day is the first day's pairings reversed: a team that was never part of it is not "left out" of it.
    const notIncluded = draft.mode === "return" ? [] : clubDay.day.teams.filter((t) => !draft.selections[t.teamId] && t.compatible.length === 0)
    return { ready, attention, notIncluded, acknowledged: ready.filter((r) => r.item.acknowledgePending) }
  }, [draft, clubDay.day, opponent, date])

  async function deliver(pending: PendingSend) {
    setSending(true)
    setProblem(null)
    const result = await sendClubDay(supabase, {
      clubId: draft!.clubId,
      opponentClubId: pending.opponent.clubId as string,
      date: pending.date,
      batchId: pending.batchId,
      items: pending.items,
      reverseOfGroupId: pending.mode === "return" ? pending.reverseOfGroupId : null,
    })
    setSending(false)
    if (!result.ok) {
      // The batch is kept: checking again replays this batch rather than sending a second set.
      setProblem(plannerProblem(result.message, result.code))
      return
    }
    const leg = { opponent: pending.opponent, date: pending.date, groupId: result.groupId, items: pending.items, results: result.results, mode: pending.mode, leftOut: pending.leftOut }
    planner.update({
      lastSent: leg,
      firstLeg: pending.mode === "first" ? leg : draft!.firstLeg,
      batchId: newClientMessageId(),
      selections: {},
      pendingSend: null,
    })
    router.replace("/fixtures/planner/sent")
  }

  async function send() {
    if (!draft || !evaluated || !opponent?.clubId || !date || sending || evaluated.ready.length === 0) return
    const pending: PendingSend = {
      batchId: draft.batchId,
      opponent,
      date,
      items: evaluated.ready.map((r) => r.item),
      mode: draft.mode,
      reverseOfGroupId: draft.reverseOfGroupId,
      leftOut: evaluated.attention.map((a) => ({ teamName: a.team?.displayName ?? "A team", reason: a.reason })),
    }
    // Recorded BEFORE the call: if its answer never arrives, Review can still ask the server what happened.
    planner.update({ pendingSend: pending })
    await deliver(pending)
  }

  if (!draft || !opponent || !date) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Review & Send" onBack={() => router.back()} />
      </View>
    )
  }

  const count = evaluated?.ready.length ?? 0
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={isReturn ? "Return Club Day" : "Review & Send"} onBack={() => router.back()} />
      <ForestSteps labels={isReturn ? ["Reverse", "Return Date", "Review", "Send"] : ["Opponent", "Teams", "Review", "Send"]} current={2} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        <PlannerCard padded={false}>
          <View style={{ padding: space.md }}>
            <OpponentCard opponent={opponent} onEdit={isReturn ? undefined : () => router.back()} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: 1, borderTopColor: colour.line }}>
            <CalendarDays size={22} color={colour.forest800} strokeWidth={1.8} />
            <View>
              <Text style={[type.heading, { color: colour.ink }]}>{longMatchDate(date)}</Text>
              {!!draft.weekStart && <Text style={[type.small, { color: colour.inkMuted }]}>{weekCommencingLabel(draft.weekStart)}</Text>}
            </View>
          </View>
        </PlannerCard>

        {draft.pendingSend && draft.pendingSend.date === date && draft.pendingSend.opponent.clubId === opponent.clubId && (
          <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.warningSurface }}>
            <Text style={[type.bodyMedium, { color: colour.ink }]}>Your last send may not have finished</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              The connection dropped before Ovalball answered. Check what was sent -- nothing is sent twice.
            </Text>
            <Button variant="secondary" label="Check What Was Sent" busy={sending} disabled={sending} onPress={() => draft.pendingSend && void deliver(draft.pendingSend)} />
          </View>
        )}
        {clubDay.problem && <ErrorState message={clubDay.problem} onRetry={() => void clubDay.reload()} />}
        {!evaluated && !clubDay.problem && <Skeleton height={200} />}

        {evaluated && (
          <>
            <View style={{ gap: space.md }}>
              <SectionLabel title={`Fixture Requests (${count})`} />
              {count === 0 ? (
                <Text style={[type.small, { color: colour.inkMuted }]}>No team can be sent on this date. Choose another week, or go back and change the teams.</Text>
              ) : (
                <PlannerCard padded={false}>
                  {evaluated.ready.map(({ team, item, side }, i) => (
                    <View key={team.teamId} style={{ padding: space.md, gap: space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                      <View accessible accessibilityLabel={`${team.displayName} against ${side}, ${item.venue === "home" ? "Home" : "Away"}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                        <TeamIcon />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.bodyMedium, { color: colour.ink }]}>{team.displayName}</Text>
                          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>v {opponent.name}{team.compatible.length > 1 ? ` · ${side}` : ""}</Text>
                        </View>
                        <VenuePill venue={item.venue} />
                      </View>
                      {!!item.note && <Text style={[type.small, { color: colour.ink, paddingLeft: 36 + space.md }]}>“{item.note}”</Text>}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.note ? "Edit" : "Add"} a note on ${team.displayName}`}
                        onPress={() => setNoteFor(team)}
                        hitSlop={6}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: TOUCH_TARGET - 8, marginLeft: 36 + space.md }}
                      >
                        <MessageSquare size={15} color={colour.forest800} />
                        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{item.note ? "Edit Note" : "Add Note"}</Text>
                      </Pressable>
                    </View>
                  ))}
                </PlannerCard>
              )}
            </View>

            <View style={{ gap: space.md }}>
              <SectionLabel title="Checks and Warnings" />
              {evaluated.attention.length === 0 && evaluated.acknowledged.length === 0 && count > 0 && (
                <CheckCard tone="positive" title="No known clash on this date" body="None of the selected teams has a fixture, a pending request or a competition match on Ovalball that day." />
              )}
              {evaluated.acknowledged.map(({ team }) => (
                <CheckCard key={team.teamId} tone="warning" title={`${team.displayName} also has a pending request that day`} body="You chose to include it. Only one of the two can be accepted." />
              ))}
              {evaluated.attention.map(({ team, teamId, reason }) => (
                <CheckCard
                  key={teamId}
                  tone="warning"
                  title={`${team?.displayName ?? "A team"} can't be sent on this date`}
                  body={reason}
                  action={{
                    label: "Leave Out",
                    onPress: () => {
                      const next = { ...draft.selections }
                      delete next[teamId]
                      planner.update({ selections: next })
                    },
                  }}
                  secondAction={isReturn ? { label: "Choose Another Date", onPress: () => router.back() } : undefined}
                />
              ))}
              {evaluated.notIncluded.map((team) => (
                <CheckCard
                  key={team.teamId}
                  tone="neutral"
                  title={`${team.displayName} not included`}
                  body={`${opponent.name} don't currently have a matching team registered on Ovalball.`}
                  action={{
                    label: "Find Another Club",
                    onPress: () =>
                      router.push({
                        pathname: "/clubhouse/find-fixture/matching",
                        params: { criteria: JSON.stringify({ teamIds: [team.teamId], teamRugbyCode: null, dates: [date], venuePreference: "either", distance: "any" }), teamLabels: JSON.stringify([team.displayName]) },
                      } as never),
                  }}
                />
              ))}
            </View>
          </>
        )}

        {problem && <ErrorState message={problem} onRetry={() => (draft.pendingSend ? void deliver(draft.pendingSend) : void send())} />}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <Button
          variant="brand"
          label={sending ? "Sending…" : `Send ${count} Fixture ${count === 1 ? "Request" : "Requests"}`}
          busy={sending}
          disabled={count === 0 || sending}
          icon={<Send size={18} color={colour.onForest} />}
          onPress={() => void send()}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <ShieldCheck size={16} color={colour.inkMuted} />
          <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>
            {opponent.name} accept, decline or suggest another date for each fixture.
          </Text>
        </View>
      </View>

      <TextSheet
        visible={noteFor !== null}
        title={noteFor ? `Note on ${noteFor.displayName}` : "Note"}
        hint={`${opponent.name} see it on this fixture only.`}
        placeholder="For example: could this kick off at 10:30?"
        value={(noteFor && draft.selections[noteFor.teamId]?.note) || ""}
        multiline
        onClose={() => setNoteFor(null)}
        onSave={(text) => {
          const sel = noteFor ? draft.selections[noteFor.teamId] : null
          if (noteFor && sel) planner.update({ selections: { ...draft.selections, [noteFor.teamId]: { ...sel, note: text.trim() || null } } })
          setNoteFor(null)
        }}
        saving={false}
        problem={null}
      />
    </View>
  )
}

function stateReason(state: TeamDayState, opponentName: string): string {
  if ("commitment" in state) {
    const c = state.commitment
    if (state.kind === "playing") return `Already playing ${c.opponent ?? "another fixture"} that day.`
    if (state.kind === "competition") return "Has a competition match that day."
    if (state.kind === "already_with_opponent") return `A request to ${opponentName} for this day is already open.`
    if (state.kind === "incoming_from_opponent") return `${opponentName} have already asked to play this team that day -- reply to their request.`
  }
  if (state.kind === "no_match") return `${opponentName} don't currently have a matching team.`
  return "This team can't be sent on this date."
}

function CheckCard({
  tone,
  title,
  body,
  action,
  secondAction,
}: {
  tone: "positive" | "warning" | "neutral"
  title: string
  body: string
  action?: { label: string; onPress: () => void }
  secondAction?: { label: string; onPress: () => void }
}) {
  const ground = tone === "positive" ? colour.successSurface : tone === "warning" ? colour.warningSurface : colour.surface
  return (
    <View style={{ flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: ground, borderWidth: 1, borderColor: colour.line }}>
      {tone === "positive" ? <CircleCheck size={22} color={colour.rugby700} /> : <CircleAlert size={22} color={tone === "warning" ? colour.warning : colour.inkMuted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{body}</Text>
        <View style={{ flexDirection: "row", gap: space.lg }}>
          {[action, secondAction].filter(Boolean).map((a) => (
            <Pressable key={a!.label} accessibilityRole="button" onPress={a!.onPress} hitSlop={6} style={{ minHeight: TOUCH_TARGET - 8, justifyContent: "center" }}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{a!.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  )
}
