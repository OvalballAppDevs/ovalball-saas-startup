import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  acceptFixtureRequest,
  counterFixtureRequest,
  declineFixtureRequest,
  readFixtureRequestGroupDetail,
  readFixtureRequestHistory,
  withdrawFixtureRequest,
  type FixtureRequestGroupRow,
  type FixtureRequestHistoryEntry,
} from "@ovalball/contracts/team/requests"
import { buildFixtureRequestGroupSummaries, fixtureRequestGroupStatusLabel, relativeTimeAgo, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { teamErrorMessage } from "@ovalball/contracts/club/teams"
import { readClubAuthority } from "@ovalball/contracts/club/overview"
import { longMatchDate } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { useTeamAuthority } from "../../../../src/team/authority"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { BottomSheet } from "../../../../src/components/bottom-sheet"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { ChoiceField, DateField, Field, TextField, TimeField } from "../../../../src/components/form"
import { CalendarDays, CircleAlert, CircleCheck, CircleX, Clock, Pencil, Trophy } from "../../../../src/components/icons"
import { ButtonRow } from "../../../../src/people/ui"
import { useOriginBack } from "../../../../src/links/origin"
import { routeForIntent } from "../../../../src/links/destinations"
import { exactDate, kickoffLabel } from "../../../../src/agenda/presentation"
import { ClubPairBand, OnForestCount, OnForestPill, STATE_COLOUR } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../../../../src/design/tokens"

/**
 * FIXTURE REQUEST -- the negotiation surface for a request group, or (with `requestId`) for ONE request inside it, as a
 * Club Day opens each of its fixtures. Accept, Suggest Changes, Decline and Withdraw are the existing canonical
 * mutations and nothing else.
 *
 * Every request speaks for itself: its own state, its own notes and its own latest answer, read from ITS history --
 * never the newest answer anywhere in the group shown as though it were this one's. A confirmed request offers its one
 * fixture; nothing is offered twice.
 */
export default function FixtureRequestDetail() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Back to the inbox, planner or Club Day this request was opened from, not the Fixtures list beneath it.
  const back = useOriginBack("/fixtures")
  const params = useLocalSearchParams<{ groupId: string; requestId?: string; returnTo?: string }>()
  const groupId = params.groupId
  const focusId = params.requestId || null
  const { active, club } = useAppContexts()
  const teamAuth = useTeamAuthority()
  const [clubAuthority, setClubAuthority] = useState<{ requestRespond: boolean; requestCreate: boolean } | null>(null)
  useEffect(() => {
    const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
    if (!clubId) return
    void readClubAuthority(supabase, clubId).then(setClubAuthority)
  }, [active])
  // WHAT YOU MAY DO IS ASKED OF THE SERVER (never inferred from role name here): the same
  // fixture.request.respond/fixture.request.create probes the list screens already use, so a control
  // this screen offers is never one the server would refuse.
  const canRespond = active?.kind === "club" ? (clubAuthority?.requestRespond ?? false) : teamAuth.authority.requestRespond
  const canCreate = active?.kind === "club" ? (clubAuthority?.requestCreate ?? false) : teamAuth.authority.requestCreate
  const [rows, setRows] = useState<FixtureRequestGroupRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, FixtureRequestHistoryEntry[]>>({})
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [counterFor, setCounterFor] = useState<FixtureRequestGroupRow | null>(null)

  const load = useCallback(async () => {
    if (!groupId || !active) return
    setProblem(null)
    try {
      const viewerTeams =
        active.kind === "team" && active.id
          ? [{ id: active.id, name: active.label }]
          : active.kind === "club" && (active.clubId ?? active.id)
            ? (await readClubTeams(supabase, (active.clubId ?? active.id) as string)).teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.displayName }))
            : []
      const detail = await readFixtureRequestGroupDetail(supabase, groupId, viewerTeams)
      setRows(detail)
      // Each request's own history, kept with its request.
      const each = await Promise.all(detail.map((r) => readFixtureRequestHistory(supabase, r.id)))
      setHistory(Object.fromEntries(detail.map((r, i) => [r.id, each[i] ?? []])))
    } catch (caught) {
      setProblem(teamErrorMessage(caught, "Couldn't load this request."))
    }
  }, [groupId, active])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const group: FixtureRequestGroupSummary<FixtureRequestGroupRow> | null = useMemo(() => {
    if (!rows || rows.length === 0) return null
    return buildFixtureRequestGroupSummaries(rows)[0] ?? null
  }, [rows])

  const focused = group && focusId ? (group.requests.find((r) => r.id === focusId) ?? null) : null
  // A link to ONE request whose request is not here (withdrawn, out of this viewer's reach, a stale link) says so --
  // never quietly shows the whole group and its actions instead (M7).
  const focusMissing = !!focusId && rows !== null && !focused
  const shown = focusMissing ? [] : focused ? [focused] : (group?.requests ?? [])
  const isClubDay = !!group && group.requests.some((r) => r.groupSource === "season_planner")
  const openedFromClubDay = typeof params.returnTo === "string" && params.returnTo.includes("/club-day/")

  async function acceptOne(requestId: string) {
    await acceptFixtureRequest(supabase, requestId)
    await load()
  }

  async function acceptAll(requestIds: string[]) {
    const results = await Promise.allSettled(requestIds.map((id) => acceptFixtureRequest(supabase, id)))
    await load()
    const failed = results.filter((r) => r.status === "rejected").length
    if (failed > 0) throw new Error(failed === requestIds.length ? "None of those could be accepted." : `${requestIds.length - failed} of ${requestIds.length} accepted -- the rest could not be.`)
  }

  async function declineOne(requestId: string) {
    await declineFixtureRequest(supabase, requestId)
    await load()
  }

  async function withdraw(requestIds: string[]) {
    await Promise.all(requestIds.map((id) => withdrawFixtureRequest(supabase, id)))
    await load()
  }

  // The requesting club on the left, always -- whichever side is reading.
  const ours = { name: club.name ?? "Your club", crestUrl: club.crestUrl ?? null }
  const theirs = group ? { name: group.otherClub, crestUrl: group.otherClubCrestUrl ?? null } : null
  const sent = group?.direction === "sent"
  const lead = focused ?? group?.requests[0] ?? null
  const leadDate = focused ? (focused.counteredDate ?? focused.proposedDate) : (group?.proposedDate ?? null)
  const status = focused ? requestState(focused) : group ? groupState(group) : null
  const withdrawable = focusMissing ? [] : focused ? (group?.withdrawableRequestIds.includes(focused.id) ? [focused.id] : []) : (group?.withdrawableRequestIds ?? [])
  const myTurn = shown.filter((r) => r.isMyTurn)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={focusId || (group && group.requests.length === 1) ? "Fixture Request" : "Fixture Requests"} onBack={back} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
      >
        {focusMissing ? (
          <View style={{ padding: space.lg }}>
            <EmptyState title="This fixture request isn't available" body="It may have been withdrawn, or it is not one your team or club can see. Go back to see where things stand." />
          </View>
        ) : group && theirs && lead && status ? (
          <ClubPairBand
            left={sent ? ours : theirs}
            right={sent ? theirs : ours}
            headline={leadDate ? longMatchDate(leadDate).replace(/ \d{4}$/, "") : group.hasMixedDates ? "Dates vary by team" : "Date to be agreed"}
            lines={[
              focused ? `${focused.ourTeam} v ${focused.otherTeam ?? "their team"}` : `${group.teamCount} ${group.teamCount === 1 ? "team" : "teams"} ${sent ? "requested" : "asked for"}`,
              isClubDay ? (focused ? "One fixture of a Club Day" : "Club Day") : sent ? `Sent to ${group.otherClub}` : `Received from ${group.otherClub}`,
            ]}
          >
            <OnForestPill label={status.label}>
              <OnForestCount dot={status.dot} text={status.label} />
            </OnForestPill>
          </ClubPairBand>
        ) : (
          <View style={{ backgroundColor: surface.forest, padding: space.lg }}>{!problem && <CardSkeleton lines={3} />}</View>
        )}

        <View style={{ padding: space.lg, gap: space.lg }}>
          {problem && !group && <ErrorState message={problem} onRetry={load} />}

          {isClubDay && focused && !openedFromClubDay && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Part of a Club Day with ${group?.otherClub}. View Club Day`}
              onPress={() => router.push({ pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: focused.groupId, returnTo: `/fixtures/request/${focused.groupId}` } } as never)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: TOUCH_TARGET + 8, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
            >
              <CalendarDays size={20} color={colour.forest800} />
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>Part of a Club Day with {group?.otherClub}</Text>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>View Club Day</Text>
            </Pressable>
          )}

          {shown.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              history={history[r.id] ?? []}
              ourClub={ours.name}
              canRespond={canRespond}
              showTeamTitle={!focused}
              onAccept={() => setAsk(acceptAsk(r, acceptOne))}
              onDecline={() => setAsk(declineAsk(r, declineOne))}
              onSuggestChanges={() => setCounterFor(r)}
              onViewFixture={(fixtureId) => {
                // THE ONE ROUTING TABLE: the fixture's one Match Centre, like every other fixture destination.
                const route = routeForIntent({ kind: "FIXTURE", fixtureId })
                if (route) router.push(route as never)
              }}
            />
          ))}

          {!focused && canRespond && myTurn.length > 1 && (
            <Button
              variant="brand"
              label={`Accept All (${myTurn.length})`}
              onPress={() =>
                setAsk({
                  title: `Accept all ${myTurn.length} requests?`,
                  body: "Every team still waiting on your answer is accepted. Each becomes a fixture in both clubs' calendars.",
                  confirmLabel: "Accept All",
                  reason: "none",
                  onConfirm: () => acceptAll(myTurn.map((r) => r.id)),
                })
              }
            />
          )}

          {canCreate && withdrawable.length > 0 && (
            <Button
              label={focused || withdrawable.length === (group?.requests.length ?? 0) ? "Withdraw Request" : "Withdraw Remaining"}
              variant="quiet"
              onPress={() =>
                setAsk({
                  title: focused ? "Withdraw this request?" : "Withdraw these requests?",
                  body: `${group?.otherClub ?? "The other club"} will no longer be able to accept ${focused || withdrawable.length === 1 ? "it" : "them"}. Nothing already answered changes.`,
                  confirmLabel: "Withdraw",
                  destructive: true,
                  reason: "none",
                  onConfirm: () => withdraw(withdrawable),
                })
              }
            />
          )}
        </View>
      </ScrollView>

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamErrorMessage(cause, "That could not be done.")} />
      <SuggestChangesSheet request={counterFor} onClose={() => setCounterFor(null)} onDone={load} />
    </View>
  )
}

/** One request's state, as words and a dot. Whose turn it is decides the words -- never colour alone. */
function requestState(r: FixtureRequestGroupRow): { label: string; dot: string } {
  switch (r.status) {
    case "accepted":
      return { label: "Confirmed", dot: colour.pitch400 }
    case "declined":
      return { label: "Declined", dot: STATE_COLOUR.declined.dot }
    case "counter_proposed":
      return { label: r.isMyTurn ? "New date suggested · your decision" : "New date suggested · awaiting reply", dot: STATE_COLOUR.pending.dot }
    case "cancelled":
      return { label: "Withdrawn", dot: STATE_COLOUR.unfilled.dot }
    case "expired":
      return { label: "Expired", dot: STATE_COLOUR.unfilled.dot }
    case "sent":
      return { label: r.isMyTurn ? "Awaiting your decision" : "Awaiting reply", dot: STATE_COLOUR.pending.dot }
    default:
      return { label: "Draft", dot: STATE_COLOUR.unfilled.dot }
  }
}

function groupState(g: FixtureRequestGroupSummary<FixtureRequestGroupRow>): { label: string; dot: string } {
  const label = fixtureRequestGroupStatusLabel(g)
  const dot = label.tone === "positive" ? colour.pitch400 : label.tone === "negative" ? STATE_COLOUR.declined.dot : label.tone === "caution" ? STATE_COLOUR.pending.dot : STATE_COLOUR.unfilled.dot
  return { label: label.label, dot }
}

/**
 * THE LATEST ANSWER ON THIS REQUEST, from its own history: the newest change after it was made. Changes made in one
 * transaction share a timestamp, so a status change outranks a note-only change made at the same moment.
 */
function latestAnswer(entries: FixtureRequestHistoryEntry[]): FixtureRequestHistoryEntry | null {
  const answers = entries.filter((e) => e.statusBefore !== null && (e.statusAfter !== e.statusBefore || e.noteAfter))
  if (answers.length === 0) return null
  return [...answers].sort((a, b) => b.changedAt.localeCompare(a.changedAt) || Number(b.statusAfter !== b.statusBefore) - Number(a.statusAfter !== a.statusBefore))[0] ?? null
}

function answerWords(e: FixtureRequestHistoryEntry): string {
  if (e.statusAfter !== e.statusBefore) {
    if (e.statusAfter === "accepted") return "accepted"
    if (e.statusAfter === "declined") return "declined"
    if (e.statusAfter === "cancelled") return "withdrew the request"
    if (e.statusAfter === "counter_proposed") return `suggested ${e.dateAfter ? exactDate(e.dateAfter) : "another date"}${e.kickoffTimeAfter ? ` at ${kickoffLabel(e.kickoffTimeAfter)}` : ""}`
  }
  return "added a note"
}

function acceptAsk(request: FixtureRequestGroupRow, onAccept: (id: string) => Promise<void>): ReasonAsk {
  const date = request.counteredDate ?? request.proposedDate
  const time = request.counteredKickoffTime ?? request.preferredKickoffTime
  return {
    title: `Accept ${request.otherClub}'s request?`,
    body: `${request.otherTeam ?? "Their team"} · ${date ? exactDate(date) : "Date to be agreed"}${time ? ` at ${kickoffLabel(time)}` : ""}. The match goes into both clubs' calendars.`,
    confirmLabel: "Accept",
    reason: "none",
    onConfirm: () => onAccept(request.id),
  }
}

