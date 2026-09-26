import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  acceptFixtureRequest,
  counterFixtureRequest,
  declineFixtureRequest,
  readFixtureRequestHistory,
  readTeamFixtureRequests,
  type FixtureRequestHistoryEntry,
  type TeamFixtureRequest,
} from "@ovalball/contracts/team/requests"
import { teamErrorMessage } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useTeamAuthority } from "../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../src/team/screen"
import { ReasonSheet, type ReasonAsk } from "../../../src/admin/reason-sheet"
import { exactDate, kickoffLabel } from "../../../src/agenda/presentation"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { ChoiceField, DateField, Field, TextField, TimeField } from "../../../src/components/form"
import { ChevronRight, Plus } from "../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * FIXTURE REQUESTS -- what other clubs have asked this team, and what it has asked them (CA-M7).
 *
 * A request RECEIVED and still `sent` is waiting on this team; a request SENT is waiting on somebody
 * else. Accepting is `accept_fixture_request`, which re-checks `fixture.request.respond` for the
 * responding side and creates the same match in both clubs' calendars; declining is the status update
 * the `fixture_requests_update_scoped` policy already admits. A Coach, who may raise a request but not
 * answer one, sees the incoming list without the two buttons.
 *
 * NOTHING HERE OPENS A CHANNEL TO THE OTHER CLUB. A request is a fixture-request record; the
 * conversation it may carry is the canonical request thread, reached from Messages, and the recipient
 * rules there are the server's.
 */
const STATUS_LABEL: Record<TeamFixtureRequest["status"], { label: string; tone: "positive" | "caution" | "neutral" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Waiting for an answer", tone: "caution" },
  accepted: { label: "Accepted", tone: "positive" },
  declined: { label: "Declined", tone: "neutral" },
  counter_proposed: { label: "Change proposed", tone: "caution" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
}

export default function TeamFixtureRequests() {
  const router = useRouter()
  const { session } = useSession()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [data, setData] = useState<{ incoming: TeamFixtureRequest[]; outgoing: TeamFixtureRequest[] } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setData(await readTeamFixtureRequests(supabase, teamId))
    } catch (caught) {
      setProblem(teamErrorMessage(caught, "Couldn't load fixture requests. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setData(null)
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

  // CA-M11.5: once a counter-proposal flips the standing offer, "waiting for your answer" and "waiting
  // for them" are about whose TURN it is, not which side originally sent the request -- isMyTurn is the
  // same responder logic counter_fixture_request/accept_fixture_request compute server-side.
  const all = [...(data?.incoming ?? []), ...(data?.outgoing ?? [])]
  const openRequests = all.filter((r) => r.status === "sent" || r.status === "counter_proposed")
  const waiting = openRequests.filter((r) => r.isMyTurn)
  const sent = openRequests.filter((r) => !r.isMyTurn)
  const settled = all
    .filter((r) => r.status !== "sent" && r.status !== "counter_proposed" && r.status !== "draft")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 10)

  return (
    <TeamScreen section="Fixture Requests" refreshing={refreshing} onRefresh={refresh}>
      {authority.requestCreate && (
        <Button label="Request a Fixture" onPress={() => router.push({ pathname: "/fixtures/new", params: { teamId: teamId ?? "" } } as never)} />
      )}
      {!authorityLoading && !authority.requestRespond && !authority.requestCreate && (
        <NotForYou title="Fixture requests are not part of your job here" body="Asking other clubs for a match, and answering them, is done by the people the club has given that job to." />
      )}
      {problem && !data && <ErrorState message={problem} onRetry={load} />}
      {!problem && data === null && <CardSkeleton lines={3} />}

      {data && (
        <>
          <Section title="Waiting for Your Answer" count={waiting.length}>
            {waiting.length === 0 ? (
              <EmptyState title="Nothing waiting" body="When another club asks this team for a match, it appears here." />
            ) : (
              waiting.map((r) => (
                <RequestCard key={r.id} request={r} onThread={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)}>
                  {authority.requestRespond && (
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Button
                        label="Accept"
                        style={{ flex: 1 }}
                        onPress={() =>
                          setAsk({
                            title: `Accept ${r.otherClub}'s request?`,
                            body: `${(r.counteredDate ?? r.proposedDate) ? exactDate(r.counteredDate ?? r.proposedDate!) : "The proposed date"}${(r.counteredKickoffTime ?? r.preferredKickoffTime) ? ` at ${kickoffLabel(r.counteredKickoffTime ?? r.preferredKickoffTime!)}` : ""}. The match goes into both clubs' calendars.`,
                            confirmLabel: "Accept",
                            reason: "none",
                            onConfirm: async () => {
                              await acceptFixtureRequest(supabase, r.id)
                              await load()
                            },
                          })
                        }
                      />
                      <Button
                        label="Decline"
                        variant="secondary"
                        style={{ flex: 1 }}
                        onPress={() =>
                          setAsk({
                            title: `Decline ${r.otherClub}'s request?`,
                            body: "They are told the answer is no. You can still message them from the request thread.",
                            confirmLabel: "Decline",
                            destructive: true,
                            reason: "none",
                            onConfirm: async () => {
                              await declineFixtureRequest(supabase, r.id, session?.user.id ?? "")
                              await load()
                            },
                          })
                        }
                      />
                    </View>
                  )}
                  {authority.requestRespond && r.canNegotiate && <NegotiationControls request={r} onDone={load} />}
                </RequestCard>
              ))
            )}
          </Section>

          <Section title="Waiting for Them" count={sent.length}>
            {sent.length === 0 ? (
              <EmptyState title="Nothing sent" body={authority.requestCreate ? "Ask another club for a match and it will be listed here until they answer." : "Requests this team has sent appear here."} icon={authority.requestCreate ? <Plus size={20} color={colour.inkSubtle} /> : undefined} />
            ) : (
              sent.map((r) => (
                <RequestCard key={r.id} request={r} onThread={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)}>
                  {authority.requestCreate && r.status === "sent" && (
                    <Button
                      label="Withdraw"
                      variant="quiet"
                      onPress={() =>
                        setAsk({
                          title: "Withdraw this request?",
                          body: `${r.otherClub} will no longer be able to accept it.`,
                          confirmLabel: "Withdraw",
                          destructive: true,
                          reason: "none",
                          onConfirm: async () => {
                            await withdraw(r.id, session?.user.id ?? "")
                            await load()
                          },
                        })
                      }
                    />
                  )}
                </RequestCard>
              ))
            )}
          </Section>

          {settled.length > 0 && (
            <Section title="Recently Settled" count={settled.length}>
              {settled.map((r) => (
                <RequestCard key={r.id} request={r} onThread={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)} />
              ))}
            </Section>
          )}
        </>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamErrorMessage(cause, "That could not be done.")} />
    </TeamScreen>
  )
}

