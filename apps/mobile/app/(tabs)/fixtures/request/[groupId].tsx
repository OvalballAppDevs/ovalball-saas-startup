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
import { buildFixtureRequestGroupSummaries, fixtureRequestGroupStatusLabel, fixtureRequestStatusLabel, relativeTimeAgo, type FixtureRequestGroupSummary } from "@ovalball/contracts/team/request-groups"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { teamErrorMessage } from "@ovalball/contracts/club/teams"
import { readClubAuthority } from "@ovalball/contracts/club/overview"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { useTeamAuthority } from "../../../../src/team/authority"
import { ClubCrest } from "../../../../src/components/identity"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { Button, CardSkeleton, ErrorState, StatusPill } from "../../../../src/components/ui"
import { ChoiceField, DateField, Field, TextField, TimeField } from "../../../../src/components/form"
import { ChevronRight } from "../../../../src/components/icons"
import { narrowIntentForContext, routeForIntent } from "../../../../src/links/destinations"
import { exactDate, kickoffLabel } from "../../../../src/agenda/presentation"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * FIXTURE REQUEST DETAIL (owner correction pass, Sections 9-16): the negotiation surface for ONE
 * request group, read directly by `groupId` so it works from a My Requests card, from the Request Sent
 * confirmation, or from a future deep link alike. Accept, Suggest Changes, Decline and Withdraw are the
 * existing canonical mutations and nothing else -- this screen only assembles them around the real
 * group, never a second response mechanism.
 */
export default function FixtureRequestDetail() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const { active, club } = useAppContexts()
  const { session } = useSession()
  const teamAuth = useTeamAuthority()
  const [clubAuthority, setClubAuthority] = useState<{ requestRespond: boolean; requestCreate: boolean } | null>(null)
  useEffect(() => {
    const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
    if (!clubId) return
    void readClubAuthority(supabase, clubId).then(setClubAuthority)
  }, [active])
  // WHAT YOU MAY DO IS ASKED OF THE SERVER (never inferred from role name here): the same
  // fixture.request.respond/fixture.request.create probes the list screens already use, so a control
  // this screen offers is never one the server would refuse -- the permission-UI leak this codebase has
  // already been burned by once (request-row.tsx's own history).
  const canRespond = active?.kind === "club" ? (clubAuthority?.requestRespond ?? false) : teamAuth.authority.requestRespond
  const canCreate = active?.kind === "club" ? (clubAuthority?.requestCreate ?? false) : teamAuth.authority.requestCreate
  const [rows, setRows] = useState<FixtureRequestGroupRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [history, setHistory] = useState<FixtureRequestHistoryEntry[]>([])
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
      const entries = (await Promise.all(detail.map((r) => readFixtureRequestHistory(supabase, r.id)))).flat()
      setHistory(entries.sort((a, b) => b.changedAt.localeCompare(a.changedAt)))
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

  const latest = history[0]

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
    await declineFixtureRequest(supabase, requestId, session?.user.id ?? "")
    await load()
  }

  async function withdrawGroup(requestIds: string[]) {
    await Promise.all(requestIds.map((id) => withdrawFixtureRequest(supabase, id, session?.user.id ?? "")))
    await load()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Fixture Request
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
      >
        {problem && !group && <ErrorState message={problem} onRetry={load} />}
        {!problem && group === null && <CardSkeleton lines={4} />}

        {group && (
          <>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <ClubCrest clubName={club.name ?? (group.direction === "sent" ? "Us" : group.otherClub)} url={group.direction === "sent" ? club.crestUrl : group.otherClubCrestUrl} size={40} />
                <ChevronRight size={16} color={colour.inkSubtle} />
                <ClubCrest clubName={group.direction === "sent" ? group.otherClub : (club.name ?? "Us")} url={group.direction === "sent" ? group.otherClubCrestUrl : club.crestUrl} size={40} />
                <View style={{ flex: 1 }} />
                <StatusPill label={fixtureRequestGroupStatusLabel(group).label} tone={fixtureRequestGroupStatusLabel(group).tone} />
              </View>
              <View>
                <Text style={[type.smallMedium, { color: colour.ink, fontSize: 16 }]}>
                  {group.direction === "sent" ? (
                    <>
                      {club.name ?? "Us"} <Text style={{ color: colour.inkMuted }}>→</Text> {group.otherClub}
                    </>
                  ) : (
                    <>
                      {group.otherClub} <Text style={{ color: colour.inkMuted }}>→</Text> {club.name ?? "Us"}
                    </>
                  )}
                </Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>
                  {group.teamCount} {group.teamCount === 1 ? "team" : "teams"} requested
                  {group.proposedDate ? ` · ${exactDate(group.proposedDate)}` : group.hasMixedDates ? " · Dates vary by team" : " · Date to be agreed"}
                </Text>
              </View>
              {group.resultingFixtureIds.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {group.resultingFixtureIds.map((fixtureId) => (
                    <Button
                      key={fixtureId}
                      label="View Fixture"
                      variant="secondary"
                      onPress={() => {
                        // THE ONE ROUTING TABLE (never a hand-built fixture path): narrows to the
                        // participant address for a family-facing viewer, exactly like every other
                        // fixture destination in the app.
                        const route = routeForIntent(narrowIntentForContext({ kind: "FIXTURE", fixtureId }, active?.kind ?? null))
                        if (route) router.push(route as never)
                      }}
                    />
                  ))}
                </View>
              )}
            </View>

            {latest && (
              <View style={{ gap: space.xs }}>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>
                  Response from {latest.changedByClubName ?? "the other side"} · {relativeTimeAgo(latest.changedAt)}
                </Text>
                <View style={{ borderRadius: radius.md, backgroundColor: "rgba(50,166,101,0.08)", borderWidth: 1, borderColor: "rgba(50,166,101,0.2)", padding: space.md }}>
                  <Text style={[type.small, { color: colour.ink }]}>
                    {latest.statusAfter === "counter_proposed"
                      ? `Suggested ${latest.dateAfter ? exactDate(latest.dateAfter) : "a different date"}${latest.kickoffTimeAfter ? ` at ${kickoffLabel(latest.kickoffTimeAfter)}` : ""}`
                      : latest.statusAfter === "declined"
                        ? "Declined this request"
                        : latest.statusAfter === "accepted"
                          ? "Accepted this request"
                          : "Updated this request"}
                    {latest.noteAfter ? ` — "${latest.noteAfter}"` : ""}
                  </Text>
                </View>
              </View>
            )}

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Requested Teams
              </Text>
              {group.requests.map((r) => (
                <RequestTeamRow
                  key={r.id}
                  request={r}
                  canRespond={canRespond}
                  onAccept={() => setAsk(acceptAsk(r, acceptOne))}
                  onDecline={() => setAsk(declineAsk(r, declineOne))}
                  onSuggestChanges={() => setCounterFor(r)}
                />
              ))}
              {canRespond && group.requests.filter((r) => r.isMyTurn).length > 1 && (
                <Button
                  label="Accept All"
                  onPress={() =>
                    setAsk({
                      title: `Accept all ${group.requests.filter((r) => r.isMyTurn).length} requests?`,
                      body: "Every team below still waiting on your answer is accepted. Each becomes a fixture in both clubs' calendars.",
                      confirmLabel: "Accept All",
                      reason: "none",
                      onConfirm: () => acceptAll(group.requests.filter((r) => r.isMyTurn).map((r) => r.id)),
                    })
                  }
                />
              )}
            </View>

            {canCreate && group.canWithdraw && (
              <Button
                label={group.withdrawableRequestIds.length === group.requests.length ? "Withdraw Request" : "Withdraw Remaining"}
                variant="secondary"
                onPress={() =>
                  setAsk({
                    title: "Withdraw this request?",
                    body: `${group.otherClub} will no longer be able to accept it. This does not affect any team that has already answered.`,
                    confirmLabel: "Withdraw",
                    destructive: true,
                    reason: "none",
                    onConfirm: () => withdrawGroup(group.withdrawableRequestIds),
                  })
                }
              />
            )}
          </>
        )}
      </ScrollView>

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamErrorMessage(cause, "That could not be done.")} />
      {counterFor && <SuggestChangesSheet request={counterFor} onClose={() => setCounterFor(null)} onDone={load} />}
    </View>
  )
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

