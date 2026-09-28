import { useCallback, useEffect, useMemo, useState } from "react"
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem } from "@ovalball/contracts"
import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfile, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { relativeDate } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { teamContextKeyFor } from "./context"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { NextFixtureCard } from "../components/agenda-row"
import { FixtureListRow, FixtureRowSkeleton } from "../components/fixture-list-row"
import { pageFixtures } from "../agenda/fixture-list"
import { ChevronRight, SlidersHorizontal, Users } from "../components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../design/tokens"

type Tab = "overview" | "fixtures" | "squad"

/**
 * THE TEAM PROFILE -- ONE SCREEN, ANY VIEWER (owner brief: Team Profiles + Club Admin Home).
 *
 * Reached from a club's Teams list, Club Admin Home's Your Teams rail, Clubhouse's cross-club Club
 * Profile, or Fixtures -- never a role-branched copy. Identity (name, age-grade, crest, cover) is the
 * same public data Clubhouse already shows a stranger from another club; what a viewer may see beyond
 * that -- fixtures, aggregate squad/staff counts, a full roster -- is decided once, server-side, by
 * `readTeamAuthority` for THIS viewer against THIS team, never inferred from the viewer's own active
 * context. A Club Admin looking at their own side and a parent from another club looking at an
 * opposition side land on the exact same component tree with different data drawn.
 */
export function TeamProfileScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const { active, contexts, select } = useAppContexts()
  const teamKey = teamContextKeyFor(teamId, contexts, active)
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [profile, setProfile] = useState<TeamProfile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>("overview")
  const [fixturesExpanded, setFixturesExpanded] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      setProfile(await loadTeamProfile(supabase, id.clubId, teamId, todayIso()))
    } catch (caught) {
      const failure = friendly(caught, "this team")
      logDetail("team profile", failure)
      setProblem(failure.message)
    }
  }, [teamId])
  useEffect(() => {
    setIdentity(null)
    setProfile(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const today = todayIso()
  const open = useCallback(
    (item: AgendaItem) => {
      const route = routeForAgendaItem(item, active?.kind ?? "club")
      if (route) router.push(route as never)
    },
    [router, active?.kind]
  )

  const page = useMemo(() => (profile ? pageFixtures(profile.upcoming, fixturesExpanded) : { shown: [], hasMore: false }), [profile, fixturesExpanded])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity || !profile ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ height: 160, borderRadius: radius.lg, backgroundColor: colour.line }} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}>
          <TeamCoverHero identity={identity} />
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, flexDirection: "row", gap: space.xs }}>
            {(["overview", "fixtures", "squad"] as Tab[]).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => setTab(t)}
                style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: tab === t ? colour.forest950 : pressed ? colour.line : "transparent" })}
              >
                <Text style={[type.smallMedium, { color: tab === t ? colour.onForest : colour.inkMuted, textTransform: "capitalize" }]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ padding: space.lg, gap: space.md }}>
            {tab === "overview" && (
              <OverviewTab identity={identity} profile={profile} today={today} onOpenFixture={open} router={router} teamKey={teamKey} onEnterTeamContext={() => { void select(teamKey!); router.replace("/" as never) }} />
            )}
            {tab === "fixtures" && (
              <>
                {page.shown.length === 0 ? (
                  <EmptyState title="No fixtures scheduled" body="When a fixture is arranged for this side, it appears here." icon={<Users size={22} color={colour.inkSubtle} />} />
                ) : (
                  <View style={{ gap: space.sm }}>
                    {page.shown.map((item, index) => (
                      <FixtureListRow key={item.key} item={item} today={today} isNext={index === 0} onPress={() => open(item)} />
                    ))}
                  </View>
                )}
                {page.hasMore && <Button label="View All" variant="secondary" onPress={() => setFixturesExpanded(true)} />}
              </>
            )}
            {tab === "squad" && <SquadTab identity={identity} profile={profile} router={router} />}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function TeamCoverHero({ identity }: { identity: TeamProfileIdentity }) {
  return (
    <View style={{ backgroundColor: surface.forest }}>
      {identity.cover.kind === "cover" ? (
        <Image source={{ uri: identity.cover.url }} style={{ width: "100%", height: 180 }} resizeMode="cover" />
      ) : (
        <View style={{ width: "100%", height: 120, alignItems: "center", justifyContent: "center" }}>
          {identity.cover.kind === "crest" && <Image source={{ uri: identity.cover.url }} style={{ width: 64, height: 64, borderRadius: 12 }} resizeMode="contain" />}
        </View>
      )}
      <View style={{ padding: space.lg, flexDirection: "row", alignItems: "flex-end", gap: space.md }}>
        {identity.cover.kind === "cover" && identity.crestUrl && <Image source={{ uri: identity.crestUrl }} style={{ width: 44, height: 44, borderRadius: 10, marginTop: -34, borderWidth: 2, borderColor: surface.forest }} resizeMode="contain" />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.title, { color: onForest.primary }]}>{identity.fullLabel}</Text>
          <Text numberOfLines={1} style={[type.caption, { color: onForest.secondary }]}>{identity.clubName}</Text>
        </View>
      </View>
    </View>
  )
}