/** Withdrawing our own request: the same policy-covered status update, from the requesting side. */
async function withdraw(requestId: string, userId: string): Promise<void> {
  const { data, error } = await supabase.from("fixture_requests").update({ status: "cancelled", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", requestId).eq("status", "sent").select("id")
  if (error) throw error
  if (!data || data.length === 0) throw Object.assign(new Error("You can't withdraw this request."), { code: "42501" })
}

/**
 * CA-M11.5 -- "Suggest Another" + negotiation history, mobile. Shown only when it is genuinely this
 * team's turn to respond (r.canNegotiate && parent gates on authority.requestRespond); the RPC itself
 * re-checks both, this is only about not offering a control that would just come back as an error.
 */
function NegotiationControls({ request, onDone }: { request: TeamFixtureRequest; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(request.counteredDate ?? request.proposedDate ?? new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState<string | null>(request.counteredKickoffTime ?? request.preferredKickoffTime)
  const [venue, setVenue] = useState<"Home" | "Away" | "TBD">(request.counteredVenuePreference === "home" ? "Home" : request.counteredVenuePreference === "away" ? "Away" : "TBD")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<FixtureRequestHistoryEntry[] | null>(null)

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
      setOpen(false)
      await onDone()
    } catch (caught) {
      setError(teamErrorMessage(caught, "Couldn't send that suggestion. Try again."))
    } finally {
      setBusy(false)
    }
  }

  async function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && history === null) {
      try {
        setHistory(await readFixtureRequestHistory(supabase, request.id))
      } catch (caught) {
        setError(teamErrorMessage(caught, "Couldn't load history."))
      }
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label={open ? "Hide Suggestion" : "Suggest Another"} variant="quiet" style={{ flex: 1 }} onPress={() => setOpen((v) => !v)} />
        <Button label={historyOpen ? "Hide History" : "History"} variant="quiet" style={{ flex: 1 }} onPress={toggleHistory} />
      </View>
      {open && (
        <View style={{ gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, padding: space.md }}>
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
          {error && <Text style={[type.caption, { color: colour.warning }]}>{error}</Text>}
          <Button label="Send Suggestion" onPress={send} busy={busy} />
        </View>
      )}
      {historyOpen && (
        <View style={{ gap: space.xs, borderLeftWidth: 1, borderLeftColor: colour.line, paddingLeft: space.sm }}>
          {history === null && !error && <Text style={[type.caption, { color: colour.inkMuted }]}>Loading…</Text>}
          {history?.length === 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>No history yet.</Text>}
          {history?.map((h, i) => (
            <Text key={i} style={[type.caption, { color: colour.inkMuted }]}>
              {h.changedByClubName ?? "Someone"}: {h.statusBefore ?? "new"} → {h.statusAfter}
              {h.dateAfter ? `, ${exactDate(h.dateAfter)}` : ""}
              {h.noteAfter ? ` — "${h.noteAfter}"` : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {title}
        </Text>
        {count > 0 && <Text style={[type.caption, { color: colour.inkMuted }]}>{count}</Text>}
      </View>
      {children}
    </View>
  )
}

function RequestCard({ request, onThread, children }: { request: TeamFixtureRequest; onThread: () => void; children?: React.ReactNode }) {
  const status = STATUS_LABEL[request.status]
  const where = request.venuePreference === "home" ? (request.direction === "incoming" ? "At their ground" : "At our ground") : request.venuePreference === "away" ? (request.direction === "incoming" ? "At our ground" : "At their ground") : "Either ground"
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.inkMuted }]}>{request.direction === "incoming" ? "From" : "To"}</Text>
          <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]} numberOfLines={2}>
            {request.otherClub}
            {request.otherTeam ? ` · ${request.otherTeam}` : ""}
          </Text>
        </View>
        <StatusPill label={status.label} tone={status.tone} />
      </View>
      <Text style={[type.small, { color: colour.ink }]}>
        {request.proposedDate ? exactDate(request.proposedDate) : "Date to be agreed"}
        {request.preferredKickoffTime ? ` · ${kickoffLabel(request.preferredKickoffTime)}` : ""}
        {` · ${where}`}
        {request.gameType ? ` · ${request.gameType}` : ""}
      </Text>
      {!!request.note && <Text style={[type.caption, { color: colour.inkMuted }]}>“{request.note}”</Text>}
      {children}
      <Pressable accessibilityRole="button" accessibilityLabel="Open the request thread" onPress={onThread} style={{ minHeight: TOUCH_TARGET - 8, flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>Thread</Text>
        <ChevronRight size={15} color={colour.forest800} />
      </Pressable>
    </View>
  )
}
