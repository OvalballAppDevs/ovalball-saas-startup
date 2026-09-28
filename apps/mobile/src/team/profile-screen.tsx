import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem } from "@ovalball/contracts"
import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfile, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { relativeDate } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { teamContextKeyFor } from "./context"
import { demoTeamCoverAsset } from "./team-cover-demo"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { BottomSheet } from "../components/bottom-sheet"
import { NextFixtureCard } from "../components/agenda-row"
import { FixtureListRow } from "../components/fixture-list-row"
import { PhotoBottomShade } from "../components/photo-gradient"
import { pageFixtures } from "../agenda/fixture-list"
import { Camera, CalendarDays, ChevronRight, Ellipsis, SlidersHorizontal, Users } from "../components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../design/tokens"

type Tab = "overview" | "fixtures" | "squad" | "staff"
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "fixtures", label: "Fixtures" },
  { key: "squad", label: "Squad" },
  { key: "staff", label: "Staff" },
]

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
 *
 * ONE CONTINUOUS FOREST BLOCK carries the top bar, the photographic hero and the tab bar (Section 1A
 * convergence pass) -- header, photo and tabs read as one identity system, the same way the Calendar's
 * own forest plate sits above its white sheet. Only the content below the tabs is chalk.
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
  const [menuOpen, setMenuOpen] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      setProfile(await loadTeamProfile(supabase, id.clubId, teamId, id.rugbyCode, todayIso()))
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
  const menuAvailable = !!profile && (profile.canEditCover || profile.authority.teamManage)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* THE TOP BAR STAYS REACHABLE while the rest scrolls -- back navigation and the team menu are
          never scrolled out of reach, exactly like every other detail screen this primitive serves. */}
      <OvalballDetailHeader
        title="Team"
        onBack={() => router.back()}
        tone="forest"
        rightAction={
          menuAvailable ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Team actions" onPress={() => setMenuOpen(true)} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
              <Ellipsis size={22} color={onForest.primary} />
            </Pressable>
          ) : undefined
        }
      />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity || !profile ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ height: 220, borderRadius: radius.lg, backgroundColor: colour.line }} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}>
          {/* THE ONE FOREST BLOCK: photo, identity and tabs never separate from one another -- one
              continuous ground flowing straight on from the forest bar above, not photo-then-white-page. */}
          <View style={{ backgroundColor: surface.forest }}>
            <TeamCoverHero identity={identity} profile={profile} onOpenClub={identity.clubDirectoryId ? () => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: identity.clubDirectoryId } } as never) : undefined} />
            <View style={{ flexDirection: "row" }}>
              {TABS.map(({ key, label }) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === key }}
                  onPress={() => setTab(key)}
                  style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", gap: 6, opacity: pressed ? 0.75 : 1 })}
                >
                  <Text numberOfLines={1} style={[type.smallMedium, { color: tab === key ? onForest.primary : onForest.secondary, fontSize: 14 }]}>{label}</Text>
                  <View style={{ height: 2, width: 22, borderRadius: 1, backgroundColor: tab === key ? onForest.primary : "transparent" }} />
                </Pressable>
              ))}
            </View>
          </View>

          {/* THE CONTENT SURFACE, tucked under the forest block with a large-radius seam rather than a
              hard edge -- the same relationship the Calendar's own forest plate has to its white sheet. */}
          <View style={{ flex: 1, backgroundColor: colour.chalk, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -radius.xl, paddingTop: radius.xl }}>
            <View style={{ padding: space.lg, gap: space.md }}>
              {tab === "overview" && (
                <OverviewTab identity={identity} profile={profile} today={today} onOpenFixture={open} router={router} teamKey={teamKey} onEnterTeamContext={() => { void select(teamKey!); router.replace("/" as never) }} />
              )}
              {tab === "fixtures" && (
                <>
                  {page.shown.length === 0 ? (
                    <EmptyState title="No fixtures scheduled" body="When a fixture is arranged for this side, it appears here." icon={<CalendarDays size={22} color={colour.inkSubtle} />} />
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
              {tab === "staff" && (
                <EmptyState title="Staff is coming soon" body="A dedicated staff list -- coaches, managers and other team roles -- is being built next. Squad already shows how many staff this side has." icon={<Users size={22} color={colour.inkSubtle} />} />
              )}
            </View>
          </View>
        </ScrollView>
      )}

      {profile && identity && (
        <TeamMenuSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          canEditCover={profile.canEditCover}
          canManageSettings={profile.authority.teamManage}
          onTeamPhoto={() => { setMenuOpen(false); router.push({ pathname: "/teams/[teamId]/photo", params: { teamId: identity.id } } as never) }}
          onTeamSettings={() => { setMenuOpen(false); router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: identity.id } } as never) }}
        />
      )}
    </View>
  )
}

