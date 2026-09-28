import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem } from "@ovalball/contracts"
import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfile, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import { readTeamPeople, teamPeopleErrorMessage, type TeamPeople, type TeamPerson } from "@ovalball/contracts/team/people"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { dateBlock, homeAwayLabel, kickoffLabel, opponentLine, relativeDate, resultOutcome, shortVenue, spokenAgendaItem } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { teamContextKeyFor } from "./context"
import { demoTeamCoverAsset } from "./team-cover-demo"
import { teamCoverPhotoSource } from "./cover-library"
import { EditDescriptionSheet } from "./edit-description-sheet"
import { StaffTab } from "./staff-tab"
import { MediaTab } from "./media-tab"
import { NotForYou } from "./screen"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { BottomSheet } from "../components/bottom-sheet"
import { NextFixtureCard } from "../components/agenda-row"
import { ClubCrest, PersonAvatar } from "../components/identity"
import { PhotoBottomShade } from "../components/photo-gradient"
import { pageFixtures } from "../agenda/fixture-list"
import { Camera, CalendarDays, ChevronRight, Ellipsis, KeyRound, MapPin, Search, SlidersHorizontal, UserPlus, Users } from "../components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../design/tokens"

type Tab = "overview" | "fixtures" | "squad" | "staff" | "media"
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "fixtures", label: "Fixtures" },
  { key: "squad", label: "Squad" },
  { key: "staff", label: "Staff" },
  { key: "media", label: "Media" },
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
  // PRESERVED ACROSS A FIXTURE VISIT (Section 13): this screen stays mounted while a row push takes the
  // viewer to `/fixtures/[fixtureId]`, so the segment they had open is exactly where Back returns them,
  // with no extra state to restore.
  const [fixtureSegment, setFixtureSegment] = useState<"upcoming" | "past" | "all">("upcoming")
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)

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

  const menuAvailable = !!profile && (profile.canEditCover || profile.authority.teamManage)

  // THE THREE FIXTURE LISTS THIS TAB EVER SHOWS -- narrowed and de-duplicated ONCE here from the two
  // reads `loadTeamProfile` already made (`upcoming`, `history`), never a fourth network round trip.
  //   Upcoming: legitimate future fixtures, nearest first, cancelled excluded (Section 6).
  //   Past:     completed fixtures, most recent first, cancelled excluded (Section 7 -- a cancelled
  //             match never legitimately reads as "the past", it is a fixture that did not happen).
  //   All:      the season's own reading order, oldest to newest, WITH cancelled fixtures kept in their
  //             real date slot (Section 8/24) -- the one place this tab admits a cancelled match ever
  //             existed, deliberately restrained rather than hidden from history entirely.
  const fixtureLists = useMemo(() => {
    if (!profile) return { upcoming: [], past: [], all: [] }
    const onlyFixtures = (items: AgendaItem[]) => items.filter((i) => i.kind === "fixture")
    const notCancelled = (i: AgendaItem) => i.status !== "Cancelled"
    const upcoming = onlyFixtures(profile.upcoming).filter(notCancelled)
    const past = onlyFixtures(profile.history).filter(notCancelled)
    const seen = new Set<string>()
    const all = [...onlyFixtures(profile.upcoming), ...onlyFixtures(profile.history)]
      .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { upcoming, past, all }
  }, [profile])

  // "VIEW FULL FIXTURE LIST" ONLY WHERE IT COULD LEGITIMATELY SHOW SOMETHING (Section 17/27): the
  // canonical Fixtures agenda scopes itself from the viewer's OWN active context, which this screen does
  // not control and must never silently switch. Offered only where that context already, structurally,
  // covers this team -- standing in its own team context, standing in this team's own club, or Site
  // Admin's platform-wide one -- never guessed from whether Team Profile itself happens to show fixtures,
  // which would send a cross-club guest or a family context to a screen that would legitimately show
  // them nothing and read as broken rather than as the honest absence it is.
  const canOpenFullFixtureList =
    !!identity &&
    (active?.kind === "site_admin" || (active?.kind === "team" && active.id === identity.id) || (active?.kind === "club" && active.clubId === identity.clubId))

  // SQUAD'S ROW-TAP AND ADD-PLAYER DESTINATIONS SHARE THIS SAME CONSTRAINT (Section 10/12): `/team/
  // people/[kind]/[id]`, `/team/settings/join-codes` and `/team/settings/requests` all resolve their own
  // team id from the viewer's ACTIVE switched context (`useTeamAuthority`), never from a route param --
  // so pushing to any of them is only ever correct when the viewer is already standing inside THIS
  // team's own context. Unlike the Fixtures agenda, a club-wide or Site Admin scope does not make these
  // safe: they would resolve to whatever team (or no team) the viewer happens to be switched into, not
  // this one. Where this is false, a row simply isn't tappable and Add Player isn't offered (Section 10's
  // own explicit fallback), rather than risk sending anyone to another team's roster tools.
  const inThisTeamContext = !!identity && active?.kind === "team" && active.id === identity.id

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* THE TOP BAR STAYS REACHABLE while the rest scrolls -- back navigation and the team menu are
          never scrolled out of reach, exactly like every other detail screen this primitive serves. */}
      <OvalballDetailHeader
        title={identity?.fullLabel ?? "Team"}
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
              continuous ground flowing straight on from the forest bar above, not photo-then-white-page.
              The tabs belong entirely to this block: a dedicated forest SPACER, sized to exactly the
              content surface's own corner radius, sits after them so the rounded-sheet overlap below
              only ever eats into that spacer -- never into the tab row's own height or touch targets. */}
          <View style={{ backgroundColor: surface.forest }}>
            {/* THE RICH PHOTOGRAPHIC HERO IS OVERVIEW'S OWN (Section 3): it earns half the screen because
                Overview's whole job is "who is this team". Fixtures/Squad/Staff are working screens --
                the pinned bar above already carries the team's real name, so collapsing straight to the
                tab row here is the SAME profile settling into its working state, never a second header
                or a second route. */}
            {tab === "overview" && (
              <TeamCoverHero identity={identity} profile={profile} onOpenClub={identity.clubDirectoryId ? () => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: identity.clubDirectoryId } } as never) : undefined} />
            )}
            <View style={{ flexDirection: "row", paddingTop: tab === "overview" ? 0 : space.xs, paddingBottom: space.sm }}>
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
            {/* The spacer the rounded content sheet overlaps -- never the tabs above it. */}
            <View style={{ height: radius.xl }} />
          </View>

          {/* THE CONTENT SURFACE, tucked under the forest block's own spacer with a large-radius seam
              rather than a hard edge -- the same relationship the Calendar's own forest plate has to its
              white sheet -- and never across the tab row itself. */}
          <View style={{ flex: 1, backgroundColor: colour.chalk, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -radius.xl, paddingTop: radius.xl }}>
            <View style={{ padding: space.lg, gap: space.md }}>
              {tab === "overview" && (
                <OverviewTab identity={identity} profile={profile} today={today} onOpenFixture={open} router={router} teamKey={teamKey} onEnterTeamContext={() => { void select(teamKey!); router.replace("/" as never) }} onEditDescription={() => setEditingDescription(true)} />
              )}
              {tab === "fixtures" && (
                <FixturesTab
                  lists={fixtureLists}
                  today={today}
                  segment={fixtureSegment}
                  onSegment={setFixtureSegment}
                  onOpenFixture={open}
                  canOpenFullList={canOpenFullFixtureList}
                  onOpenFullList={() => router.push({ pathname: "/fixtures", params: { teamId } } as never)}
                />
              )}
              {tab === "squad" && <SquadTab identity={identity} profile={profile} router={router} inThisTeamContext={inThisTeamContext} />}
              {tab === "staff" && (
                <StaffTab
                  identity={{ id: identity.id, clubId: identity.clubId }}
                  rosterVisible={profile.people.rosterVisible}
                  canManageRoles={profile.authority.roleAssignTeam}
                />
              )}
              {tab === "media" && (
                <MediaTab identity={identity} rosterVisible={profile.people.rosterVisible} canManage={profile.canEditCover} />
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

      {editingDescription && identity && (
        <EditDescriptionSheet
          teamId={identity.id}
          current={identity.description}
          onClose={() => setEditingDescription(false)}
          onSaved={(description) => {
            // Updates the card immediately -- no full reload, no second read -- exactly the value the
            // server just stored (the same trim-to-null it applies, mirrored client-side for this one
            // optimistic update only).
            setIdentity((prior) => (prior ? { ...prior, description } : prior))
            setEditingDescription(false)
          }}
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
  const photo = teamCoverPhotoSource(identity.cover, demoTeamCoverAsset(identity))
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

/**
 * FIXTURES -- "what fixtures does THIS team have" (Section 2 brief), a focused team-scoped view, never
 * the Club Admin fixture agenda wearing this team's colours. Upcoming/Past/All narrow the ONE pair of
 * reads `loadTeamProfile` already made (`upcoming`, `history`) -- no hardcoded review objects, no second
 * fixture domain. Each segment previews at most five (Section 16, via the same `pageFixtures` the old
 * Overview-only list used), nearest/most-recent/earliest first; "View Full Fixture List" is the one door
 * to the deeper, more powerful canonical Fixtures agenda, offered only where that screen's own
 * active-context scoping is already known to cover this team.
 */
function FixturesTab({
  lists,
  today,
  segment,
  onSegment,
  onOpenFixture,
  canOpenFullList,
  onOpenFullList,
}: {
  lists: { upcoming: AgendaItem[]; past: AgendaItem[]; all: AgendaItem[] }
  today: string
  segment: "upcoming" | "past" | "all"
  onSegment: (next: "upcoming" | "past" | "all") => void
  onOpenFixture: (item: AgendaItem) => void
  canOpenFullList: boolean
  onOpenFullList: () => void
}) {
  const shown = pageFixtures(lists[segment], false).shown
  const empty = {
    upcoming: { title: "No upcoming fixtures", body: "When a match is arranged for this side, it will appear here." },
    past: { title: "No past fixtures", body: "Results will appear here once this team has played." },
    all: { title: "No fixtures yet", body: "This team's fixture list will appear here once one is arranged." },
  }[segment]

  return (
    <View style={{ gap: space.md }}>
      <FixtureSegments value={segment} onChange={onSegment} />
      {shown.length === 0 ? (
        <EmptyState title={empty.title} body={empty.body} icon={<CalendarDays size={22} color={colour.inkSubtle} />} />
      ) : (
        <View style={{ gap: space.sm }}>
          {shown.map((item) => (
            <TeamFixtureRow key={item.key} item={item} today={today} onPress={() => onOpenFixture(item)} />
          ))}
        </View>
      )}
      {canOpenFullList && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View Full Fixture List"
          onPress={onOpenFullList}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            minHeight: TOUCH_TARGET,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.forest800,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <CalendarDays size={18} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>View Full Fixture List</Text>
        </Pressable>
      )}
    </View>
  )
}

/** The same forest-fill/neutral segmented control the Fixtures agenda's own Upcoming/Past uses (Section
 * 5), extended to a third option here -- a small, explicit variant rather than a change to that screen's
 * own two-way control, which Calendar/Home never touch and must not gain a third state. */
function FixtureSegments({ value, onChange }: { value: "upcoming" | "past" | "all"; onChange: (next: "upcoming" | "past" | "all") => void }) {
  const options: { key: "upcoming" | "past" | "all"; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "all", label: "All" },
  ]
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}>
      {options.map(({ key, label }) => {
        const selected = key === value
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label} fixtures`}
            onPress={() => onChange(key)}
            style={{ flex: 1, minHeight: TOUCH_TARGET - 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: selected ? colour.forest800 : "transparent" }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.inkMuted }]}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * THE TEAM PROFILE'S OWN FIXTURE ROW (Section 9) -- deliberately not `FixtureListRow`: that row's
 * second line names which of the viewer's OWN teams the fixture belongs to, a fact this screen already
 * gave the reader once, in its header, for every row on the page. This one spends that line on
 * Home/Away and fixture type instead, and shows kickoff alongside venue on the third line (Section 12 --
 * meet time still never appears here or anywhere else in a fixture list), replaced by the real score and
 * a restrained Win/Loss/Draw once a result exists (Section 7). Presentation only: every fact comes from
 * the same `AgendaItem` shape and the same presentation helpers (`dateBlock`, `homeAwayLabel`,
 * `resultOutcome`, `shortVenue`, `kickoffLabel`, `spokenAgendaItem`) `FixtureListRow` itself already
 * draws from.
 */
function TeamFixtureRow({ item, today, onPress }: { item: AgendaItem; today: string; onPress: () => void }) {
  const block = dateBlock(item.date)
  const cancelled = item.status === "Cancelled"
  const home = homeAwayLabel(item.homeAway)
  const outcome = resultOutcome(item.result)
  const venue = shortVenue(item.venue)
  const kickoff = kickoffLabel(item.time)
  const isPast = item.date < today
  const metaLine = [home?.spoken, item.gameType].filter(Boolean).join(" · ") || null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenAgendaItem(item, today)}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: 10,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.94 : cancelled ? 0.65 : 1,
      })}
    >
      <View style={{ width: 34, alignItems: "center", gap: 1 }}>
        <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.weekday}</Text>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 18, lineHeight: 20 }]}>{block.day}</Text>
        <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10, letterSpacing: 0.4 }]}>{block.month}</Text>
      </View>

      <ClubCrest clubName={item.them?.clubName ?? null} url={item.them?.crestUrl ?? null} size={40} />

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text numberOfLines={1} style={[type.bodyMedium, { color: colour.ink, fontSize: 15, textDecorationLine: cancelled ? "line-through" : "none" }]}>
          {opponentLine(item)}
        </Text>
        {!!metaLine && <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{metaLine}</Text>}
        {cancelled ? (
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>Cancelled</Text>
        ) : outcome ? (
          <Text style={[type.caption, { fontSize: 11, color: outcome.tone === "positive" ? colour.forest800 : outcome.tone === "negative" ? colour.danger : colour.inkMuted }]}>
            {item.result!.ourScore}–{item.result!.theirScore} · {outcome.label}
          </Text>
        ) : isPast ? (
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>Result pending</Text>
        ) : venue ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <MapPin size={11} color={colour.inkSubtle} />
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>{[kickoff, venue].filter(Boolean).join(" · ")}</Text>
          </View>
        ) : (
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>{kickoff ? `${kickoff} · Venue TBC` : "Venue TBC"}</Text>
        )}
      </View>

      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
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
  onEditDescription,
}: {
  identity: TeamProfileIdentity
  profile: TeamProfile
  today: string
  onOpenFixture: (item: AgendaItem) => void
  router: ReturnType<typeof useRouter>
  teamKey: string | null
  onEnterTeamContext: () => void
  onEditDescription: () => void
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

      <AboutThisTeam description={identity.description} canManage={profile.canEditCover} onEdit={onEditDescription} />

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
 * exactly the kind of furniture Section F says a stranger must never see. For an authorised manager,
 * "Add Description" (nothing written yet) or "Edit" (something already is) opens the real focused
 * composer (`EditDescriptionSheet`) -- never a hand-off to Team Settings, and never shown at all once
 * text exists for an ordinary viewer, who sees only the words themselves.
 */
function AboutThisTeam({ description, canManage, onEdit }: { description: string | null; canManage: boolean; onEdit: () => void }) {
  if (!description && !canManage) return null
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>About This Team</Text>
        {!!description && canManage && (
          <Pressable accessibilityRole="button" accessibilityLabel="Edit team description" onPress={onEdit} hitSlop={8} style={({ pressed }) => ({ minHeight: 32, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
          </Pressable>
        )}
      </View>
      <Text style={[type.small, { color: description ? colour.ink : colour.inkMuted }]}>
        {description ?? "Tell members a little about this team."}
      </Text>
      {!description && canManage && <Button label="Add Description" variant="quiet" onPress={onEdit} />}
    </View>
  )
}

/**
 * SQUAD -- the legitimate players attached to THIS team, from the same `team_people` RPC and
 * `team.roster.view` gate the existing People screen already relies on (Section 5/6 brief): never a
 * parallel roster query, never a client-side RLS-filtered table read, and never the aggregate
 * `team_people_counts` standing in for the real rows. `profile.people.rosterVisible` is exactly
 * `team.roster.view`'s own answer (confirmed against `internal.team_people_authority`'s current
 * definition), so it correctly predicts whether this call will succeed -- the 42501 branch below is
 * a defensive second line, not the primary gate.
 *
 * FETCHED LAZILY, ONLY WHILE THIS TAB IS OPEN: unlike Fixtures' own small window, a squad list has no
 * natural size cap (Section 23), so nothing here is worth loading for a viewer who never opens Squad.
 */
function SquadTab({
  identity,
  profile,
  router,
  inThisTeamContext,
}: {
  identity: TeamProfileIdentity
  profile: TeamProfile
  router: ReturnType<typeof useRouter>
  inThisTeamContext: boolean
}) {
  const [people, setPeople] = useState<TeamPeople | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [query, setQuery] = useState("")
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setPeople(await readTeamPeople(supabase, identity.id))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        // THE SAME REFUSAL, NEVER RELABELLED (Section 20): a denial is never rendered as "no players
        // yet" -- that would say something false about a team that may have a full squad this viewer
        // simply isn't shown.
        setRefused(true)
        setPeople({ staff: [], players: [], guardians: [], requests: [], archived: [] })
        return
      }
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load the squad. Try again."))
    }
  }, [identity.id])

  useEffect(() => {
    setPeople(null)
    setProblem(null)
    setRefused(false)
    void load()
  }, [load])

  if (!profile.people.rosterVisible || refused) {
    return <NotForYou title="Squad isn&apos;t part of your view" body="Who is in the side is shown to the people who run it." />
  }
  if (problem && !people) {
    return <ErrorState message={problem} onRetry={load} />
  }
  if (people === null) {
    return (
      <View style={{ gap: space.md }}>
        <View style={{ height: 46, borderRadius: radius.pill, backgroundColor: colour.line, opacity: 0.5 }} />
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SquadRowSkeleton key={i} first={i === 0} />
          ))}
        </View>
      </View>
    )
  }

  // ACTIVE PLAYERS ONLY (Section 16): `readTeamPeople`'s own grouping already filters
  // `player_team_memberships.status = 'active'` -- a former or a still-pending player is never counted
  // or rendered here, and the heading's own number is this same array's length, never the separately
  // computed aggregate, so the two can never silently disagree for a fully authorised viewer.
  const players = people.players
  const q = query.trim().toLowerCase()
  const shown = q ? players.filter((p) => p.name.toLowerCase().includes(q)) : players
  const canAdd = inThisTeamContext && (profile.authority.rosterManage || profile.authority.joinCodeManage)
  const openPlayer = inThisTeamContext ? (p: TeamPerson) => router.push({ pathname: "/team/people/[kind]/[id]", params: { kind: p.kind, id: p.rowId } } as never) : undefined

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Squad</Text>
        <Text accessibilityLabel={`${players.length} players`} style={[type.title, { color: colour.ink }]}>{players.length}</Text>
      </View>
      <Text style={[type.caption, { color: colour.inkMuted, marginTop: -space.sm }]}>Players registered to this team</Text>

      {players.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
          <Search size={18} color={colour.inkSubtle} />
          <TextInput
            accessibilityLabel="Search players"
            value={query}
            onChangeText={setQuery}
            placeholder="Search players..."
            placeholderTextColor={colour.inkSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]}
          />
        </View>
      )}

      {players.length === 0 ? (
        <EmptyState title="No players yet" body="Players added to this team will appear here." icon={<Users size={22} color={colour.inkSubtle} />} />
      ) : shown.length === 0 ? (
        <EmptyState title="No players match your search" body="Try a different name." icon={<Search size={22} color={colour.inkSubtle} />} />
      ) : (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {shown.map((p, i) => (
            <SquadRow key={p.rowId} person={p} first={i === 0} onPress={openPlayer ? () => openPlayer(p) : undefined} />
          ))}
        </View>
      )}

      {canAdd && <Button label="Add Player" onPress={() => setAddOpen(true)} />}
      <AddPlayerSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        canManageRequests={profile.authority.rosterManage}
        canManageCodes={profile.authority.joinCodeManage}
        onJoinRequests={() => { setAddOpen(false); router.push("/team/settings/requests" as never) }}
        onJoinCodes={() => { setAddOpen(false); router.push("/team/settings/join-codes" as never) }}
      />
    </View>
  )
}

function SquadRow({ person, first, onPress }: { person: TeamPerson; first: boolean; onPress?: () => void }) {
  const row = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      {/* NO REAL PLAYER PHOTO YET (Section 4): the only authorised avatar resolution that exists today
          (`FamilyProjection`) covers a guardian's OWN linked children, not a whole roster a coach or
          admin is looking at -- so this stays the same honest initials fallback the existing People
          screen already uses for every row, rather than a new storage read invented for this screen. */}
      <PersonAvatar name={person.name} url={null} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, fontSize: 15 }]}>{person.name}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Player</Text>
      </View>
      {!!onPress && <ChevronRight size={17} color={colour.inkSubtle} />}
    </View>
  )
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${person.name}, player`}>
        {row}
      </View>
    )
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${person.name}, player`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, opacity: pressed ? 0.85 : 1 })}>
      {row}
    </Pressable>
  )
}

function SquadRowSkeleton({ first }: { first: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colour.line, opacity: 0.5 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ height: 14, width: "55%", borderRadius: 4, backgroundColor: colour.line, opacity: 0.5 }} />
        <View style={{ height: 11, width: "30%", borderRadius: 4, backgroundColor: colour.line, opacity: 0.35 }} />
      </View>
    </View>
  )
}

/**
 * ADD PLAYER -- exactly the two real mobile-reachable ways a squad grows (Section 12 audit: there is no
 * third, "create a player directly" mutation on mobile today). Each row is its own capability, gated
 * independently and exactly as `Team Settings` itself already gates them -- this sheet invents no new
 * authority and no new membership mutation, it is only a shortcut into the two that already exist.
 */
function AddPlayerSheet({
  visible,
  onClose,
  canManageRequests,
  canManageCodes,
  onJoinRequests,
  onJoinCodes,
}: {
  visible: boolean
  onClose: () => void
  canManageRequests: boolean
  canManageCodes: boolean
  onJoinRequests: () => void
  onJoinCodes: () => void
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add Player">
      {canManageCodes && (
        <Pressable accessibilityRole="button" accessibilityLabel="Join Codes. Share a code a family can use to ask to join" onPress={onJoinCodes} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
          <KeyRound size={20} color={colour.forest800} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Join Codes</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Share a code a family can use to ask to join</Text>
          </View>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
      {canManageRequests && (
        <Pressable accessibilityRole="button" accessibilityLabel="Join Requests. Players waiting to be let into the side" onPress={onJoinRequests} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
          <UserPlus size={20} color={colour.forest800} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Join Requests</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>Players waiting to be let into the side</Text>
          </View>
          <ChevronRight size={16} color={colour.inkSubtle} />
        </Pressable>
      )}
    </BottomSheet>
  )
}