function declineAsk(request: FixtureRequestGroupRow, onDecline: (id: string) => Promise<void>): ReasonAsk {
  return {
    title: `Decline ${request.otherClub}'s request?`,
    body: `${request.otherTeam ?? "Their team"} is told the answer is no.`,
    confirmLabel: "Decline",
    destructive: true,
    reason: "none",
    onConfirm: () => onDecline(request.id),
  }
}

/** HOME/AWAY/EITHER, SAID FROM OUR SIDE -- venue_preference is the sender's truth ("away" means the
 * sender travels), so a request we received reads it the other way round; the stored value never
 * changes, only the words (mirrors the website's own `sideForReader`). */
function ourSide(request: FixtureRequestGroupRow): string {
  const raw = request.counteredVenuePreference ?? request.venuePreference
  if (!raw) return "Either"
  const mine = request.direction === "outgoing" ? raw : raw === "home" ? "away" : raw === "away" ? "home" : raw
  return mine === "home" ? "Home" : mine === "away" ? "Away" : "Either"
}


function RequestCard({
  request: r,
  history,
  ourClub,
  canRespond,
  showTeamTitle,
  onAccept,
  onDecline,
  onSuggestChanges,
  onViewFixture,
}: {
  request: FixtureRequestGroupRow
  history: FixtureRequestHistoryEntry[]
  ourClub: string
  canRespond: boolean
  showTeamTitle: boolean
  onAccept: () => void
  onDecline: () => void
  onSuggestChanges: () => void
  onViewFixture: (fixtureId: string) => void
}) {
  const state = requestState(r)
  const date = r.counteredDate ?? r.proposedDate
  const time = r.counteredKickoffTime ?? r.preferredKickoffTime
  const side = ourSide(r)
  const requestingClub = r.direction === "outgoing" ? ourClub : r.otherClub
  const answeringClub = r.direction === "outgoing" ? r.otherClub : ourClub
  const answer = latestAnswer(history)
  const answerNote = answer?.noteAfter ?? null
  const icon =
    r.status === "accepted" ? <CircleCheck size={16} color={colour.rugby700} /> : r.status === "declined" ? <CircleX size={16} color={colour.danger} /> : r.status === "cancelled" || r.status === "expired" ? <CircleX size={16} color={colour.inkMuted} /> : r.isMyTurn ? <CircleAlert size={16} color={colour.warning} /> : <Clock size={16} color={colour.warning} />
  const tone = r.status === "accepted" ? colour.rugby700 : r.status === "declined" ? colour.danger : r.status === "cancelled" || r.status === "expired" ? colour.inkMuted : colour.warning

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: r.isMyTurn ? 2 : 1, borderColor: r.isMyTurn ? colour.pitch600 : colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      <View style={{ padding: space.md, gap: space.md }}>
        {showTeamTitle && (
          <Text accessibilityRole="header" numberOfLines={2} style={[type.heading, { color: colour.ink }]}>
            {r.ourTeam}
          </Text>
        )}
        {side === "Either" ? (
          <SideBox club={`${ourClub} v ${r.otherClub}`} team={`${r.ourTeam} v ${r.otherTeam ?? "their team"}`} word="Venue to be agreed" />
        ) : (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <SideBox club={side === "Home" ? ourClub : r.otherClub} team={side === "Home" ? r.ourTeam : (r.otherTeam ?? "")} word="Home" strong />
            <SideBox club={side === "Home" ? r.otherClub : ourClub} team={side === "Home" ? (r.otherTeam ?? "") : r.ourTeam} word="Away" />
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: space.md, rowGap: 4 }}>
          <Text style={[type.small, { color: colour.ink }]}>
            {date ? exactDate(date) : "Date to be agreed"} · {time ? kickoffLabel(time) : "Kick-off to be agreed"}
          </Text>
          {/* One request shown on its own already states this in the band above; a group shows it per team. */}
          {showTeamTitle && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {icon}
              <Text style={[type.smallMedium, { color: tone }]}>{state.label}</Text>
            </View>
          )}
        </View>

        {!!r.note && <NoteLine from={requestingClub} text={r.note} />}
        {answer && (
          <View accessible style={{ gap: 2 }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {(answer.changedByClubName ?? answeringClub)} {answerWords(answer)} · {relativeTimeAgo(answer.changedAt)}
            </Text>
            {!!answerNote && <NoteLine from={answer.changedByClubName ?? answeringClub} text={answerNote} />}
          </View>
        )}
        {!!r.responseNote && r.responseNote !== answerNote && <NoteLine from={answeringClub} text={r.responseNote} />}
      </View>

      {((canRespond && r.isMyTurn) || r.resultingFixtureId) && (
        <View style={{ borderTopWidth: 1, borderTopColor: colour.line, padding: space.md, gap: space.sm }}>
          {canRespond && r.isMyTurn && (
            <>
              <ButtonRow>
                <Button variant="secondary" label="Decline" onPress={onDecline} />
                <Button variant="brand" label="Accept" onPress={onAccept} />
              </ButtonRow>
              <Pressable accessibilityRole="button" onPress={onSuggestChanges} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: TOUCH_TARGET - 4 }}>
                <Pencil size={15} color={colour.forest800} />
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>Suggest Changes</Text>
              </Pressable>
            </>
          )}
          {!!r.resultingFixtureId && <Button variant="secondary" label="View Fixture" icon={<Trophy size={17} color={colour.forest800} />} onPress={() => onViewFixture(r.resultingFixtureId as string)} />}
        </View>
      )}
    </View>
  )
}

