import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { approveTeamPlaceRequest, declineTeamPlaceRequest, readTeamPeople, teamPeopleErrorMessage, type TeamPerson } from "@ovalball/contracts/team/people"

import { supabase } from "../../../../src/auth/supabase"
import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { PersonAvatar } from "../../../../src/components/identity"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { exactDate } from "../../../../src/agenda/presentation"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * JOIN REQUESTS -- the players waiting to be let into this side (CA-M7).
 *
 * A request is a `player_team_memberships` row in its pending state, read through the same roster
 * reader as everybody else. Approving and declining are the canonical operations
 * (`approve_pending_team_membership` / `reject_pending_team_membership`), each asking
 * `team.roster.manage` at the team or the club and telling the family the outcome. There is no second
 * approval system here: the website's team People page runs the same two operations.
 */
export default function TeamJoinRequests() {
  const router = useRouter()
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [requests, setRequests] = useState<TeamPerson[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setRequests((await readTeamPeople(supabase, teamId)).requests)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        setRequests([])
        return
      }
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load the requests. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setRequests(null)
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

  return (
    <TeamScreen section="Join Requests" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && !authority.rosterManage && <NotForYou title="Deciding who joins is not your job here" body="Requests to join this side are approved by the people the club has given that job to." />}
      {problem && !requests && <ErrorState message={problem} onRetry={load} />}
      {!problem && requests === null && <CardSkeleton lines={3} />}
      {requests && requests.length === 0 && <EmptyState title="No one is waiting for approval" body="Requests to join this side appear here, and in Needs Attention." />}
      {requests && requests.length > 0 && (
        <View style={{ gap: space.sm }}>
          {requests.map((r) => (
            <View key={r.rowId} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <PersonAvatar name={r.name} url={null} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>{r.name}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{r.requestedAt ? `Asked ${exactDate(r.requestedAt.slice(0, 10))}` : "Waiting"}</Text>
                </View>
              </View>
              {authority.rosterManage && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button
                    label="Approve"
                    style={{ flex: 1 }}
                    onPress={() =>
                      setAsk({
                        title: `Approve ${r.name}?`,
                        body: "They join the side and their parents or guardians are told.",
                        confirmLabel: "Approve",
                        reason: "none",
                        onConfirm: async () => {
                          await approveTeamPlaceRequest(supabase, r.rowId)
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
                        title: `Decline ${r.name}?`,
                        body: "Say why. The reason is recorded and their parents or guardians are told.",
                        confirmLabel: "Decline",
                        destructive: true,
                        reason: "required",
                        onConfirm: async (reason) => {
                          await declineTeamPlaceRequest(supabase, r.rowId, reason)
                          await load()
                        },
                      })
                    }
                  />
                </View>
              )}
              <Text style={[type.caption, { color: colour.forest800 }]} onPress={() => router.push({ pathname: "/team/people/[kind]/[id]", params: { kind: "player", id: r.rowId } } as never)}>
                See the player
              </Text>
            </View>
          ))}
        </View>
      )}
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That could not be done.")} />
    </TeamScreen>
  )
}
