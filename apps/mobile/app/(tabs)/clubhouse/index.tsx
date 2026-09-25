import { useCallback, useState } from "react"
import { Linking, Pressable, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import { readNotificationPage, type FeedNotification } from "@ovalball/contracts/notifications/feed"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { CardSkeleton } from "../../../src/components/ui"
import { editorial } from "../../../src/components/home/editorial"
import { resolveIntent } from "../../../src/links/intents"
import { narrowIntentForContext, routeForIntent } from "../../../src/links/destinations"
import { webUrl } from "../../../src/config/environment"
import { CalendarDays, ChevronRight, HeartHandshake, MapPin, UserPlus } from "../../../src/components/icons"
import { colour, radius, space, type } from "../../../src/design/tokens"

/**
 * CLUBHOUSE HOME — the tab's own root screen (replacing the map as Clubhouse's landing page; the map
 * itself is unchanged and now lives at `map.tsx`, one push away via "Explore the Map"). Product
 * direction: Clubhouse is the rugby community inside Ovalball -- clubs finding each other, arranging
 * games and building partnerships -- not a map with controls bolted on. Every action here is a real,
 * already-canonical Ovalball destination:
 *
 *   Find a Fixture  -> `/clubhouse/find-fixture`     (Section 6/7, unchanged)
 *   Partner Clubs    -> `/clubhouse/map?filter=partners` (Section 5's own partner state, same map/list,
 *                        never a second partner store)
 *   Explore the Map  -> `/clubhouse/map`              (Section 2/11, unchanged)
 *   Refer a Club      -> `/clubhouse/refer`            (a genuinely wired, real screen -- the platform's
 *                        own referral-reward domain, `club_referral_summary`, is real and DB-enforced;
 *                        it was simply never wired to mobile before this screen)
 *
 * RECENT ACTIVITY reads the same `my_notifications` feed the Notifications tab already reads, filtered
 * to the types that are genuinely about the rugby NETWORK (fixture requests, partner requests, and the
 * viewer's own club-claim outcome) -- never a fabricated feed, and never a global "every club's activity"
 * feed, which no capability check has ever authorised. See the type filter below for exactly what
 * qualifies and why.
 */
const CLUBHOUSE_ACTIVITY_TYPES = new Set([
  "fixture_request_received",
  "fixture_request_accepted",
  "fixture_request_declined",
  "fixture_request_countered",
  "partner_request_received",
  "calendar_share_approved",
  "calendar_share_declined",
  "club_claim_approved",
])

const ACTIVITY_LIMIT = 5

export default function ClubhouseHome() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activity, setActivity] = useState<FeedNotification[] | null>(null)
  const [activityError, setActivityError] = useState(false)

  const loadActivity = useCallback(async () => {
    try {
      // One page is enough for a Home teaser -- the full history lives in Notifications. Over-fetch
      // slightly (a full page) before filtering, since most notifications are NOT Clubhouse-relevant.
      const page = await readNotificationPage(supabase, { limit: 30 })
      setActivity(page.items.filter((n) => CLUBHOUSE_ACTIVITY_TYPES.has(n.type)).slice(0, ACTIVITY_LIMIT))
      setActivityError(false)
    } catch {
      setActivity([])
      setActivityError(true)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadActivity()
    }, [loadActivity])
  )

  function openActivity(item: FeedNotification) {
    const intent = narrowIntentForContext(resolveIntent(`ovalball://${item.href.replace(/^\//, "")}`), active?.kind ?? null)
    const route = routeForIntent(intent)
    if (route) {
      router.push(route as never)
      return
    }
    void Linking.openURL(`${webUrl}${item.href}`)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} showsVerticalScrollIndicator={false}>
        <ClubhouseHero onOpenMap={() => router.push("/clubhouse/map" as never)} />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          <ActionTile
            icon={<CalendarDays size={20} color={colour.forest800} strokeWidth={2} />}
            label="Find a Fixture"
            caption="Find clubs that are free"
            onPress={() => router.push("/clubhouse/find-fixture" as never)}
          />
          <ActionTile
            icon={<HeartHandshake size={20} color={colour.forest800} strokeWidth={2} />}
            label="Partner Clubs"
            caption="Build lasting relationships"
            onPress={() => router.push({ pathname: "/clubhouse/map", params: { filter: "partners" } } as never)}
          />
          <ActionTile
            icon={<MapPin size={20} color={colour.forest800} strokeWidth={2} />}
            label="Explore the Map"
            caption="See clubs near you"
            onPress={() => router.push("/clubhouse/map" as never)}
          />
          <ActionTile
            icon={<UserPlus size={20} color={colour.forest800} strokeWidth={2} />}
            label="Refer a Club"
            caption="Get 1 month free"
            onPress={() => router.push("/clubhouse/refer" as never)}
          />
        </View>

        <ReferralPromoCard onPress={() => router.push("/clubhouse/refer" as never)} />

        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[type.heading, { color: colour.ink }]}>Recent Activity</Text>
          </View>
          {activity === null && !activityError && (
            <View style={{ gap: space.sm }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}
          {activity !== null && activity.length === 0 && (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                Your Clubhouse activity will appear here as you connect with clubs and arrange fixtures.
              </Text>
            </View>
          )}
          {activity !== null && activity.length > 0 && (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {activity.map((item, index) => (
                <ActivityRow key={item.id} item={item} isFirst={index === 0} onPress={() => openActivity(item)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

/**
 * THE HERO, STATIC AND NETWORK-WIDE -- not a specific fixture or session, so it never swipes and never
 * carries club-accent colouring the way the Home tab's own match/training hero does. Same grammar
 * though: a bundled, reviewed editorial photograph (never club-specific, never generated for this
 * screen), a forest gradient thinning where the words are, chalk type over it. `editorial.news.community`
 * is the one bundled asset actually named for this ("community" -- a pitch/evening photograph, no crest,
 * no face, no text) rather than a new image invented for this pass.
 */
function ClubhouseHero({ onOpenMap }: { onOpenMap: () => void }) {
  const artwork = editorial.news.community
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clubhouse. The rugby community, all in one place. Open the map."
      onPress={onOpenMap}
      style={({ pressed }) => ({ height: 168, borderRadius: 22, overflow: "hidden", backgroundColor: colour.forest900, opacity: pressed ? 0.95 : 1 })}
    >
      {artwork && <Image source={artwork} accessible={false} contentFit="cover" contentPosition="center" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />}
      <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="clubhouseHeroShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.5" />
            <Stop offset="0.5" stopColor={colour.forest950} stopOpacity="0.3" />
            <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.88" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#clubhouseHeroShade)" />
      </Svg>
      <View style={{ flex: 1, padding: space.lg, justifyContent: "flex-end" }}>
        <Text style={[type.display, { color: colour.onForest, fontSize: 28, lineHeight: 32 }]}>Clubhouse</Text>
        <Text style={[type.small, { color: colour.onForestMuted, marginTop: 4 }]}>
          The rugby community, all in one place. Find clubs, arrange fixtures, make partnerships and grow the game together.
        </Text>
      </View>
    </Pressable>
  )
}

function ActionTile({ icon, label, caption, onPress }: { icon: React.ReactNode; label: string; caption: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: "47%",
        minHeight: 96,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : colour.surface,
        padding: space.md,
        justifyContent: "space-between",
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        {icon}
      </View>
      <View>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{caption}</Text>
      </View>
    </Pressable>
  )
}

/**
 * THE REWARD IS REAL, and this card must never claim more than the same DB-enforced rule the web
 * billing surface already states: a reward is earned only once the referred club's first Ovalball
 * subscription payment is successfully collected -- never a click, a signup, or a mandate. Tapping
 * through opens `/clubhouse/refer`, which reads the real `club_referral_summary`/`club_credit_balance_pence`
 * RPCs rather than asserting the reward has been earned here.
 */
function ReferralPromoCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refer a rugby club. Get one month free. Help grow the rugby community."
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.lg,
        backgroundColor: colour.forest800,
        padding: space.lg,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.mint300 }]}>Refer a rugby club</Text>
        <Text style={[type.heading, { color: colour.onForest, marginTop: 2 }]}>Get 1 month free</Text>
        <Text style={[type.caption, { color: colour.onForestMuted, marginTop: 4 }]}>Help grow the rugby community</Text>
      </View>
      <ChevronRight size={20} color={colour.onForest} />
    </Pressable>
  )
}

function ActivityRow({ item, isFirst, onPress }: { item: FeedNotification; isFirst: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.body}`}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]} numberOfLines={2}>
        {item.body}
      </Text>
    </Pressable>
  )
}
