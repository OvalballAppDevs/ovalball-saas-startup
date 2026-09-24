import { useCallback, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { approvePlayerJoinRequest, canOpenGuardiansPlayers, declinePlayerJoinRequest, guardiansPlayersErrorMessage, readPlayerJoinRequests, type PlayerJoinRequest } from "@ovalball/contracts/club/guardians-players"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"

import { AdminScreen } from "../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { ChoiceChips, Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { exactDate } from "../../../../src/agenda/presentation"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * PLAYERS ASKING TO JOIN -- the website's /club/join-requests (CA-M11.1).
 *
 * One list of one kind of thing: a player waiting for the club to say yes. Accepting means choosing
 * which of the club's sides they join, and THE SQUAD PICKER IS THE POINT: Ovalball has established the
 * category a player is eligible for; the club establishes the team. Nothing is pre-selected, because
 * pre-selecting would be this screen deciding on a manager's behalf.
 *
 * ALREADY RESOLVED IS A REAL ANSWER. Two managers may open this at once; the server settles the race and
 * the second one is told so rather than shown an error for something they did nothing wrong in. What a
 * viewer may DO is decided inside the operations (team.join_request.review at the club or the chosen
 * side; nobody resolves their own child's request); this screen only draws to match.
 */
export default function PlayerJoinRequests() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps, refresh: refreshAccess } = useGuardiansPlayersAccess()
  const [rows, setRows] = useState<PlayerJoinRequest[] | null>(null)
  const [teams, setTeams] = useState<ClubTeam[]>([])
  const [error, setError] = useState<FriendlyError | null>(null)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [settled, setSettled] = useState<Record<string, string>>({})
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = usePendingIntent("guardians:join-requests")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !caps.joinRequestReview) return
    const gen = ++generation.current
    setError(null)
    try {
      const [list, directory] = await Promise.all([readPlayerJoinRequests(supabase, clubId), readClubTeams(supabase, clubId)])
      if (gen !== generation.current) return
      setRows(list)
      setTeams(directory.teams.filter((t) => t.active).sort((a, b) => a.fullLabel.localeCompare(b.fullLabel)))
    } catch (cause) {
      const translated = friendly(cause, "join requests")
      logDetail("admin:guardians:join-requests", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, accessLoading, caps.joinRequestReview])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  const may = canOpenGuardiansPlayers(caps) || caps.joinRequestReview

  function accept(r: PlayerJoinRequest) {
    const teamId = chosen[r.requestId]
    const team = teams.find((t) => t.id === teamId)
    if (!team) return
    setAsk({
      title: `Accept ${r.playerName} into ${team.fullLabel}?`,
      body: "They take a place on that side. Their family, or the player themselves, is told.",
      confirmLabel: "Accept",
      reason: "none",
      onConfirm: async () => {
        const outcome = await approvePlayerJoinRequest(supabase, r.requestId, team.id)
        if (!outcome.ok) setSettled((s) => ({ ...s, [r.requestId]: `Someone else at ${r.clubName} has already dealt with this request. Nothing further is needed from you.` }))
        else setNotice(`${r.playerName} is now on ${team.fullLabel}.`)
        await load()
      },
    })
  }

  function decline(r: PlayerJoinRequest) {
    setAsk({
      title: `Decline ${r.playerName}?`,
      body: "A reason is optional, and the player will read it.",
      confirmLabel: `Decline ${r.playerName}`,
      destructive: true,
      reason: "optional",
      onConfirm: async (reason) => {
        const outcome = await declinePlayerJoinRequest(supabase, r.requestId, reason)
        if (!outcome.ok) setSettled((s) => ({ ...s, [r.requestId]: `Someone else at ${r.clubName} has already dealt with this request. Nothing further is needed from you.` }))
        else setNotice(`${r.playerName}'s request was declined.`)
        await load()
      },
    })
  }

  return (
    <AdminScreen section="Players Asking to Join" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Players Asking to Join
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Accepting one puts them in the side you choose. Ovalball has worked out the category they are eligible for, not which of your teams they belong in.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="Players asking to join are decided by the people the club has given that job to." />}
      {may && !caps.joinRequestReview && !accessLoading && <EmptyState title="Not yours to decide" body="Reviewing a player's request to join needs the club's join-request permission." />}
      {caps.joinRequestReview && notice && <Notice tone="ok" text={notice} />}
      {caps.joinRequestReview && error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {caps.joinRequestReview && !error && rows === null && <CardSkeleton lines={4} />}
      {caps.joinRequestReview && rows !== null && rows.length === 0 && Object.keys(settled).length === 0 && <EmptyState title="Nothing waiting" body="Requests from players appear here." />}

      {caps.joinRequestReview &&
        Object.entries(settled).map(([id, text]) => (
          <Card key={id}>
            <Text style={[type.small, { color: colour.inkMuted }]}>{text}</Text>
          </Card>
        ))}

      {caps.joinRequestReview &&
        rows?.map((r) => (
          <Card key={r.requestId} style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.title, { color: colour.ink }]}>{r.playerName}</Text>
                {r.resolvedCategory && (
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    Eligible for <Text style={{ color: colour.ink, fontFamily: "Inter_600SemiBold" }}>{r.resolvedCategory}</Text>
                  </Text>
                )}
              </View>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>Asked {exactDate(r.requestedAt.slice(0, 10))}</Text>
            </View>
            <ChoiceChips label="Which side?" hint="Nothing is chosen until you choose it." options={teams.map((t) => ({ key: t.id, label: t.fullLabel }))} value={chosen[r.requestId] ?? null} onChange={(id) => setChosen((c) => ({ ...c, [r.requestId]: id }))} />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Decline" variant="secondary" onPress={() => decline(r)} style={{ flex: 1 }} />
              <Button label="Accept" disabled={!chosen[r.requestId]} onPress={() => accept(r)} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => { void refreshAccess(); void load() }}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/guardians/join-requests" } } as never)
        }}
        errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this request").message)}
      />
    </AdminScreen>
  )
}
