import { useMemo } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { existingReturnDates, longMatchDate, shortMatchDate, teamDayState } from "@ovalball/contracts"

import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { ClubCrest } from "../../../../src/components/identity"
import { CalendarSync, CircleAlert, CircleCheck, Repeat, Search } from "../../../../src/components/icons"
import { Button, Skeleton } from "../../../../src/components/ui"
import { IconTile } from "../../../../src/people/ui"
import { useSeasonPlanner } from "../../../../src/season-planner/state"
import { useClubDay, useClubPlannerTeams } from "../../../../src/season-planner/data"
import { PlannerCard, SectionLabel, VenuePill } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, space, type } from "../../../../src/design/tokens"

/**
 * WHAT HAPPENED -- per team, from the server's answer. "3 sent" means three requests exist; a team that was refused
 * says why. Then the two things that usually come next: the return club day, and the teams still without a match.
 */
export default function ClubDaySent() {
  const router = useRouter()
  const planner = useSeasonPlanner()
  const leg = planner.draft?.lastSent ?? null
  const { teams } = useClubPlannerTeams(planner.clubId)
  const clubDay = useClubDay(planner.clubId, leg?.opponent.clubId ?? null, leg?.date ?? null)
  const names = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t.displayName])), [teams])
  const sides = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of clubDay.day?.teams ?? []) for (const c of t.compatible) map.set(c.teamId, c.displayName)
    return map
  }, [clubDay.day])

  if (!leg) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Season Planner" onBack={() => router.replace("/fixtures/planner" as never)} />
      </View>
    )
  }

  const sent = leg.results.filter((r) => r.outcome === "sent")
  const refused = leg.results.filter((r) => r.outcome !== "sent")
  const returnDates = clubDay.day ? existingReturnDates(clubDay.day.teams, leg.date) : null
  const unfilled = (clubDay.day?.teams ?? []).filter((t) => {
    if (leg.results.some((r) => r.requestingTeamId === t.teamId && r.outcome === "sent")) return false
    const state = teamDayState(t, leg.date, leg.opponent.clubId as string)
    return state.kind === "ready" || state.kind === "no_match"
  })
  const toPlanner = () => router.dismissTo("/fixtures/planner" as never)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title={leg.mode === "return" ? "Return Club Day Sent" : "Club Day Sent"} onBack={toPlanner} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }}>
        <PlannerCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ClubCrest clubName={leg.opponent.name} url={leg.opponent.crestUrl} size={52} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                {sent.length > 0 ? leg.opponent.name : `Nothing was sent to ${leg.opponent.name}`}
              </Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{longMatchDate(leg.date)}</Text>
            </View>
          </View>
          {sent.length > 0 && (
            <Text style={[type.small, { color: colour.inkMuted, marginTop: space.md }]}>
              {sent.length === 1
                ? `1 fixture in this Club Day request. ${leg.opponent.name} can accept or decline it; nothing is in either calendar until they do.`
                : `${sent.length} fixtures in one Club Day request. ${leg.opponent.name} can accept or decline them together or one by one; nothing is in either calendar until they do.`}
            </Text>
          )}
        </PlannerCard>

        <PlannerCard padded={false}>
          {leg.results.map((r, i) => {
            const item = leg.items.find((x) => x.requestingTeamId === r.requestingTeamId)
            const ok = r.outcome === "sent"
            return (
              <View key={`${r.requestingTeamId}-${i}`} accessible accessibilityLabel={`${names.get(r.requestingTeamId) ?? "Team"}: ${ok ? "sent, pending" : `not sent. ${r.reason ?? ""}`}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                {ok ? <CircleCheck size={22} color={colour.rugby700} /> : <CircleAlert size={22} color={colour.warning} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{names.get(r.requestingTeamId) ?? "Team"}</Text>
                  <Text style={[type.caption, { color: ok ? colour.inkMuted : colour.warning }]}>
                    {ok ? `v ${r.targetTeamId && sides.get(r.targetTeamId) ? sides.get(r.targetTeamId) : leg.opponent.name} · Awaiting reply` : (r.reason ?? "Not sent")}
                  </Text>
                </View>
                {ok && item && <VenuePill venue={item.venue} />}
              </View>
            )
          })}
        </PlannerCard>
        {refused.length > 0 && <Text style={[type.small, { color: colour.inkMuted }]}>{refused.length === 1 ? "One team was" : `${refused.length} teams were`} not sent. Nothing was created for {refused.length === 1 ? "it" : "them"}.</Text>}

        {(leg.leftOut ?? []).length > 0 && (
          <View style={{ gap: space.md }}>
            <SectionLabel title="Not Sent" />
            <PlannerCard padded={false}>
              {(leg.leftOut ?? []).map((l, i) => (
                <View key={`${l.teamName}-${i}`} accessible accessibilityLabel={`${l.teamName}: not sent. ${l.reason}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                  <CircleAlert size={22} color={colour.warning} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>{l.teamName}</Text>
                    <Text style={[type.caption, { color: colour.warning }]}>{l.reason}</Text>
                  </View>
                </View>
              ))}
            </PlannerCard>
            <Text style={[type.small, { color: colour.inkMuted }]}>Nothing was sent for {(leg.leftOut ?? []).length === 1 ? "this team" : "these teams"}. Plan {(leg.leftOut ?? []).length === 1 ? "it" : "them"} on another date when you are ready.</Text>
          </View>
        )}

        <View style={{ gap: space.sm }}>
          {/* The Club Day is where its answers will arrive; the planner is the way home. One green action per screen. */}
          {!!leg.groupId && <Button variant="secondary" label="View Club Day" onPress={() => router.push({ pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: leg.groupId as string } } as never)} />}
          <Button variant="quiet" label="Back to Season Planner" onPress={toPlanner} />
        </View>

        {leg.mode === "first" && sent.length > 0 && (
          <View style={{ gap: space.md }}>
            <SectionLabel title="Return Club Day" />
            {returnDates === null ? (
              <Skeleton height={110} />
            ) : returnDates.length > 0 ? (
              <PlannerCard>
                <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                  <IconTile>
                    <CalendarSync size={20} color={colour.forest800} />
                  </IconTile>
                  <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
                    You already have {returnDates.length === 1 ? "another meeting" : "other meetings"} with {leg.opponent.name} this season: {returnDates.map(shortMatchDate).join(", ")}.
                  </Text>
                </View>
              </PlannerCard>
            ) : (
              <PlannerCard>
                <View style={{ flexDirection: "row", gap: space.md }}>
                  <IconTile tone="amber">
                    <Repeat size={20} color={colour.warning} />
                  </IconTile>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>No return club day currently planned</Text>
                    <Text style={[type.small, { color: colour.inkMuted }]}>You don't have a return club day with {leg.opponent.name} this season.</Text>
                  </View>
                </View>
                <View style={{ marginTop: space.md }}>
                  <Button variant="brand" label="Plan Return Club Day" onPress={() => router.push({ pathname: "/fixtures/planner/return", params: { groupId: leg.groupId ?? "" } } as never)} />
                </View>
              </PlannerCard>
            )}
          </View>
        )}

        {unfilled.length > 0 && (
          <View style={{ gap: space.md }}>
            <SectionLabel title="Unfilled Teams" />
            <PlannerCard padded={false}>
              {unfilled.map((t, i) => (
                <View key={t.teamId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>{t.displayName}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>Nothing arranged on {shortMatchDate(leg.date)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Find opponents for ${t.displayName}`}
                    onPress={() =>
                      router.push({
                        pathname: "/clubhouse/find-fixture/matching",
                        params: { criteria: JSON.stringify({ teamIds: [t.teamId], teamRugbyCode: null, dates: [leg.date], venuePreference: "either", distance: "any" }), teamLabels: JSON.stringify([t.displayName]) },
                      } as never)
                    }
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH_TARGET }}
                  >
                    <Search size={16} color={colour.forest800} />
                    <Text style={[type.smallMedium, { color: colour.forest800 }]}>Find Opponents</Text>
                  </Pressable>
                </View>
              ))}
            </PlannerCard>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
