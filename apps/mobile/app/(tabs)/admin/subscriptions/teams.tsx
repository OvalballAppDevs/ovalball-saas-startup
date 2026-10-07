import { useCallback, useMemo, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { loadClubMembershipBoard, sendTeamMembershipAttention, teamAttentionSentence, type ClubMembershipBoard } from "@ovalball/contracts/membership/board"
import { teamBreakdown, type TeamStanding } from "@ovalball/contracts/membership/operate"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, friendlyAction, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { AsyncButton, StandingBar, StandingLegend, standingCounts, standingLegendSpoken } from "../../../../src/membership/running-ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * TEAMS -- each team's memberships at a glance (Club Memberships Part 2).
 *
 * The club's own board, team by team (`teamBreakdown`): how many members, how many are up to date and how many need
 * action, with each team's standing bar drawn from the same standings the server gave every player -- a player in
 * two teams counts in both. A team opens Members with that team chosen. Somebody who may remind families
 * (`finance.enrolment.manage`) can also tell a team's staff how many of their players need attention: the server
 * sends it once a day per team, to the team's own staff, and names nobody's money. What it did is said under that
 * team's own row, where the button was pressed.
 */
export default function MembershipTeamsScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [board, setBoard] = useState<ClubMembershipBoard | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [told, setTold] = useState<Record<string, { tone: "ok" | "error"; text: string }>>({})
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || authorityLoading || !authority.view) return
    const gen = ++generation.current
    setError(null)
    try {
      const next = await loadClubMembershipBoard(supabase, clubId)
      if (gen === generation.current) setBoard(next)
    } catch (cause) {
      const translated = friendly(cause, "the club's teams")
      logDetail("admin:memberships:teams", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, authorityLoading, authority.view])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refreshAuthority(), load()])
    setRefreshing(false)
  }, [refreshAuthority, load])

  const teams = useMemo(() => (board ? teamBreakdown(board) : []), [board])
  const running = !!board?.programme && (board.programme.enabled || board.programme.activatedAt !== null)

  /** The club telling a team's staff; the outcome is said under that team's row. */
  const tellTeam = useCallback(async (team: TeamStanding): Promise<string> => {
    try {
      const result = await sendTeamMembershipAttention(supabase, team.team.id)
      const text = teamAttentionSentence(result)
      setTold((t) => ({ ...t, [team.team.id]: { tone: "ok", text } }))
      return text
    } catch (cause) {
      const text = friendlyAction(cause, "send", "the message to the team").message
      setTold((t) => ({ ...t, [team.team.id]: { tone: "error", text } }))
      return text
    }
  }, [])

  return (
    <AdminScreen section="Teams" onRefresh={() => void refresh()} refreshing={refreshing}>
      {!authorityLoading && !authority.view && <EmptyState title="Not for you at this club" body="Seeing each team's memberships needs the finance view permission at this club. If that has changed, pull to refresh." />}

      {(authorityLoading || (authority.view && !board && !error)) && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}

      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {board && !running && <EmptyState title="The club doesn't collect membership through Ovalball yet" body="Once Club Memberships are set up, each team's memberships appear here." />}

      {board && running && (
        <>
          <Text style={[type.body, { color: colour.inkMuted }]}>Each team's members this month. A player in two teams counts in both.</Text>
          {authority.enrolmentManage && teams.some((t) => t.needsAction > 0) && (
            <Text style={[type.small, { color: colour.inkMuted }]}>{"Tell Team Staff lets the team's staff who can see memberships know how many players need action. It never says who pays or how much, and can be sent once a day per team."}</Text>
          )}
          {teams.length === 0 ? (
            <EmptyState title="No teams with members yet" body="A team appears here once its players are covered by one of the club's memberships." />
          ) : (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {teams.map((t, i) => {
                const counts = standingCounts(board.rows.filter((r) => (r.teams ?? []).some((x) => x.id === t.team.id)))
                const members = `${t.total} ${t.total === 1 ? "member" : "members"}`
                return (
                  <View key={t.team.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t.team.name}. ${members}: ${standingLegendSpoken(counts)}`}
                      accessibilityHint="Opens Members with this team chosen"
                      onPress={() => router.push({ pathname: "/admin/subscriptions/members", params: { teamId: t.team.id } } as never)}
                      style={({ pressed }) => ({ minHeight: 72, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: space.sm }}>
                          <Text style={[type.heading, { color: colour.ink, flexShrink: 1 }]}>{t.team.name}</Text>
                          <Text style={[type.small, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{members}</Text>
                        </View>
                        <StandingBar counts={counts} height={8} />
                        <StandingLegend counts={counts} />
                      </View>
                      <ChevronRight size={18} color={colour.inkSubtle} />
                    </Pressable>
                    {authority.enrolmentManage && t.needsAction > 0 && (
                      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, alignItems: "flex-start", gap: space.sm }}>
                        <AsyncButton
                          label="Tell Team Staff"
                          variant="secondary"
                          accessibilityHint={`Tells the ${t.team.name} staff how many of their players need action`}
                          onPress={() => tellTeam(t)}
                        />
                        {told[t.team.id] && (
                          <Text accessibilityLiveRegion="polite" style={[type.small, { color: told[t.team.id].tone === "error" ? colour.danger : colour.ink }]}>
                            {told[t.team.id].text}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}
    </AdminScreen>
  )
}
