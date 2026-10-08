import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import {
  clubDayState,
  clubDaySummaryWords,
  clubLogoUrlFromPath,
  CLUB_DAY_STATE_LABEL,
  longMatchDate,
  noteClubDayFixture,
  respondClubDay,
  shortMatchDate,
  venueForSide,
  type ClubDayDetail,
  type ClubDayFixture,
  type ClubDaySummary,
  type RespondOutcome,
} from "@ovalball/contracts"

import { supabase } from "../../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../../src/components/app-header"
import { BottomSheet } from "../../../../../src/components/bottom-sheet"
import { TextSheet } from "../../../../../src/components/field-sheet"
import { ClubCrest } from "../../../../../src/components/identity"
import { CalendarSync, ChevronRight, CircleAlert, CircleCheck, CircleX, Clock, FileText, MessageSquare, Pencil, Trophy } from "../../../../../src/components/icons"
import { Button, EmptyState, ErrorState, Skeleton } from "../../../../../src/components/ui"
import { ButtonRow, Note } from "../../../../../src/people/ui"
import { useOriginBack, withReturnTo } from "../../../../../src/links/origin"
import { useSeasonPlanner } from "../../../../../src/season-planner/state"
import { plannerProblem, useClubDayDetail, usePlannerSeasons } from "../../../../../src/season-planner/data"
import { ClubPairBand, OnForestCount, OnForestPill, PlannerCard, SheetList, STATE_COLOUR } from "../../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../../../../src/design/tokens"
import { routeForIntent } from "../../../../../src/links/destinations"

/**
 * ONE CLUB DAY -- one club-to-club proposal, as either club sees it.
 *
 * Underneath, each fixture is its own canonical request with its own state; this screen never hides those behind a
 * made-up batch status. The receiving club can answer everything still open at once, or each fixture on its own
 * (with a note on that fixture), and suggest another date through the canonical request. The planning club watches
 * the same day fill in, opens any fixture or request, and plans the return from here.
 */