function RequestTeamRow({
  request,
  canRespond,
  onAccept,
  onDecline,
  onSuggestChanges,
}: {
  request: FixtureRequestGroupRow
  canRespond: boolean
  onAccept: () => void
  onDecline: () => void
  onSuggestChanges: () => void
}) {
  const status = fixtureRequestStatusLabel(request.status, request.isMyTurn)
  const date = request.counteredDate ?? request.proposedDate
  const time = request.counteredKickoffTime ?? request.preferredKickoffTime
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{request.ourTeam}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>vs {request.otherTeam ?? "Their team"}</Text>
        </View>
        <StatusPill label={status.label} tone={status.tone} />
      </View>
      <Text style={[type.small, { color: colour.ink }]}>
        {date ? exactDate(date) : "Date TBC"}
        {` · ${time ? kickoffLabel(time) : "Time TBC"}`}
        {` · ${ourSide(request)}`}
      </Text>
      {canRespond && request.isMyTurn && (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Button label="Accept" style={{ flex: 1 }} onPress={onAccept} />
          <Button label="Suggest Changes" variant="secondary" style={{ flex: 1 }} onPress={onSuggestChanges} />
          <Button label="Decline" variant="danger" style={{ flex: 1 }} onPress={onDecline} />
        </View>
      )}
    </View>
  )
}

/** CA-M11.5 "Suggest Another", scoped to exactly one child request -- the RPC's own boundary, mirrored
 * here so this is never offered as one action across a mixed multi-team group. */
function SuggestChangesSheet({ request, onClose, onDone }: { request: FixtureRequestGroupRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(request.counteredDate ?? request.proposedDate ?? new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState<string | null>(request.counteredKickoffTime ?? request.preferredKickoffTime)
  const [venue, setVenue] = useState<"Home" | "Away" | "TBD">(request.counteredVenuePreference === "home" ? "Home" : request.counteredVenuePreference === "away" ? "Away" : "TBD")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
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
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colour.surface,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        padding: space.lg,
        gap: space.md,
      }}
    >
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        Suggest Changes — {request.otherTeam ?? "Their team"}
      </Text>
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
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" variant="secondary" style={{ flex: 1 }} disabled={busy} onPress={onClose} />
        <Button label="Send Suggestion" style={{ flex: 1 }} busy={busy} onPress={send} />
      </View>
    </View>
  )
}