function SideBox({ club, team, word, strong = false }: { club: string; team: string; word: string; strong?: boolean }) {
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

/** CA-M11.5 "Suggest Another", scoped to exactly one child request -- the RPC's own boundary, mirrored
 * here so this is never offered as one action across a mixed multi-team group. */
function SuggestChangesSheet({ request, onClose, onDone }: { request: FixtureRequestGroupRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState<string | null>(null)
  const [venue, setVenue] = useState<"Home" | "Away" | "TBD">("TBD")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!request) return
    setDate(request.counteredDate ?? request.proposedDate ?? new Date().toISOString().slice(0, 10))
    setTime(request.counteredKickoffTime ?? request.preferredKickoffTime)
    setVenue(request.counteredVenuePreference === "home" ? "Home" : request.counteredVenuePreference === "away" ? "Away" : "TBD")
    setNote("")
    setError(null)
  }, [request])

  async function send() {
    if (!request) return
    setBusy(true)
    setError(null)
    try {
      await counterFixtureRequest(supabase, {
        requestId: request.id,
        date,
        kickoffTime: time,
        venuePreference: venue === "Home" ? "home" : venue === "Away" ? "away" : "either",
        note,
        expectedUpdatedAt: request.updatedAt,
      })
      await onDone()
      onClose()
    } catch (caught) {
      setError(teamErrorMessage(caught, "Couldn't send that suggestion. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={request !== null} onClose={onClose} title={`Suggest Changes · ${request?.otherTeam ?? "Their team"}`}>
      <Field label="Date">
        <DateField label="Suggested date" value={date} onChange={setDate} />
      </Field>
      <Field label="Kick-Off">
        <TimeField label="Suggested kick-off" value={time} onChange={setTime} />
      </Field>
      <Field label="Venue">
        <ChoiceField
          label="Suggested venue"
          value={venue}
          onChange={setVenue}
          options={[
            { value: "Home", label: "Our ground" },
            { value: "Away", label: "Theirs" },
            { value: "TBD", label: "Either" },
          ]}
        />
      </Field>
      <Field label="Note" hint="Optional.">
        <TextField label="Note" value={note} onChange={setNote} />
      </Field>
      {error && <Text style={[type.caption, { color: colour.danger }]}>{error}</Text>}
      <Button variant="brand" label="Send Suggestion" busy={busy} onPress={send} />
    </BottomSheet>
  )
}