/**
 * THE TEAM'S ACTIONS -- Team Photo and Team Settings only, each shown only where the SAME authority the
 * future editor/existing settings screen already checks says yes (owner brief Section 3/17: "one
 * canonical rule", never a role-name UI check, never inferred from fixture edit, result recording,
 * pitch allocation or roster view). Fold Team stays inside Team Settings' own danger zone -- it does
 * not belong in this menu, and nothing here duplicates it.
 */
function TeamMenuSheet({
  visible,
  onClose,
  canEditCover,
  canManageSettings,
  onTeamPhoto,
  onTeamSettings,
}: {
  visible: boolean
  onClose: () => void
  canEditCover: boolean
  canManageSettings: boolean
  onTeamPhoto: () => void
  onTeamSettings: () => void
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Team">
      {canEditCover && (
        <Pressable accessibilityRole="button" accessibilityLabel="Team Photo. Change the team cover image" onPress={onTeamPhoto} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
          <Camera size={20} color={colour.forest800} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Team Photo</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Change the team cover image</Text>
          </View>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
      {canManageSettings && (
        <Pressable accessibilityRole="button" accessibilityLabel="Team Settings. Details, people and team management" onPress={onTeamSettings} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
          <SlidersHorizontal size={20} color={colour.forest800} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Team Settings</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Details, people and team management</Text>
          </View>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
    </BottomSheet>
  )
}

/** "Senior · Women · 2026/27", "Age Grade · Boys · 2026/27" -- derived from the same canonical
 * `category`/`gender` fields `fullTeamLabel` already reads, never parsed from the team's name and never
 * a second naming rule: this never produces the team's NAME, only a metadata line beside it. A part
 * whose canonical field is genuinely absent (no gender recorded, no current season) is omitted, not
 * guessed. */
function teamMetaLine(identity: TeamProfileIdentity, season: string | null): string {
  const categoryWord = identity.category === "senior" ? "Senior" : identity.category === "colts" ? "Colts" : "Age Grade"
  const genderWord = identity.gender === "mens" ? "Men" : identity.gender === "womens" ? "Women" : identity.gender === "boys" ? "Boys" : identity.gender === "girls" ? "Girls" : identity.gender === "mixed" ? "Mixed" : null
  return [categoryWord, genderWord, season].filter(Boolean).join(" · ")
}

/**
 * THE TEAM'S PHOTOGRAPH (owner's Visual Correction Pass, Section 8; enlarged and realigned in Section
 * 1A): a real cover where the club has set one (`resolveTeamCover`, unchanged -- production truth still
 * runs real cover -> crest -> none), or the SAME deterministic, category-appropriate stand-in Club
 * Admin Home's Your Teams rail uses (`demoTeamCoverAsset`) -- one resolver, called from both places, so
 * a team's card on Home and its own Profile cover are never two different pictures of the same side.
 * The crest is never the photograph: it is always drawn separately, as an identity badge over the
 * photo's bottom edge, exactly as it was before this pass -- just larger, to carry the parent-club
 * identity the way the approved mockup does.
 */
function TeamCoverHero({ identity, profile, onOpenClub }: { identity: TeamProfileIdentity; profile: TeamProfile; onOpenClub?: () => void }) {
  const photo = identity.cover.kind === "cover" ? { uri: identity.cover.url } : demoTeamCoverAsset(identity)
  const metaLine = teamMetaLine(identity, profile.season?.label ?? null)
  return (
    <View style={{ height: 260, overflow: "hidden" }}>
      <Image source={photo} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade />
      <View style={{ flex: 1, padding: space.lg, flexDirection: "row", alignItems: "flex-end", gap: space.md }}>
        {!!identity.crestUrl && (
          <View style={{ width: 84, height: 84, borderRadius: radius.lg, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "center" }}>
            <Image source={{ uri: identity.crestUrl }} accessible={false} contentFit="contain" style={{ width: 66, height: 66 }} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2, paddingBottom: 2 }}>
          <Text accessibilityRole="header" numberOfLines={2} style={[type.title, { color: onForest.primary, fontSize: 24, lineHeight: 28 }]}>{identity.fullLabel}</Text>
          {onOpenClub ? (
            <Pressable accessibilityRole="link" accessibilityLabel={`Open ${identity.clubName}'s club profile`} onPress={onOpenClub} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, alignSelf: "flex-start" })}>
              <Text numberOfLines={1} style={[type.small, { color: onForest.primary }]}>{identity.clubName}</Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={[type.small, { color: onForest.primary }]}>{identity.clubName}</Text>
          )}
          {!!metaLine && <Text numberOfLines={1} style={[type.caption, { color: onForest.secondary, marginTop: 1 }]}>{metaLine}</Text>}
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
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Next Fixture</Text>
        {profile.nextUp ? (
          <NextFixtureCard item={profile.nextUp} today={today} onPress={() => onOpenFixture(profile.nextUp!)} />
        ) : (
          <EmptyState title="No upcoming fixture" body="When a match is arranged for this side, it appears here." icon={<CalendarDays size={22} color={colour.inkSubtle} />} />
        )}
      </View>

      <TeamMetrics profile={profile} />

      <AboutThisTeam description={identity.description} canManage={profile.canEditCover} onManage={() => router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: identity.id } } as never)} />

      {profile.authority.teamManage && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage Team. Team details, people and settings"
          onPress={() => router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: identity.id } } as never)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 10, opacity: pressed ? 0.6 : 1 })}
        >
          <SlidersHorizontal size={18} color={colour.forest800} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Manage Team</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Team details, people and settings</Text>
          </View>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
      {!teamKey && !profile.authority.teamManage && (
        <Text style={[type.caption, { color: colour.inkSubtle }]}>A side&apos;s register, requests and settings belong to the people who run it.</Text>
      )}
    </>
  )
}