export default function ClubDayScreen() {
  const router = useRouter()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const back = useOriginBack("/fixtures/planner")
  const { detail, problem, missing, reload } = useClubDayDetail(groupId ?? null)
  const planner = useSeasonPlanner()
  const seasons = usePlannerSeasons(planner.clubId)
  const seasonName = detail ? (seasons?.find((x) => (x.preSeasonStartsOn ?? x.startsOn) <= detail.date && x.endsOn >= detail.date)?.name ?? null) : null
  const [confirm, setConfirm] = useState<"accept" | "decline" | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ words: string; tone: "positive" | "warning" } | null>(null)
  const [actionProblem, setActionProblem] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<ClubDayFixture | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)

  const summary: ClubDaySummary | null = useMemo(() => {
    if (!detail) return null
    const f = detail.fixtures
    return {
      total: f.length,
      accepted: f.filter((x) => x.status === "accepted").length,
      declined: f.filter((x) => x.status === "declined").length,
      pending: f.filter((x) => x.status === "sent").length,
      countered: f.filter((x) => x.status === "counter_proposed").length,
      withdrawn: f.filter((x) => x.status === "cancelled" || x.status === "expired").length,
    }
  }, [detail])

  const received = detail?.side === "received"
  const open = (detail?.fixtures ?? []).filter((f) => f.status === "sent")
  const title = received ? "Club Day Request" : "Club Day"

  async function answer(action: "accept" | "decline", requestIds: string[] | null) {
    if (!detail || busy) return
    setBusy(requestIds?.[0] ?? `all-${action}`)
    setActionProblem(null)
    setOutcome(null)
    // What this screen offered to answer: a bulk answer is reported for these fixtures, so one answered earlier (or a
    // suggested date left for its own answer) is not counted as if it had just been part of "Accept All".
    const offered = new Set(requestIds ?? open.map((f) => f.requestId))
    const result = await respondClubDay(supabase, { groupId: detail.groupId, action, requestIds })
    setBusy(null)
    setConfirm(null)
    if (!result.ok) {
      setActionProblem(plannerProblem(result.message, result.code))
      await reload()
      return
    }
    const answered = result.results.filter((r) => offered.has(r.requestId))
    const outcomes = answered.map((r) => r.outcome)
    const surprising = outcomes.some((o) => o !== "accepted" && o !== "declined")
    // One fixture answered as asked needs no banner: its card already says so. A bulk answer, or one that did not go
    // as asked, is reported in full -- the server's own per-fixture outcomes, never the number that was asked for.
    if (requestIds === null || surprising) setOutcome({ words: outcomeWords(outcomes, answered.find((r) => r.outcome === "failed")?.reason ?? null), tone: outcomes.includes("failed") ? "warning" : "positive" })
    await reload()
  }

  async function saveNote(text: string) {
    if (!noteFor) return
    setNoteSaving(true)
    const result = await noteClubDayFixture(supabase, noteFor.requestId, text)
    setNoteSaving(false)
    if (!result.ok) {
      setActionProblem(result.message)
      return
    }
    setNoteFor(null)
    await reload()
  }

  // Each fixture opens as ITSELF: the confirmed fixture's Match Centre, or this one request (never the whole group's).
  function openFixture(f: ClubDayFixture) {
    if (!detail) return
    const here = `/fixtures/planner/club-day/${detail.groupId}`
    if (f.resultingFixtureId) { const route = routeForIntent({ kind: "FIXTURE", fixtureId: f.resultingFixtureId }); if (route) router.push(withReturnTo(route, here) as never) }
    else router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: detail.groupId, requestId: f.requestId, returnTo: here } } as never)
  }

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Club Day" onBack={back} />
        <View style={{ padding: space.lg }}>
          <EmptyState title="This club day isn't available" body="It may have been withdrawn, or it is not one of your club's club days." />
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={title} onBack={back} />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        {detail ? <Hero detail={detail} summary={summary as ClubDaySummary} seasonName={seasonName} /> : <View style={{ backgroundColor: surface.forest, padding: space.lg }}><Skeleton height={140} /></View>}

        <View style={{ padding: space.lg, gap: space.lg }}>
          {problem && <ErrorState message={problem} onRetry={() => void reload()} />}
          {actionProblem && <ErrorState message={actionProblem} />}
          {outcome && <Note tone={outcome.tone}>{outcome.words}</Note>}

          {detail?.fixtures.map((f) => (
            <FixtureCard
              key={f.requestId}
              fixture={f}
              detail={detail}
              busy={busy === f.requestId}
              disabled={busy !== null}
              onAccept={() => void answer("accept", [f.requestId])}
              onDecline={() => void answer("decline", [f.requestId])}
              onNote={() => setNoteFor(f)}
              onOpen={() => openFixture(f)}
            />
          ))}

          {detail && !received && (
            <PlannerCard>
              <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
                  <CalendarSync size={20} color={colour.forest800} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{detail.returnGroupIds.length ? "Return club day planned" : detail.reverseOfGroupId ? "This is a return club day" : "No return club day currently planned"}</Text>
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    {detail.returnGroupIds.length ? "Open it to see how it stands." : detail.reverseOfGroupId ? "It returns an earlier club day with this club." : `Home and Away reversed, against ${detail.opponentClub.name}.`}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: space.md }}>
                {detail.returnGroupIds.length ? (
                  <Button variant="secondary" label="View Return Club Day" onPress={() => router.push({ pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: detail.returnGroupIds[0], returnTo: `/fixtures/planner/club-day/${detail.groupId}` } } as never)} />
                ) : detail.reverseOfGroupId ? (
                  <Button variant="secondary" label="View First Club Day" onPress={() => router.push({ pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: detail.reverseOfGroupId as string, returnTo: `/fixtures/planner/club-day/${detail.groupId}` } } as never)} />
                ) : (
                  <Button variant="brand" label="Plan Return Club Day" onPress={() => router.push({ pathname: "/fixtures/planner/return", params: { groupId: detail.groupId } } as never)} />
                )}
              </View>
            </PlannerCard>
          )}
        </View>
      </ScrollView>

      {received && open.length > 0 && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.xs, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
          {!!detail && open.length < detail.fixtures.length && (
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
              Applies to the {open.length === 1 ? "one fixture" : `${open.length} fixtures`} still awaiting your decision.
            </Text>
          )}
          <ButtonRow weights={[1, 2]}>
            <Button variant="quiet" label="Decline All" disabled={busy !== null} onPress={() => setConfirm("decline")} />
            <Button variant="brand" label={`Accept All (${open.length})`} busy={busy === "all-accept"} disabled={busy !== null} onPress={() => setConfirm("accept")} />
          </ButtonRow>
        </View>
      )}

      <BottomSheet visible={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "accept" ? `Accept ${open.length} ${open.length === 1 ? "Fixture" : "Fixtures"}?` : `Decline ${open.length} ${open.length === 1 ? "Fixture" : "Fixtures"}?`}>
        <View style={{ gap: space.md }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {confirm === "accept"
              ? "Each one becomes a confirmed fixture in both clubs' calendars. Fixtures you have already answered, or that have another date suggested, are left as they are."
              : `${detail?.requestingClub.name ?? "The other club"} will be told once. Fixtures you have already answered are left as they are.`}
          </Text>
          <SheetList>
            {open.map((f) => (
              <View key={f.requestId} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                <Text style={[type.bodyMedium, { color: colour.ink, flex: 1 }]}>{f.targetTeam ?? f.requestingTeam}</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>{venueForSide(f.venue, "received")}</Text>
              </View>
            ))}
          </SheetList>
          <Button
            variant={confirm === "decline" ? "danger" : "brand"}
            label={confirm === "accept" ? `Accept ${open.length} ${open.length === 1 ? "Fixture" : "Fixtures"}` : `Decline ${open.length} ${open.length === 1 ? "Fixture" : "Fixtures"}`}
            busy={busy !== null}
            onPress={() => confirm && void answer(confirm, null)}
          />
        </View>
      </BottomSheet>

      <TextSheet
        visible={noteFor !== null}
        title={noteFor ? `Note on ${received ? (noteFor.targetTeam ?? noteFor.requestingTeam) : noteFor.requestingTeam}` : "Note"}
        hint={received ? `${detail?.requestingClub.name ?? "The other club"} see it on this fixture.` : `${detail?.opponentClub.name ?? "The other club"} see it on this fixture.`}
        placeholder="For example: could this kick off at 10:30?"
        value={(received ? noteFor?.responseNote : noteFor?.note) ?? ""}
        multiline
        onClose={() => setNoteFor(null)}
        onSave={(text) => void saveNote(text)}
        saving={noteSaving}
        problem={null}
      />
    </View>
  )
}

