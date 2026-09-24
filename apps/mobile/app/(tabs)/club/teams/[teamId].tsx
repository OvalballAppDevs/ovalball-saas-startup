import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import type { AgendaItem } from "@ovalball/contracts"
import { loadClubOverview, type ClubOverview, type ClubTeamSummary } from "@ovalball/contracts/club/overview"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { todayIso } from "../../../../src/agenda/load"
import { exactDate, kickoffLabel, relativeDate } from "../../../../src/agenda/presentation"
import { routeForAgendaItem } from "../../../../src/links/destinations"
import { teamContextKeyFor } from "../../../../src/team/context"
import { NextFixtureCard } from "../../../../src/components/agenda-row"
import { ArrowRightLeft, ChevronRight, ClipboardList, Users } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * A SIDE, FROM THE CLUB'S SIDE OF THE FENCE (CA-M10): its identity, what it has next, who is in it,
 * and the club-scoped things this person may do about it.
 *
 * ENTER TEAM CONTEXT is offered only where this person legitimately holds that team as a context --
 * the same rule a notification uses (`teamContextKeyFor`) -- and switching is explicit: a tap on a
 * side never quietly changes where the person is standing. Once switched, CA-M7 owns the experience;
 * nothing of the Team workspace is duplicated here. A Club Admin who holds no team context sees the
 * club's inspection only, and the Admin Centre's team screen where `team.team.manage` applies.
 */
export default function ClubTeamScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  const { active, club, contexts, select } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [overview, setOverview] = useState<ClubOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      setOverview(await loadClubOverview(supabase, clubId, club.name ?? active?.label ?? "Club", todayIso()))
    } catch (caught) {
      const failure = friendly(caught, "this team")
      logDetail("club team", failure)
      setProblem(failure.message)
    }
  }, [clubId, club.name, active?.label])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const today = todayIso()
  const row: ClubTeamSummary | null = overview?.teams.find((t) => t.team.id === teamId) ?? null
  const teamKey = teamId ? teamContextKeyFor(teamId, contexts, active) : null
  const upcoming = (overview?.upcoming ?? []).filter((i) => i.teamId === teamId).slice(0, 4)
  const open = (item: AgendaItem) => {
    if (!active) return
    const route = routeForAgendaItem(item, active.kind)
    if (route) router.push(route as never)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink, flex: 1 }]}>{row?.team.displayName ?? "Team"}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!problem && overview === null && <CardSkeleton lines={3} />}
        {overview && !row && <EmptyState title="Not one of this club's sides" body="This side is not part of the club you are viewing, or it has been folded." />}
        {row && (
          <>
            <View style={{ gap: 2 }}>
              <Text style={[type.overline, { color: colour.forest800 }]}>{[club.name, row.team.ageGroup, row.team.category === "senior" ? "Senior" : null].filter(Boolean).join(" · ").toUpperCase()}</Text>
              <Text style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 34 }]}>{row.team.displayName}</Text>
              {!!row.team.alias && <Text style={[type.small, { color: colour.inkMuted }]}>{`Known as ${row.team.alias}`}</Text>}
            </View>

            {teamKey ? (
              <Card style={{ gap: space.sm }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>You run this side</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Switch into the team to see the register, answer requests and manage the side.</Text>
                <Button label="Enter Team Context" onPress={() => { void select(teamKey); router.replace("/" as never) }} accessibilityHint="Switches to this team's workspace" />
              </Card>
            ) : (
              <Text style={[type.caption, { color: colour.inkSubtle }]}>You are viewing this side as the club. The team's own workspace is for the people who run it.</Text>
            )}

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Next Up</Text>
              {row.nextFixture ? <NextFixtureCard item={row.nextFixture} today={today} onPress={() => open(row.nextFixture!)} /> : <Text style={[type.small, { color: colour.inkMuted }]}>No fixture scheduled.</Text>}
              {upcoming.filter((i) => i.key !== row.nextFixture?.key).map((item) => (
                <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.kind === "training" ? "Training" : `v ${item.them?.clubName ?? "TBC"}`}, ${exactDate(item.date)}${item.time ? `, ${kickoffLabel(item.time)}` : ""}`} onPress={() => open(item)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
                  <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: item.kind === "training" ? colour.messengerBlue : colour.pitch600 }} />
                  <View style={{ width: 64 }}>
                    <Text style={[type.smallMedium, { color: colour.forest800 }]}>{relativeDate(item.date, today)}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{kickoffLabel(item.time) ?? "TBC"}</Text>
                  </View>
                  <Text numberOfLines={1} style={[type.small, { color: colour.ink, flex: 1 }]}>{item.kind === "training" ? "Training" : `v ${[item.them?.clubName, item.them?.teamName].filter(Boolean).join(" ")}`}</Text>
                  <ChevronRight size={16} color={colour.inkSubtle} />
                </Pressable>
              ))}
            </View>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>The Side</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Card style={{ flex: 1, gap: 4 }}>
                  <Users size={16} color={colour.forest800} />
                  <Text style={[type.title, { color: colour.ink, fontSize: 22 }]}>{row.players}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Players</Text>
                </Card>
                <Card style={{ flex: 1, gap: 4 }}>
                  <ClipboardList size={16} color={colour.forest800} />
                  <Text style={[type.title, { color: colour.ink, fontSize: 22 }]}>{row.staff}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Staff</Text>
                </Card>
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>As the Club</Text>
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                <Row first label="Calendar" caption="This side's matches and training" onPress={() => router.push({ pathname: "/calendar", params: { teamId: row.team.id } } as never)} />
                {overview?.authority.peopleView && <Row label="People" caption="Members and staff, with their team roles" onPress={() => router.push("/admin/people" as never)} />}
                {overview?.authority.teamManage && <Row label="Team Directory entry" caption="Alias, fold or reactivate, in the Admin Centre" onPress={() => router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: row.team.id } } as never)} />}
              </View>
            </View>
            {!teamKey && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <ArrowRightLeft size={14} color={colour.inkSubtle} />
                <Text style={[type.caption, { color: colour.inkSubtle, flex: 1 }]}>A side's register, requests and settings belong to the people who run it. Give somebody team access from People to hand them that workspace.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Row({ label, caption, onPress, first = false }: { label: string; caption: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${caption}`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
