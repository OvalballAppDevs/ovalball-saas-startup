import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import * as Linking from "expo-linking"
import { CALL_UP_STATUS_LABEL, decideCallUp, readTeamCallUps, type TeamCallUp } from "@ovalball/contracts/team/requests"
import { teamPeopleErrorMessage } from "@ovalball/contracts/team/people"

import { supabase } from "../../../../src/auth/supabase"
import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { webUrl } from "../../../../src/config/environment"
import { exactDate } from "../../../../src/agenda/presentation"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { ExternalLink } from "../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * PLAYER REQUESTS -- call-ups between the club's sides for one fixture (CA-M7).
 *
 * A call-up is `fixture_player_call_up`: one team asking to borrow one of another's players for one
 * match, with the age-grade rule it relies on recorded on the request. The SOURCE team decides, and
 * only it -- `decide_player_call_up` refuses the target regardless of what is drawn here, and the
 * canonical eligibility rule is applied on the way in. There is no second approval system: the
 * website's Player Requests page runs the same operation.
 *
 * RAISING a call-up needs the club's other sides, their players and an eligibility preview; that is a
 * cross-team administrative flow the website already carries, so this screen hands off to it honestly
 * rather than rebuilding it worse. Deciding -- the thing that waits on THIS team -- is native.
 */
export default function TeamPlayerRequests() {
  const { authority, loading: authorityLoading, teamId } = useTeamAuthority()
  const [rows, setRows] = useState<TeamCallUp[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setProblem(null)
    try {
      setRows(await readTeamCallUps(supabase, teamId))
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load player requests. Try again."))
    }
  }, [teamId])

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

  const waiting = rows?.filter((r) => r.canDecide) ?? []
  const rest = rows?.filter((r) => !r.canDecide) ?? []

  return (
    <TeamScreen section="Player Requests" refreshing={refreshing} onRefresh={refresh}>
      {!authorityLoading && !authority.callupRequest && <NotForYou title="Player requests are not part of your job here" body="Asking for a player from another side, and answering such a request, is done by the people the club has given that job to." />}
      {problem && !rows && <ErrorState message={problem} onRetry={load} />}
      {!problem && rows === null && <CardSkeleton lines={3} />}
      {rows && (
        <>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Waiting for Your Decision
          </Text>
          {waiting.length === 0 ? (
            <EmptyState title="Nothing waiting" body="When another side asks for one of your players, it appears here and in Needs Attention." />
          ) : (
            waiting.map((r) => (
              <CallUpCard key={r.id} row={r}>
                {authority.callupRequest && (
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button
                      label="Approve"
                      style={{ flex: 1 }}
                      onPress={() =>
                        setAsk({
                          title: `Let ${r.playerName} play for ${r.targetTeamName}?`,
                          body: `For the fixture on ${r.fixtureDate ? exactDate(r.fixtureDate) : "the date requested"}. Their parents or guardians are told.`,
                          confirmLabel: "Approve",
                          reason: "optional",
                          onConfirm: async (reason) => {
                            await decideCallUp(supabase, r.id, "approve", reason)
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
                          title: `Keep ${r.playerName} with ${r.sourceTeamName}?`,
                          body: "The other side is told. A reason helps them plan.",
                          confirmLabel: "Decline",
                          destructive: true,
                          reason: "optional",
                          onConfirm: async (reason) => {
                            await decideCallUp(supabase, r.id, "reject", reason)
                            await load()
                          },
                        })
                      }
                    />
                  </View>
                )}
              </CallUpCard>
            ))
          )}
          {rest.length > 0 && (
            <>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Recent
              </Text>
              {rest.slice(0, 10).map((r) => (
                <CallUpCard key={r.id} row={r} />
              ))}
            </>
          )}
          {authority.callupRequest && (
            <Pressable accessibilityRole="link" accessibilityLabel="Request a player from another side, on the Ovalball website" onPress={() => void Linking.openURL(`${webUrl}/teams/${teamId}/player-requests`)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ExternalLink size={16} color={colour.forest800} />
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Request a player from another side, on the web</Text>
            </Pressable>
          )}
        </>
      )}
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That could not be done.")} />
    </TeamScreen>
  )
}

function CallUpCard({ row, children }: { row: TeamCallUp; children?: React.ReactNode }) {
  const tone = row.status === "approved" ? "positive" : row.status === "requested" || row.status === "awaiting_eligibility" ? "caution" : "neutral"
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 15, flex: 1 }]}>{row.playerName}</Text>
        <StatusPill label={CALL_UP_STATUS_LABEL[row.status]} tone={tone} />
      </View>
      <Text style={[type.small, { color: colour.ink }]}>
        {row.sourceTeamName} → {row.targetTeamName}
      </Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {row.fixtureDate ? exactDate(row.fixtureDate) : "Date to be confirmed"}
        {row.fixtureOpponent ? ` v ${row.fixtureOpponent}` : ""}
        {` · ${row.eligibilityRuleReference}`}
      </Text>
      {children}
    </View>
  )
}