function OverviewTab({
  identity,
  profile,
  today,
  onOpenFixture,
  router,
  teamKey,
  onEnterTeamContext,
}: {
  identity: TeamProfileIdentity
  profile: TeamProfile
  today: string
  onOpenFixture: (item: AgendaItem) => void
  router: ReturnType<typeof useRouter>
  teamKey: string | null
  onEnterTeamContext: () => void
}) {
  return (
    <>
      {teamKey && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>You run this side</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>Switch into the team to see the register, answer requests and manage the side.</Text>
          <Button label="Enter Team Context" onPress={onEnterTeamContext} accessibilityHint="Switches to this team's workspace" />
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Next Up</Text>
        {profile.nextUp ? (
          <NextFixtureCard item={profile.nextUp} today={today} onPress={() => onOpenFixture(profile.nextUp!)} />
        ) : (
          <EmptyState title="Nothing scheduled" body="When a match or session is arranged for this side, it appears here." icon={<Users size={22} color={colour.inkSubtle} />} />
        )}
      </View>

      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: 4 }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>THE SIDE</Text>
        {profile.people.counts ? (
          <Text style={[type.body, { color: colour.ink }]}>{`${profile.people.counts.players} ${profile.people.counts.players === 1 ? "player" : "players"} · ${profile.people.counts.staff} ${profile.people.counts.staff === 1 ? "staff member" : "staff"}`}</Text>
        ) : (
          <Text style={[type.body, { color: colour.inkMuted }]}>Squad details aren&apos;t available in this view.</Text>
        )}
      </View>

      {profile.authority.teamManage && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage Team"
          onPress={() => router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: identity.id } } as never)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, opacity: pressed ? 0.6 : 1 })}
        >
          <SlidersHorizontal size={18} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800, flex: 1 }]}>Manage Team</Text>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
      {!teamKey && !profile.authority.teamManage && (
        <Text style={[type.caption, { color: colour.inkSubtle }]}>A side&apos;s register, requests and settings belong to the people who run it.</Text>
      )}
    </>
  )
}

function SquadTab({ identity, profile, router }: { identity: TeamProfileIdentity; profile: TeamProfile; router: ReturnType<typeof useRouter> }) {
  if (!profile.people.counts) {
    return <EmptyState title="Not visible here" body="Squad details aren&apos;t available in this view." icon={<Users size={22} color={colour.inkSubtle} />} />
  }
  return (
    <View style={{ gap: space.md }}>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: 4 }}>
        <Text style={[type.title, { color: colour.ink }]}>{profile.people.counts.players}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Players</Text>
      </View>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: 4 }}>
        <Text style={[type.title, { color: colour.ink }]}>{profile.people.counts.staff}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Staff</Text>
      </View>
      {profile.people.rosterVisible ? (
        <Button label="View People" onPress={() => router.push({ pathname: "/team/people", params: { teamId: identity.id } } as never)} />
      ) : (
        <Text style={[type.small, { color: colour.inkMuted }]}>Names aren&apos;t shown in this view.</Text>
      )}
    </View>
  )
}