/**
 * PLAYERS · STAFF · FIXTURES · WINS -- four real facts, one row (owner brief Section E). Players/Staff
 * are the same authority-gated aggregate the Squad tab already shows; Fixtures/Wins are the current
 * season's own fixtures, public in the same way `nextUp` already is (Clubhouse shows fixture facts
 * cross-club without roster authority). An em dash, never a zero, is what "not available to this
 * viewer" or "no season on record" looks like -- a real zero only ever means a real zero.
 */
function TeamMetrics({ profile }: { profile: TeamProfile }) {
  const metrics: { label: string; value: number | null }[] = [
    { label: "Players", value: profile.people.counts?.players ?? null },
    { label: "Staff", value: profile.people.counts?.staff ?? null },
    { label: "Fixtures", value: profile.seasonSummary?.fixtures ?? null },
    { label: "Wins", value: profile.seasonSummary?.wins ?? null },
  ]
  return (
    <View style={{ flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, paddingVertical: space.md }}>
      {metrics.map((m, i) => (
        <View key={m.label} accessible accessibilityLabel={`${m.label}: ${m.value === null ? "not available" : m.value}`} style={{ flex: 1, alignItems: "center", gap: 2, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: colour.line }}>
          <Text style={[type.title, { color: colour.ink, fontSize: 22 }]}>{m.value === null ? "—" : m.value}</Text>
          <Text style={[type.caption, { color: colour.inkMuted }]}>{m.label}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * ABOUT THIS TEAM -- canonical `teams.description` only, never invented (owner brief Section F/15). The
 * whole card is absent for an unauthorised viewer when there is nothing to show: an admin prompt is
 * exactly the kind of furniture Section F says a stranger must never see. For an authorised manager
 * with nothing written yet, the prompt is now actionable -- it opens the same canonical Team Settings
 * destination the "Manage Team" row already uses, never a second, ad-hoc inline editor.
 */
function AboutThisTeam({ description, canManage, onManage }: { description: string | null; canManage: boolean; onManage: () => void }) {
  if (!description && !canManage) return null
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>About This Team</Text>
      <Text style={[type.small, { color: description ? colour.ink : colour.inkMuted }]}>
        {description ?? "Tell members a little about this team."}
      </Text>
      {!description && canManage && <Button label="Add Description" variant="quiet" onPress={onManage} />}
    </View>
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
