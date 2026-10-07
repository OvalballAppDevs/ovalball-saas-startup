import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, { Easing, Extrapolation, cancelAnimation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated"

import {
  accessibilityLabel,
  activityLabel,
  arenaFocus,
  kindWord,
  longDay,
  operationalState,
  placeLine,
  readArenaHub,
  sortActivities,
  timeRange,
  weekAttention,
  weekDayCard,
  type ArenaActivity,
  type ArenaHub,
  type ArenaRangeDay,
} from "@ovalball/contracts/arena"

import { useAdminCentreAccess } from "../admin/access"
import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { useReduceMotion } from "../a11y/reduce-motion"
import { HomeAwayBadge } from "../components/agenda-row"
import { OvalballDetailHeader } from "../components/app-header"
import { useOriginBack } from "../links/origin"
import { ClubCrest } from "../components/identity"
import { PhotoEdgeShade } from "../components/photo-gradient"
import { CalendarDays, ChevronRight, CircleAlert, ClipboardList, DoorOpen, Dumbbell, LayoutGrid, MapPin, Settings, TriangleAlert, Trophy } from "../components/icons"
import { TOUCH_TARGET, colour, familyOnForest, onForest, radius, space, statusOnForest, surface, type } from "../design/tokens"
import { friendly, logDetail } from "../errors/translate"
import { hasOwnPicture, venuePhoto } from "../fixtures/match-centre/facility-images"
import { IllustrativeTag } from "../media/media-picker"
import { libraryAsset } from "../media/stock-assets"
import { ArenaDestinationCard, PressableScale, tapFeedback } from "./destination-card"
import { useArenaHeroPhoto, type ArenaHeroPhoto } from "./hero-photo"
import { openActivity } from "./navigation"
import { shortDate, weekdayShort } from "./style"

/**
 * ARENA HOME -- built to the owner's APPROVED Arena Hub mock-up (Screen 1, with Screen 2's live surfaces below
 * the fold), which is the source of truth for this screen rather than an inspiration for it.
 *
 * THE PAGE IS DEEP FOREST, deliberately. Ovalball's content canvas is warm chalk, and a screen differs only
 * for a genuine, documented reason; this one's is the approved design itself -- the club's physical world as
 * one dark, photographic architecture (as the Calendar's feature area and the Clubhouse map already differ).
 * White appears where the mock-up puts it: the floating stat card.
 *
 * IN ORDER: the estate from above with the club's name over it and the floating back control on the
 * photograph; what the club owns (four live counts); the six ways in, each a photograph; Arena Planning;
 * then what is happening -- today or the next day anything is on, every ground's pitches in use, and the
 * week ahead. Arena owns no activity: everything comes from the server's one Arena projection and every
 * tap opens the canonical home of what was tapped. Nothing here duplicates another way to the same place.
 */

// THE CLUB'S OWN ESTATE: the primary venue's own picture, else the club's photograph of one of its pitches,
// else Ovalball's Arena aerial marked Illustrative (`hero-photo-choice.ts`).
/** The hero below the status bar at the usual text size: room for the floating header, the club, ARENA and its line. */
const HERO_BODY = 240
/** The floating header below the status bar (8 + 44 + 8): the hero's words always begin beneath it. */
const HEADER_BODY = space.sm * 2 + TOUCH_TARGET
/** How far the stat card reaches up into the photograph -- the bridge between hero and page. */
const STAT_OVERLAP = 36
const GUTTER = space.lg
const TILE_GAP = 10
/** The page: deep forest (see the note above). Raised surfaces are forest800 on it. */
const PAGE = colour.forest900
const RAISED = colour.forest800

/** The event violet (#7448c9) lifted the way familyOnForest lifts the blue, so it reads on forest. */
const EVENT_ON_FOREST = "#b9a2f2"

/** An activity's own hue, lifted to read on forest -- the same family the Calendar and the agenda use. */
function toneOnForest(a: Pick<ArenaActivity, "kind">): string {
  if (a.kind === "FIXTURE") return familyOnForest.green
  if (a.kind === "TRAINING") return familyOnForest.blue
  if (a.kind === "TOURNAMENT") return colour.mint300
  return EVENT_ON_FOREST
}

export function ArenaHubScreen() {
  // Back to whoever opened the Arena (Home, More, the Admin Centre) -- never a guess at the stack beneath.
  const back = useOriginBack("/admin")
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const { clubId } = useAdminCentreAccess()
  const { club } = useAppContexts()
  const reduceMotion = useReduceMotion()
  const [hub, setHub] = useState<ArenaHub | null>(null)
  const [problem, setProblem] = useState<{ message: string; forbidden: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      setHub(await readArenaHub(supabase, clubId))
    } catch (cause) {
      const failure = friendly(cause, "Arena")
      logDetail("arena hub", failure)
      const code = typeof cause === "object" && cause && "code" in cause ? String((cause as { code: unknown }).code) : ""
      setProblem({ message: failure.message, forbidden: code === "42501" })
    }
  }, [clubId])

  // Focus covers the first visit as well as every return, so this is the one load.
  useFocusEffect(useCallback(() => { void load() }, [load]))

  // THE HEADER RIDES ON THE PHOTOGRAPH at rest. The moment the page moves, the forest bar comes in behind the
  // back control -- before the club's name and ARENA can slide under the clock -- and the title follows as the
  // hero's own ARENA passes beneath it. Both distances are from the top, where the hero's words begin at any
  // text size.
  const heroMinHeight = insets.top + HERO_BODY
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y })
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [8, 56], [0, 1], Extrapolation.CLAMP) }))
  const titleStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [50, 100], [0, 1], Extrapolation.CLAMP) }))

  const focus = useMemo(() => (hub ? arenaFocus(hub) : null), [hub])
  const estateRoute = (focusOn: "venues" | "pitches" | "rooms") =>
    hub && hub.venues.length === 1 && focusOn !== "venues"
      ? ({ pathname: "/admin/venues/[venueId]", params: { venueId: hub.venues[0].id } } as never)
      : ("/admin/venues" as never)
  const openPlanning = (params: Record<string, string> = {}) => router.push({ pathname: "/admin/arena/planning", params } as never)
  const clubName = hub?.club.name ?? club.name ?? "Your club"
  // Two photographs across, as the mock-up has them; one across at accessibility text sizes, so a title is
  // never larger than the picture it names. The week strip widens its days the same way.
  const largeText = fontScale > 1.4
  const tileWidth = largeText ? width - GUTTER * 2 : Math.floor((width - GUTTER * 2 - TILE_GAP) / 2)
  // 0.56 keeps Arena Planning whole above the tab bar on the first screen, as the mock-up shows it.
  const tileHeight = Math.round(tileWidth * (largeText ? 0.5 : 0.56))
  const dayWidth = Math.floor(((width - GUTTER - space.sm * 3) / 3.45) * Math.min(Math.max(fontScale, 1), 2.4))
  const forbidden = problem?.forbidden ?? false

  // THE BANNER'S PICTURE: the club's own estate first, Ovalball's only when it has none (see `hero-photo.ts`).
  const estate = useMemo(() => (hub ? { venues: hub.venues, pitches: hub.todayAtTheClub.pitches } : null), [hub])
  const heroPhoto = useArenaHeroPhoto(estate)

  // THE FOURTH COUNT IS OPERATIONAL. When anything in the next seven days needs somebody -- by the strip's own
  // rule, `weekAttention`: something to allocate, or a clash -- it says how many in the restrained amber and
  // opens Arena Planning on the first day it happens. Otherwise it is what is coming up, and opens the week.
  const attention = hub ? weekAttention(hub.week) : null
  const fourth: StatFact = attention && attention.count > 0 && attention.firstDate
    ? {
        key: "attention",
        icon: <TriangleAlert size={17} color={colour.warning} />,
        n: attention.count,
        label: "Need Attention",
        tone: "attention",
        spoken: (n) => {
          const parts = [
            attention.needsAllocation > 0 ? `${attention.needsAllocation} to allocate` : null,
            attention.conflicts > 0 ? `${attention.conflicts} ${attention.conflicts === 1 ? "clash" : "clashes"}` : null,
          ].filter(Boolean)
          return `${n} need attention in the next 7 days: ${parts.join(" and ")}. Opens Arena Planning on ${longDay(attention.firstDate!)}.`
        },
        onPress: () => openPlanning({ date: attention.firstDate! }),
      }
    : {
        key: "upcoming",
        icon: <CalendarDays size={17} color={colour.forest800} />,
        n: hub?.estate.upcoming,
        label: "Upcoming",
        spoken: (n) => `${n} upcoming ${n === 1 ? "activity" : "activities"} in the next 7 days. Opens the week in Arena Planning.`,
        onPress: hub ? () => openPlanning({ mode: "week" }) : undefined,
      }
  // Four counts; the first three are facts about what the club owns (the tiles below are the ways in).
  const stats: StatFact[] = [
    { key: "venues", icon: <MapPin size={17} color={colour.forest800} />, n: hub?.estate.venues, label: hub?.estate.venues === 1 ? "Venue" : "Venues", spoken: (n) => `${n} ${n === 1 ? "venue" : "venues"}` },
    { key: "pitches", icon: <LayoutGrid size={17} color={colour.forest800} />, n: hub?.estate.pitches, label: hub?.estate.pitches === 1 ? "Pitch" : "Pitches", spoken: (n) => `${n} ${n === 1 ? "pitch" : "pitches"}` },
    { key: "rooms", icon: <DoorOpen size={17} color={colour.forest800} />, n: hub?.estate.rooms, label: "Changing Rooms", spoken: (n) => `${n} changing ${n === 1 ? "room" : "rooms"}` },
    fourth,
  ]

  const destinations = [
    { key: "venues", title: "Venues", subtitle: "Manage all club venues", image: libraryAsset("venue-clubhouse-dusk-02"), icon: <MapPin size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push("/admin/venues" as never) },
    { key: "pitches", title: "Pitches", subtitle: "Switch on, edit and allocate", image: libraryAsset("pitch-touchline-01"), icon: <LayoutGrid size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push(estateRoute("pitches")) },
    { key: "rooms", title: "Changing Rooms", subtitle: "Facilities and access", image: libraryAsset("changing-oak-hooks-01"), icon: <DoorOpen size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push(estateRoute("rooms")) },
    // A player with the ball rather than kit on grass: of the six, Training is the one that is about people.
    { key: "training", title: "Training", subtitle: "Plan and manage sessions", image: libraryAsset("training-player-ball-01"), icon: <Dumbbell size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push("/admin/training-planning" as never) },
    { key: "tournaments", title: "Tournaments", subtitle: "Create and run tournaments", image: libraryAsset("tournament-festival-aerial-01"), icon: <Trophy size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push("/admin/tournaments" as never) },
    { key: "events", title: "Events", subtitle: "Club and team events", image: libraryAsset("event-winter-social-01"), icon: <CalendarDays size={14} color={colour.onForest} strokeWidth={2.2} />, onPress: () => router.push("/admin/events" as never) },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        refreshControl={<RefreshControl tintColor={colour.onForest} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
      >
        <Hero photo={heroPhoto} minHeight={heroMinHeight} topInset={insets.top} clubName={clubName} crestUrl={club.crestUrl} reduceMotion={reduceMotion} />

        {forbidden && problem ? (
          // Nothing of the estate is shown to somebody Arena is not for -- not even a card of dashes.
          <ForestNotice
            title="Arena is for the people who plan the club's facilities"
            body="Planning pitches and changing rooms is given to specific people by the club. Your fixtures, sessions and events are on the Calendar."
            action={{ label: "Calendar", onPress: () => router.push("/calendar" as never) }}
            style={{ marginTop: -STAT_OVERLAP }}
          />
        ) : (
          <>
            {/* WHAT THE CLUB OWNS -- four live counts on the one white card, bridging photograph and page. Four
                across as the mock-up has them; two by two once accessibility text sizes would split their names. */}
            <View
              style={{ marginTop: -STAT_OVERLAP, marginHorizontal: GUTTER, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colour.surface, shadowColor: colour.forest950, shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}
            >
              {(largeText ? [stats.slice(0, 2), stats.slice(2)] : [stats]).map((row, r) => (
                <View key={r} style={{ flexDirection: "row", ...(r > 0 ? { marginTop: space.sm, marginHorizontal: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colour.line } : {}) }}>
                  {row.map((s, i) => <Stat key={s.key} fact={s} divider={i > 0} />)}
                </View>
              ))}
            </View>
          </>
        )}

        {forbidden && problem ? null : (
          <>
            {/* THE SIX WAYS IN, as photographs: the estate's places, then the club's activity. */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingHorizontal: GUTTER, marginTop: space.md }}>
              {destinations.map((d) => (
                <ArenaDestinationCard key={d.key} title={d.title} subtitle={d.subtitle} image={d.image} icon={d.icon} width={tileWidth} height={tileHeight} reduceMotion={reduceMotion} onPress={d.onPress} />
              ))}
            </View>

            {/* ARENA PLANNING -- the operational brain, and it looks like it. */}
            <PressableScale
              accessibilityLabel="Arena Planning. Every pitch and changing room, hour by hour."
              onPress={() => openPlanning({ date: hub?.today ?? "" })}
              reduceMotion={reduceMotion}
              scaleTo={0.985}
              // Raised above the page rather than sunk into it, outlined in the bright green, with the planner's own
              // mark -- as the mock-up draws it.
              style={{ marginHorizontal: GUTTER, marginTop: space.md, minHeight: 62, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colour.pitch600, backgroundColor: RAISED }}
            >
              <ClipboardList size={28} color={colour.pitch400} strokeWidth={1.8} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.heading, { color: colour.onForest }]}>Arena Planning</Text>
                <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={largeText ? undefined : 2}>Every pitch and changing room, hour by hour</Text>
              </View>
              <ChevronRight size={20} color={colour.onForest} />
            </PressableScale>

            {problem && (
              <ForestNotice
                tone="danger"
                title="Arena did not load"
                body={problem.message}
                action={{ label: "Try Again", onPress: () => void load() }}
                style={{ marginTop: space.xl }}
              />
            )}
            {!problem && !hub && <DarkSkeleton />}

            {hub && (
              <>
                {/* WHAT IS HAPPENING -- today when anything is on at the club, otherwise the next day something is. */}
                <NextAtTheClub
                  hub={hub}
                  focus={focus}
                  onOpenActivity={(a) => openActivity(router, a)}
                  onViewAll={(date) => openPlanning({ date, view: "list" })}
                />

                {/* EACH GROUND, AND HOW MUCH OF IT IS IN USE NOW. */}
                {hub.venues.length > 0 && (
                  <DarkCard title="Venue Availability" style={{ marginTop: space.md }}>
                    {hub.venues.map((v, i) => {
                      const cover = { coverImagePath: v.coverImagePath, coverStockKey: v.coverStockKey }
                      const inUse = Math.min(v.pitchesInUseNow, v.pitches)
                      const where = [v.address, v.postcode].filter(Boolean).join(", ") || (v.isDefault ? "Home ground" : `${v.rooms} changing ${v.rooms === 1 ? "room" : "rooms"}`)
                      return (
                        <Pressable
                          key={v.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${v.name}. ${where}. ${inUse} of ${v.pitches} ${v.pitches === 1 ? "pitch" : "pitches"} in use now.`}
                          onPress={() => router.push({ pathname: "/admin/venues/[venueId]", params: { venueId: v.id } } as never)}
                          // At accessibility text sizes the picture goes above the words, so a ground's name and
                          // address are read whole rather than cut to a few letters beside a thumbnail.
                          style={({ pressed }) => ({ flexDirection: largeText ? "column" : "row", alignItems: largeText ? "stretch" : "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: onForest.line, backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent" })}
                        >
                          <View style={{ width: largeText ? "100%" : 72, height: largeText ? 120 : 54, borderRadius: radius.sm + 2, overflow: "hidden", backgroundColor: PAGE }}>
                            <Image source={venuePhoto(cover, v.id)} accessible={false} contentFit="cover" transition={200} style={{ width: "100%", height: "100%" }} />
                            {!hasOwnPicture(cover) && <IllustrativeTag size="small" />}
                          </View>
                          <View style={{ flex: largeText ? undefined : 1, minWidth: 0, gap: 1 }}>
                            <Text style={[type.smallMedium, { color: colour.onForest }]} numberOfLines={largeText ? 3 : 1}>{v.name}</Text>
                            <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={largeText ? 3 : 1}>{where}</Text>
                            {v.pitches > 0 ? (
                              <>
                                {/* Bright green only when something is in use; an idle ground reads as quiet, not as good news. */}
                                <Text style={[type.caption, { color: inUse > 0 ? colour.pitch400 : onForest.secondary, fontFamily: type.smallMedium.fontFamily }]}>{`${inUse} / ${v.pitches} ${v.pitches === 1 ? "pitch" : "pitches"} in use`}</Text>
                                <View style={{ height: 4, borderRadius: 2, marginTop: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                                  <View style={{ width: `${(inUse / v.pitches) * 100}%`, height: "100%", backgroundColor: colour.pitch600 }} />
                                </View>
                              </>
                            ) : (
                              <Text style={[type.caption, { color: onForest.secondary }]}>No pitches recorded</Text>
                            )}
                          </View>
                          {!largeText && <ChevronRight size={17} color={onForest.secondary} />}
                        </Pressable>
                      )
                    })}
                  </DarkCard>
                )}

                {/* WHAT IS COMING -- seven days, each only what is useful; a day opens Arena Planning on that date. */}
                <View style={{ marginTop: space.xl }}>
                  <View style={{ paddingHorizontal: GUTTER, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colour.onForest }]}>Plan Your Week</Text>
                    <Text style={[type.caption, { color: onForest.secondary }]}>Next 7 days</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: GUTTER, paddingTop: space.sm }}>
                    {hub.week.map((d) => (
                      <WeekDay key={d.date} day={d} today={hub.today} width={dayWidth} reduceMotion={reduceMotion} onPress={() => openPlanning({ date: d.date })} />
                    ))}
                  </ScrollView>
                </View>
              </>
            )}
          </>
        )}
      </Animated.ScrollView>

      {/* Drawn last so it sits over the scrolled content; at rest it is only a back control on the photograph. */}
      <OvalballDetailHeader
        title="Arena"
        onBack={back}
        overlay={{
          backdrop: <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surface.forest, borderBottomWidth: 1, borderBottomColor: onForest.line }, backdropStyle]} />,
          titleStyle,
        }}
        rightAction={hub?.canManage ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Arena settings" onPress={() => router.push("/admin/arena/settings" as never)} hitSlop={6}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(255,255,255,0.12)" : "transparent" })}>
            <Settings size={20} color={colour.onForest} />
          </Pressable>
        ) : undefined}
      />
    </View>
  )
}

/**
 * The club's own estate (or, until it has a picture of its own, Ovalball's -- marked Illustrative), the club's
 * crest and name over it, and ARENA -- the entrance to the club's physical world. Its words sit at the foot in
 * the page's own flow, never beneath the floating header: at the usual text size the hero is exactly its usual
 * height, and with larger text it grows to hold them.
 */
function Hero({ photo, minHeight, topInset, clubName, crestUrl, reduceMotion }: {
  photo: ArenaHeroPhoto | null
  minHeight: number
  topInset: number
  clubName: string
  crestUrl: string | null
  reduceMotion: boolean
}) {
  const drift = useSharedValue(1)
  useEffect(() => {
    if (reduceMotion) { cancelAnimation(drift); drift.value = 1; return }
    // One slow drift across the estate -- never needed to read anything, gone under Reduce Motion.
    drift.value = withRepeat(withTiming(1.06, { duration: 22000, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(drift)
  }, [reduceMotion, drift])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: drift.value }] }))
  return (
    // No padding on the hero itself: the photograph and its shade fill it edge to edge (the shade sizes itself
    // as a percentage of this box), and only the words below are inset.
    <View style={{ minHeight, justifyContent: "flex-end", backgroundColor: colour.forest950, overflow: "hidden" }}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        {/* Until the picture is chosen and measured the banner is its forest ground, then the picture fades in. */}
        {photo && <Image source={photo.source} accessible={false} contentFit="cover" contentPosition={photo.contentPosition} transition={250} style={{ width: "100%", height: "100%" }} />}
      </Animated.View>
      {/* Forest behind the floating back control, the estate clear through the middle (no flat veil -- the low
          sun is the photograph's drama), and the foot deepening into the page itself so the words read and the
          photograph dissolves beneath the stat card. */}
      <PhotoEdgeShade top={0.66} ground={PAGE} />
      {/* Ovalball's picture is never passed off as the club's ground; the club's own photograph carries no mark.
          Top right, just under the settings control, since the banner's corners belong to the header. */}
      {photo?.illustrative && <IllustrativeTag placement="top" style={{ left: "auto", right: GUTTER, top: topInset + HEADER_BODY - 6 }} />}
      <View style={{ gap: 2, paddingTop: topInset + HEADER_BODY + space.sm, paddingHorizontal: GUTTER, paddingBottom: STAT_OVERLAP + space.lg }}>
        {/* Seen, not spoken: the heading below already says "<club> Arena", so the crest and name are not read
            out a second and third time. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingRight: photo?.illustrative ? 96 : 0 }}>
          <ClubCrest clubName={clubName} url={crestUrl} size={28} />
          <Text maxFontSizeMultiplier={2} style={[type.smallMedium, { color: "rgba(255,255,255,0.92)", flex: 1, textShadowColor: "rgba(7,28,20,0.7)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }]} numberOfLines={2}>{clubName}</Text>
        </View>
        {/* Already display-sized, so it grows only a little with larger text; its spoken name is unchanged. */}
        <Text accessibilityRole="header" accessibilityLabel={`${clubName} Arena`} maxFontSizeMultiplier={1.3} style={{ fontFamily: type.display.fontFamily, fontSize: 54, lineHeight: 56, letterSpacing: 4, color: "#fff", marginTop: 4, textShadowColor: "rgba(7,28,20,0.55)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10 }}>ARENA</Text>
        <Text maxFontSizeMultiplier={1.6} style={[type.body, { color: "#fff", marginTop: -2, textShadowColor: "rgba(7,28,20,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 }]}>Your club. Every ground. One place.</Text>
      </View>
    </View>
  )
}

type StatFact = {
  key: string
  icon: React.ReactNode
  n: number | undefined
  label: string
  spoken: (n: number) => string
  /** Work that needs somebody: the icon and the number in the restrained amber, nothing more. */
  tone?: "attention"
  onPress?: () => void
}

/**
 * One count on the white card: the icon of what it counts, the number, and its name. Every cell looks the same;
 * only the fourth opens anything, and when it is work that needs somebody its icon and number turn amber -- a
 * count, never a banner. The number and name grow with larger text up to the point where four (or, two by two,
 * two) still fit across the card whole. Until the estate arrives the number is a quiet bar, never a dash that
 * reads as "none".
 */
function Stat({ fact, divider }: { fact: StatFact; divider?: boolean }) {
  const { icon, n, label, spoken, tone, onPress } = fact
  const cell = { flex: 1, alignItems: "center" as const, paddingHorizontal: 2, borderLeftWidth: divider ? 1 : 0, borderLeftColor: colour.line }
  const body = (
    <>
      {icon}
      {n === undefined ? (
        <View style={{ width: 22, height: 14, borderRadius: 4, marginTop: 8, marginBottom: 6, backgroundColor: colour.line }} />
      ) : (
        <Text maxFontSizeMultiplier={2} style={{ fontFamily: type.heading.fontFamily, fontSize: 21, lineHeight: 25, color: tone === "attention" ? colour.warning : colour.ink, fontVariant: ["tabular-nums"], marginTop: 3 }}>{n}</Text>
      )}
      <Text maxFontSizeMultiplier={2.4} style={[type.caption, { color: colour.inkMuted, textAlign: "center", lineHeight: 14 }]} numberOfLines={2}>{label}</Text>
    </>
  )
  const spokenLabel = n === undefined ? `${label}, loading` : spoken(n)
  if (!onPress) {
    return <View accessible accessibilityLabel={spokenLabel} style={cell}>{body}</View>
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spokenLabel} onPress={() => { tapFeedback(); onPress() }} style={({ pressed }) => [cell, { opacity: pressed ? 0.6 : 1 }]}>
      {body}
    </Pressable>
  )
}

/**
 * A PRODUCT STATE ON FOREST -- the page's own raised surface rather than a chalk card dropped on a dark page:
 * a title, what it means, and the one way forward in the bright green (forest text on it, about 5.7:1).
 */
function ForestNotice({ title, body, action, tone = "calm", style }: {
  title: string
  body: string
  action?: { label: string; onPress: () => void }
  tone?: "calm" | "danger"
  style?: object
}) {
  return (
    <View style={[{ marginHorizontal: GUTTER, padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: RAISED, borderWidth: 1, borderColor: onForest.line }, style]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        {tone === "danger" && <View style={{ marginTop: 2 }}><CircleAlert size={18} color={statusOnForest.danger.ink} /></View>}
        <Text accessibilityRole={tone === "danger" ? "alert" : "header"} style={[type.bodyMedium, { flex: 1, color: colour.onForest }]}>{title}</Text>
      </View>
      <Text style={[type.small, { color: onForest.secondary }]}>{body}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: TOUCH_TARGET, justifyContent: "center", marginTop: space.xs, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colour.pitch600, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={[type.smallMedium, { color: colour.forest950 }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  )
}

/** A raised forest surface with its own heading -- Screen 2's live cards. */
function DarkCard({ title, action, style, children }: { title: string; action?: React.ReactNode; style?: object; children: React.ReactNode }) {
  return (
    <View style={[{ marginHorizontal: GUTTER, borderRadius: radius.lg, backgroundColor: RAISED, borderWidth: 1, borderColor: onForest.line, overflow: "hidden" }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.onForest, flex: 1 }]}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  )
}

/**
 * TODAY AT THE CLUB / NEXT AT THE CLUB -- the day, a small chip for its state, what still needs doing in one
 * line, and its first few activities, each opening its own centre. Ready is a chip, not a card's worth of words.
 */
function NextAtTheClub({ hub, focus, onOpenActivity, onViewAll }: {
  hub: ArenaHub
  focus: ReturnType<typeof arenaFocus>
  onOpenActivity: (a: ArenaActivity) => void
  onViewAll: (date: string) => void
}) {
  if (!focus) {
    return (
      <DarkCard title="Next at the Club" style={{ marginTop: space.xl }}>
        <Text style={[type.small, { color: onForest.secondary, paddingHorizontal: space.md, paddingBottom: space.md }]}>
          Nothing is booked at the club in the next four weeks. A home fixture, a session, a tournament or an event appears here with what it needs.
        </Text>
      </DarkCard>
    )
  }
  const state = operationalState(focus.day)
  const activities = sortActivities(focus.day.activities)
  const shown = activities.slice(0, 3)
  const attention = state.facts.filter((f) => !/catering/.test(f))
  const dayWords = focus.isToday ? "today" : `on ${longDay(focus.date)}`
  const allSpoken = `View all ${activities.length} ${activities.length === 1 ? "activity" : "activities"} ${dayWords} in Arena Planning`
  const viewAll = (
    <Pressable accessibilityRole="button" accessibilityLabel={allSpoken} onPress={() => onViewAll(focus.date)} hitSlop={10}
      style={({ pressed }) => ({ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Text style={[type.caption, { color: colour.pitch400, fontFamily: type.smallMedium.fontFamily }]}>View All</Text>
      <ChevronRight size={15} color={colour.pitch400} />
    </Pressable>
  )
  const chip = state.ready ? statusOnForest.calm : statusOnForest.warning
  return (
    <DarkCard title={focus.isToday ? "Today at the Club" : "Next at the Club"} action={viewAll} style={{ marginTop: space.xl }}>
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm, gap: 6 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
          <Text style={[type.caption, { color: onForest.secondary }]}>{longDay(focus.date)}</Text>
          <View accessible accessibilityLabel={state.ready ? "Ready: all required facilities are allocated" : "Needs attention"} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: chip.ground }}>
            {!state.ready && <TriangleAlert size={11} color={familyOnForest.amber} />}
            <Text style={[type.caption, { color: chip.ink, fontFamily: type.smallMedium.fontFamily }]}>{state.ready ? "Ready" : "Needs attention"}</Text>
          </View>
        </View>
        {attention.length > 0 && <Text style={[type.caption, { color: statusOnForest.warning.ink }]} numberOfLines={2}>{attention.join(" · ")}</Text>}
      </View>
      {shown.map((a) => (
        <ActivityRow key={`${a.kind}-${a.id}`} activity={a} place={placeLine(focus.day, a)} label={accessibilityLabel(focus.day, a)} onPress={() => onOpenActivity(a)} />
      ))}
      {/* The rest of the day is one tap away at the foot of the card, where the thumb already is. */}
      {activities.length > shown.length && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={allSpoken}
          onPress={() => onViewAll(focus.date)}
          style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.md, paddingRight: space.sm, borderTopWidth: 1, borderTopColor: onForest.line, backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent" })}
        >
          <Text style={[type.caption, { color: onForest.secondary }]}>
            {`${activities.length - shown.length} more ${focus.isToday ? "today" : `on ${longDay(focus.date).split(" ")[0]}`}`}
          </Text>
          <ChevronRight size={16} color={onForest.secondary} />
        </Pressable>
      )}
    </DarkCard>
  )
}

function ActivityRow({ activity: a, place, label, onPress }: { activity: ArenaActivity; place: string; label: string; onPress: () => void }) {
  const { fontScale } = useWindowDimensions()
  const largeText = fontScale > 1.4
  const hue = toneOnForest(a)
  const needs = ((a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING") && a.needs.length > 0
  const KindIcon = a.kind === "TRAINING" ? Dumbbell : a.kind === "TOURNAMENT" ? Trophy : CalendarDays
  // A fixture's home or away is Ovalball's lettered badge (green H, blue A), never the word in a grey line; the
  // spoken label still says "home fixture" or "away fixture" in full.
  const mark = a.kind === "FIXTURE"
    ? <HomeAwayBadge home={{ short: a.home ? "H" : "A", spoken: a.home ? "Home" : "Away" }} size={20} onDark />
    : <KindIcon size={17} color={hue} />
  const detail = a.kind === "FIXTURE" ? place : `${kindWord(a)} · ${place}`
  // At least a column wide, and above the words at accessibility sizes -- a time is never broken across lines.
  const time = <Text style={[type.smallMedium, { minWidth: 44, color: colour.onForest, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{timeRange(a).split("–")[0]}</Text>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens it in its own centre"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 56, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.sm, borderTopWidth: 1, borderTopColor: onForest.line, backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent" })}
    >
      {!largeText && time}
      <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: hue }} />
      {mark}
      <View style={{ flex: 1, minWidth: 0 }}>
        {largeText && time}
        <Text style={[type.smallMedium, { color: colour.onForest }]} numberOfLines={largeText ? 3 : 1}>{activityLabel(a)}</Text>
        <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={largeText ? 3 : 1}>{detail}</Text>
      </View>
      {needs && <TriangleAlert size={14} color={familyOnForest.amber} />}
      <ChevronRight size={16} color={onForest.secondary} />
    </Pressable>
  )
}

/**
 * ONE DAY OF THE WEEK STRIP -- compact enough that three and a half show at once: the day, what is on in a
 * word or two and a time, a small mark for each kind of thing on it, and, in amber with words, what needs doing.
 */
function WeekDay({ day, today, width, reduceMotion, onPress }: { day: ArenaRangeDay; today: string; width: number; reduceMotion: boolean; onPress: () => void }) {
  const card = weekDayCard(day)
  const isToday = day.date === today
  const attention = card.attention.length > 0
  const quiet = card.lines[0] === "Nothing booked"
  const marks = [
    day.homeGames > 0 ? familyOnForest.green : null,
    day.awayGames > 0 ? "rgba(255,255,255,0.55)" : null,
    day.training > 0 ? familyOnForest.blue : null,
    day.tournaments > 0 ? colour.mint300 : null,
    day.events > 0 ? EVENT_ON_FOREST : null,
  ].filter((m): m is string => !!m)
  return (
    <PressableScale
      accessibilityLabel={`${isToday ? "Today" : `${weekdayShort(day.date)} ${shortDate(day.date)}`}. ${[...card.lines, ...card.attention].join(", ")}. Opens Arena Planning on this day.`}
      onPress={onPress}
      reduceMotion={reduceMotion}
      style={{ width, minHeight: 98, padding: space.sm + 2, gap: 3, borderRadius: radius.md + 2, backgroundColor: RAISED, borderWidth: isToday ? 1.5 : 1, borderColor: attention ? "rgba(251,191,36,0.6)" : isToday ? colour.pitch600 : onForest.line }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[type.caption, { color: isToday ? colour.pitch400 : onForest.secondary, fontFamily: type.smallMedium.fontFamily }]}>{isToday ? "Today" : `${weekdayShort(day.date)} ${Number(day.date.slice(8))}`}</Text>
        <View style={{ flexDirection: "row", gap: 3 }}>
          {marks.map((m, i) => <View key={`${m}-${i}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m }} />)}
        </View>
      </View>
      {/* A quiet day reads quieter, but still at text contrast: faint white on forest is a line, not words. */}
      <Text style={[type.smallMedium, { color: quiet ? onForest.secondary : colour.onForest, fontSize: 13, lineHeight: 17 }]} numberOfLines={2}>{card.lines[0]}</Text>
      {!!card.lines[1] && <Text style={[type.caption, { color: onForest.secondary }]} numberOfLines={1}>{card.lines[1]}</Text>}
      {card.attention.map((l) => (
        <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: "auto" }}>
          <TriangleAlert size={10} color={familyOnForest.amber} />
          <Text style={[type.caption, { color: statusOnForest.warning.ink }]} numberOfLines={1}>{l}</Text>
        </View>
      ))}
    </PressableScale>
  )
}

/** While the day loads: the shape of the live card in forest, so nothing jumps when it arrives. */
function DarkSkeleton() {
  return (
    <View style={{ marginHorizontal: GUTTER, marginTop: space.xl, height: 196, borderRadius: radius.lg, backgroundColor: RAISED, borderWidth: 1, borderColor: onForest.line, padding: space.md, gap: space.sm }}>
      <View style={{ width: "48%", height: 16, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)" }} />
      <View style={{ width: "30%", height: 12, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)" }} />
      {[0, 1, 2].map((i) => <View key={i} style={{ height: 36, borderRadius: 6, marginTop: space.xs, backgroundColor: "rgba(255,255,255,0.05)" }} />)}
    </View>
  )
}