function outcomeWords(outcomes: RespondOutcome[], firstFailure: string | null): string {
  const n = (o: RespondOutcome) => outcomes.filter((x) => x === o).length
  return (
    [
      n("accepted") ? `${n("accepted")} accepted` : null,
      n("declined") ? `${n("declined")} declined` : null,
      n("already_resolved") ? `${n("already_resolved")} already answered` : null,
      n("not_actionable") ? `${n("not_actionable")} left to answer one by one` : null,
      n("failed") ? `${n("failed")} could not be answered${firstFailure ? `: ${firstFailure}` : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing needed answering."
  )
}

/** The two clubs, crest to crest, on the forest -- the club day's identity, its date, whose it is and how it stands. */
function Hero({ detail, summary, seasonName }: { detail: ClubDayDetail; summary: ClubDaySummary; seasonName: string | null }) {
  const awaiting = summary.pending + summary.countered
  const state = clubDayState(summary)
  const received = detail.side === "received"
  const perspective = received ? `Received from ${detail.requestingClub.name}` : `Sent to ${detail.opponentClub.name}`
  const what = `${detail.reverseOfGroupId ? "Return club day" : "Club day"} · ${summary.total} ${summary.total === 1 ? "fixture" : "fixtures"}${seasonName ? ` · ${seasonName}` : ""}`
  return (
    <ClubPairBand
      left={{ name: detail.requestingClub.name, crestUrl: clubLogoUrlFromPath(supabase, detail.requestingClub.logoPath) }}
      right={{ name: detail.opponentClub.name, crestUrl: clubLogoUrlFromPath(supabase, detail.opponentClub.logoPath) }}
      headline={longMatchDate(detail.date).replace(/ \d{4}$/, "")}
      lines={[perspective, what]}
    >
      <OnForestPill label={`${CLUB_DAY_STATE_LABEL[state]}. ${clubDaySummaryWords(summary)}`}>
        {/* Only what is true of this club day: an empty "0 declined" is noise. While anything is open, "awaiting" stays. */}
        {summary.accepted > 0 && <OnForestCount dot={colour.pitch400} text={`${summary.accepted} confirmed`} />}
        {awaiting > 0 && <OnForestCount dot={STATE_COLOUR.pending.dot} text={`${awaiting} awaiting`} />}
        {summary.declined > 0 && <OnForestCount dot={STATE_COLOUR.declined.dot} text={`${summary.declined} declined`} />}
        {summary.accepted + summary.declined + awaiting === 0 && <OnForestCount dot={STATE_COLOUR.unfilled.dot} text="Withdrawn" />}
      </OnForestPill>
    </ClubPairBand>
  )
}

function FixtureCard({
  fixture: f,
  detail,
  busy,
  disabled,
  onAccept,
  onDecline,
  onNote,
  onOpen,
}: {
  fixture: ClubDayFixture
  detail: ClubDayDetail
  busy: boolean
  disabled: boolean
  onAccept: () => void
  onDecline: () => void
  onNote: () => void
  onOpen: () => void
}) {
  const received = detail.side === "received"
  const planningHome = f.venue === "home"
  const homeClub = planningHome ? detail.requestingClub.name : detail.opponentClub.name
  const awayClub = planningHome ? detail.opponentClub.name : detail.requestingClub.name
  const homeTeam = planningHome ? f.requestingTeam : (f.targetTeam ?? "")
  const awayTeam = planningHome ? (f.targetTeam ?? "") : f.requestingTeam
  const myTeam = received ? (f.targetTeam ?? f.requestingTeam) : f.requestingTeam
  const status = fixtureStatus(f, received)
  const canAnswer = received && f.status === "sent"
  const awaitingAnswer = canAnswer

  return (
    <View
      style={{
        borderRadius: radius.lg,
        backgroundColor: colour.surface,
        borderWidth: awaitingAnswer ? 2 : 1,
        borderColor: awaitingAnswer ? colour.pitch600 : colour.line,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${myTeam}. ${homeClub} at home to ${awayClub}. ${status.label}. Opens the ${f.resultingFixtureId ? "fixture" : "request"}`}
        onPress={onOpen}
        style={({ pressed }) => ({ padding: space.md, gap: space.md, backgroundColor: pressed ? colour.chalk : colour.surface })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.heading, { color: colour.ink, flex: 1 }]} numberOfLines={2}>
            {myTeam}
          </Text>
          <ChevronRight size={18} color={colour.inkSubtle} />
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <SideBox club={homeClub} team={homeTeam} word="Home" strong />
          <SideBox club={awayClub} team={awayTeam} word="Away" />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
          {!!f.kickoff && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Clock size={14} color={colour.inkMuted} />
              <Text style={[type.small, { color: colour.inkMuted }]}>{f.kickoff.slice(0, 5)}</Text>
            </View>
          )}
          {f.date !== detail.date && <Text style={[type.small, { color: colour.warning }]}>Suggested: {shortMatchDate(f.date)}</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {status.icon}
            <Text style={[type.smallMedium, { color: status.colour }]}>{status.label}</Text>
          </View>
        </View>
        {!!f.note && <NoteLine from={detail.requestingClub.name} text={f.note} />}
        {!!f.responseNote && <NoteLine from={detail.opponentClub.name} text={f.responseNote} />}
        {!!f.counterNote && <NoteLine from={f.counteredByRequester ? detail.requestingClub.name : detail.opponentClub.name} text={f.counterNote} />}
      </Pressable>

      <View style={{ borderTopWidth: 1, borderTopColor: colour.line, padding: space.md, gap: space.sm }}>
        {canAnswer && (
          <ButtonRow>
            <Button variant="secondary" label="Decline" disabled={disabled} onPress={onDecline} />
            <Button variant="brand" label="Accept" busy={busy} disabled={disabled} onPress={onAccept} />
          </ButtonRow>
        )}
        {/* ONE next step per fixture, named for what it opens: the confirmed fixture, or this fixture's own request. */}
        <View style={{ flexDirection: "row", columnGap: space.lg, flexWrap: "wrap" }}>
          {f.resultingFixtureId ? (
            <LinkButton icon={<Trophy size={15} color={colour.forest800} />} label="View Fixture" onPress={onOpen} />
          ) : f.status === "counter_proposed" ? (
            <LinkButton icon={<Pencil size={15} color={colour.forest800} />} label="Review New Date" onPress={onOpen} />
          ) : canAnswer ? (
            <LinkButton icon={<Pencil size={15} color={colour.forest800} />} label="Suggest Change" onPress={onOpen} />
          ) : (
            <LinkButton icon={<FileText size={15} color={colour.forest800} />} label="View Request" onPress={onOpen} />
          )}
          {(f.status === "sent" || f.status === "counter_proposed") && (
            <LinkButton icon={<MessageSquare size={15} color={colour.forest800} />} label={(received ? f.responseNote : f.note) ? "Edit Note" : "Add Note"} onPress={onNote} />
          )}
        </View>
      </View>
    </View>
  )
}

function SideBox({ club, team, word, strong = false }: { club: string; team: string; word: "Home" | "Away"; strong?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0, padding: space.sm, borderRadius: radius.md, backgroundColor: strong ? colour.mint100 : colour.chalk, gap: 2 }}>
      <Text style={[type.overline, { color: strong ? colour.rugby700 : colour.inkMuted }]}>{word.toUpperCase()}</Text>
      <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
        {club}
      </Text>
      {!!team && (
        <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted }]}>
          {team}
        </Text>
      )}
    </View>
  )
}

function NoteLine({ from, text }: { from: string; text: string }) {
  return (
    <View style={{ padding: space.sm, borderRadius: radius.md, backgroundColor: colour.chalk, borderLeftWidth: 3, borderLeftColor: colour.pitch600, gap: 2 }}>
      <Text style={[type.caption, { color: colour.inkMuted }]}>Note from {from}</Text>
      <Text style={[type.small, { color: colour.ink }]}>“{text}”</Text>
    </View>
  )
}

function LinkButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH_TARGET - 8 }}>
      {icon}
      <Text style={[type.smallMedium, { color: colour.forest800 }]}>{label}</Text>
    </Pressable>
  )
}

function fixtureStatus(f: ClubDayFixture, received: boolean): { label: string; colour: string; icon: React.ReactNode } {
  switch (f.status) {
    case "accepted":
      return { label: "Accepted", colour: colour.rugby700, icon: <CircleCheck size={16} color={colour.rugby700} /> }
    case "declined":
      return { label: "Declined", colour: colour.danger, icon: <CircleX size={16} color={colour.danger} /> }
    case "counter_proposed":
      return {
        label: (received ? !f.counteredByRequester : f.counteredByRequester) ? "New date suggested · awaiting reply" : "New date suggested · your decision",
        colour: colour.warning,
        icon: <CircleAlert size={16} color={colour.warning} />,
      }
    case "cancelled":
    case "expired":
      return { label: f.status === "cancelled" ? "Withdrawn" : "Expired", colour: colour.inkMuted, icon: <CircleX size={16} color={colour.inkMuted} /> }
    default:
      return received
        ? { label: "Awaiting your decision", colour: colour.warning, icon: <CircleAlert size={16} color={colour.warning} /> }
        : { label: "Awaiting reply", colour: colour.warning, icon: <Clock size={16} color={colour.warning} /> }
  }
}
